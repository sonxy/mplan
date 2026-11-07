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

type UserRow = typeof users.$inferSelect;

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw httpError(`${first.path.join('.') || '请求体'}：${first.message}`);
  }
  return result.data;
}

function toAuthUser(row: UserRow, projectIds: string[] = []): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    projectIds: row.role === 'admin' ? [] : projectIds,
  };
}

function toSummary(row: UserRow, projectIds: string[] = []) {
  return {
    ...toAuthUser(row, projectIds),
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

async function projectIdsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return rows.map((r) => r.projectId);
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

async function replaceProjectAssignments(userId: string, ids: string[]): Promise<void> {
  await db.delete(projectMembers).where(eq(projectMembers.userId, userId));
  if (ids.length === 0) return;
  await db.insert(projectMembers).values(
    ids.map((projectId) => ({ id: randomUUID(), userId, projectId })),
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
    return { user: toAuthUser(row, await projectIdsOf(row.id)) };
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
    const byUser = new Map<string, string[]>();
    for (const link of links) {
      const list = byUser.get(link.userId) ?? [];
      list.push(link.projectId);
      byUser.set(link.userId, list);
    }
    return { users: rows.map((row) => toSummary(row, byUser.get(row.id) ?? [])) };
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
      }),
      req.body,
    );
    const role = body.role ?? 'member';
    const projectIds = role === 'admin' ? [] : await normalizeProjectIds(body.projectIds);
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
    await replaceProjectAssignments(row.id, projectIds);
    reply.code(201);
    return { user: toSummary(row, projectIds) };
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
      }),
      req.body,
    );
    const target = await loadUser(id);
    const nextRole = body.role ?? target.role;
    const nextActive = body.active ?? target.active;
    const nextProjectIds =
      nextRole === 'admin'
        ? []
        : body.projectIds !== undefined
          ? await normalizeProjectIds(body.projectIds)
          : await projectIdsOf(id);

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

    if (body.projectIds !== undefined || nextRole !== target.role) {
      await replaceProjectAssignments(id, nextProjectIds);
    }

    // 停用或改密码后，强制让该账号已登录的会话失效
    if (!nextActive || body.password) {
      await db.delete(sessions).where(eq(sessions.userId, id));
    }

    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return { user: toSummary(row!, nextProjectIds) };
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