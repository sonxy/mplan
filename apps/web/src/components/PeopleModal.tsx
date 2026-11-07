import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { CalendarOff, Check, Plus, Trash2, Zap } from 'lucide-react';
import { PALETTE, resolvePersonColor, weekdayCN } from '@mplan/core';
import { api } from '../api';
import { useApp } from '../store';
import { Avatar, Button, Field, Modal, inputClass } from './ui';

export function PeopleModal() {
  const { boot, modal, setModal, refreshAll, notify, canEditGlobal } = useApp();
  const open = modal === 'people';

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState('');
  const [dayKind, setDayKind] = useState<'work' | 'off'>('work');

  useEffect(() => {
    if (!open) {
      setExpanded(null);
      setDayDate('');
      setName('');
      setRole('');
    }
  }, [open]);

  const persons = boot?.persons ?? [];

  const addPerson = async () => {
    if (!name.trim()) return;
    try {
      await api.createPerson({ name: name.trim(), role: role.trim() || undefined });
      setName('');
      setRole('');
      await refreshAll();
      notify('成员已添加', 'ok');
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const saveDays = async (
    personId: string,
    list: Array<{ date: string; work: boolean; note?: string }>,
  ) => {
    try {
      await api.savePersonDays(personId, list);
      await refreshAll();
      notify('个人日历已更新', 'ok');
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="人员"
      subtitle={
        canEditGlobal
          ? '负责人决定甘特图配色；加班 / 请假只影响这个人的工作日历。'
          : '只读模式：可以查看成员与个人例外，人员属于全局设置，只有管理员可以修改。'
      }
      width={620}
    >
      <div className="space-y-1.5">
        {persons.map((p) => {
          const overrides = Object.entries(boot?.personOverrides[p.id] ?? {});
          const color = resolvePersonColor(p.color);
          const isOpen = expanded === p.id;
          return (
            <div key={p.id} className="group rounded-lg border border-line bg-white">
              <div className="flex items-center gap-2.5 px-3 py-2">
                <Avatar person={p} size={26} />
                <div className="min-w-0 flex-1">
                  <input
                    defaultValue={p.name}
                    disabled={!canEditGlobal}
                    onBlur={async (e) => {
                      const v = e.target.value.trim();
                      if (v && v !== p.name) {
                        await api.patchPerson(p.id, { name: v });
                        await refreshAll();
                      }
                    }}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium text-ink outline-none hover:border-line focus:border-teal-600"
                  />
                  <input
                    defaultValue={p.role ?? ''}
                    placeholder="角色"
                    disabled={!canEditGlobal}
                    onBlur={async (e) => {
                      const v = e.target.value.trim();
                      if (v !== (p.role ?? '')) {
                        await api.patchPerson(p.id, { role: v || null });
                        await refreshAll();
                      }
                    }}
                    className="w-full rounded border border-transparent bg-transparent px-1 text-[11px] text-ink-3 outline-none hover:border-line focus:border-teal-600"
                  />
                </div>

                {canEditGlobal && (
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {PALETTE.slice(0, 9).map((c) => (
                    <button
                      key={c.key}
                      title={c.name}
                      onClick={async () => {
                        await api.patchPerson(p.id, { color: c.key });
                        await refreshAll();
                      }}
                      className={clsx(
                        'h-3 w-3 rounded-full transition-transform hover:scale-125',
                        color.key === c.key && 'ring-2 ring-stone-400 ring-offset-1',
                      )}
                      style={{ background: c.bar }}
                    />
                  ))}
                </div>
                )}

                <Button
                  size="sm"
                  variant={overrides.length ? 'outline' : 'ghost'}
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                  className="ml-1"
                >
                  {overrides.length ? `${overrides.length} 天例外` : '加班/请假'}
                </Button>

                {canEditGlobal && (
                  <button
                    onClick={async () => {
                      if (!confirm(`删除成员「${p.name}」？其任务会变成未分配。`)) return;
                      await api.deletePerson(p.id);
                      await refreshAll();
                      notify('成员已删除', 'ok');
                    }}
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-rose-50 hover:text-rose-600"
                    title="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="animate-fade-up border-t border-line-soft px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {overrides.length === 0 && (
                      <span className="text-[11.5px] text-ink-3">还没有例外日</span>
                    )}
                    {overrides.map(([d, v]) => (
                      <span
                        key={d}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
                          v.work
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-sky-200 bg-sky-50 text-sky-800',
                        )}
                      >
                        {v.work ? <Zap size={9} fill="currentColor" /> : <CalendarOff size={9} />}
                        {d.slice(5)} {weekdayCN(d)}
                        {canEditGlobal && (
                          <button
                            onClick={() =>
                              void saveDays(
                                p.id,
                                overrides
                                  .filter(([x]) => x !== d)
                                  .map(([x, y]) => ({ date: x, work: y.work, note: y.note ?? undefined })),
                              )
                            }
                            className="ml-0.5 opacity-60 hover:opacity-100"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>

                  {canEditGlobal && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      type="date"
                      className={clsx(inputClass, 'num max-w-[160px] py-1')}
                      value={dayDate}
                      onChange={(e) => setDayDate(e.target.value)}
                    />
                    <select
                      className={clsx(inputClass, 'max-w-[92px] py-1')}
                      value={dayKind}
                      onChange={(e) => setDayKind(e.target.value as 'work' | 'off')}
                    >
                      <option value="work">加班</option>
                      <option value="off">请假</option>
                    </select>
                    <Button
                      size="sm"
                      disabled={!dayDate}
                      onClick={() => {
                        if (!dayDate) return;
                        const next = [
                          ...overrides
                            .filter(([x]) => x !== dayDate)
                            .map(([x, y]) => ({ date: x, work: y.work, note: y.note ?? undefined })),
                          { date: dayDate, work: dayKind === 'work' },
                        ];
                        void saveDays(p.id, next);
                        setDayDate('');
                      }}
                    >
                      <Plus size={12} /> 添加
                    </Button>
                  </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canEditGlobal ? (
      <div className="mt-4 rounded-lg border border-dashed border-line bg-stone-50/60 p-3">
        <div className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
          添加成员
        </div>
        <div className="flex items-end gap-2">
          <Field label="姓名" className="w-[140px]">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="张三"
              onKeyDown={(e) => e.key === 'Enter' && void addPerson()}
            />
          </Field>
          <Field label="角色" className="flex-1">
            <input
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="前端开发"
              onKeyDown={(e) => e.key === 'Enter' && void addPerson()}
            />
          </Field>
          <Button variant="primary" onClick={() => void addPerson()} disabled={!name.trim()}>
            <Check size={13} /> 添加
          </Button>
        </div>
      </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-stone-50/60 px-3 py-2 text-[11.5px] text-ink-3">
          只读模式：只有管理员可以添加成员、调整配色、设置个人加班与请假。
        </div>
      )}
    </Modal>
  );
}