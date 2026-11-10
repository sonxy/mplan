import { create } from 'zustand';
import { projectOverdueWorkdays, type Task } from '@mplan/core';
import {
  api,
  setForbiddenHandler,
  setUnauthorizedHandler,
  type AuthUser,
  type Bootstrap,
  type ProjectDetail,
} from './api';
import { companyFromBootstrap, type Zoom } from './lib/gantt';

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
  before: TaskSnapshot[];
  after: TaskSnapshot[];
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
  toast: { kind: 'error' | 'ok' | 'warn'; text: string } | null;
  todayPing: number;
  /** 改期时是否自动顺延后续任务；持久化在 localStorage */
  autoShift: boolean;
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
  setAutoShift: (on: boolean) => void;
  /** 重新初始化项目后清空撤销栈：旧任务 ID 已不存在 */
  clearHistory: () => void;
  notify: (text: string, kind?: 'error' | 'ok' | 'warn') => void;
  pingToday: () => void;
  patchTask: (id: string, patch: Parameters<typeof api.patchTask>[1]) => Promise<void>;
  commitDates: (
    id: string,
    next: { startDate: string; dueDate: string; estimateHours: number },
    recalc: 'none' | 'due',
  ) => Promise<void>;
  /** 统一处理所有改日期 / 改工时的入口：写快照、联动、toast */
  commitTaskPatch: (id: string, patch: Parameters<typeof api.patchTask>[1]) => Promise<void>;
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

const AUTO_SHIFT_KEY = 'mplan.autoShift';

function loadAutoShift(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_SHIFT_KEY);
    return raw == null ? true : raw === '1';
  } catch {
    return true;
  }
}

function snapshotOf(task: Task): TaskSnapshot {
  return {
    taskId: task.id,
    startDate: task.startDate,
    dueDate: task.dueDate,
    estimateHours: task.estimateHours,
  };
}

/** 对比刷新前后的项目任务，把主任务和所有被联动任务的日期变化合成一条撤销记录 */
function diffTaskDates(
  before: Task[],
  after: Task[],
  onlyIds: ReadonlySet<string>,
): HistoryEntry | null {
  const beforeMap = new Map(before.map((t) => [t.id, t]));
  const parentIds = new Set<string>();
  for (const t of [...before, ...after]) if (t.parentId) parentIds.add(t.parentId);
  const beforeSnapshots: TaskSnapshot[] = [];
  const afterSnapshots: TaskSnapshot[] = [];
  for (const t of after) {
    if (!onlyIds.has(t.id) || parentIds.has(t.id)) continue;
    const prev = beforeMap.get(t.id);
    if (!prev) continue;
    if (
      prev.startDate !== t.startDate ||
      prev.dueDate !== t.dueDate ||
      prev.estimateHours !== t.estimateHours
    ) {
      beforeSnapshots.push(snapshotOf(prev));
      afterSnapshots.push(snapshotOf(t));
    }
  }
  return beforeSnapshots.length ? { before: beforeSnapshots, after: afterSnapshots } : null;
}

function overdueOf(tasks: Task[], projectDue: string | null, boot: Bootstrap | null): number {
  if (!boot) return 0;
  return projectOverdueWorkdays(tasks, projectDue, companyFromBootstrap(boot));
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
  autoShift: loadAutoShift(),
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
    const switching = get().detail?.project.id !== id;
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
      // 撤销记录不跨项目：切项目后旧快照不能再用当前项目 id 回放
      if (switching) set({ history: [], future: [] });
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
      const previousId = get().detail?.project.id;
      const id = previousId ?? boot.projects[0]?.id;
      if (id) {
        const detail = await api.project(id);
        set({
          detail,
          canEdit: canEditProject(authUser, detail.project.id),
          canAdminCurrent: canAdminProject(authUser, detail.project.id),
        });
        if (previousId !== detail.project.id) set({ history: [], future: [] });
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
  setAutoShift: (autoShift) => {
    try {
      localStorage.setItem(AUTO_SHIFT_KEY, autoShift ? '1' : '0');
    } catch {
      /* localStorage 不可用时只影响持久化 */
    }
    set({ autoShift });
  },
  clearHistory: () => set({ history: [], future: [] }),
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
    await get().commitTaskPatch(id, {
      startDate: next.startDate,
      dueDate: next.dueDate,
      estimateHours: next.estimateHours,
      recalc,
    });
  },

  commitTaskPatch: async (id, patch) => {
    if (!requireEdit(get)) return;
    const beforeDetail = get().detail;
    if (!beforeDetail) return;
    const beforeTasks = beforeDetail.tasks;
    const beforeOverdue = overdueOf(beforeTasks, beforeDetail.project.dueDate, get().boot);
    try {
      const res = await api.patchTask(id, {
        ...patch,
        shiftFollowing: get().autoShift,
      });
      await get().refreshProject();
      const afterDetail = get().detail;
      if (!afterDetail) return;

      // 用刷新前后的快照对比，而不是只信主任务：被联动的任务也要进同一条撤销记录
      const diff = diffTaskDates(
        beforeTasks,
        afterDetail.tasks,
        new Set([id, ...res.shiftedTaskIds]),
      );
      if (diff) {
        set((s) => ({
          history: [...s.history, diff].slice(-50),
          future: [],
        }));
      }

      const afterOverdue = overdueOf(afterDetail.tasks, afterDetail.project.dueDate, get().boot);
      const worsened = afterOverdue > beforeOverdue;
      if (res.autoShift && res.autoShift.count > 0) {
        get().notify(
          worsened
            ? `已联动 ${res.autoShift.count} 个后续任务（+${res.autoShift.deltaWorkdays} 个工作日）；项目计划已超期 ${afterOverdue} 个工作日`
            : `已联动 ${res.autoShift.count} 个后续任务（+${res.autoShift.deltaWorkdays} 个工作日）`,
          worsened ? 'warn' : 'ok',
        );
      } else if (worsened) {
        get().notify(`项目计划完成日已超期 ${afterOverdue} 个工作日，请手动调整`, 'warn');
      }
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  undo: async () => {
    if (!requireEdit(get)) return;
    const entry = get().history.at(-1);
    const projectId = get().detail?.project.id;
    if (!entry || !projectId) return;
    try {
      await api.restoreTaskDates(
        projectId,
        entry.before.map((snapshot) => ({
          id: snapshot.taskId,
          startDate: snapshot.startDate,
          dueDate: snapshot.dueDate,
          estimateHours: snapshot.estimateHours,
        })),
      );
      await get().refreshProject();
      set((s) => ({ history: s.history.slice(0, -1), future: [...s.future, entry] }));
      get().notify('已撤销', 'ok');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },

  postponeTask: async (id) => {
    if (!requireEdit(get)) return null;
    const beforeDetail = get().detail;
    if (!beforeDetail) return null;
    try {
      const res = await api.postpone(id);
      await get().refreshProject();
      const afterDetail = get().detail;
      if (afterDetail) {
        const diff = diffTaskDates(
          beforeDetail.tasks,
          afterDetail.tasks,
          new Set(beforeDetail.tasks.map((t) => t.id)),
        );
        if (diff) {
          set((s) => ({
            history: [...s.history, diff].slice(-50),
            future: [],
          }));
        }
      }
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
    const projectId = get().detail?.project.id;
    if (!entry || !projectId) return;
    try {
      await api.restoreTaskDates(
        projectId,
        entry.after.map((snapshot) => ({
          id: snapshot.taskId,
          startDate: snapshot.startDate,
          dueDate: snapshot.dueDate,
          estimateHours: snapshot.estimateHours,
        })),
      );
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
