import {
  type Axis,
  type CompanyCalendar,
  type DayOverrideMap,
  type Derived,
  type Person,
  type TaskStatus,
  type TreeRow,
  buildAxis,
  buildTree,
  calendarFor,
  countWorkdays,
  deriveTask,
  eachDay,
  flattenTree,
  isWorkday,
  makeCalendar,
  overtimeDatesIn,
  resolvePersonColor,
  type PaletteColor,
} from '@mplan/core';
import type { Bootstrap, ProjectDetail } from '../api';

export type Zoom = 'day' | 'week' | 'month';

export const ROW_HEIGHT = 40;
export const HEADER_HEIGHT = 58;
export const LEFT_WIDTH = 392;

export const ZOOM_WIDTH: Record<Zoom, number> = { day: 30, week: 15, month: 8 };

export interface BoardRow {
  task: TreeRow;
  level: number;
  hasChildren: boolean;
  summary: boolean;
  derived: Derived;
  owner: Person | null;
  color: PaletteColor;
  hours: number;
  progress: number;
  status: TaskStatus;
  overtimeDates: string[];
  /** 筛选时仅作为上下文出现的祖先节点 */
  dimmed: boolean;
}

export interface BoardStats {
  total: number;
  matched: number;
  filtering: boolean;
  leafCount: number;
  totalHours: number;
  doneCount: number;
  overdueCount: number;
  headcount: number;
}

export interface BoardFilter {
  query: string;
  persons: string[];
  status: 'all' | 'todo' | 'doing' | 'overdue' | 'done';
}

export interface Board {
  rows: BoardRow[];
  axis: Axis;
  stats: BoardStats;
  company: CompanyCalendar;
  byId: Map<string, BoardRow>;
}

export type RenderRow =
  | {
      kind: 'task';
      key: string;
      row: BoardRow;
      indent: number;
      compact: boolean;
      showOwner: boolean;
    }
  | {
      kind: 'person';
      key: string;
      person: Person | null;
      label: string;
      role: string;
      taskCount: number;
      hours: number;
      overloadDays: number;
    };

export function companyFromBootstrap(boot: Bootstrap): CompanyCalendar {
  const overrides: Record<string, 'off' | 'work'> = {};
  for (const e of boot.calendar.exceptions) overrides[e.date] = e.type === 'holiday' ? 'off' : 'work';
  return { weekend: boot.calendar.weekend, overrides };
}

function weightedProgress(node: TreeRow, own: Map<string, number>): number {
  if (node.children.length === 0) return own.get(node.id) ?? 0;
  let weight = 0;
  let sum = 0;
  for (const child of node.children) {
    const childHours = child.rollupHours || 1;
    sum += weightedProgress(child, own) * childHours;
    weight += childHours;
  }
  return weight > 0 ? sum / weight : 0;
}

export function buildBoard(
  detail: ProjectDetail,
  boot: Bootstrap,
  collapsed: ReadonlySet<string>,
  filter?: BoardFilter,
): Board {
  const company = companyFromBootstrap(boot);
  const persons = new Map(boot.persons.map((p) => [p.id, p]));
  const tree = buildTree(detail.tasks);

  const overridesFor = (ownerId: string | null, taskId: string): DayOverrideMap | undefined => {
    const person = ownerId ? detail.personOverrides[ownerId] : undefined;
    const task = detail.taskOverrides[taskId];
    if (!person && !task) return undefined;
    return task ?? person;
  };

  const deriveFor = (task: TreeRow): Derived => {
    const cal = calendarFor(
      company,
      task.ownerId ? detail.personOverrides[task.ownerId] : undefined,
      detail.taskOverrides[task.id],
    );
    return deriveTask(task, detail.today, cal);
  };

  const ownProgress = new Map<string, number>();
  const ownStatus = new Map<string, TaskStatus>();
  for (const t of detail.tasks) {
    const d = deriveFor(t as TreeRow);
    ownProgress.set(t.id, d.progress);
    ownStatus.set(t.id, d.status);
  }

  /** 父任务的状态由子任务汇总：全完成才算完成，有逾期就算逾期 */
  const aggStatus = (node: TreeRow): TaskStatus => {
    if (!node.children.length) return ownStatus.get(node.id) ?? 'todo';
    const kids = node.children.map(aggStatus);
    if (kids.every((k) => k === 'done')) return 'done';
    if (kids.some((k) => k === 'overdue')) return 'overdue';
    if (kids.some((k) => k === 'doing')) return 'doing';
    return 'todo';
  };
  const statusOf = (t: TreeRow): TaskStatus =>
    t.children.length ? aggStatus(t) : (ownStatus.get(t.id) ?? 'todo');

  const q = filter?.query.trim().toLowerCase() ?? '';
  const personFilter = filter?.persons ?? [];
  const statusFilter = filter?.status ?? 'all';
  const filtering = Boolean(q) || personFilter.length > 0 || statusFilter !== 'all';

  const matchedIds = new Set<string>();
  const keepIds = new Set<string>();

  if (filtering) {
    const matches = (t: TreeRow) => {
      if (q && !`${t.name} ${t.note ?? ''}`.toLowerCase().includes(q)) return false;
      if (personFilter.length && (!t.ownerId || !personFilter.includes(t.ownerId))) return false;
      if (statusFilter !== 'all' && statusOf(t) !== statusFilter) return false;
      return true;
    };
    const visit = (node: TreeRow, ancestors: string[]): boolean => {
      const own = matches(node);
      if (own) {
        matchedIds.add(node.id);
        keepIds.add(node.id);
        for (const a of ancestors) keepIds.add(a);
      }
      let any = own;
      for (const c of node.children) if (visit(c, [...ancestors, node.id])) any = true;
      return any;
    };
    for (const r of tree) visit(r, []);
  }

  const flat: Array<{ task: TreeRow; level: number; hasChildren: boolean; dimmed: boolean }> = [];
  const walk = (nodes: TreeRow[], level: number) => {
    for (const n of nodes) {
      if (filtering && !keepIds.has(n.id)) continue;
      flat.push({
        task: n,
        level,
        hasChildren: n.children.length > 0,
        dimmed: filtering && !matchedIds.has(n.id),
      });
      // 筛选时忽略折叠，保证命中项一定可见
      if (n.children.length && (filtering || !collapsed.has(n.id))) walk(n.children, level + 1);
    }
  };
  walk(tree, 1);

  const rows: BoardRow[] = flat.map(({ task, level, hasChildren, dimmed }) => {
    const derived = deriveFor(task);
    const owner = task.ownerId ? (persons.get(task.ownerId) ?? null) : null;
    const summary = hasChildren;
    const progress = summary ? weightedProgress(task, ownProgress) : derived.progress;
    const overtimeDates = overtimeDatesIn(
      task.startDate,
      task.dueDate,
      company,
      overridesFor(task.ownerId, task.id),
    );
    const status: TaskStatus = summary ? aggStatus(task) : derived.status;
    return {
      task,
      level,
      hasChildren,
      summary,
      derived: { ...derived, progress, status },
      owner,
      color: resolvePersonColor(owner?.color),
      hours: summary ? task.rollupHours : task.estimateHours,
      progress,
      status,
      overtimeDates,
      dimmed,
    };
  });

  const dates: string[] = [detail.project.startDate];
  for (const t of detail.tasks) {
    dates.push(t.startDate, t.dueDate);
  }
  if (detail.project.dueDate) dates.push(detail.project.dueDate);
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const extra = new Set<string>();
  for (const map of Object.values(detail.personOverrides)) {
    for (const [d, v] of Object.entries(map)) if (v.work) extra.add(d);
  }
  for (const map of Object.values(detail.taskOverrides)) {
    for (const [d, v] of Object.entries(map)) if (v.work) extra.add(d);
  }

  const pad = (d: string, days: number) => {
    const ms = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + days * 86400000;
    const dt = new Date(ms);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dt.getUTCDate(),
    ).padStart(2, '0')}`;
  };

  const axis = buildAxis(pad(first, -3), pad(last, 10), company, extra);

  const leaves = detail.tasks.filter((t) => !detail.tasks.some((c) => c.parentId === t.id));
  const totalHours = leaves.reduce((s, t) => s + t.estimateHours, 0);
  const visibleLeaves = rows.filter((r) => !r.summary).length;
  const doneCount = rows.filter((r) => r.status === 'done' && !r.summary).length;
  const overdueCount = rows.filter((r) => r.status === 'overdue').length;
  const headcount = new Set(detail.tasks.map((t) => t.ownerId).filter(Boolean)).size;

  return {
    rows,
    axis,
    company,
    byId: new Map(rows.map((r) => [r.task.id, r])),
    stats: {
      total: detail.tasks.length,
      matched: filtering ? matchedIds.size : detail.tasks.length,
      filtering,
      leafCount: filtering ? visibleLeaves : leaves.length,
      totalHours,
      doneCount,
      overdueCount,
      headcount,
    },
  };
}

/**
 * 人员视图：按负责人分组，每人下面挂他的可执行任务。
 * 同时估算「同一天被排了超过 8 小时」的天数，作为软性超载提示。
 */
export function buildPeopleRows(
  board: Board,
  persons: Person[],
  detail: ProjectDetail,
): RenderRow[] {
  const groups = new Map<string, BoardRow[]>();
  for (const row of board.rows) {
    if (row.summary) continue;
    const key = row.task.ownerId ?? '__none__';
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const out: RenderRow[] = [];
  const ordered = [...persons];
  const unassigned = groups.get('__none__');
  if (unassigned?.length) {
    ordered.push({ id: '__none__', name: '未分配', role: null, color: 'slate', dailyHours: 8, active: true });
  }

  for (const person of ordered) {
    const list = groups.get(person.id);
    if (!list?.length) continue;
    list.sort((a, b) => a.task.startDate.localeCompare(b.task.startDate));

    const cal = calendarFor(
      board.company,
      person.id === '__none__' ? undefined : detail.personOverrides[person.id],
      undefined,
    );
    const load = new Map<string, number>();
    let hours = 0;
    for (const r of list) {
      hours += r.hours;
      if (r.status === 'done') continue;
      const days = countWorkdays(r.task.startDate, r.task.dueDate, cal);
      if (days <= 0) continue;
      const perDay = r.hours / days;
      for (const d of listWorkdaysIn(r.task.startDate, r.task.dueDate, cal)) {
        load.set(d, (load.get(d) ?? 0) + perDay);
      }
    }
    const overloadDays = [...load.values()].filter((h) => h > 8.01).length;

    out.push({
      kind: 'person',
      key: `person-${person.id}`,
      person: person.id === '__none__' ? null : person,
      label: person.name,
      role: person.role ?? '',
      taskCount: list.length,
      hours,
      overloadDays,
    });

    for (const row of list) {
      out.push({
        kind: 'task',
        key: row.task.id,
        row,
        indent: 1,
        compact: true,
        showOwner: false,
      });
    }
  }

  return out;
}

function listWorkdaysIn(start: string, due: string, cal: Parameters<typeof countWorkdays>[2]) {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const end = new Date(`${due}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out.filter((d) => isWorkday(d, cal));
}

/** 任务在轴上的像素区间 */
export function barGeometry(axis: Axis, start: string, due: string, colWidth: number) {
  const byDate = axis.indexByDate;
  let from = byDate.get(start);
  let to = byDate.get(due);

  if (from == null) {
    const next = axis.columns.find((c) => c.date >= start);
    from = next?.index ?? axis.columns.length - 1;
  }
  if (to == null) {
    const prev = [...axis.columns].reverse().find((c) => c.date <= due);
    to = prev?.index ?? 0;
  }
  if (from == null || to == null) return null;
  if (to < from) to = from;
  const left = from * colWidth;
  const width = (to - from + 1) * colWidth;
  return { left, width, from, to };
}

/** 为表头准备月份分段 */
export function monthSegments(axis: Axis, colWidth: number) {
  return axis.months.map((m) => ({
    ...m,
    left: m.startIndex * colWidth,
    width: m.span * colWidth,
  }));
}

/** 今日在轴上的位置 */
export function todayX(axis: Axis, today: string, colWidth: number) {
  if (!axis.columns.length) return null;
  const idx = axis.indexByDate.get(today);
  if (idx != null) return idx * colWidth + colWidth / 2;
  const next = axis.columns.find((c) => c.date > today);
  if (next) return next.index * colWidth;
  const prev = [...axis.columns].reverse().find((c) => c.date < today);
  if (prev) return (prev.index + 1) * colWidth;
  return null;
}

export function workingDayCount(
  start: string,
  due: string,
  company: CompanyCalendar,
  ownerId: string | null,
  detail: ProjectDetail,
): number {
  const cal = calendarFor(
    company,
    ownerId ? detail.personOverrides[ownerId] : undefined,
    undefined,
  );
  return countWorkdays(start, due, cal);
}

export function rangeWorkdays(axis: Axis, company: CompanyCalendar): number {
  let n = 0;
  if (!axis.start || !axis.end) return 0;
  const cal = makeCalendar(company);
  for (const d of eachDay(axis.start, axis.end)) if (isWorkday(d, cal)) n++;
  return n;
}