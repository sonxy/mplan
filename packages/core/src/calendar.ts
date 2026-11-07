import {
  type DateStr,
  addDays,
  dayOfWeek,
  eachDay,
  isValidDateStr,
} from './date.js';

/** 公司日历：周末规则 + 例外（法定节假日 / 调休补班） */
export interface CompanyCalendar {
  /** 0 = 周日 … 6 = 周六，默认 [0, 6] */
  weekend: number[];
  /** 例外：`off` = 法定节假日放假，`work` = 调休补班 */
  overrides: Record<DateStr, 'off' | 'work'>;
}

/** 人 / 任务级别的单日覆盖：只有和公司日历不一致时才存 */
export interface DayOverride {
  /** true = 这天上班（加班），false = 这天休息（请假） */
  work: boolean;
  hours?: number | null;
  note?: string | null;
}

export type DayOverrideMap = Record<DateStr, DayOverride>;

/**
 * 判定某一天是否工作日的完整上下文。
 * 优先级：人员请假 > 任务加班 > 人员加班 > 公司例外 > 周末规则
 *
 * 「请假」最优先是刻意的：人不在，任务也不该被算作推进。
 */
export interface WorkCalendar {
  weekend: number[];
  company: Record<DateStr, 'off' | 'work'>;
  person?: Record<DateStr, boolean>;
  task?: Record<DateStr, boolean>;
}

export const DEFAULT_WEEKEND = [0, 6];

export function makeCalendar(
  company: CompanyCalendar,
  person?: DayOverrideMap,
  task?: DayOverrideMap,
): WorkCalendar {
  const toFlag = (m?: DayOverrideMap) => {
    if (!m) return undefined;
    const out: Record<DateStr, boolean> = {};
    for (const [k, v] of Object.entries(m)) out[k] = v.work;
    return out;
  };
  return {
    weekend: company.weekend,
    company: company.overrides,
    person: toFlag(person),
    task: toFlag(task),
  };
}

export function isWorkday(date: DateStr, cal: WorkCalendar): boolean {
  const person = cal.person?.[date];
  if (person === false) return false;
  if (cal.task?.[date] === true) return true;
  if (person === true) return true;
  const company = cal.company[date];
  if (company === 'off') return false;
  if (company === 'work') return true;
  return !cal.weekend.includes(dayOfWeek(date));
}

/** 当天若不上班，向后滚到最近的工作日 */
export function nextWorkday(date: DateStr, cal: WorkCalendar): DateStr {
  let d = date;
  for (let i = 0; i < 366; i++) {
    if (isWorkday(d, cal)) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** 当天若不上班，向前滚到最近的工作日 */
export function prevWorkday(date: DateStr, cal: WorkCalendar): DateStr {
  let d = date;
  for (let i = 0; i < 366; i++) {
    if (isWorkday(d, cal)) return d;
    d = addDays(d, -1);
  }
  return d;
}

/**
 * 从 start 起偏移 n 个工作日（n 可以为负）。
 * addWorkdays(start, 0) === start（start 会先被归一化到工作日）。
 */
export function addWorkdays(start: DateStr, n: number, cal: WorkCalendar): DateStr {
  let d = nextWorkday(start, cal);
  if (n === 0) return d;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let guard = 0;
  while (left > 0 && guard++ < 5000) {
    d = addDays(d, step);
    if (isWorkday(d, cal)) left--;
  }
  return d;
}

/**
 * 最近 count 个工作日（含 date；date 非工作日时从最近工作日往前数），按时间正序返回。
 * 例：周一 2026-11-09、count=3 → [11-05, 11-06, 11-09]
 */
export function recentWorkdays(date: DateStr, cal: WorkCalendar, count = 3): DateStr[] {
  if (count <= 0) return [];
  let d = prevWorkday(date, cal);
  const result = [d];
  for (let i = 1; i < count; i++) {
    d = prevWorkday(addDays(d, -1), cal);
    result.unshift(d);
  }
  return result;
}

/** [a, b] 闭区间内的工作日数量；b < a 返回 0 */
export function countWorkdays(a: DateStr, b: DateStr, cal: WorkCalendar): number {
  if (b < a) return 0;
  let n = 0;
  for (const d of eachDay(a, b)) if (isWorkday(d, cal)) n++;
  return n;
}

/** [a, b] 闭区间内的工作日列表 */
export function listWorkdays(a: DateStr, b: DateStr, cal: WorkCalendar): DateStr[] {
  if (b < a) return [];
  return eachDay(a, b).filter((d) => isWorkday(d, cal));
}

/** 某天是 start 之后第几个工作日（start 本身为 0），非工作日返回 -1 */
export function workdayIndex(start: DateStr, date: DateStr, cal: WorkCalendar): number {
  if (date < start) return -1;
  let idx = -1;
  for (const d of eachDay(start, date)) {
    if (isWorkday(d, cal)) idx++;
  }
  return idx;
}

/** 把公司日历展开成日期 → 是否上班的 Map，便于批量判断 */
export function companyWorkdaySet(
  rangeStart: DateStr,
  rangeEnd: DateStr,
  company: CompanyCalendar,
): Set<DateStr> {
  const cal: WorkCalendar = { weekend: company.weekend, company: company.overrides };
  const set = new Set<DateStr>();
  for (const d of eachDay(rangeStart, rangeEnd)) if (isWorkday(d, cal)) set.add(d);
  return set;
}

export function normalizeCalendarOverrides(
  input: Record<string, 'off' | 'work'> | null | undefined,
): Record<DateStr, 'off' | 'work'> {
  const out: Record<DateStr, 'off' | 'work'> = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (isValidDateStr(k) && (v === 'off' || v === 'work')) out[k] = v;
  }
  return out;
}