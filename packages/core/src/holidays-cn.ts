import type { DateStr } from './date.js';
import { eachDay } from './date.js';
import type { CompanyCalendar } from './calendar.js';

export interface HolidaySpec {
  name: string;
  /** 放假区间（闭区间） */
  from: DateStr;
  to: DateStr;
  /** 调休补班日 */
  makeup?: DateStr[];
}

/**
 * 国务院办公厅关于 2026 年部分节假日安排的通知
 * 国办发明电〔2025〕7 号 · 2025-11-04 发布
 * https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 */
export const CN_HOLIDAYS_2026: HolidaySpec[] = [
  { name: '元旦', from: '2026-01-01', to: '2026-01-03', makeup: ['2026-01-04'] },
  {
    name: '春节',
    from: '2026-02-15',
    to: '2026-02-23',
    makeup: ['2026-02-14', '2026-02-28'],
  },
  { name: '清明节', from: '2026-04-04', to: '2026-04-06' },
  { name: '劳动节', from: '2026-05-01', to: '2026-05-05', makeup: ['2026-05-09'] },
  { name: '端午节', from: '2026-06-19', to: '2026-06-21' },
  { name: '中秋节', from: '2026-09-25', to: '2026-09-27' },
  {
    name: '国庆节',
    from: '2026-10-01',
    to: '2026-10-07',
    makeup: ['2026-09-20', '2026-10-10'],
  },
];

/** 生成默认公司日历（周末 + 2026 法定节假日 + 调休补班） */
export function buildCompanyCalendar(specs: HolidaySpec[] = CN_HOLIDAYS_2026): CompanyCalendar {
  const overrides: Record<DateStr, 'off' | 'work'> = {};
  for (const spec of specs) {
    for (const d of eachDay(spec.from, spec.to)) overrides[d] = 'off';
    for (const d of spec.makeup ?? []) overrides[d] = 'work';
  }
  return { weekend: [0, 6], overrides };
}

/** 日历例外展开成 [{date, type, name}]，便于落库和界面编辑 */
export function flattenHolidaySpecs(
  specs: HolidaySpec[] = CN_HOLIDAYS_2026,
): Array<{ date: DateStr; type: 'holiday' | 'workday'; name: string }> {
  const out: Array<{ date: DateStr; type: 'holiday' | 'workday'; name: string }> = [];
  for (const spec of specs) {
    for (const d of eachDay(spec.from, spec.to)) out.push({ date: d, type: 'holiday', name: spec.name });
    for (const d of spec.makeup ?? []) out.push({ date: d, type: 'workday', name: `${spec.name}调休` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}