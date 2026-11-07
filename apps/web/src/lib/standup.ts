import {
  type CompanyCalendar,
  type Task,
  recentWorkdays,
  todayStr,
  weekdayCN,
} from '@mplan/core';
import type { ProjectDetail } from '../api';

export interface StandupDay {
  date: string;
  short: string;
  weekday: string;
  done: Task[];
}

export interface StandupSummary {
  /** 实际今天（可能是非工作日） */
  today: string;
  /** 计划基准日：今天是工作日则是今天，否则是最近一个工作日 */
  planDate: string;
  /** 最近 3 个工作日，按时间正序 */
  days: StandupDay[];
  planTasks: Task[];
  overdue: Task[];
  dueToday: Task[];
  unassigned: number;
  /** 需要突出显示的任务 id（含其祖先，避免树结构断层） */
  focusIds: Set<string>;
  windowStart: string;
  windowEnd: string;
}

const shortDay = (date: string): string => `${date.slice(5).replace('-', '/')} ${weekdayCN(date)}`;

/**
 * 构造当前项目的晨会摘要：
 * - 最近 3 个工作日完成情况
 * - 计划基准日仍在进行中的叶子任务
 * - 逾期、今日到期、未分配
 * 父任务只作为上下文保留，不进入统计。
 */
export function buildStandup(detail: ProjectDetail, company: CompanyCalendar): StandupSummary {
  const cal = { weekend: company.weekend, company: company.overrides };
  const dates = recentWorkdays(detail.today, cal, 3);
  const planDate = dates[dates.length - 1] ?? detail.today;
  const doneByDate = new Map<string, Task[]>(dates.map((d) => [d, []]));

  const parentIds = new Set(
    detail.tasks.map((t) => t.parentId).filter((id): id is string => Boolean(id)),
  );
  const leaves = detail.tasks.filter((t) => !parentIds.has(t.id));

  for (const task of leaves) {
    if (!task.doneAt) continue;
    const doneDate = todayStr(new Date(task.doneAt));
    doneByDate.get(doneDate)?.push(task);
  }

  const planTasks = leaves.filter(
    (t) => !t.doneAt && t.startDate <= planDate && t.dueDate >= planDate,
  );
  const overdue = leaves.filter((t) => !t.doneAt && t.dueDate < planDate);
  const dueToday = planTasks.filter((t) => t.dueDate === planDate);
  const unassigned = planTasks.filter((t) => !t.ownerId).length;

  const days: StandupDay[] = dates.map((date) => ({
    date,
    short: shortDay(date),
    weekday: weekdayCN(date),
    done: doneByDate.get(date) ?? [],
  }));

  const focusIds = new Set<string>();
  for (const day of days) for (const task of day.done) focusIds.add(task.id);
  for (const task of planTasks) focusIds.add(task.id);
  for (const task of overdue) focusIds.add(task.id);

  // 把焦点任务的祖先也标亮，避免父节点变成一条灰色的孤零零汇总条
  const byId = new Map(detail.tasks.map((t) => [t.id, t]));
  for (const id of [...focusIds]) {
    let parentId = byId.get(id)?.parentId ?? null;
    let guard = 0;
    while (parentId && guard++ < 10) {
      focusIds.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return {
    today: detail.today,
    planDate,
    days,
    planTasks,
    overdue,
    dueToday,
    unassigned,
    focusIds,
    windowStart: dates[0] ?? detail.today,
    windowEnd: dates[dates.length - 1] ?? detail.today,
  };
}
