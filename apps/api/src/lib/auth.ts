import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projectMembers, sessions, users } from '../db/schema.js';

const scryptAsync = promisify(scrypt);

export type UserRole = 'admin' | 'member';

/** 挂在 request 上的登录用户，绝不包含 passwordHash */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** 可编辑的项目 id；全局管理员为空数组，因为隐含拥有全部项目 */
  projectIds: string[];
  /** 其中被指定为「项目管理员」的项目 id；全局管理员为空数组 */
  projectAdminIds: string[];
}

export const SESSION_COOKIE = 'mplan_session';
export const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 7) || 7;

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** 这几个写接口本身必须允许匿名访问：登录、首次初始化、退出 */
const PUBLIC_WRITE_PATHS = new Set(['/api/auth/login', '/api/auth/setup', '/api/auth/logout']);

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: AuthUser | null;
  }
}

export function httpError(message: string, statusCode = 400): Error {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

// ---------- 密码 ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------- 会话 ----------

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return Number(row?.n ?? 0);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    tokenHash: sha256(token),
    expiresAt,
  });
  // 顺手清掉过期会话，够用且不用起定时任务
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function resolveSession(token: string | null): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = sha256(token);
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now() || !row.active) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }
  let projectIds: string[] = [];
  let projectAdminIds: string[] = [];
  if (row.role !== 'admin') {
    const links = await db
      .select({ projectId: projectMembers.projectId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.userId, row.id));
    projectIds = links.map((l) => l.projectId);
    projectAdminIds = links.filter((l) => l.role === 'admin').map((l) => l.projectId);
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    projectIds,
    projectAdminIds,
  };
}

/** 管理员管理全部项目；普通成员只管理被指定的项目 */
export function canManageProject(user: AuthUser | null, projectId: string | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(projectId && user.projectIds.includes(projectId));
}

export function requireProjectAccess(
  req: FastifyRequest,
  projectId: string | null | undefined,
  message = '你没有这个项目的编辑权限',
): void {
  if (!req.currentUser) throw httpError('请先登录再修改', 401);
  if (!canManageProject(req.currentUser, projectId)) throw httpError(message, 403);
}

/** 项目管理员：全局管理员，或该项目被指定为 admin 的成员 */
export function canAdminProject(user: AuthUser | null, projectId: string | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(projectId && user.projectAdminIds.includes(projectId));
}

export function requireProjectAdmin(
  req: FastifyRequest,
  projectId: string | null | undefined,
  message = '你没有这个项目的管理权限',
): void {
  if (!req.currentUser) throw httpError('请先登录', 401);
  if (!canAdminProject(req.currentUser, projectId)) throw httpError(message, 403);
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  if (!req.currentUser) throw httpError('请先登录', 401);
  if (req.currentUser.role !== 'admin') throw httpError('只有管理员可以执行这个操作', 403);
  return req.currentUser;
}

export async function destroySession(token: string | null): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

// ---------- Cookie ----------

export function readSessionToken(req: FastifyRequest): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name !== SESSION_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return value || null;
    }
  }
  return null;
}

function serializeCookie(value: string, maxAge?: number): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  // 只有显式开启才加 Secure：内网常用 http，加了会导致 cookie 发不出去
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  if (maxAge === 0) parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  else if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header('set-cookie', serializeCookie(token, SESSION_DAYS * 86_400));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', serializeCookie('', 0));
}

// ---------- 登录限流（内存版，单机够用） ----------

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_FAILURES = 8;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

export function assertLoginAllowed(ip: string): void {
  const entry = loginFailures.get(ip);
  if (!entry) return;
  if (entry.resetAt <= Date.now()) {
    loginFailures.delete(ip);
    return;
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    throw httpError('登录尝试过于频繁，请 10 分钟后再试', 429);
  }
}

export function recordLoginFailure(ip: string): void {
  if (loginFailures.size > 5000) {
    for (const [key, entry] of loginFailures) {
      if (entry.resetAt <= Date.now()) loginFailures.delete(key);
    }
  }
  const entry = loginFailures.get(ip);
  if (!entry || entry.resetAt <= Date.now()) {
    loginFailures.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip);
}

// ---------- 请求鉴权 ----------

function pathOf(req: FastifyRequest): string {
  return (req.url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
}

/** Origin 校验：浏览器跨站写请求带 Origin，内网也顺手挡一下 CSRF */
function originAllowed(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / 服务端调用没有 Origin
  const allowed = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // 没配置白名单时退回旧行为（仅靠 SameSite=Lax 挡 CSRF）
  if (allowed.length === 0) return true;
  if (allowed.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

/**
 * 每个请求都解析会话；写操作（登录/初始化/退出除外）必须已登录。
 * 读接口全部匿名开放 —— 只读浏览不需要登录。
 */
export function attachAuth(app: FastifyInstance): void {
  app.decorateRequest('currentUser', null);
  app.addHook('onRequest', async (req) => {
    // 探活接口不碰数据库，DB 挂了也能看出进程还活着
    if (pathOf(req) === '/api/health') return;

    req.currentUser = await resolveSession(readSessionToken(req));

    if (!UNSAFE_METHODS.has(req.method)) return;
    if (!originAllowed(req)) throw httpError('请求来源不被允许', 403);
    if (PUBLIC_WRITE_PATHS.has(pathOf(req))) return;
    if (!req.currentUser) throw httpError('请先登录再修改', 401);
  });
}