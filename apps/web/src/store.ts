import { create } from 'zustand';
import {
  api,
  setForbiddenHandler,
  setUnauthorizedHandler,
  type AuthUser,
  type Bootstrap,
  type ProjectDetail,
} from './api';
import type { Zoom } from './lib/gantt';

export type ModalKind = 'people' | 'calendar' | 'newProject' | 'import' | 'changes' | 'login' | 'users' | 'projectSettings' | null;

export interface FilterState {
  query: string;
  persons: string[];
  status: 'all' | 'todo' | 'doing' | 'overdue' | 'done';
}

export const EMPTY_FILTER: FilterState = { query: '', persons: [], status: 'all' };

export function isFilterActive(f: FilterState): boolean {
  return Boolean(f.query.trim()) || f.persons.length > 0 || f.status !== 'all';
}
export type ViewMode = 'project' | 'people';
/** 日视图列宽倍率：标准 / 两倍 / 三倍 */
export type DayWidthScale = 1 | 2 | 3;

export interface TaskSnapshot {
  taskId: string;
  startDate: string;
  dueDate: string;
  estimateHours: number;
}

interface HistoryEntry {
  before: TaskSnapshot;
  after: TaskSnapshot;
}

interface AppState {
  boot: Bootstrap | null;
  detail: ProjectDetail | null;
  loading: boolean;
  /** 当前登录用户；null = 匿名只读 */
  user: AuthUser | null;
  /** 当前项目是否可编辑：管理员，或项目在用户的 projectIds 里 */
  canEdit: boolean;
  /** 全局设置（人员 / 日历 / 项目增删）仅管理员可改 */
  canEditGlobal: boolean;
  /** 当前项目是否可管理：全局管理员，或该项目的项目管理员 */
  canAdminCurrent: boolean;
  isAdmin: boolean;
  needsSetup: boolean;
  selectedId: string | null;
  collapsed: Set<string>;
  zoom: Zoom;
  dayWidthScale: DayWidthScale;
  view: ViewMode;
  /** 晨会聚焦：最近 3 个工作日 */
  standupMode: boolean;
  modal: ModalKind;
  filter: FilterState;
  toast: { kind: 'error' | 'ok'; text: string } | null;
  todayPing: number;
  history: HistoryEntry[];
  future: HistoryEntry[];
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setupAdmin: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  refreshAll: () => Promise<void>;
  select: (id: string | null) => void;
  toggle: (id: string) => void;
  setZoom: (z: Zoom) => void;
  setDayWidthScale: (scale: DayWidthScale) => void;
  setView: (v: ViewMode) => void;
  setStandupMode: (on: boolean) => void;
  setModal: (m: ModalKind) => void;
  setFilter: (patch: Partial<FilterState>) => void;
  clearFilter: () => void;
  notify: (text: string, kind?: 'error' | 'ok') => void;
  pingToday: () => void;
  patchTask: (id: string, patch: Parameters<typeof api.patchTask>[1]) => Promise<void>;
  commitDates: (
    id: string,
    next: { startDate: string; dueDate: string; estimateHours: number },
    recalc: 'none' | 'due',
  ) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  postponeTask: (id: string) => Promise<{ deltaWorkdays: number; shifted: number } | null>;
  archiveProject: (id: string) => Promise<void>;
  unarchiveProject: (id: string) => Promise<void>;
  addTask: (parentId: string | null, kind?: 'task' | 'milestone') => Promise<void>;
  removeTask: (id: string) => Promise<void>;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function canEditProject(user: AuthUser | null, projectId: string | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(projectId && user.projectIds.includes(projectId));
}

function canAdminProject(user: AuthUser | null, projectId: string | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(projectId && user.projectAdminIds.includes(projectId));
}

/** 前端兜底：匿名引导登录，已登录但没分到项目则提示找管理员；服务端还会再拦一次 */
function requireEdit(get: () => AppState): boolean {
  if (get().canEdit) return true;
  if (!get().user) {
    get().notify('登录后才能修改', 'error');
    get().setModal('login');
  } else {
    get().notify('当前项目未分配给你的账号，请联系管理员', 'error');
  }
  return false;
}

export const useApp = create<AppState>((set, get) => ({
  boot: null,
  detail: null,
  loading: true,
  user: null,
  canEdit: false,
  canEditGlobal: false,
  canAdminCurrent: false,
  isAdmin: false,
  needsSetup: false,
  selectedId: null,
  collapsed: new Set<string>(),
  zoom: 'day',
  dayWidthScale: 1,
  view: 'project',
  standupMode: false,
  modal: null,
  filter: EMPTY_FILTER,
  toast: null,
  todayPing: 0,
  history: [],
  future: [],

  init: async () => {
    try {
      const boot = await api.bootstrap();
      const authUser = boot.auth.user;
      set({
        boot,
        user: authUser,
        isAdmin: authUser?.role === 'admin',
        canEditGlobal: authUser?.role === 'admin',
        canEdit: false,
        canAdminCurrent: false,
        needsSetup: boot.auth.needsSetup,
      });
      const first = boot.projects[0];
      if (first) await get().openProject(first.id);
      else set({ loading: false });
    } catch (e) {
      set({ loading: false });
      get().notify((e as Error).message);
    }
  },

  login: async (username, password) => {
    const { user } = await api.login({ username, password });
    set({
      user,
      isAdmin: user.role === 'admin',
      canEditGlobal: user.role === 'admin',
      needsSetup: false,
      modal: null,
    });
    await get().refreshAll();
    get().notify(`已登录：${user.displayName}`, 'ok');
  },

  setupAdmin: async (username, password, displayName) => {
    const { user } = await api.setup({ username, password, displayName });
    set({
      user,
      isAdmin: user.role === 'admin',
      canEditGlobal: user.role === 'admin',
      needsSetup: false,
      modal: null,
    });
    await get().refreshAll();
    get().notify(`账号「${user.displayName}」已创建`, 'ok');
  },

  logout: async () => {
    try {
      await api.logout();
      set({
        user: null,
        canEdit: false,
        canEditGlobal: false,
        canAdminCurrent: false,
        isAdmin: false,
        selectedId: null,
      });
      await get().refreshAll();
      get().notify('已退出登录，当前为只读模式', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  openProject: async (id) => {
    set({ loading: true });
    try {
      const detail = await api.project(id);
      set({
        detail,
        loading: false,
        selectedId: null,
        canEdit: canEditProject(get().user, detail.project.id),
        canAdminCurrent: canAdminProject(get().user, detail.project.id),
      });
    } catch (e) {
      set({ loading: false });
      get().notify((e as Error).message);
    }
  },

  refreshProject: async () => {
    const id = get().detail?.project.id;
    if (!id) return;
    try {
      const detail = await api.project(id);
      set({
        detail,
        canEdit: canEditProject(get().user, detail.project.id),
        canAdminCurrent: canAdminProject(get().user, detail.project.id),
      });
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  refreshAll: async () => {
    try {
      const boot = await api.bootstrap();
      const authUser = boot.auth.user;
      set({
        boot,
        user: authUser,
        isAdmin: authUser?.role === 'admin',
        canEditGlobal: authUser?.role === 'admin',
        needsSetup: boot.auth.needsSetup,
      });
      const id = get().detail?.project.id ?? boot.projects[0]?.id;
      if (id) {
        const detail = await api.project(id);
        set({
          detail,
          canEdit: canEditProject(authUser, detail.project.id),
          canAdminCurrent: canAdminProject(authUser, detail.project.id),
        });
      } else {
        set({ canEdit: false, canAdminCurrent: false });
      }
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  select: (id) => set({ selectedId: id }),

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsed: next };
    }),

  setZoom: (zoom) => set({ zoom }),
  setDayWidthScale: (dayWidthScale) => set({ dayWidthScale }),
  setView: (view) => set({ view, selectedId: null }),
  setStandupMode: (standupMode) => set({ standupMode }),
  setModal: (modal) => set({ modal }),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  clearFilter: () => set({ filter: EMPTY_FILTER }),
  pingToday: () => set((s) => ({ todayPing: s.todayPing + 1 })),

  notify: (text, kind = 'error') => {
    set({ toast: { kind, text } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3200);
  },

  patchTask: async (id, patch) => {
    if (!requireEdit(get)) return;
    try {
      await api.patchTask(id, patch);
      await get().refreshProject();
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  commitDates: async (id, next, recalc) => {
    if (!requireEdit(get)) return;
    const before = get().detail?.tasks.find((t) => t.id === id);
    if (!before) return;
    const snapshot: TaskSnapshot = {
      taskId: id,
      startDate: before.startDate,
      dueDate: before.dueDate,
      estimateHours: before.estimateHours,
    };
    try {
      await api.patchTask(id, {
        startDate: next.startDate,
        dueDate: next.dueDate,
        estimateHours: next.estimateHours,
        recalc,
      });
      await get().refreshProject();
      const after = get().detail?.tasks.find((t) => t.id === id);
      if (!after) return;
      set((s) => ({
        history: [
          ...s.history,
          {
            before: snapshot,
            after: {
              taskId: id,
              startDate: after.startDate,
              dueDate: after.dueDate,
              estimateHours: after.estimateHours,
            },
          },
        ].slice(-50),
        future: [],
      }));
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  undo: async () => {
    if (!requireEdit(get)) return;
    const entry = get().history.at(-1);
    if (!entry) return;
    try {
      await api.patchTask(entry.before.taskId, { ...entry.before, recalc: 'none' });
      await get().refreshProject();
      set((s) => ({ history: s.history.slice(0, -1), future: [...s.future, entry] }));
      get().notify('已撤销', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  postponeTask: async (id) => {
    if (!requireEdit(get)) return null;
    try {
      const res = await api.postpone(id);
      await get().refreshProject();
      get().notify(`已顺延 ${res.shifted} 个任务（+${res.deltaWorkdays} 个工作日）`, 'ok');
      return { deltaWorkdays: res.deltaWorkdays, shifted: res.shifted };
    } catch (e) {
      get().notify((e as Error).message);
      return null;
    }
  },

  redo: async () => {
    if (!requireEdit(get)) return;
    const entry = get().future.at(-1);
    if (!entry) return;
    try {
      await api.patchTask(entry.after.taskId, { ...entry.after, recalc: 'none' });
      await get().refreshProject();
      set((s) => ({ future: s.future.slice(0, -1), history: [...s.history, entry] }));
      get().notify('已重做', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  archiveProject: async (id) => {
    if (!canAdminProject(get().user, id)) {
      get().notify('你没有这个项目的管理权限', 'error');
      return;
    }
    try {
      await api.archiveProject(id);
      set({ modal: null, selectedId: null });
      await get().refreshAll();
      const active = get().boot?.projects ?? [];
      // 优先切到还能编辑的项目；都只读时退回第一个，至少不留在一个已归档项目上
      const next = active.find((p) => canEditProject(get().user, p.id)) ?? active[0];
      if (next) {
        await get().openProject(next.id);
      } else {
        // 所有项目都归档了：留在空状态，在项目菜单里可以恢复
        set({ detail: null, loading: false, canEdit: false, canAdminCurrent: false });
      }
      get().notify('项目已归档，不再显示在项目列表里', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  unarchiveProject: async (id) => {
    if (!canAdminProject(get().user, id)) {
      get().notify('你没有这个项目的管理权限', 'error');
      return;
    }
    try {
      await api.unarchiveProject(id);
      await get().refreshAll();
      await get().openProject(id);
      set({ modal: null });
      get().notify('项目已恢复，重新显示在项目列表里', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  addTask: async (parentId, kind = 'task') => {
    if (!requireEdit(get)) return;
    const detail = get().detail;
    if (!detail) return;
    try {
      const { task } = await api.createTask(detail.project.id, {
        parentId,
        kind,
        name:
          kind === 'milestone'
            ? '新里程碑'
            : parentId
              ? '新功能点'
              : '新模块',
        estimateHours: kind === 'milestone' ? 0 : 8,
        startDate: detail.today,
      });
      if (parentId) {
        set((s) => {
          const next = new Set(s.collapsed);
          next.delete(parentId);
          return { collapsed: next };
        });
      }
      await get().refreshProject();
      set({ selectedId: task.id });
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  removeTask: async (id) => {
    if (!requireEdit(get)) return;
    try {
      await api.deleteTask(id);
      set({ selectedId: null });
      await get().refreshProject();
      get().notify('任务已删除', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },
}));
// 会话过期或被停用：后端返回 401 时统一弹登录框
setUnauthorizedHandler(() => {
  const state = useApp.getState();
  if (state.modal === 'login') return;
  state.notify('登录已失效，请重新登录', 'error');
  state.setModal('login');
});

// 权限被撤销：重新拉一次 bootstrap / 当前项目，让项目管理员入口和只读态立即回正
setForbiddenHandler(() => {
  void useApp.getState().refreshAll();
});
