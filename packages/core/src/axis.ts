import { type DateStr, dayOfWeek, eachDay, parseDate } from './date.js';
import { type CompanyCalendar, type WorkCalendar, isWorkday } from './calendar.js';

export interface AxisColumn {
  date: DateStr;
  /** 在轴上的列序号 */
  index: number;
  /** 公司日历里这天不上班，但因为有人/有任务加班而出现在轴上 */
  overtime: boolean;
  monthKey: string;
  day: number;
  dow: number;
}

export interface AxisMonth {
  key: string;
  label: string;
  startIndex: number;
  span: number;
}

export interface Axis {
  columns: AxisColumn[];
  indexByDate: Map<DateStr, number>;
  months: AxisMonth[];
  start: DateStr | null;
  end: DateStr | null;
}

/**
 * 压缩工作日轴：周末和法定节假日默认不占列。
 * 只要任何一个人或任何一个任务在这天加班，这一天就会作为「加班列」插入轴上。
 */
export function buildAxis(
  rangeStart: DateStr,
  rangeEnd: DateStr,
  company: CompanyCalendar,
  extraWorkDays: Iterable<DateStr> = [],
): Axis {
  const base: WorkCalendar = { weekend: company.weekend, company: company.overrides };
  const extra = new Set<DateStr>();
  for (const d of extraWorkDays) {
    // 只有本来是休息日的才标记为「加班列」
    if (!isWorkday(d, base)) extra.add(d);
  }

  const columns: AxisColumn[] = [];
  const indexByDate = new Map<DateStr, number>();
  for (const d of eachDay(rangeStart, rangeEnd)) {
    const isBase = isWorkday(d, base);
    if (!isBase && !extra.has(d)) continue;
    const [, m, day] = d.split('-');
    const col: AxisColumn = {
      date: d,
      index: columns.length,
      overtime: !isBase,
      monthKey: d.slice(0, 7),
      day: Number(day),
      dow: dayOfWeek(d),
    };
    indexByDate.set(d, col.index);
    columns.push(col);
  }

  const months: AxisMonth[] = [];
  for (const col of columns) {
    const last = months[months.length - 1];
    if (last && last.key === col.monthKey) last.span++;
    else {
      const [y, m] = col.monthKey.split('-');
      months.push({
        key: col.monthKey,
        label: `${y}年${Number(m)}月`,
        startIndex: col.index,
        span: 1,
      });
    }
  }

  return {
    columns,
    indexByDate,
    months,
    start: columns[0]?.date ?? null,
    end: columns[columns.length - 1]?.date ?? null,
  };
}

/** 轴上落在 [a, b] 内的列序号区间，用于绘制任务条 */
export function spanIndexes(
  axis: Axis,
  start: DateStr,
  due: DateStr,
): { from: number; to: number } | null {
  let from = axis.indexByDate.get(start);
  let to = axis.indexByDate.get(due);

  // 起止日不在轴上（极端情况：任务被排在全员休息日）时向两侧找最近列
  if (from == null) {
    const firstAfter = axis.columns.find((c) => c.date >= start);
    from = firstAfter?.index ?? axis.columns.length - 1;
  }
  if (to == null) {
    const lastBefore = [...axis.columns].reverse().find((c) => c.date <= due);
    to = lastBefore?.index ?? 0;
  }
  if (from == null || to == null) return null;
  if (to < from) to = from;
  return { from, to };
}

/** 今天在轴上的像素位置：落在某个非工作日时，贴到下一列的左边界 */
export function todayOffset(
  axis: Axis,
  today: DateStr,
  colWidth: number,
): { x: number; exact: boolean } | null {
  if (axis.columns.length === 0) return null;
  if (today < axis.columns[0].date) return { x: 0, exact: false };
  const idx = axis.indexByDate.get(today);
  if (idx != null) return { x: idx * colWidth, exact: true };
  const next = axis.columns.find((c) => c.date > today);
  if (next) return { x: next.index * colWidth, exact: false };
  return { x: axis.columns.length * colWidth, exact: false };
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${y}年${Number(m)}月`;
}

export function axisRangeForDates(dates: DateStr[]): { start: DateStr; end: DateStr } | null {
  if (dates.length === 0) return null;
  let min = dates[0];
  let max = dates[0];
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { start: min, end: max };
}

export function tsOf(d: DateStr): number {
  return parseDate(d);
}