import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db/client.js';
import { projectMembers, projects, sessions, users } from './db/schema.js';
import {
  type AuthUser,
  assertLoginAllowed,
  clearLoginFailures,
  clearSessionCookie,
  countUsers,
  createSession,
  destroySession,
  hashPassword,
  httpError,
  readSessionToken,
  recordLoginFailure,
  requireAdmin,
  setSessionCookie,
  verifyPassword,
} from './lib/auth.js';

const usernameSchema = z
  .string()
  .trim()
  .min(2, '用户名至少 2 位')
  .max(32)
  .regex(/^[a-zA-Z0-9_.@-]+$/, '用户名只能包含字母、数字和 _ . @ -');
const passwordSchema = z.string().min(6, '密码至少 6 位').max(128);
const displayNameSchema = z.string().trim().min(1, '请填写显示名称').max(60);
const roleSchema = z.enum(['admin', 'member']);
const projectIdsSchema = z.array(z.string().max(36)).max(200).optional();
const projectAdminIdsSchema = z.array(z.string().max(36)).max(200).optional();

type UserRow = typeof users.$inferSelect;

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw httpError(`${first.path.join('.') || '请求体'}：${first.message}`);
  }
  return result.data;
}

function toAuthUser(
  row: UserRow,
  projectIds: string[] = [],
  projectAdminIds: string[] = [],
): AuthUser {
  const globalAdmin = row.role === 'admin';
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    projectIds: globalAdmin ? [] : projectIds,
    projectAdminIds: globalAdmin ? [] : projectAdminIds,
  };
}

function toSummary(row: UserRow, projectIds: string[] = [], projectAdminIds: string[] = []) {
  return {
    ...toAuthUser(row, projectIds, projectAdminIds),
    active: row.active,
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

async function loadUser(id: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw httpError('用户不存在', 404);
  return row;
}

async function projectAssignmentsOf(userId: string): Promise<{
  projectIds: string[];
  projectAdminIds: string[];
}> {
  const rows = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return {
    projectIds: rows.map((r) => r.projectId),
    projectAdminIds: rows.filter((r) => r.role === 'admin').map((r) => r.projectId),
  };
}

/** 校验项目都存在并去重；去重后保持前端传入的顺序 */
async function normalizeProjectIds(ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.id, unique));
  if (rows.length !== unique.length) throw httpError('选择的项目不存在或已被删除', 400);
  return unique;
}

function ensureAdminSubset(projectIds: string[], projectAdminIds: string[]): void {
  const ids = new Set(projectIds);
  if (projectAdminIds.some((id) => !ids.has(id))) {
    throw httpError('项目管理员必须同时拥有该项目的编辑权限', 400);
  }
}

async function replaceProjectAssignments(
  userId: string,
  projectIds: string[],
  projectAdminIds: string[],
): Promise<void> {
  ensureAdminSubset(projectIds, projectAdminIds);
  await db.delete(projectMembers).where(eq(projectMembers.userId, userId));
  if (projectIds.length === 0) return;
  const admins = new Set(projectAdminIds);
  await db.insert(projectMembers).values(
    projectIds.map((projectId) => ({
      id: randomUUID(),
      userId,
      projectId,
      role: admins.has(projectId) ? ('admin' as const) : ('member' as const),
    })),
  );
}

/** 除某个账号外，还有几个启用中的管理员 */
async function activeAdminsExcept(id: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)));
  return rows.length;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ---------- 当前身份 ----------
  app.get('/api/auth/me', async (req) => ({
    user: req.currentUser,
    canEdit:
      req.currentUser?.role === 'admin' || (req.currentUser?.projectIds.length ?? 0) > 0,
    isAdmin: req.currentUser?.role === 'admin',
    needsSetup: (await countUsers()) === 0,
  }));

  /** 首次使用：库里一个账号都没有时，允许创建第一个管理员并直接登录 */
  app.post('/api/auth/setup', async (req, reply) => {
    if ((await countUsers()) > 0) throw httpError('系统已经初始化过了，请直接登录', 403);
    const body = parse(
      z.object({
        username: usernameSchema,
        password: passwordSchema,
        displayName: displayNameSchema.optional(),
      }),
      req.body,
    );
    const id = randomUUID();
    const row: UserRow = {
      id,
      username: body.username.toLowerCase(),
      displayName: body.displayName ?? body.username,
      passwordHash: await hashPassword(body.password),
      role: 'admin',
      active: true,
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(users).values(row);
    const { token } = await createSession(id);
    setSessionCookie(reply, token);
    reply.code(201);
    return { user: toAuthUser(row) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(
      z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(128) }),
      req.body,
    );
    assertLoginAllowed(req.ip);
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username.trim().toLowerCase()))
      .limit(1);
    const ok = row ? await verifyPassword(body.password, row.passwordHash) : false;
    if (!row || !ok) {
      recordLoginFailure(req.ip);
      throw httpError('用户名或密码不正确', 401);
    }
    if (!row.active) throw httpError('这个账号已被停用，请联系管理员', 403);
    clearLoginFailures(req.ip);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
    const { token } = await createSession(row.id);
    setSessionCookie(reply, token);
    const assignments = await projectAssignmentsOf(row.id);
    return { user: toAuthUser(row, assignments.projectIds, assignments.projectAdminIds) };
  });

  /** 退出要允许匿名调用：会话过期时也要能把浏览器里的 cookie 清干净 */
  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(readSessionToken(req));
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ---------- 用户管理（仅管理员） ----------
  app.get('/api/auth/users', async (req) => {
    requireAdmin(req);
    const [rows, links] = await Promise.all([
      db.select().from(users).orderBy(asc(users.createdAt), asc(users.username)),
      db.select().from(projectMembers),
    ]);
    const byUser = new Map<string, { projectIds: string[]; projectAdminIds: string[] }>();
    for (const link of links) {
      const entry = byUser.get(link.userId) ?? { projectIds: [], projectAdminIds: [] };
      entry.projectIds.push(link.projectId);
      if (link.role === 'admin') entry.projectAdminIds.push(link.projectId);
      byUser.set(link.userId, entry);
    }
    return {
      users: rows.map((row) => {
        const entry = byUser.get(row.id);
        return toSummary(row, entry?.projectIds ?? [], entry?.projectAdminIds ?? []);
      }),
    };
  });

  app.post('/api/auth/users', async (req, reply) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        username: usernameSchema,
        password: passwordSchema,
        displayName: displayNameSchema.optional(),
        role: roleSchema.optional(),
        projectIds: projectIdsSchema,
        projectAdminIds: projectAdminIdsSchema,
      }),
      req.body,
    );
    const role = body.role ?? 'member';
    const projectIds = role === 'admin' ? [] : await normalizeProjectIds(body.projectIds);
    const projectAdminIds =
      role === 'admin' ? [] : await normalizeProjectIds(body.projectAdminIds);
    ensureAdminSubset(projectIds, projectAdminIds);
    const username = body.username.toLowerCase();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (existing.length) throw httpError('这个用户名已经被占用了', 409);

    const row: UserRow = {
      id: randomUUID(),
      username,
      displayName: body.displayName ?? body.username,
      passwordHash: await hashPassword(body.password),
      role,
      active: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(users).values(row);
    await replaceProjectAssignments(row.id, projectIds, projectAdminIds);
    reply.code(201);
    return { user: toSummary(row, projectIds, projectAdminIds) };
  });

  app.patch('/api/auth/users/:id', async (req) => {
    const me = requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({
        displayName: displayNameSchema.optional(),
        role: roleSchema.optional(),
        active: z.boolean().optional(),
        password: passwordSchema.optional(),
        projectIds: projectIdsSchema,
        projectAdminIds: projectAdminIdsSchema,
      }),
      req.body,
    );
    const target = await loadUser(id);
    const nextRole = body.role ?? target.role;
    const nextActive = body.active ?? target.active;
    const existing = await projectAssignmentsOf(id);
    const nextProjectIds =
      nextRole === 'admin'
        ? []
        : body.projectIds !== undefined
          ? await normalizeProjectIds(body.projectIds)
          : existing.projectIds;
    const nextProjectAdminIds =
      nextRole === 'admin'
        ? []
        : body.projectAdminIds !== undefined
          ? await normalizeProjectIds(body.projectAdminIds)
          : existing.projectAdminIds.filter((pid) => nextProjectIds.includes(pid));
    ensureAdminSubset(nextProjectIds, nextProjectAdminIds);

    if (id === me.id && !nextActive) throw httpError('不能停用自己的账号');
    if (id === me.id && nextRole !== 'admin') throw httpError('不能取消自己的管理员身份');
    if (target.role === 'admin' && target.active && (nextRole !== 'admin' || !nextActive)) {
      if ((await activeAdminsExcept(id)) === 0) throw httpError('至少要保留一个可用的管理员');
    }

    await db
      .update(users)
      .set({
        displayName: body.displayName ?? target.displayName,
        role: nextRole,
        active: nextActive,
        passwordHash: body.password ? await hashPassword(body.password) : target.passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    if (
      body.projectIds !== undefined ||
      body.projectAdminIds !== undefined ||
      nextRole !== target.role
    ) {
      await replaceProjectAssignments(id, nextProjectIds, nextProjectAdminIds);
    }

    // 停用或改密码后，强制让该账号已登录的会话失效
    if (!nextActive || body.password) {
      await db.delete(sessions).where(eq(sessions.userId, id));
    }

    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return { user: toSummary(row!, nextProjectIds, nextProjectAdminIds) };
  });

  app.delete('/api/auth/users/:id', async (req) => {
    const me = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (id === me.id) throw httpError('不能删除自己的账号');
    const target = await loadUser(id);
    if (target.role === 'admin' && target.active && (await activeAdminsExcept(id)) === 0) {
      throw httpError('至少要保留一个可用的管理员');
    }
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(projectMembers).where(eq(projectMembers.userId, id));
    await db.delete(users).where(eq(users.id, id));
    return { ok: true };
  });
}