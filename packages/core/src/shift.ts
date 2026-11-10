import type { CompanyCalendar, DayOverrideMap } from './calendar.js';
import { addWorkdays, countWorkdays, nextWorkday } from './calendar.js';
import { type DateStr, addDays } from './date.js';
import { calendarFor } from './derive.js';
import type { Task } from './tree.js';

export interface AutoShiftInput {
  /** 项目内全部任务（当前库里的旧日期） */
  tasks: Task[];
  /** 被改期的任务 id */
  taskId: string;
  /** 改期前的结束日 */
  oldDueDate: DateStr;
  /** 改期后的结束日 */
  newDueDate: DateStr;
  company: CompanyCalendar;
  personOverrides?: Record<string, DayOverrideMap> | null;
  taskOverrides?: Record<string, DayOverrideMap> | null;
}

export interface AutoShiftTarget {
  taskId: string;
  startDate: DateStr;
  dueDate: DateStr;
}

export interface AutoShiftResult {
  /** 公司日历口径的工作日差；只有 > 0 才有联动 */
  deltaWorkdays: number;
  targets: AutoShiftTarget[];
}

/**
 * 改期联动规则（v1）：
 * - 本项目、未完成、叶子任务；
 * - 开始日严格晚于被改任务的原结束日（同一天开始视为并行，不推）；
 * - 同负责人，或同一父级分支（父级整棵子树；同父级的不同负责人通常就是前后端交接）；
 * - 只往后推，delta <= 0 不处理；
 * - 每个任务按公司日历算 delta，再按自己的日历归一化，工期保持不变。
 */
export function computeAutoShift(input: AutoShiftInput): AutoShiftResult {
  const { tasks, taskId, oldDueDate, newDueDate, company } = input;
  const changed = tasks.find((t) => t.id === taskId);
  if (!changed || changed.doneAt) return { deltaWorkdays: 0, targets: [] };
  if (newDueDate <= oldDueDate) return { deltaWorkdays: 0, targets: [] };

  const hasChildren = new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId as string));
  if (hasChildren.has(taskId)) return { deltaWorkdays: 0, targets: [] };

  const companyCal = { weekend: company.weekend, company: company.overrides };
  const deltaWorkdays = countWorkdays(addDays(oldDueDate, 1), newDueDate, companyCal);
  if (deltaWorkdays <= 0) return { deltaWorkdays: 0, targets: [] };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parentId = changed.parentId;

  const inSameBranch = (t: Task): boolean => {
    if (!parentId) return false;
    let cursor: Task | undefined = t;
    for (let i = 0; i < 16 && cursor?.parentId; i++) {
      if (cursor.parentId === parentId) return true;
      cursor = byId.get(cursor.parentId);
    }
    return false;
  };

  const seen = new Set<string>();
  const targets: AutoShiftTarget[] = [];

  for (const t of tasks) {
    if (t.id === taskId || t.doneAt) continue;
    if (t.projectId !== changed.projectId) continue;
    if (hasChildren.has(t.id)) continue;
    if (t.startDate <= oldDueDate) continue;

    const sameOwner = changed.ownerId != null && t.ownerId === changed.ownerId;
    if (!sameOwner && !inSameBranch(t)) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);

    const cal = calendarFor(
      company,
      t.ownerId ? input.personOverrides?.[t.ownerId] : undefined,
      input.taskOverrides?.[t.id],
    );
    const duration =
      t.kind === 'milestone' ? 1 : Math.max(1, countWorkdays(t.startDate, t.dueDate, cal));
    const startDate = nextWorkday(addWorkdays(t.startDate, deltaWorkdays, companyCal), cal);
    const dueDate = t.kind === 'milestone' ? startDate : addWorkdays(startDate, duration - 1, cal);
    targets.push({ taskId: t.id, startDate, dueDate });
  }

  targets.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.taskId.localeCompare(b.taskId));
  return { deltaWorkdays, targets };
}

/**
 * 项目计划完成日被未完成叶子任务超过多少个工作日。
 * 项目没设完成日，或所有任务都完成时返回 0。
 */
export function projectOverdueWorkdays(
  tasks: Task[],
  projectDueDate: DateStr | null,
  company: CompanyCalendar,
): number {
  if (!projectDueDate) return 0;
  const hasChildren = new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId as string));
  let latest: DateStr | null = null;
  for (const t of tasks) {
    if (t.doneAt || hasChildren.has(t.id)) continue;
    if (!latest || t.dueDate > latest) latest = t.dueDate;
  }
  if (!latest || latest <= projectDueDate) return 0;
  return countWorkdays(addDays(projectDueDate, 1), latest, {
    weekend: company.weekend,
    company: company.overrides,
  });
}