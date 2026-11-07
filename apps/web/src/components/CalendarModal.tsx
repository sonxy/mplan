import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarPlus, Check, Trash2 } from 'lucide-react';
import { weekdayCN } from '@mplan/core';
import { api, type CalendarExceptionDto } from '../api';
import { useApp } from '../store';
import { Button, Field, Modal, inputClass } from './ui';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_NAME: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  0: '周日',
};

export function CalendarModal() {
  const { boot, modal, setModal, refreshAll, notify, canEditGlobal } = useApp();
  const open = modal === 'calendar';

  const [weekend, setWeekend] = useState<number[]>([0, 6]);
  const [exceptions, setExceptions] = useState<CalendarExceptionDto[]>([]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'holiday' | 'workday'>('holiday');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && boot) {
      setWeekend(boot.calendar.weekend);
      setExceptions(boot.calendar.exceptions);
    }
  }, [open, boot]);

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarExceptionDto[]>();
    for (const e of [...exceptions].sort((a, b) => a.date.localeCompare(b.date))) {
      const key = e.date.slice(0, 7);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [exceptions]);

  const holidayCount = exceptions.filter((e) => e.type === 'holiday').length;
  const workdayCount = exceptions.filter((e) => e.type === 'workday').length;

  const add = () => {
    if (!date) return;
    const next = exceptions.filter((e) => e.date !== date);
    next.push({ date, type, name: name.trim() || (type === 'holiday' ? '自定义假期' : '调休补班') });
    setExceptions(next);
    setDate('');
    setName('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveCalendar({ weekend, exceptions });
      await refreshAll();
      notify('日历已保存', 'ok');
      setModal(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="日历与节假日"
      subtitle={`${boot?.calendar.name ?? '公司日历'} · 版本 ${boot?.calendar.version ?? ''} · 节假日与调休补班都会参与工期计算${
        canEditGlobal ? '' : ' · 只读模式'
      }`}
      width={640}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ink-3">
            {holidayCount} 天放假 · {workdayCount} 天补班
          </span>
          <Button variant="outline" onClick={() => setModal(null)}>
            {canEditGlobal ? '取消' : '关闭'}
          </Button>
          {canEditGlobal && (
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              <Check size={13} /> 保存
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            每周休息日
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => {
              const active = weekend.includes(d);
              return (
                <button
                  key={d}
                  disabled={!canEditGlobal}
                  onClick={() =>
                    setWeekend((w) => (active ? w.filter((x) => x !== d) : [...w, d]))
                  }
                  className={clsx(
                    'h-8 w-12 rounded-lg border text-[12px] font-medium transition-colors disabled:opacity-60',
                    active
                      ? 'border-teal-200 bg-teal-50 text-brand'
                      : 'border-line bg-white text-ink-3 hover:bg-stone-50',
                  )}
                >
                  {WEEK_NAME[d]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              法定节假日与调休
            </span>
            <span className="text-[10.5px] text-ink-3">
              2026 年数据来自国务院办公厅通知，2027 年待发布后补充
            </span>
          </div>

          <div className="thin-scroll max-h-[260px] overflow-y-auto rounded-lg border border-line">
            {grouped.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-ink-3">暂无例外日</div>
            )}
            {grouped.map(([month, list]) => (
              <div key={month}>
                <div className="sticky top-0 flex items-center gap-2 border-b border-line-soft bg-stone-50/95 px-3 py-1 text-[11px] font-medium text-ink-3 backdrop-blur">
                  {month.replace('-', ' 年 ')} 月
                  <span className="text-stone-300">/</span>
                  <span className="font-normal">{list.length} 天</span>
                </div>
                {list.map((e) => (
                  <div
                    key={e.date}
                    className="group flex items-center gap-2 border-b border-line-soft px-3 py-1.5 last:border-b-0 hover:bg-stone-50/60"
                  >
                    <span className="num w-[92px] text-[12px] text-ink">{e.date}</span>
                    <span className="w-[46px] text-[11px] text-ink-3">{weekdayCN(e.date)}</span>
                    <span
                      className={clsx(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        e.type === 'holiday'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-teal-50 text-brand',
                      )}
                    >
                      {e.type === 'holiday' ? '放假' : '补班'}
                    </span>
                    <span className="flex-1 truncate text-[12px] text-ink-2">{e.name}</span>
                    {canEditGlobal && (
                      <button
                        onClick={() => setExceptions((xs) => xs.filter((x) => x.date !== e.date))}
                        className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {canEditGlobal ? (
        <div className="rounded-lg border border-dashed border-line bg-stone-50/60 p-3">
          <div className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            添加例外日
          </div>
          <div className="flex items-end gap-2">
            <Field label="日期" className="w-[150px]">
              <input
                type="date"
                className={clsx(inputClass, 'num')}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="类型" className="w-[104px]">
              <select
                className={inputClass}
                value={type}
                onChange={(e) => setType(e.target.value as 'holiday' | 'workday')}
              >
                <option value="holiday">放假</option>
                <option value="workday">补班</option>
              </select>
            </Field>
            <Field label="名称" className="flex-1">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：春节调休"
                onKeyDown={(e) => e.key === 'Enter' && add()}
              />
            </Field>
            <Button onClick={add} disabled={!date}>
              <CalendarPlus size={13} /> 添加
            </Button>
          </div>
        </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-stone-50/60 px-3 py-2 text-[11.5px] text-ink-3">
            只读模式：日历属于全局设置，只有管理员可以修改。
          </div>
        )}
      </div>
    </Modal>
  );
}