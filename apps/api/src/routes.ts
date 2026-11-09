import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  type DayOverrideMap,
  type Task,
  MAX_DEPTH,
  addDays,
  addWorkdays,
  calendarFor,
  codeSegments,
  compareCodes,
  countWorkdays,
  parentCode,
  nextWorkday,
  rescheduleByDue,
  rescheduleByHours,
  todayStr,
} from '@mplan/core';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db/client.js';
import {
  calendarExceptions,
  calendarSettings,
  changeLog,
  dayOverrides,
  persons,
  projectMembers,
  projects,
  tasks,
  users,
} from './db/schema.js';
import { actorOf, writeLog } from './lib/log.js';
import {
  canAdminProject,
  countUsers,
  requireAdmin,
  requireProjectAccess,
  requireProjectAdmin,
} from './lib/auth.js';
import {
  deleteTaskCascade,
  listArchivedProjects,
  listPersons,
  listProjects,
  listTasks,
  loadCompany,
  loadPersonOverrides,
  loadTaskOverrides,
  toProject,
  toTask,
} from './lib/data.js';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const projectBody = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(32).optional(),
  startDate: dateStr,
  dueDate: dateStr.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

const personBody = z.object({
  name: z.string().min(1).max(60),
  role: z.string().max(60).nullable().optional(),
  color: z.string().max(16).optional(),
});

const overrideItem = z.object({
  date: dateStr,
  work: z.boolean(),
  hours: z.number().min(0).max(24).nullable().optional(),
  note: z.string().max(120).nullable().optional(),
});

function httpError(message: string, statusCode = 400): Error {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw httpError(`${first.path.join('.') || '请求体'}：${first.message}`);
  }
  return result.data;
}

/** 改完任务后自下而上重算父节点的起止时间，保证库里的汇总区间不飘 */
async function recomputeParentRanges(projectId: string): Promise<void> {
  const all = await listTasks(projectId);
  const childrenOf = new Map<string, Task[]>();
  for (const t of all) {
    if (!t.parentId) continue;
    const list = childrenOf.get(t.parentId) ?? [];
    list.push(t);
    childrenOf.set(t.parentId, list);
  }
  const depthDesc = [...all].sort((a, b) => b.depth - a.depth);
  for (const parent of depthDesc) {
    const kids = childrenOf.get(parent.id);
    if (!kids?.length) continue;
    const start = kids.reduce((m, k) => (k.startDate < m ? k.startDate : m), kids[0].startDate);
    const due = kids.reduce((m, k) => (k.dueDate > m ? k.dueDate : m), kids[0].dueDate);
    if (start !== parent.startDate || due !== parent.dueDate) {
      await db
        .update(tasks)
        .set({ startDate: start, dueDate: due, updatedAt: new Date() })
        .where(eq(tasks.id, parent.id));
    }
  }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---------- 启动数据 ----------
  app.get('/api/health', async () => ({ ok: true, today: todayStr() }));

  app.get('/api/bootstrap', async (req) => {
    const [projectList, archivedList, personList, company, personOverrides, userCount] =
      await Promise.all([
        listProjects(),
        listArchivedProjects(),
        listPersons(),
        loadCompany(),
        loadPersonOverrides(),
        countUsers(),
      ]);
    // 归档项目只对能管理它的人可见：全局管理员看全部，项目管理员只看自己管理的
    const archivedProjects = archivedList.filter(
      (p) =>
        req.currentUser?.role === 'admin' ||
        Boolean(p.id && req.currentUser?.projectAdminIds.includes(p.id)),
    );
    const [settings] = await db.select().from(calendarSettings).limit(1);
    const exceptions = await db.select().from(calendarExceptions);
    return {
      today: todayStr(),
      projects: projectList,
      archivedProjects,
      persons: personList,
      calendar: {
        name: settings?.name ?? '公司日历',
        version: settings?.version ?? '2026.1',
        weekend: company.weekend,
        exceptions: exceptions
          .map((e) => ({ date: e.date, type: e.type, name: e.name }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      },
      personOverrides,
      auth: {
        user: req.currentUser,
        // canEdit 这里表示「有项目可编辑」；具体某个项目能不能改由前端按 projectIds 判断
        canEdit:
          req.currentUser?.role === 'admin' || (req.currentUser?.projectIds.length ?? 0) > 0,
        isAdmin: req.currentUser?.role === 'admin',
        projectIds: req.currentUser?.projectIds ?? [],
        projectAdminIds: req.currentUser?.projectAdminIds ?? [],
        needsSetup: userCount === 0,
      },
    };
  });

  // ---------- 项目 ----------
  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw httpError('项目不存在', 404);
    // 归档项目只允许其管理员打开（用于恢复或查看），其他人和匿名访问一律按不存在处理
    if (row.archivedAt && !canAdminProject(req.currentUser, id)) throw httpError('项目不存在', 404);
    const taskList = await listTasks(id);
    const taskOverrides = await loadTaskOverrides(taskList.map((t) => t.id));
    return {
      today: todayStr(),
      project: toProject(row),
      tasks: taskList,
      taskOverrides,
      personOverrides: await loadPersonOverrides(),
    };
  });

  app.post('/api/projects', async (req, reply) => {
    requireAdmin(req);
    const body = parse(projectBody, req.body);
    const id = randomUUID();
    const code = body.code?.trim() || `P${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const existing = await listProjects(true);
    await db.insert(projects).values({
      id,
      name: body.name,
      code,
      sort: existing.length,
      startDate: body.startDate,
      dueDate: body.dueDate ?? null,
      note: body.note ?? null,
    });
    reply.code(201);
    return { id, code };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(projectBody.partial(), req.body);
    const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw httpError('项目不存在', 404);
    requireProjectAdmin(req, id);
    await db
      .update(projects)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projects.id, id));
    return { ok: true };
  });

  app.delete('/api/projects/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const taskList = await listTasks(id);
    for (const t of taskList) {
      await db.delete(dayOverrides).where(eq(dayOverrides.scopeId, t.id));
    }
    await db.delete(tasks).where(eq(tasks.projectId, id));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    return { ok: true };
  });

  /** 归档：项目从列表里隐藏，任务 / 成员 / 变更日志都保留 */
  app.post('/api/projects/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw httpError('项目不存在', 404);
    requireProjectAdmin(req, id);
    if (!row.archivedAt) {
      const archivedAt = new Date();
      await db
        .update(projects)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(eq(projects.id, id));
      return { ok: true, archivedAt: archivedAt.toISOString() };
    }
    return { ok: true, archivedAt: new Date(row.archivedAt).toISOString() };
  });

  /** 恢复归档：重新出现在项目列表里 */
  app.post('/api/projects/:id/unarchive', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw httpError('项目不存在', 404);
    requireProjectAdmin(req, id);
    if (row.archivedAt) {
      await db
        .update(projects)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(projects.id, id));
    }
    return { ok: true };
  });

  // ---------- 项目成员 ----------
  app.get('/api/projects/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) throw httpError('项目不存在', 404);
    requireProjectAdmin(req, id);

    const rows = await db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        active: users.active,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, id))
      .orderBy(projectMembers.role, users.displayName);

    const assigned = new Set(rows.map((r) => r.userId));
    const allUsers = await db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(users.displayName);

    return {
      members: rows,
      // 项目成员只能从已有账号里选；全局管理员默认拥有全部项目，不列进候选
      candidates: allUsers.filter((u) => u.role !== 'admin' && !assigned.has(u.userId)),
    };
  });

  app.post('/api/projects/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ userId: z.string().min(1).max(36) }), req.body);
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) throw httpError('项目不存在', 404);
    requireProjectAdmin(req, id);

    const [target] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!target) throw httpError('用户不存在', 404);
    if (!target.active) throw httpError('这个账号已被停用');
    if (target.role === 'admin') throw httpError('全局管理员默认拥有全部项目权限，不需要添加');

    const [existing] = await db
      .select({ id: projectMembers.id, role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, id), eq(projectMembers.userId, body.userId)),
      )
      .limit(1);
    if (existing) {
      reply.code(200);
      return {
        member: {
          userId: target.id,
          username: target.username,
          displayName: target.displayName,
          active: target.active,
          role: existing.role,
        },
      };
    }

    await db.insert(projectMembers).values({
      id: randomUUID(),
      userId: target.id,
      projectId: id,
      role: 'member',
    });
    reply.code(201);
    return {
      member: {
        userId: target.id,
        username: target.username,
        displayName: target.displayName,
        active: target.active,
        role: 'member' as const,
      },
    };
  });

  app.delete('/api/projects/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) throw httpError('项目不存在', 404);
    requireProjectAdmin(req, id);

    const [link] = await db
      .select({ id: projectMembers.id, role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!link) throw httpError('这个用户不在项目成员里', 404);
    if (req.currentUser?.id === userId) throw httpError('不能移除自己');
    if (req.currentUser?.role !== 'admin' && link.role === 'admin') {
      throw httpError('项目管理员不能移除其他项目管理员', 403);
    }
    await db.delete(projectMembers).where(eq(projectMembers.id, link.id));
    return { ok: true };
  });

  // ---------- 人员 ----------
  app.post('/api/persons', async (req, reply) => {
    requireAdmin(req);
    const body = parse(personBody, req.body);
    const existing = await listPersons();
    const used = new Set(existing.map((p) => p.color));
    const palette = ['teal', 'indigo', 'amber', 'rose', 'sky', 'violet', 'lime', 'orange', 'cyan'];
    const color = body.color ?? palette.find((c) => !used.has(c)) ?? 'slate';
    const id = randomUUID();
    await db.insert(persons).values({
      id,
      name: body.name,
      role: body.role ?? null,
      color,
      dailyHours: '8.00',
      active: true,
      sort: existing.length,
    });
    reply.code(201);
    return { id };
  });

  app.patch('/api/persons/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = parse(
      personBody.partial().extend({ active: z.boolean().optional() }),
      req.body,
    );
    await db
      .update(persons)
      .set({ ...body })
      .where(eq(persons.id, id));
    return { ok: true };
  });

  app.delete('/api/persons/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    await db.update(tasks).set({ ownerId: null }).where(eq(tasks.ownerId, id));
    await db.delete(dayOverrides).where(eq(dayOverrides.scopeId, id));
    await db.delete(persons).where(eq(persons.id, id));
    return { ok: true };
  });

  app.put('/api/persons/:id/days', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = parse(z.object({ overrides: z.array(overrideItem) }), req.body);
    await db.delete(dayOverrides).where(eq(dayOverrides.scopeId, id));
    if (body.overrides.length) {
      await db.insert(dayOverrides).values(
        body.overrides.map((o) => ({
          id: randomUUID(),
          scope: 'person' as const,
          scopeId: id,
          date: o.date,
          work: o.work,
          hours: o.hours != null ? String(o.hours) : null,
          note: o.note ?? null,
        })),
      );
    }
    const rows = await db.select().from(dayOverrides).where(eq(dayOverrides.scopeId, id));
    const map: DayOverrideMap = {};
    for (const r of rows) map[r.date] = { work: r.work, hours: r.hours ? Number(r.hours) : null, note: r.note };
    return { overrides: map };
  });

  // ---------- 公司日历 ----------
  app.put('/api/calendar', async (req) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        weekend: z.array(z.number().int().min(0).max(6)).min(1),
        exceptions: z.array(
          z.object({
            date: dateStr,
            type: z.enum(['holiday', 'workday']),
            name: z.string().max(60),
          }),
        ),
      }),
      req.body,
    );
    await db
      .update(calendarSettings)
      .set({ weekend: body.weekend.join(',') })
      .where(eq(calendarSettings.id, 1));
    await db.delete(calendarExceptions);
    if (body.exceptions.length) {
      await db
        .insert(calendarExceptions)
        .values(body.exceptions.map((e) => ({ id: randomUUID(), ...e })));
    }
    return { ok: true };
  });

  // ---------- 任务 ----------
  app.post('/api/projects/:id/tasks', async (req, reply) => {
    const { id: projectId } = req.params as { id: string };
    const body = parse(
      z.object({
        parentId: z.string().nullable().optional(),
        name: z.string().min(1).max(200),
        ownerId: z.string().nullable().optional(),
        estimateHours: z.number().min(0).max(10000).optional(),
        startDate: dateStr.optional(),
        kind: z.enum(['task', 'milestone']).optional(),
      }),
      req.body,
    );

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw httpError('项目不存在', 404);
    requireProjectAccess(req, projectId);

    let depth = 1;
    if (body.parentId) {
      const siblings = await listTasks(projectId);
      const parent = siblings.find((t) => t.id === body.parentId);
      if (!parent) throw httpError('父任务不存在', 404);
      if (parent.kind === 'milestone') throw httpError('里程碑下面不能再挂任务');
      depth = parent.depth + 1;
      if (depth > MAX_DEPTH) throw httpError(`最多 ${MAX_DEPTH} 层，不能再往下拆了`);
    }

    const company = await loadCompany();
    const personOverrides = await loadPersonOverrides();
    const cal = calendarFor(company, body.ownerId ? personOverrides[body.ownerId] : null);
    const kind = body.kind ?? 'task';
    const hours = kind === 'milestone' ? 0 : (body.estimateHours ?? 8);
    const schedule =
      kind === 'milestone'
        ? (() => {
            const startDate = nextWorkday(body.startDate ?? project.startDate, cal);
            return { startDate, dueDate: startDate, estimateHours: 0 };
          })()
        : rescheduleByHours(body.startDate ?? project.startDate, hours, cal);

    const siblings = await listTasks(projectId);
    const sameParent = siblings.filter((t) => t.parentId === (body.parentId ?? null));
    const sort = sameParent.reduce((m, t) => Math.max(m, t.sort), -1) + 1;

    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      projectId,
      parentId: body.parentId ?? null,
      depth,
      sort,
      name: body.name,
      ownerId: body.ownerId ?? null,
      estimateHours: String(schedule.estimateHours),
      startDate: schedule.startDate,
      dueDate: schedule.dueDate,
      kind,
      progressMode: 'auto',
      doneAt: null,
      note: null,
    });
    await recomputeParentRanges(projectId);
    await writeLog(
      [
        {
          projectId,
          taskId: id,
          taskName: body.name,
          action: 'create',
          after: kind === 'milestone' ? '里程碑' : `${hours}h`,
        },
      ],
      actorOf(req),
    );
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    reply.code(201);
    return { task: toTask(row) };
  });

  app.patch('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        name: z.string().min(1).max(200).optional(),
        ownerId: z.string().nullable().optional(),
        estimateHours: z.number().min(0).max(10000).optional(),
        startDate: dateStr.optional(),
        dueDate: dateStr.optional(),
        kind: z.enum(['task', 'milestone']).optional(),
        progressMode: z.enum(['auto', 'manual']).optional(),
        manualProgress: z.number().min(0).max(100).nullable().optional(),
        done: z.boolean().optional(),
        note: z.string().max(4000).nullable().optional(),
        /** none = 严格按传入值写入（拖拽平移用），hours / due = 按对应字段重算 */
        recalc: z.enum(['none', 'hours', 'due']).optional(),
      }),
      req.body,
    );

    const [current] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!current) throw httpError('任务不存在', 404);
    requireProjectAccess(req, current.projectId);

    const all = await listTasks(current.projectId);
    const hasChildren = all.some((t) => t.parentId === id);
    const kind = body.kind ?? current.kind;
    if (kind === 'milestone' && hasChildren) throw httpError('有子任务的任务不能改成里程碑');

    const ownerId = body.ownerId !== undefined ? body.ownerId : current.ownerId;

    const company = await loadCompany();
    const personOverrides = await loadPersonOverrides();
    const taskOverrides = await loadTaskOverrides([id]);
    const cal = calendarFor(company, ownerId ? personOverrides[ownerId] : null, taskOverrides[id]);

    let startDate = current.startDate;
    let dueDate = current.dueDate;
    let estimateHours = Number(current.estimateHours);

    if (kind === 'milestone') {
      const start = nextWorkday(body.startDate ?? current.startDate, cal);
      startDate = start;
      dueDate = start;
      estimateHours = 0;
    } else {
      const hoursInput =
        body.estimateHours ?? (current.kind === 'milestone' ? 8 : Number(current.estimateHours));
      const dateTouched =
        body.estimateHours !== undefined ||
        body.startDate !== undefined ||
        body.dueDate !== undefined ||
        body.recalc !== undefined ||
        current.kind !== kind;

      if (!hasChildren && dateTouched) {
        const start = body.startDate ?? current.startDate;
        const recalc = body.recalc;
        if (recalc === 'none') {
          // 拖拽平移：日期按原样落库，工时保持不变
          startDate = nextWorkday(start, cal);
          dueDate = body.dueDate ?? current.dueDate;
          if (dueDate < startDate) dueDate = startDate;
          estimateHours = hoursInput;
        } else if (recalc === 'due' || (recalc === undefined && body.dueDate !== undefined)) {
          const r = rescheduleByDue(start, body.dueDate ?? current.dueDate, cal);
          startDate = r.startDate;
          dueDate = r.dueDate;
          estimateHours = r.estimateHours;
        } else {
          const r = rescheduleByHours(start, hoursInput, cal);
          startDate = r.startDate;
          dueDate = r.dueDate;
          estimateHours = r.estimateHours;
        }
      }
    }

    const doneAt = body.done === undefined ? current.doneAt : body.done ? new Date() : null;

    await db
      .update(tasks)
      .set({
        name: body.name ?? current.name,
        ownerId,
        estimateHours: String(estimateHours),
        startDate,
        dueDate,
        kind,
        progressMode: body.progressMode ?? current.progressMode,
        manualProgress:
          body.manualProgress !== undefined ? body.manualProgress : current.manualProgress,
        doneAt,
        note: body.note !== undefined ? body.note : current.note,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));

    await recomputeParentRanges(current.projectId);

    // ---------- 变更日志 ----------
    const personList = await listPersons();
    const nameOf = (pid: string | null) =>
      pid ? (personList.find((p) => p.id === pid)?.name ?? '未分配') : '未分配';
    const entries: Array<{
      projectId: string;
      taskId: string;
      taskName: string;
      action: 'update';
      field: string;
      before: string;
      after: string;
    }> = [];
    const taskName = body.name ?? current.name;
    const push = (field: string, before: string, after: string) =>
      entries.push({ projectId: current.projectId, taskId: id, taskName, action: 'update', field, before, after });

    if (body.name && body.name !== current.name) push('name', current.name, body.name);
    if (body.ownerId !== undefined && ownerId !== current.ownerId)
      push('owner', nameOf(current.ownerId), nameOf(ownerId));
    if (Number(current.estimateHours) !== estimateHours)
      push('hours', `${Number(current.estimateHours)}h`, `${estimateHours}h`);
    if (current.startDate !== startDate || current.dueDate !== dueDate)
      push('dates', `${current.startDate} → ${current.dueDate}`, `${startDate} → ${dueDate}`);
    if (body.kind && body.kind !== current.kind)
      push('kind', current.kind === 'milestone' ? '里程碑' : '任务', kind === 'milestone' ? '里程碑' : '任务');
    if (Boolean(current.doneAt) !== Boolean(doneAt))
      push('done', current.doneAt ? '已完成' : '未完成', doneAt ? '已完成' : '未完成');
    if (body.note !== undefined && (body.note ?? '') !== (current.note ?? '')) push('note', '备注', '已修改');

    await writeLog(entries, actorOf(req));

    const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return { task: toTask(row) };
  });

  /**
   * 顺延：把这个逾期任务和它之后（按开始日）所有未完成任务，整体后移 overdue 个工作日。
   * 不做依赖求解，只按时间顺序推，覆盖日常排期维护的绝大多数场景。
   */
  app.post('/api/tasks/:id/postpone', async (req) => {
    const { id } = req.params as { id: string };
    const [current] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!current) throw httpError('任务不存在', 404);
    requireProjectAccess(req, current.projectId);
    if (current.doneAt) throw httpError('已完成的任务不需要顺延');

    const all = await listTasks(current.projectId);
    const parentIds = new Set(all.filter((t) => all.some((c) => c.parentId === t.id)).map((t) => t.id));
    if (parentIds.has(id)) throw httpError('请对最末级任务操作');

    const today = todayStr();
    if (today <= current.dueDate) throw httpError('这个任务还没有逾期');

    const company = await loadCompany();
    const personOverrides = await loadPersonOverrides();
    const taskOverrides = await loadTaskOverrides(all.map((t) => t.id));
    const calFor = (t: Task) =>
      calendarFor(company, t.ownerId ? personOverrides[t.ownerId] : null, taskOverrides[t.id]);

    // 统一用公司日历算偏移，保证所有人按同一条时间线整体后移，
    // 否则个别同事的加班日会让他的任务只挪 5 天、别人挪 7 天，节奏就错位了。
    const companyCal = { weekend: company.weekend, company: company.overrides };
    const delta = countWorkdays(addDays(current.dueDate, 1), today, companyCal);
    if (delta <= 0) throw httpError('没有需要顺延的工作日');

    const targets = all.filter(
      (t) => !t.doneAt && !parentIds.has(t.id) && t.startDate >= current.startDate,
    );

    for (const t of targets) {
      const ownerCal = calFor(t);
      const duration = Math.max(1, countWorkdays(t.startDate, t.dueDate, ownerCal));
      const startDate = nextWorkday(
        addWorkdays(t.startDate, delta, companyCal),
        ownerCal,
      );
      const dueDate = addWorkdays(startDate, duration - 1, ownerCal);
      await db
        .update(tasks)
        .set({ startDate, dueDate, updatedAt: new Date() })
        .where(eq(tasks.id, t.id));
    }

    await recomputeParentRanges(current.projectId);

    await writeLog(
      [
        {
          projectId: current.projectId,
          taskId: id,
          taskName: current.name,
          action: 'postpone',
          field: 'dates',
          before: `${current.startDate} → ${current.dueDate}`,
          after: `+${delta} 个工作日（共 ${targets.length} 个任务）`,
        },
      ],
      actorOf(req),
    );

    return {
      deltaWorkdays: delta,
      shifted: targets.length,
      names: targets.map((t) => t.name),
    };
  });

  app.delete('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [current] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!current) throw httpError('任务不存在', 404);
    requireProjectAccess(req, current.projectId);
    await deleteTaskCascade(current.projectId, id);
    await recomputeParentRanges(current.projectId);
    await writeLog(
      [{ projectId: current.projectId, taskId: id, taskName: current.name, action: 'delete' }],
      actorOf(req),
    );
    return { ok: true };
  });

  app.put('/api/tasks/:id/days', async (req) => {
    const { id } = req.params as { id: string };
    const [taskRow] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!taskRow) throw httpError('任务不存在', 404);
    requireProjectAccess(req, taskRow.projectId);
    const body = parse(z.object({ overrides: z.array(overrideItem) }), req.body);
    await db.delete(dayOverrides).where(eq(dayOverrides.scopeId, id));
    if (body.overrides.length) {
      await db.insert(dayOverrides).values(
        body.overrides.map((o) => ({
          id: randomUUID(),
          scope: 'task' as const,
          scopeId: id,
          date: o.date,
          work: o.work,
          hours: o.hours != null ? String(o.hours) : null,
          note: o.note ?? null,
        })),
      );
    }
    return { ok: true };
  });

  // ---------- CSV 导入 ----------
  app.post('/api/import', async (req, reply) => {
    const body = parse(
      z.object({
        projectId: z.string().optional(),
        newProject: z
          .object({
            name: z.string().min(1).max(120),
            code: z.string().max(32).optional(),
            startDate: dateStr.optional(),
          })
          .optional(),
        autoCreatePersons: z.boolean().optional(),
        rows: z
          .array(
            z.object({
              /** WBS 编号：1 / 1.2 / 1.2.3，最多 4 段 */
              code: z.string().min(1).max(24),
              kind: z.enum(['task', 'milestone']).optional(),
              name: z.string().min(1).max(200),
              owner: z.string().max(60).nullable().optional(),
              hours: z.number().min(0).max(10000).optional(),
              start: dateStr.optional(),
              due: dateStr.optional(),
              done: z.boolean().optional(),
              note: z.string().max(4000).nullable().optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
      req.body,
    );

    const company = await loadCompany();
    const personOverrides = await loadPersonOverrides();
    const projectStart = body.rows.find((r) => r.start)?.start ?? todayStr();

    let projectId: string;
    if (body.newProject) {
      requireAdmin(req);
      projectId = randomUUID();
      const code =
        body.newProject.code?.trim() || `P${Date.now().toString(36).toUpperCase().slice(-5)}`;
      const existing = await listProjects(true);
      await db.insert(projects).values({
        id: projectId,
        name: body.newProject.name,
        code,
        startDate: body.newProject.startDate ?? projectStart,
        dueDate: null,
        note: '由 CSV 模板导入',
        sort: existing.length,
      });
    } else if (body.projectId) {
      const [p] = await db.select().from(projects).where(eq(projects.id, body.projectId)).limit(1);
      if (!p) throw httpError('项目不存在', 404);
      requireProjectAccess(req, body.projectId);
      projectId = body.projectId;
    } else {
      throw httpError('请指定导入目标');
    }

    const personList = await listPersons();
    const byName = new Map(personList.map((p) => [p.name, p.id]));
    const palette = ['teal', 'indigo', 'amber', 'rose', 'sky', 'violet', 'lime', 'orange', 'cyan'];
    const usedColors = new Set(personList.map((p) => p.color));
    let personsCreated = 0;

    const sortCounters = new Map<string, number>();
    const idByCode = new Map<string, string>();
    let created = 0;

    // 行顺序无所谓：按编号排序后，父节点一定先于子节点出现
    const sortedRows = [...body.rows].sort((a, b) => compareCodes(a.code, b.code));

    for (let i = 0; i < sortedRows.length; i++) {
      const r = sortedRows[i];
      const segments = codeSegments(r.code);
      if (!segments) throw httpError(`第 ${i + 1} 行：编号「${r.code}」格式不对`);
      if (segments.length > MAX_DEPTH) throw httpError(`第 ${i + 1} 行：编号 ${r.code} 超过 ${MAX_DEPTH} 层`);
      if (idByCode.has(r.code)) throw httpError(`第 ${i + 1} 行：编号 ${r.code} 重复`);

      const pc = parentCode(r.code);
      const parentId = pc ? (idByCode.get(pc) ?? null) : null;
      if (pc && !parentId) throw httpError(`第 ${i + 1} 行：编号 ${r.code} 的上级 ${pc} 不存在`);

      let ownerId: string | null = null;
      const ownerName = r.owner?.trim();
      if (ownerName) {
        ownerId = byName.get(ownerName) ?? null;
        if (!ownerId) {
          if (!body.autoCreatePersons) throw httpError(`第 ${i + 1} 行：负责人「${ownerName}」不存在`);
          ownerId = randomUUID();
          const color = palette.find((c) => !usedColors.has(c)) ?? 'slate';
          usedColors.add(color);
          await db.insert(persons).values({
            id: ownerId,
            name: ownerName,
            role: null,
            color,
            dailyHours: '8.00',
            active: true,
            sort: personList.length + personsCreated,
          });
          byName.set(ownerName, ownerId);
          personsCreated++;
        }
      }

      const kind = r.kind ?? 'task';
      const hours = kind === 'milestone' ? 0 : (r.hours ?? 0);
      const cal = calendarFor(company, ownerId ? personOverrides[ownerId] : null);
      const start = r.start ?? projectStart;
      const schedule =
        kind === 'milestone'
          ? (() => {
              const s = nextWorkday(start, cal);
              return { startDate: s, dueDate: s, estimateHours: 0 };
            })()
          : r.due
            ? rescheduleByDue(start, r.due, cal)
            : rescheduleByHours(start, hours, cal);

      const sortKey = parentId ?? '__root__';
      const sort = sortCounters.get(sortKey) ?? 0;
      sortCounters.set(sortKey, sort + 1);

      const id = randomUUID();
      await db.insert(tasks).values({
        id,
        projectId,
        parentId,
        depth: segments.length,
        sort,
        name: r.name,
        ownerId,
        estimateHours: String(schedule.estimateHours),
        startDate: schedule.startDate,
        dueDate: schedule.dueDate,
        kind,
        progressMode: 'auto',
        manualProgress: null,
        doneAt: r.done ? new Date() : null,
        note: r.note ?? null,
      });

      idByCode.set(r.code, id);
      created++;
    }

    // 导入时父节点也会走「按结束日反算工时」的分支，把 0 工时算成 工期×8。
    // 父节点的工时没有业务意义（展示时按子节点汇总），统一归零。
    const inserted = await listTasks(projectId);
    const parentIds = new Set(inserted.filter((t) => t.parentId).map((t) => t.parentId as string));
    for (const pid of parentIds) {
      await db.update(tasks).set({ estimateHours: '0.00' }).where(eq(tasks.id, pid));
    }

    await recomputeParentRanges(projectId);
    await writeLog(
      [
        {
          projectId,
          action: 'import',
          taskName: body.newProject?.name ?? 'CSV 导入',
          after: `${created} 行`,
        },
      ],
      actorOf(req),
    );

    reply.code(201);
    return { projectId, created, personsCreated };
  });

  // ---------- 变更日志 ----------
  app.get('/api/projects/:id/changes', async (req) => {
    const { id } = req.params as { id: string };
    const [project] = await db
      .select({ archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!project) throw httpError('项目不存在', 404);
    if (project.archivedAt && !canAdminProject(req.currentUser, id)) {
      throw httpError('项目不存在', 404);
    }
    const q = req.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 120));
    const rows = await db
      .select()
      .from(changeLog)
      .where(eq(changeLog.projectId, id))
      .orderBy(desc(changeLog.createdAt))
      .limit(limit);
    return {
      changes: rows.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        taskName: r.taskName,
        action: r.action,
        field: r.field,
        before: r.beforeValue,
        after: r.afterValue,
        actor: r.actor,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}