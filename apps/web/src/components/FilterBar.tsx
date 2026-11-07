import { useEffect, useMemo } from 'react';
import clsx from 'clsx';
import { Search, Sunrise, X } from 'lucide-react';
import { useApp } from '../store';
import { Avatar } from './ui';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'todo', label: '未开始' },
  { value: 'doing', label: '进行中' },
  { value: 'overdue', label: '逾期' },
  { value: 'done', label: '已完成' },
] as const;

export function FilterBar({ matched, total }: { matched: number; total: number }) {
  const { boot, detail, filter, setFilter, clearFilter, setStandupMode } = useApp();
  const active = Boolean(filter.query.trim()) || filter.persons.length > 0 || filter.status !== 'all';

  // 人员筛选只列当前项目里真正有任务负责人的人
  const projectPersons = useMemo(() => {
    const ownerIds = new Set(
      (detail?.tasks ?? []).map((t) => t.ownerId).filter((id): id is string => Boolean(id)),
    );
    return (boot?.persons ?? []).filter((p) => ownerIds.has(p.id));
  }, [boot, detail]);

  // 切项目后，旧项目里选中、但新项目不存在的人自动移出筛选，避免筛选出空列表
  useEffect(() => {
    const allowed = new Set(projectPersons.map((p) => p.id));
    const next = filter.persons.filter((id) => allowed.has(id));
    if (next.length !== filter.persons.length) setFilter({ persons: next });
  }, [projectPersons, filter.persons, setFilter]);

  const togglePerson = (id: string) => {
    const has = filter.persons.includes(id);
    setFilter({
      persons: has ? filter.persons.filter((x) => x !== id) : [...filter.persons, id],
    });
  };

  return (
    <div className="flex h-[42px] shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-white px-3">
      <div className="relative shrink-0">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3"
        />
        <input
          id="task-search"
          value={filter.query}
          onChange={(e) => setFilter({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilter({ query: '' });
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="搜索任务名 / 备注…"
          className="h-7 w-[188px] rounded-lg border border-line bg-stone-50 pr-6 pl-7 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/10"
        />
        {filter.query && (
          <button
            onClick={() => setFilter({ query: '' })}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded text-ink-3 hover:text-ink"
            aria-label="清空搜索"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="h-4 w-px shrink-0 bg-line" />

      <div className="flex shrink-0 items-center gap-1">
        {projectPersons.length === 0 && (
          <span className="text-[11px] text-ink-3">本项目还没有负责人</span>
        )}
        {projectPersons.map((p) => {
          const on = filter.persons.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => togglePerson(p.id)}
              title={`只看 ${p.name}`}
              className={clsx(
                'rounded-full transition-all',
                on ? 'ring-2 ring-brand ring-offset-1' : 'opacity-50 hover:opacity-90',
              )}
            >
              <Avatar person={p} size={22} />
            </button>
          );
        })}
      </div>

      <div className="h-4 w-px shrink-0 bg-line" />

      <div className="inline-flex shrink-0 items-center rounded-lg bg-stone-100 p-0.5">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setFilter({ status: o.value })}
            className={clsx(
              'rounded-[6px] px-2 py-[3px] text-[11.5px] font-medium whitespace-nowrap transition-colors',
              filter.status === o.value
                ? 'bg-white text-ink shadow-sm'
                : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {active && (
        <button
          onClick={clearFilter}
          className="shrink-0 rounded-md px-1.5 py-1 text-[11.5px] text-ink-3 hover:bg-stone-100 hover:text-ink"
        >
          清除筛选
        </button>
      )}

      <button
        onClick={() => {
          clearFilter();
          setStandupMode(true);
        }}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 text-[11.5px] font-medium text-brand transition-colors hover:bg-teal-100"
        title="聚焦最近 3 个工作日：昨天完成、今天计划、逾期与未分配"
      >
        <Sunrise size={13} /> 晨会
      </button>

      <span className="num shrink-0 pl-2 text-[11px] text-ink-3">
        {active ? (
          <>
            筛选出 <b className="font-medium text-ink-2">{matched}</b> / {total}
          </>
        ) : (
          <>共 {total} 个任务</>
        )}
      </span>
    </div>
  );
}
