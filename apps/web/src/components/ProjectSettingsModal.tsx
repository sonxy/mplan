import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { api, type ProjectMember } from '../api';
import { useApp } from '../store';
import { Button, Field, Modal, inputClass } from './ui';

export function ProjectSettingsModal() {
  const { modal, setModal, detail, user, canAdminCurrent, refreshAll, notify } = useApp();
  const open = modal === 'projectSettings' && Boolean(detail) && canAdminCurrent;
  const projectId = detail?.project.id;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [candidates, setCandidates] = useState<Array<{ userId: string; username: string; displayName: string }>>([]);
  const [picked, setPicked] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadMembers = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.projectMembers(projectId);
      setMembers(res.members);
      setCandidates(res.candidates);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !detail) return;
    setName(detail.project.name);
    setCode(detail.project.code);
    setStartDate(detail.project.startDate);
    setDueDate(detail.project.dueDate ?? '');
    setNote(detail.project.note ?? '');
    setPicked('');
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detail?.project.id]);

  const save = async () => {
    if (!projectId || !name.trim()) return;
    setBusy(true);
    try {
      await api.patchProject(projectId, {
        name: name.trim(),
        code: code.trim(),
        startDate,
        dueDate: dueDate || null,
        note: note || null,
      });
      await refreshAll();
      notify('项目设置已保存', 'ok');
      setModal(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!projectId || !picked) return;
    setBusy(true);
    try {
      await api.addProjectMember(projectId, picked);
      setPicked('');
      await loadMembers();
      notify('已加入项目', 'ok');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (m: ProjectMember) => {
    if (!projectId) return;
    if (!confirm(`把「${m.displayName}」移出这个项目？`)) return;
    setBusy(true);
    try {
      await api.removeProjectMember(projectId, m.userId);
      await loadMembers();
      notify('已移出项目', 'ok');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="项目设置"
      subtitle="项目管理员可以修改项目信息、管理普通成员；项目管理员身份只能在「用户管理」里指定。"
      width={680}
      footer={
        <>
          <Button variant="outline" onClick={() => setModal(null)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim() || !code.trim()}>
            <Save size={13} /> 保存
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="项目名称" className="col-span-2">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名称"
            />
          </Field>
          <Field label="编号" hint="唯一">
            <input
              className={clsx(inputClass, 'num uppercase')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="WEB3"
            />
          </Field>
          <Field label="开始日期">
            <input
              type="date"
              className={clsx(inputClass, 'num')}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="计划完成">
            <input
              type="date"
              className={clsx(inputClass, 'num')}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label="备注" className="col-span-2">
            <textarea
              className={clsx(inputClass, 'h-[64px] resize-none')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="项目背景、目标、风险…"
            />
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                <UserRound size={12} /> 项目成员
              </div>
              <p className="mt-1 text-[10.5px] text-ink-3">
                全局管理员默认拥有全部项目权限，不在下方列表里。
              </p>
            </div>
            <span className="text-[10.5px] text-ink-3">{members.length} 人</span>
          </div>

          <div className="max-h-[180px] overflow-y-auto rounded-lg border border-line">
            {loading && members.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-ink-3">正在加载…</div>
            )}
            {!loading && members.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-ink-3">还没有项目成员</div>
            )}
            {members.map((m) => {
              const isSelf = m.userId === user?.id;
              const canRemove = m.role === 'member' || user?.role === 'admin';
              return (
                <div
                  key={m.userId}
                  className="flex items-center gap-2 border-b border-line-soft px-3 py-2 last:border-b-0"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-medium text-white">
                    {m.displayName.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-ink">
                      {m.displayName}
                      {isSelf && <span className="ml-1 text-[10px] font-normal text-ink-3">我</span>}
                    </div>
                    <div className="num truncate text-[10.5px] text-ink-3">@{m.username}</div>
                  </div>
                  <span
                    className={clsx(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      m.role === 'admin'
                        ? 'bg-teal-50 text-brand'
                        : 'bg-stone-100 text-ink-3',
                    )}
                  >
                    {m.role === 'admin' ? '项目管理员' : '成员'}
                  </span>
                  {canRemove && !isSelf ? (
                    <button
                      onClick={() => void removeMember(m)}
                      disabled={busy}
                      title="移出项目"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <span className="w-7 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-end gap-1.5">
            <Field label="添加成员" className="flex-1">
              <select
                className={clsx(inputClass, 'py-[7px]')}
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                disabled={candidates.length === 0}
              >
                <option value="">
                  {candidates.length === 0 ? '没有可添加的账号' : '选择已有账号…'}
                </option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.displayName} (@{c.username})
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => void addMember()} disabled={busy || !picked}>
              <Plus size={13} /> 加入
            </Button>
          </div>
          <p className="mt-2 flex items-start gap-1 text-[10.5px] leading-relaxed text-ink-3">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" />
            项目管理员可以添加/移除普通成员；项目管理员身份由全局管理员在「用户管理」里指定。
          </p>
        </div>
      </div>
    </Modal>
  );
}
