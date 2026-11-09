import type { DayOverrideMap, Person, Project, Task } from '@mplan/core';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  /** 可编辑的项目 id；全局管理员为空数组（隐含全部项目） */
  projectIds: string[];
  /** 被指定为项目管理员的项目 id；全局管理员为空数组 */
  projectAdminIds: string[];
}

export interface AuthInfo {
  user: AuthUser | null;
  /** 至少有一个可编辑项目（管理员恒为 true） */
  canEdit: boolean;
  /** 管理员：可管理账号、人员、日历，并编辑全部项目 */
  isAdmin: boolean;
  projectIds: string[];
  projectAdminIds: string[];
  /** 库里还没有任何账号，引导创建第一个管理员 */
  needsSetup: boolean;
}

export interface AuthUserSummary extends AuthUser {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export type ProjectMemberRole = 'admin' | 'member';

export interface ProjectMember {
  userId: string;
  username: string;
  displayName: string;
  active: boolean;
  role: ProjectMemberRole;
}

export interface ProjectMembers {
  members: ProjectMember[];
  candidates: Array<{
    userId: string;
    username: string;
    displayName: string;
    role: 'admin' | 'member';
  }>;
}

export interface CalendarExceptionDto {
  date: string;
  type: 'holiday' | 'workday';
  name: string;
}

export interface Bootstrap {
  today: string;
  projects: Project[];
  persons: Person[];
  calendar: {
    name: string;
    version: string;
    weekend: number[];
    exceptions: CalendarExceptionDto[];
  };
  personOverrides: Record<string, DayOverrideMap>;
  auth: AuthInfo;
}

export interface ChangeEntry {
  id: string;
  taskId: string | null;
  taskName: string;
  action: 'create' | 'update' | 'delete' | 'postpone' | 'import';
  field: string | null;
  before: string | null;
  after: string | null;
  actor: string | null;
  createdAt: string;
}

export interface ImportRowInput {
  /** WBS 编号：1 / 1.2 / 1.2.3 */
  code: string;
  kind?: 'task' | 'milestone';
  name: string;
  owner?: string | null;
  hours?: number;
  start?: string;
  due?: string;
  done?: boolean;
  note?: string | null;
}

export interface ProjectDetail {
  today: string;
  project: Project;
  tasks: Task[];
  taskOverrides: Record<string, DayOverrideMap>;
  personOverrides: Record<string, DayOverrideMap>;
}

let unauthorizedHandler: (() => void) | null = null;

/** 会话过期 / 被停用后，让 store 弹出登录框 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // 只有带 body 时才声明 JSON，否则 Fastify 会因为「空 body + JSON content-type」直接 400
  const headers: Record<string, string> = init?.body
    ? { 'content-type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) }
    : { ...((init?.headers as Record<string, string>) ?? {}) };
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  if (!res.ok) {
    // 登录/初始化自己的 401 由弹窗展示，不要再触发「请先登录」的全局提示
    if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler?.();
    let message = `请求失败 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  bootstrap: () => req<Bootstrap>('/api/bootstrap'),

  // ---------- 登录 / 账号 ----------
  login: (body: { username: string; password: string }) =>
    req<{ user: AuthUser }>('/api/auth/login', { method: 'POST', ...json(body) }),

  setup: (body: { username: string; password: string; displayName?: string }) =>
    req<{ user: AuthUser }>('/api/auth/setup', { method: 'POST', ...json(body) }),

  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  users: () => req<{ users: AuthUserSummary[] }>('/api/auth/users'),

  createUser: (body: {
    username: string;
    password: string;
    displayName?: string;
    role?: 'admin' | 'member';
    projectIds?: string[];
    projectAdminIds?: string[];
  }) => req<{ user: AuthUserSummary }>('/api/auth/users', { method: 'POST', ...json(body) }),

  patchUser: (
    id: string,
    body: Partial<{
      displayName: string;
      password: string;
      role: 'admin' | 'member';
      active: boolean;
      projectIds: string[];
      projectAdminIds: string[];
    }>,
  ) => req<{ user: AuthUserSummary }>(`/api/auth/users/${id}`, { method: 'PATCH', ...json(body) }),

  deleteUser: (id: string) =>
    req<{ ok: true }>(`/api/auth/users/${id}`, { method: 'DELETE' }),

  // ---------- 项目设置 / 成员 ----------
  patchProject: (
    id: string,
    body: Partial<{ name: string; code: string; startDate: string; dueDate: string | null; note: string | null }>,
  ) => req<{ ok: true }>(`/api/projects/${id}`, { method: 'PATCH', ...json(body) }),

  projectMembers: (id: string) => req<ProjectMembers>(`/api/projects/${id}/members`),

  addProjectMember: (projectId: string, userId: string) =>
    req<{ member: ProjectMember }>(`/api/projects/${projectId}/members`, {
      method: 'POST',
      ...json({ userId }),
    }),

  removeProjectMember: (projectId: string, userId: string) =>
    req<{ ok: true }>(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),

  project: (id: string) => req<ProjectDetail>(`/api/projects/${id}`),

  createProject: (body: { name: string; code?: string; startDate: string; dueDate?: string }) =>
    req<{ id: string }>('/api/projects', { method: 'POST', ...json(body) }),

  createTask: (
    projectId: string,
    body: {
      parentId?: string | null;
      name: string;
      ownerId?: string | null;
      estimateHours?: number;
      startDate?: string;
      kind?: 'task' | 'milestone';
    },
  ) => req<{ task: Task }>(`/api/projects/${projectId}/tasks`, { method: 'POST', ...json(body) }),

  patchTask: (
    id: string,
    body: Partial<{
      name: string;
      ownerId: string | null;
      estimateHours: number;
      startDate: string;
      dueDate: string;
      kind: 'task' | 'milestone';
      progressMode: 'auto' | 'manual';
      manualProgress: number | null;
      done: boolean;
      note: string | null;
      recalc: 'none' | 'hours' | 'due';
    }>,
  ) => req<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', ...json(body) }),

  deleteTask: (id: string) => req<{ ok: true }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  postpone: (id: string) =>
    req<{ deltaWorkdays: number; shifted: number; names: string[] }>(
      `/api/tasks/${id}/postpone`,
      { method: 'POST' },
    ),

  savePersonDays: (personId: string, overrides: Array<{ date: string; work: boolean; note?: string }>) =>
    req<{ overrides: DayOverrideMap }>(`/api/persons/${personId}/days`, {
      method: 'PUT',
      ...json({ overrides }),
    }),

  saveTaskDays: (taskId: string, overrides: Array<{ date: string; work: boolean; note?: string }>) =>
    req<{ ok: true }>(`/api/tasks/${taskId}/days`, {
      method: 'PUT',
      ...json({ overrides }),
    }),

  createPerson: (body: { name: string; role?: string; color?: string }) =>
    req<{ id: string }>('/api/persons', { method: 'POST', ...json(body) }),

  patchPerson: (id: string, body: { name?: string; role?: string | null; color?: string; active?: boolean }) =>
    req<{ ok: true }>(`/api/persons/${id}`, { method: 'PATCH', ...json(body) }),

  deletePerson: (id: string) => req<{ ok: true }>(`/api/persons/${id}`, { method: 'DELETE' }),

  saveCalendar: (body: { weekend: number[]; exceptions: CalendarExceptionDto[] }) =>
    req<{ ok: true }>('/api/calendar', { method: 'PUT', ...json(body) }),

  importCsv: (body: {
    projectId?: string;
    newProject?: { name: string; code?: string; startDate?: string };
    autoCreatePersons?: boolean;
    rows: ImportRowInput[];
  }) =>
    req<{ projectId: string; created: number; personsCreated: number }>('/api/import', {
      method: 'POST',
      ...json(body),
    }),

  changes: (projectId: string, limit = 150) =>
    req<{ changes: ChangeEntry[] }>(`/api/projects/${projectId}/changes?limit=${limit}`),
};