/**
 * 日期工具：全部以 `YYYY-MM-DD` 字符串为准，内部用 UTC 零点做纯日历运算。
 * 不存、不传时间戳 —— 避免任何时区导致的整体偏移一天。
 */

export type DateStr = string;

const DAY_MS = 86_400_000;

/** 把 `2026-11-05` 解析成 UTC 零点毫秒数 */
export function parseDate(s: DateStr): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 把 UTC 零点毫秒数格式化成 `YYYY-MM-DD` */
export function toDateStr(ms: number): DateStr {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 用户所在时区的「今天」 */
export function todayStr(now: Date = new Date()): DateStr {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(s: DateStr, n: number): DateStr {
  return toDateStr(parseDate(s) + n * DAY_MS);
}

/** 0 = 周日 … 6 = 周六 */
export function dayOfWeek(s: DateStr): number {
  return new Date(parseDate(s)).getUTCDay();
}

/** b - a，单位天 */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

export function minDate(a: DateStr, b: DateStr): DateStr {
  return a <= b ? a : b;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a >= b ? a : b;
}

/** [a, b] 闭区间内每一天 */
export function eachDay(a: DateStr, b: DateStr): DateStr[] {
  const out: DateStr[] = [];
  if (b < a) return out;
  for (let t = parseDate(a); t <= parseDate(b); t += DAY_MS) out.push(toDateStr(t));
  return out;
}

export function isValidDateStr(s: unknown): s is DateStr {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDate(s));
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function weekdayCN(s: DateStr): string {
  return WEEKDAY_CN[dayOfWeek(s)];
}

/** `11月5日 周四` */
export function formatCN(s: DateStr): string {
  const [, m, d] = s.split('-');
  return `${Number(m)}月${Number(d)}日 ${weekdayCN(s)}`;
}