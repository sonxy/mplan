import clsx from 'clsx';
import { LocateFixed, Sunrise, X } from 'lucide-react';
import type { StandupSummary } from '../lib/standup';

/** 晨会条和 FilterBar 同为 42px，替换而不是叠加，不压缩甘特图高度 */
export function StandupBar({
  summary,
  onLocate,
  onExit,
}: {
  summary: StandupSummary;
  onLocate: () => void;
  onExit: () => void;
}) {
  const yesterday = summary.days[1];
  const twoDaysAgo = summary.days[0];
  const todayDone = summary.days[2]?.done.length ?? 0;
  const planLabel =
    summary.planDate === summary.today ? '今天计划' : `${summary.days[2]?.short ?? ''} 计划`;

  return (
    <div className="flex h-[42px] shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-white px-3">
      <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-brand">
        <Sunrise size={13} /> 晨会
      </span>
      <span className="shrink-0 text-[10.5px] text-ink-3">最近 3 个工作日</span>

      <div className="flex shrink-0 items-center gap-1.5">
        {twoDaysAgo && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
            title={twoDaysAgo.done.map((t) => t.name).join('\n') || '没有完成的任务'}
          >
            {twoDaysAgo.short}
            <b className="font-semibold">完成 {twoDaysAgo.done.length}</b>
          </span>
        )}
        {yesterday && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
            title={yesterday.done.map((t) => t.name).join('\n') || '没有完成的任务'}
          >
            {yesterday.short}
            <b className="font-semibold">完成 {yesterday.done.length}</b>
          </span>
        )}
        <span
          className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700"
          title={summary.planTasks.map((t) => t.name).join('\n') || '今天没有进行中的任务'}
        >
          {planLabel}
          <b className="font-semibold">{summary.planTasks.length}</b>
        </span>
        {summary.dueToday.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800"
            title="今天到期且尚未完成"
          >
            今天到期
            <b className="font-semibold">{summary.dueToday.length}</b>
          </span>
        )}
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
            summary.overdue.length
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-line bg-stone-50 text-ink-3',
          )}
          title={summary.overdue.map((t) => t.name).join('\n') || '没有逾期任务'}
        >
          逾期
          <b className="font-semibold">{summary.overdue.length}</b>
        </span>
        {summary.unassigned > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
            未分配
            <b className="font-semibold">{summary.unassigned}</b>
          </span>
        )}
        {todayDone > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
            今天完成
            <b className="font-semibold">{todayDone}</b>
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          onClick={onLocate}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-ink-2 hover:bg-stone-100"
          title="滚动到最近 3 个工作日的起点"
        >
          <LocateFixed size={13} /> 定位
        </button>
        <button
          onClick={onExit}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-ink-3 hover:bg-stone-100 hover:text-ink"
          title="退出晨会聚焦"
        >
          <X size={13} /> 退出晨会
        </button>
      </div>
    </div>
  );
}
