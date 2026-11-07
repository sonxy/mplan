import { type DateStr, addDays, diffDays } from './date.js';

export type ProgressMode = 'auto' | 'manual';
export type TaskStatus = 'todo' | 'doing' | 'done' | 'overdue';

export interface TaskCore {
  /** 普通任务 or 里程碑（零工期） */
  kind?: 'task' | 'milestone';
  startDate: DateStr;
  dueDate: DateStr;
  estimateHours: number;
  progressMode: ProgressMode;
  manualProgress: number | null;
  doneAt: string | null;
}

export interface Derived {
  durationDays: number;
  elapsedDays: number;
  /** 0 ~ 1，未完成时最高 0.99 */
  progress: number;
  status: TaskStatus;
  overdue: boolean;
  overdueWorkdays: number;
  remainingDays: number;
}

export const DEFAULT_DAILY_HOURS = 8;

/**
 * 工时 → 工期（工作日）。整天粒度，向上取整：1 小时也算 1 天。
 * 人数 > 1 时并行缩短工期。
 */
export function durationFromHours(
  hours: number,
  headcount = 1,
  dailyHours = DEFAULT_DAILY_HOURS,
): number {
  const capacity = Math.max(0.5, dailyHours * Math.max(1, headcount));
  const raw = Math.max(0, hours) / capacity;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

/** 工期（工作日） → 工时 */
export function hoursFromDuration(
  days: number,
  headcount = 1,
  dailyHours = DEFAULT_DAILY_HOURS,
): number {
  return Math.max(1, days) * dailyHours * Math.max(1, headcount);
}

/**
 * 未完成的任务，进度 = 已过工作日 / 总工作日，封顶 0.99。
 * 完成只能由人给出（doneAt），时间到了不会自动变成 100%。
 */
export function computeDerived(
  task: TaskCore,
  today: DateStr,
  durationDays: number,
  elapsedDays: number,
  overdueWorkdays: number,
): Derived {
  const done = Boolean(task.doneAt);
  const overdue = !done && today > task.dueDate;

  // 里程碑没有工期：要么完成，要么没完成，不存在"做到一半"
  if (task.kind === 'milestone') {
    return {
      durationDays: 0,
      elapsedDays: 0,
      progress: done ? 1 : 0,
      status: done ? 'done' : overdue ? 'overdue' : 'todo',
      overdue,
      overdueWorkdays: overdue ? overdueWorkdays : 0,
      remainingDays: 0,
    };
  }

  let progress: number;
  let status: TaskStatus;

  if (done) {
    progress = 1;
    status = 'done';
  } else if (task.progressMode === 'manual' && task.manualProgress != null) {
    progress = Math.min(0.99, Math.max(0, task.manualProgress / 100));
    status = overdue ? 'overdue' : progress > 0 ? 'doing' : 'todo';
  } else {
    const raw = durationDays > 0 ? elapsedDays / durationDays : 0;
    progress = Math.min(0.99, Math.max(0, raw));
    status = overdue ? 'overdue' : elapsedDays <= 0 ? 'todo' : 'doing';
  }

  return {
    durationDays,
    elapsedDays: Math.min(elapsedDays, durationDays),
    progress,
    status,
    overdue,
    overdueWorkdays: overdue ? overdueWorkdays : 0,
    remainingDays: Math.max(0, durationDays - Math.min(elapsedDays, durationDays)),
  };
}

/** 直接把整个任务按工作日平移，工期不变 */
export function shiftDates(
  start: DateStr,
  due: DateStr,
  deltaWorkdays: number,
): { startDate: DateStr; dueDate: DateStr } {
  // 由调用方用工作日日历计算，这里只做兜底的日历天平移
  return { startDate: addDays(start, deltaWorkdays), dueDate: addDays(due, deltaWorkdays) };
}

/** 两个日期之间的自然天跨度（含首尾） */
export function inclusiveDays(a: DateStr, b: DateStr): number {
  return Math.max(0, diffDays(a, b)) + 1;
}