import {
  type CompanyCalendar,
  type DayOverrideMap,
  type Person,
  type Project,
  type Task,
  nextWorkday,
} from '@mplan/core';
import { asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  calendarExceptions,
  calendarSettings,
  dayOverrides,
  persons,
  projects,
  tasks,
} from '../db/schema.js';

type TaskRow = typeof tasks.$inferSelect;
type PersonRow = typeof persons.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type OverrideRow = typeof dayOverrides.$inferSelect;

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    depth: row.depth,
    sort: row.sort,
    name: row.name,
    ownerId: row.ownerId,
    estimateHours: Number(row.estimateHours),
    kind: row.kind,
    startDate: row.startDate,
    dueDate: row.dueDate,
    progressMode: row.progressMode,
    manualProgress: row.manualProgress,
    doneAt: row.doneAt ? new Date(row.doneAt).toISOString() : null,
    note: row.note,
  };
}

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    dailyHours: Number(row.dailyHours),
    active: row.active,
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    startDate: row.startDate,
    dueDate: row.dueDate,
    note: row.note,
    archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
  };
}

export function groupOverrides(rows: OverrideRow[]): Record<string, DayOverrideMap> {
  const out: Record<string, DayOverrideMap> = {};
  for (const r of rows) {
    const bucket = (out[r.scopeId] ??= {});
    bucket[r.date] = {
      work: r.work,
      hours: r.hours != null ? Number(r.hours) : null,
      note: r.note,
    };
  }
  return out;
}

export async function loadCompany(): Promise<CompanyCalendar> {
  const [settings] = await db.select().from(calendarSettings).limit(1);
  const rows = await db.select().from(calendarExceptions);
  const overrides: Record<string, 'off' | 'work'> = {};
  for (const r of rows) overrides[r.date] = r.type === 'holiday' ? 'off' : 'work';
  const weekend = (settings?.weekend ?? '0,6')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => n >= 0 && n <= 6);
  return { weekend: weekend.length ? weekend : [0, 6], overrides };
}

export async function loadPersonOverrides(): Promise<Record<string, DayOverrideMap>> {
  const rows = await db.select().from(dayOverrides).where(eq(dayOverrides.scope, 'person'));
  return groupOverrides(rows);
}

export async function loadTaskOverrides(taskIds: string[]): Promise<Record<string, DayOverrideMap>> {
  if (taskIds.length === 0) return {};
  const rows = await db
    .select()
    .from(dayOverrides)
    .where(inArray(dayOverrides.scopeId, taskIds));
  return groupOverrides(rows.filter((r) => r.scope === 'task'));
}

/** 默认只返回未归档项目；归档项目只在「已归档」入口里单独查询 */
export async function listProjects(includeArchived = false): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(includeArchived ? undefined : isNull(projects.archivedAt))
    .orderBy(asc(projects.sort), asc(projects.createdAt));
  return rows.map(toProject);
}

/** 已归档项目；具体谁能看到由调用方按项目管理员身份过滤 */
export async function listArchivedProjects(): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(isNotNull(projects.archivedAt))
    .orderBy(asc(projects.sort), asc(projects.createdAt));
  return rows.map(toProject);
}

export async function listPersons(): Promise<Person[]> {
  const rows = await db.select().from(persons).orderBy(asc(persons.sort), asc(persons.name));
  return rows.map(toPerson);
}

export async function listTasks(projectId: string): Promise<Task[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.projectId, projectId));
  return rows
    .map(toTask)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'));
}

/** 把开始日归一到工作日；用于各类写入前的兜底 */
export function normalizeStart(start: string, company: CompanyCalendar): string {
  return nextWorkday(start, { weekend: company.weekend, company: company.overrides });
}

export async function deleteTaskCascade(projectId: string, taskId: string): Promise<void> {
  const all = await listTasks(projectId);
  const doomed = new Set<string>([taskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all) {
      if (t.parentId && doomed.has(t.parentId) && !doomed.has(t.id)) {
        doomed.add(t.id);
        grew = true;
      }
    }
  }
  const ids = [...doomed];
  if (ids.length) {
    await db.delete(dayOverrides).where(inArray(dayOverrides.scopeId, ids));
    await db.delete(tasks).where(inArray(tasks.id, ids));
  }
}