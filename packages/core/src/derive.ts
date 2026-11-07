import { type DateStr, addDays, eachDay, minDate } from './date.js';
import {
  type CompanyCalendar,
  type DayOverrideMap,
  type WorkCalendar,
  addWorkdays,
  countWorkdays,
  isWorkday,
  makeCalendar,
  nextWorkday,
} from './calendar.js';
import {
  DEFAULT_DAILY_HOURS,
  type TaskCore,
  computeDerived,
  durationFromHours,
  hoursFromDuration,
} from './schedule.js';
import type { Derived } from './schedule.js';

/** 任务视角的完整日历：公司规则 ⊕ 负责人加班/请假 ⊕ 任务加班 */
export function calendarFor(
  company: CompanyCalendar,
  personOverrides?: DayOverrideMap | null,
  taskOverrides?: DayOverrideMap | null,
): WorkCalendar {
  return makeCalendar(company, personOverrides ?? undefined, taskOverrides ?? undefined);
}

export function deriveWorkdays(
  task: Pick<TaskCore, 'startDate' | 'dueDate'> & { kind?: 'task' | 'milestone' },
  today: DateStr,
  cal: WorkCalendar,
): { durationDays: number; elapsedDays: number; overdueWorkdays: number } {
  if (task.kind === 'milestone') {
    const overdueWorkdays =
      today > task.dueDate ? countWorkdays(addDays(task.dueDate, 1), today, cal) : 0;
    return { durationDays: 0, elapsedDays: 0, overdueWorkdays };
  }
  const durationDays = countWorkdays(task.startDate, task.dueDate, cal);
  const doneUpTo = minDate(today, task.dueDate);
  const elapsedDays = today < task.startDate ? 0 : countWorkdays(task.startDate, doneUpTo, cal);
  const overdueWorkdays =
    today > task.dueDate ? countWorkdays(addDays(task.dueDate, 1), today, cal) : 0;
  return { durationDays, elapsedDays, overdueWorkdays };
}

export function deriveTask(task: TaskCore, today: DateStr, cal: WorkCalendar): Derived {
  const { durationDays, elapsedDays, overdueWorkdays } = deriveWorkdays(task, today, cal);
  return computeDerived(task, today, durationDays, elapsedDays, overdueWorkdays);
}

/**
 * 改工时 → 重排结束日。
 * 开始日先归一到工作日，工期 = ceil(工时 / 8)，结束日 = 开工后第 (工期-1) 个工作日。
 */
export function rescheduleByHours(
  start: DateStr,
  hours: number,
  cal: WorkCalendar,
  dailyHours = DEFAULT_DAILY_HOURS,
  headcount = 1,
): { startDate: DateStr; dueDate: DateStr; estimateHours: number } {
  const startDate = nextWorkday(start, cal);
  const durationDays = durationFromHours(hours, headcount, dailyHours);
  const dueDate = addWorkdays(startDate, durationDays - 1, cal);
  return { startDate, dueDate, estimateHours: hours };
}

/**
 * 改结束日 → 反算工时。
 * 若结束日落在非工作日，向后归一到最近工作日。
 */
export function rescheduleByDue(
  start: DateStr,
  due: DateStr,
  cal: WorkCalendar,
  dailyHours = DEFAULT_DAILY_HOURS,
  headcount = 1,
): { startDate: DateStr; dueDate: DateStr; estimateHours: number } {
  const startDate = nextWorkday(start, cal);
  let dueDate = due < startDate ? startDate : due;
  // 允许结束日停在非工作日的「最近前一个」工作日，符合直觉
  if (!isWorkday(dueDate, cal)) {
    let d = dueDate;
    for (let i = 0; i < 60 && !isWorkday(d, cal); i++) d = addDays(d, -1);
    dueDate = d < startDate ? startDate : d;
  }
  const days = Math.max(1, countWorkdays(startDate, dueDate, cal));
  return { startDate, dueDate, estimateHours: hoursFromDuration(days, headcount, dailyHours) };
}

/** 整体平移 delta 个工作日，工期不变 */
export function shiftTaskWorkdays(
  start: DateStr,
  due: DateStr,
  delta: number,
  cal: WorkCalendar,
): { startDate: DateStr; dueDate: DateStr } {
  if (delta === 0) return { startDate: start, dueDate: due };
  const durationDays = Math.max(1, countWorkdays(start, due, cal));
  const startDate = addWorkdays(start, delta, cal);
  const dueDate = addWorkdays(startDate, durationDays - 1, cal);
  return { startDate, dueDate };
}

/** 任务区间内所有「本来休息、但被算作上班」的日期 —— 用于在甘特条上打加班标记 */
export function overtimeDatesIn(
  start: DateStr,
  due: DateStr,
  company: CompanyCalendar,
  overrides?: DayOverrideMap | null,
): DateStr[] {
  if (!overrides) return [];
  const out: DateStr[] = [];
  const base: WorkCalendar = { weekend: company.weekend, company: company.overrides };
  for (const d of eachDay(start, due)) {
    const rule = overrides[d];
    if (rule?.work && !isWorkday(d, base)) out.push(d);
  }
  return out;
}

export function isOvertimeEnabled(map?: DayOverrideMap | null): Set<DateStr> {
  const out = new Set<DateStr>();
  if (!map) return out;
  for (const [d, v] of Object.entries(map)) if (v.work) out.add(d);
  return out;
}