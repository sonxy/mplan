import type { DateStr } from './date.js';
import type { ProgressMode, TaskStatus } from './schedule.js';

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  /** 1 = 模块，2 = 一级功能点，3 = 二级功能点，4 = 细分功能点 */
  depth: number;
  sort: number;
  name: string;
  ownerId: string | null;
  estimateHours: number;
  kind: 'task' | 'milestone';
  startDate: DateStr;
  dueDate: DateStr;
  progressMode: ProgressMode;
  manualProgress: number | null;
  doneAt: string | null;
  note: string | null;
}

export interface Person {
  id: string;
  name: string;
  role: string | null;
  color: string;
  dailyHours: number;
  active: boolean;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  startDate: DateStr;
  dueDate: DateStr | null;
  note: string | null;
}

export const MAX_DEPTH = 4;

export const KIND_LABEL: Record<'task' | 'milestone', string> = {
  task: '任务',
  milestone: '里程碑',
};

export const DEPTH_LABEL: Record<number, string> = {
  1: '模块',
  2: '一级功能点',
  3: '二级功能点',
  4: '细分功能点',
};

export interface TreeRow extends Task {
  children: TreeRow[];
  /** 该节点下所有后代（不含自身） */
  descendantCount: number;
  /** 子树内的工时合计 */
  rollupHours: number;
  /** 子树内最早的开始 / 最晚的结束 */
  rollupStart: DateStr | null;
  rollupDue: DateStr | null;
}

export function buildTree(tasks: Task[]): TreeRow[] {
  const map = new Map<string, TreeRow>();
  const roots: TreeRow[] = [];

  for (const t of tasks) {
    map.set(t.id, {
      ...t,
      children: [],
      descendantCount: 0,
      rollupHours: 0,
      rollupStart: null,
      rollupDue: null,
    });
  }

  for (const t of tasks) {
    const node = map.get(t.id)!;
    const parent = t.parentId ? map.get(t.parentId) : null;
    if (parent && parent.id !== t.id) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: TreeRow[]) => {
    nodes.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  const rollup = (node: TreeRow): void => {
    let hours = node.estimateHours;
    let start: DateStr | null = node.startDate;
    let due: DateStr | null = node.dueDate;
    let count = 0;
    for (const c of node.children) {
      rollup(c);
      hours += c.rollupHours;
      count += 1 + c.descendantCount;
      if (c.rollupStart && (!start || c.rollupStart < start)) start = c.rollupStart;
      if (c.rollupDue && (!due || c.rollupDue > due)) due = c.rollupDue;
    }
    node.rollupHours = hours;
    node.descendantCount = count;
    node.rollupStart = start;
    node.rollupDue = due;
  };
  for (const r of roots) rollup(r);

  return roots;
}

/** 按树的展示顺序压平，collapsed 中的节点不透出子级 */
export function flattenTree(
  roots: TreeRow[],
  collapsed: ReadonlySet<string>,
): Array<{ task: TreeRow; level: number; hasChildren: boolean }> {
  const out: Array<{ task: TreeRow; level: number; hasChildren: boolean }> = [];
  const walk = (nodes: TreeRow[], level: number) => {
    for (const n of nodes) {
      out.push({ task: n, level, hasChildren: n.children.length > 0 });
      if (n.children.length && !collapsed.has(n.id)) walk(n.children, level + 1);
    }
  };
  walk(roots, 1);
  return out;
}

export function depthOf(tasks: Task[], parentId: string | null): number {
  if (!parentId) return 1;
  const map = new Map(tasks.map((t) => [t.id, t]));
  let depth = 1;
  let cursor = map.get(parentId);
  while (cursor) {
    depth++;
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined;
  }
  return depth;
}