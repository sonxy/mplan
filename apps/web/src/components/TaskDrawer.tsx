import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  CalendarOff,
  Check,
  Circle,
  Clock,
  Link2,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  DEPTH_LABEL,
  addDays,
  calendarFor,
  countWorkdays,
  deriveTask,
  eachDay,
  formatCN,
  isWorkday,
  weekdayCN,
} from '@mplan/core';
import { api } from '../api';
import { useApp } from '../store';
import { companyFromBootstrap, workingDayCount } from '../lib/gantt';
import { Avatar, Button, Field, IconButton, Modal, ProgressBar, inputClass } from './ui';

export function TaskDrawer() {
  const {
    boot,
    detail,
    selectedId,
    select,
    patchTask,
    commitTaskPatch,
    removeTask,
    refreshProject,
    notify,
    postponeTask,
    canEdit,
    user,
    autoShift,
  } = useApp();
  const task = detail?.tasks.find((t) => t.id === selectedId) ?? null;

  const [name, setName] = useState('');
  const [hours, setHours] = useState('8');
  const [note, setNote] = useState('');
  const [otDate, setOtDate] = useState('');
  const [postponeOpen, setPostponeOpen] = useState(false);

  useEffect(() => {
    setName(task?.name ?? '');
    setHours(task ? String(Math.round(task.estimateHours)) : '8');
    setNote(task?.note ?? '');
    setOtDate('');
  }, [task?.id, task?.name, task?.estimateHours, task?.note]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select]);

  const computed = useMemo(() => {
    if (!task || !detail || !boot) return null;
    const company = companyFromBootstrap(boot);
    const cal = calendarFor(
      company,
      task.ownerId ? detail.personOverrides[task.ownerId] : undefined,
      detail.taskOverrides[task.id],
    );
    const derived = deriveTask(task, detail.today, cal);
    const overtime = Object.entries(detail.taskOverrides[task.id] ?? {})
      .filter(([, v]) => v.work)
      .map(([d]) => d)
      .sort();
    const owner = boot.persons.find((p) => p.id === task.ownerId) ?? null;
    const personOvertime = Object.entries(
      (task.ownerId && detail.personOverrides[task.ownerId]) || {},
    )
      .filter(([, v]) => v.work)
      .map(([d]) => d)
      .sort();
    const leaves = detail.tasks.filter((t) => t.parentId === task.id);
    return {
      derived,
      overtime,
      owner,
      personOvertime,
      company,
      isParent: leaves.length > 0,
      workdays: countWorkdays(task.startDate, task.dueDate, cal),
    };
  }, [task, detail, boot]);

  const postpone = useMemo(() => {
    if (!task || !detail || !boot || task.doneAt) return null;
    // 父任务交给具体子任务去顺延
    if (detail.tasks.some((t) => t.parentId === task.id)) return null;
    if (detail.today <= task.dueDate) return null;
    const company = companyFromBootstrap(boot);
    const cal = calendarFor(
      company,
      task.ownerId ? detail.personOverrides[task.ownerId] : undefined,
      detail.taskOverrides[task.id],
    );
    const delta = countWorkdays(addDays(task.dueDate, 1), detail.today, cal);
    if (delta <= 0) return null;
    const parentIds = new Set(
      detail.tasks.filter((t) => detail.tasks.some((c) => c.parentId === t.id)).map((t) => t.id),
    );
    const targets = detail.tasks.filter(
      (t) => !t.doneAt && !parentIds.has(t.id) && t.startDate >= task.startDate,
    );
    return { delta, count: targets.length };
  }, [task, detail, boot]);

  if (!task || !detail || !computed) return null;

  const { derived, overtime, owner, personOvertime, isParent, workdays } = computed;
  const done = Boolean(task.doneAt);
  const isMilestone = task.kind === 'milestone';

  const commitName = () => {
    if (!canEdit) return;
    const v = name.trim();
    if (v && v !== task.name) void patchTask(task.id, { name: v });
    else setName(task.name);
  };

  const commitHours = () => {
    if (!canEdit) return;
    const v = Number(hours);
    if (!Number.isFinite(v) || v <= 0) {
      setHours(String(Math.round(task.estimateHours)));
      return;
    }
    if (v !== task.estimateHours) void commitTaskPatch(task.id, { estimateHours: v });
  };

  const saveOvertime = async (dates: string[]) => {
    try {
      await api.saveTaskDays(
        task.id,
        dates.map((d) => ({ date: d, work: true, note: '任务加班' })),
      );
      await refreshProject();
      notify('加班日已更新', 'ok');
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const addOvertime = () => {
    if (!otDate || overtime.includes(otDate)) return;
    void saveOvertime([...overtime, otDate]);
    setOtDate('');
  };

  return (
    <aside className="animate-slide-in flex h-full w-[392px] shrink-0 flex-col border-l border-line bg-white shadow-[-8px_0_24px_-16px_rgba(28,25,23,0.18)]">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
              L{task.depth} · {DEPTH_LABEL[task.depth] ?? '任务'}
            </span>
            {isMilestone && (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                里程碑
              </span>
            )}
            {!canEdit && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                只读
              </span>
            )}
            {done && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <Check size={9} strokeWidth={3} /> 已完成
              </span>
            )}
            {derived.overdue && canEdit && (
              <button
                onClick={() => setPostponeOpen(true)}
                disabled={!postpone}
                title="把这个任务和它之后的未完成任务整体后移"
                className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
              >
                逾期 {derived.overdueWorkdays} 个工作日 · 顺延
              </button>
            )}
          </div>
          <input
            value={name}
            readOnly={!canEdit}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={clsx(
              'mt-1.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold text-ink outline-none',
              canEdit
                ? 'hover:border-line focus:border-teal-600 focus:bg-white'
                : 'cursor-default',
            )}
          />
        </div>
        <IconButton label="关闭" onClick={() => select(null)}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto">
        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              {isMilestone ? '节点状态' : '时间进度'}
            </span>
            <span className="num text-[12px] font-medium text-ink">
              {isMilestone ? (done ? '已达成' : '未达成') : `${Math.round((done ? 1 : derived.progress) * 100)}%`}
            </span>
          </div>
          <ProgressBar
            value={done ? 1 : derived.progress}
            tone={derived.overdue ? 'overdue' : done ? 'done' : 'brand'}
            className="h-1.5"
          />
          <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3">
            {isMilestone ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> 零工期节点，只看是否达成
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} /> 工期 {derived.durationDays} 个工作日
                </span>
                <span className="text-stone-300">|</span>
                <span>已过 {derived.elapsedDays} 天</span>
              </>
            )}
            {isParent && <span className="text-amber-600">（父任务，日期由子任务汇总）</span>}
          </div>
        </div>

        <div className="space-y-3.5 border-b border-line px-4 py-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="负责人">
              <select
                className={inputClass}
                disabled={!canEdit}
                value={task.ownerId ?? ''}
                onChange={(e) =>
                  void patchTask(task.id, { ownerId: e.target.value || null })
                }
              >
                <option value="">未分配</option>
                {boot?.persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role ? ` · ${p.role}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="工时" hint={isMilestone ? '里程碑无工期' : '8h = 1 天'}>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  step={4}
                  className={clsx(inputClass, 'num pr-7')}
                  value={hours}
                  disabled={isParent || isMilestone || !canEdit}
                  onChange={(e) => setHours(e.target.value)}
                  onBlur={commitHours}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-ink-3">
                  h
                </span>
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="开始时间">
              <input
                type="date"
                className={clsx(inputClass, 'num')}
                value={task.startDate}
                disabled={isParent || !canEdit}
                onChange={(e) =>
                  e.target.value && void commitTaskPatch(task.id, { startDate: e.target.value })
                }
              />
            </Field>
            <Field label="结束时间" hint={isMilestone ? '同开始日' : `${workdays} 个工作日`}>
              <input
                type="date"
                className={clsx(inputClass, 'num')}
                value={task.dueDate}
                disabled={isParent || isMilestone || !canEdit}
                onChange={(e) =>
                  e.target.value && void commitTaskPatch(task.id, { dueDate: e.target.value })
                }
              />
            </Field>
          </div>

          {canEdit && (
            <p className="flex items-start gap-1 text-[10.5px] leading-relaxed text-ink-3">
              <Link2 size={11} className="mt-0.5 shrink-0" />
              {autoShift
                ? '联动已开启：改期会自动顺延同一负责人 / 同一父级分支下开始日更晚的未完成任务。'
                : '联动已关闭：改期只动当前任务，可在顶部「联动」按钮重新开启。'}
            </p>
          )}

          {!isParent && (
            <label
              className={clsx(
                'flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-2 transition-colors',
                canEdit ? 'cursor-pointer hover:bg-stone-50' : 'opacity-70',
              )}
            >
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={isMilestone}
                onChange={(e) =>
                  void patchTask(task.id, { kind: e.target.checked ? 'milestone' : 'task' })
                }
                className="h-3.5 w-3.5 accent-violet-600"
              />
              里程碑（零工期，只看是否达成）
            </label>
          )}

          <div className="rounded-lg bg-stone-50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">开始</span>
              <span>{formatCN(task.startDate)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-ink-3">结束</span>
              <span>{formatCN(task.dueDate)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between border-t border-line/70 pt-1">
              <span className="text-ink-3">按 8h/天折算</span>
              <span className="num font-medium">
                {workdays} 天 × 8h = {workdays * 8}h
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-b border-line px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              完成状态
            </span>
            {canEdit ? (
              <button
                onClick={() => void patchTask(task.id, { done: !done })}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors',
                  done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-line bg-white text-ink-2 hover:bg-stone-50',
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : <Circle size={12} />}
                {done ? '已完成' : '标记完成'}
              </button>
            ) : (
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium',
                  done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-line bg-white text-ink-3',
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : <Circle size={12} />}
                {done ? '已完成' : '未完成'}
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">
            进度按已过工作日自动推算，到期未完成会变成「逾期」，但不会自动算完成。
          </p>

          <div className="flex items-center gap-1.5">
            <button
              disabled={!canEdit}
              onClick={() => void patchTask(task.id, { progressMode: 'auto', manualProgress: null })}
              className={clsx(
                'rounded-md border px-2 py-1 text-[11.5px] disabled:opacity-60',
                task.progressMode === 'auto'
                  ? 'border-teal-200 bg-teal-50 text-brand'
                  : 'border-line text-ink-3 hover:text-ink-2',
              )}
            >
              按时间自动
            </button>
            <button
              disabled={!canEdit}
              onClick={() =>
                void patchTask(task.id, {
                  progressMode: 'manual',
                  manualProgress: Math.round(derived.progress * 100),
                })
              }
              className={clsx(
                'rounded-md border px-2 py-1 text-[11.5px]',
                task.progressMode === 'manual'
                  ? 'border-teal-200 bg-teal-50 text-brand'
                  : 'border-line text-ink-3 hover:text-ink-2',
              )}
            >
              手动指定
            </button>
            {task.progressMode === 'manual' && (
              <input
                type="number"
                min={0}
                max={99}
                disabled={!canEdit}
                className={clsx(inputClass, 'num ml-auto w-[76px] max-w-[76px] py-1')}
                value={task.manualProgress ?? 0}
                onChange={(e) =>
                  void patchTask(task.id, { manualProgress: Number(e.target.value) })
                }
              />
            )}
          </div>
        </div>

        <div className="border-b border-line px-4 py-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              加班日
            </span>
            <span className="text-[10.5px] text-ink-3">占用节假日 / 周末</span>
          </div>

          {overtime.length === 0 && (
            <p className="text-[11.5px] text-ink-3">本任务没有单独的加班日。</p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {overtime.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800"
              >
                <Zap size={9} fill="currentColor" />
                {d.slice(5)} {weekdayCN(d)}
                {canEdit && (
                  <button
                    onClick={() => void saveOvertime(overtime.filter((x) => x !== d))}
                    className="ml-0.5 text-amber-500 hover:text-amber-800"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>

          {canEdit && (
            <div className="mt-2 flex gap-1.5">
              <input
                type="date"
                className={clsx(inputClass, 'num py-1')}
                value={otDate}
                onChange={(e) => setOtDate(e.target.value)}
              />
              <Button size="sm" onClick={addOvertime} disabled={!otDate} className="shrink-0">
                添加
              </Button>
            </div>
          )}

          {personOvertime.length > 0 && (
            <p className="mt-2 flex items-start gap-1 text-[10.5px] leading-relaxed text-ink-3">
              <CalendarOff size={11} className="mt-0.5 shrink-0" />
              {owner?.name} 还有 {personOvertime.length} 天个人加班：
              {personOvertime.map((d) => d.slice(5)).join('、')}
            </p>
          )}
        </div>

        <div className="px-4 py-3.5">
          <Field label="备注">
            <textarea
              className={clsx(inputClass, 'h-[72px] resize-none')}
              value={note}
              readOnly={!canEdit}
              placeholder="补充说明、风险、依赖…"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (canEdit && note !== (task.note ?? '')) {
                  void patchTask(task.id, { note: note || null });
                }
              }}
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line bg-stone-50/60 px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          {owner ? <Avatar person={owner} size={18} showName /> : '未分配负责人'}
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600 hover:bg-rose-50"
            onClick={() => {
              if (confirm(`删除「${task.name}」及其所有子任务？`)) void removeTask(task.id);
            }}
          >
            <Trash2 size={13} /> 删除
          </Button>
        ) : (
          <span className="text-[11px] text-amber-700">
            {user ? '只读模式 · 当前项目未分配给你的账号' : '只读模式 · 登录后可编辑'}
          </span>
        )}
      </div>

      <Modal
        open={postponeOpen}
        onClose={() => setPostponeOpen(false)}
        title="顺延任务"
        subtitle="不做依赖求解，只按时间顺序把后面的任务推开"
        width={470}
        footer={
          <>
            <Button variant="outline" onClick={() => setPostponeOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setPostponeOpen(false);
                void postponeTask(task.id);
              }}
            >
              确认顺延
            </Button>
          </>
        }
      >
        {postpone ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-ink">
              将「<b className="font-semibold">{task.name}</b>」及其后{' '}
              <b className="font-semibold">{postpone.count}</b> 个未完成任务，整体后移{' '}
              <b className="font-semibold text-brand">{postpone.delta}</b> 个工作日。
            </p>
            <div className="rounded-lg bg-stone-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
              <div className="mb-1 font-medium text-ink-3">顺延规则</div>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>只推移「开始日不早于本任务」且未完成的任务</li>
                <li>已完成的任务、以及父级汇总节点不动</li>
                <li>工时和工期保持不变，只平移日期</li>
                <li>父任务的起止会自动重新汇总</li>
              </ul>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-3">
              顺延后本任务的结束日会推到今天之后，暂时不再是逾期；如果届时仍未完成，会重新标记为逾期。
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">这个任务当前没有可顺延的逾期天数。</p>
        )}
      </Modal>
    </aside>
  );
}