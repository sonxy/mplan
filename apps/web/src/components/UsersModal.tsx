import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, KeyRound, Trash2, UserPlus, UserRound } from 'lucide-react';
import { api, type AuthUserSummary } from '../api';
import { useApp } from '../store';
import { Button, Field, Modal, inputClass } from './ui';

type ProjectRole = 'admin' | 'member';

function ProjectRoleEditor({
  selected,
  admins,
  onToggle,
  onRole,
  emptyHint = '不选则只能只读浏览',
}: {
  selected: string[];
  admins: string[];
  onToggle: (projectId: string) => void;
  onRole: (projectId: string, role: ProjectRole) => void;
  emptyHint?: string;
}) {
  const { boot } = useApp();
  // 已归档项目也要列出来，否则管理员会看不到成员在归档项目上的角色，
  // 一保存就可能把看不见的授权覆盖掉。
  const projects = [...(boot?.projects ?? []), ...(boot?.archivedProjects ?? [])];

  if (projects.length === 0) {
    return <span className="text-[11px] text-ink-3">还没有项目</span>;
  }

  return (
    <div className="max-h-[176px] overflow-y-auto rounded-md border border-line bg-white">
      {projects.map((p) => {
        const on = selected.includes(p.id);
        const isAdmin = admins.includes(p.id);
        return (
          <div
            key={p.id}
            className="flex items-center gap-2 border-b border-line-soft px-2 py-1.5 last:border-b-0"
          >
            <button
              type="button"
              onClick={() => onToggle(p.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              title={`${p.name}（${p.code}）`}
            >
              <span
                className={clsx(
                  'grid h-3.5 w-3.5 shrink-0 place-items-center rounded border',
                  on ? 'border-teal-600 bg-teal-600 text-white' : 'border-stone-300 bg-white',
                )}
              >
                {on && <Check size={9} strokeWidth={4} />}
              </span>
              <span className="max-w-[180px] truncate text-[11.5px] text-ink-2">{p.name}</span>
              <span className="num text-[10px] text-ink-3">{p.code}</span>
              {p.archivedAt && (
                <span className="shrink-0 rounded bg-amber-50 px-1 text-[9.5px] text-amber-700">
                  已归档
                </span>
              )}
            </button>
            {on && (
              <select
                value={isAdmin ? 'admin' : 'member'}
                onChange={(e) => onRole(p.id, e.target.value as ProjectRole)}
                className="h-6 shrink-0 rounded border border-line bg-white px-1 text-[10.5px] text-ink-2 outline-none"
                title="项目内角色"
              >
                <option value="member">成员</option>
                <option value="admin">项目管理员</option>
              </select>
            )}
          </div>
        );
      })}
      {selected.length === 0 && (
        <div className="px-2 py-2 text-[10.5px] text-ink-3">{emptyHint}</div>
      )}
    </div>
  );
}

/** 管理员维护登录账号：新增、改全局角色、分配项目与项目管理员、停用、重置密码、删除 */
export function UsersModal() {
  const { modal, setModal, user, notify, refreshAll, logout } = useApp();
  const open = modal === 'users' && user?.role === 'admin';

  const [items, setItems] = useState<AuthUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.users();
      setItems(res.users);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (list: string[], projectId: string): string[] =>
    list.includes(projectId) ? list.filter((id) => id !== projectId) : [...list, projectId];

  const add = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      await api.createUser({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
        role,
        projectIds: role === 'member' ? selectedProjects : [],
        projectAdminIds: role === 'member' ? selectedAdmins : [],
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole('member');
      setSelectedProjects([]);
      setSelectedAdmins([]);
      await load();
      notify('用户已创建', 'ok');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (target: AuthUserSummary, body: Parameters<typeof api.patchUser>[1]) => {
    try {
      const res = await api.patchUser(target.id, body);
      setItems((list) => list.map((u) => (u.id === target.id ? res.user : u)));
      notify('已保存', 'ok');
      if (target.id === user?.id && body.password === undefined) await refreshAll();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const toggleProject = (target: AuthUserSummary, projectId: string) => {
    const on = target.projectIds.includes(projectId);
    const projectIds = on
      ? target.projectIds.filter((id) => id !== projectId)
      : [...target.projectIds, projectId];
    const projectAdminIds = on
      ? target.projectAdminIds.filter((id) => id !== projectId)
      : target.projectAdminIds;
    void patch(target, { projectIds, projectAdminIds });
  };

  const setProjectRole = (target: AuthUserSummary, projectId: string, nextRole: ProjectRole) => {
    const projectAdminIds =
      nextRole === 'admin'
        ? [...new Set([...target.projectAdminIds, projectId])]
        : target.projectAdminIds.filter((id) => id !== projectId);
    void patch(target, { projectIds: target.projectIds, projectAdminIds });
  };

  const resetPassword = async (target: AuthUserSummary) => {
    const next = window.prompt(`给「${target.displayName}」设置新密码（至少 6 位）`);
    if (!next) return;
    if (next.length < 6) {
      notify('密码至少 6 位');
      return;
    }
    await patch(target, { password: next });
    if (target.id === user?.id) {
      notify('密码已更新，请用新密码重新登录', 'ok');
      await logout();
    }
  };

  const remove = async (target: AuthUserSummary) => {
    if (!window.confirm(`删除账号「${target.displayName}」？该账号的登录会话会立即失效。`)) return;
    try {
      await api.deleteUser(target.id);
      setItems((list) => list.filter((u) => u.id !== target.id));
      notify('账号已删除', 'ok');
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="用户管理"
      subtitle="普通成员只能编辑被分配的项目；项目管理员还能管理该项目的设置和成员；全局管理员拥有全部权限。"
      width={780}
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-stone-50 px-3 py-1.5 text-[10.5px] font-medium text-ink-3">
            <span className="w-5" />
            <span className="flex-1">账号 / 可管理项目</span>
            <span className="w-[92px]">全局角色</span>
            <span className="w-[70px]">状态</span>
            <span className="w-[112px] text-right">操作</span>
          </div>

          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-ink-3">
              {loading ? '正在加载…' : '还没有账号'}
            </div>
          )}

          {items.map((u) => {
            const self = u.id === user?.id;
            const projectsOpen = expanded === u.id;
            return (
              <div
                key={u.id}
                className="border-b border-line-soft last:border-b-0 hover:bg-stone-50/60"
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-medium text-white">
                    {u.displayName.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-ink">
                        {u.displayName}
                      </span>
                      {self && (
                        <span className="rounded bg-teal-50 px-1 py-px text-[9.5px] text-brand">
                          我
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="num shrink-0 text-[10.5px] text-ink-3">@{u.username}</span>
                      {u.role === 'admin' ? (
                        <span className="truncate text-[10.5px] text-ink-3">· 全部项目</span>
                      ) : (
                        <button
                          onClick={() => setExpanded(projectsOpen ? null : u.id)}
                          className={clsx(
                            'truncate rounded px-1 text-[10.5px] transition-colors hover:bg-teal-50',
                            u.projectIds.length ? 'text-brand' : 'text-amber-700',
                          )}
                          title="点击分配项目和项目管理员"
                        >
                          ·{' '}
                          {u.projectIds.length
                            ? `管理 ${u.projectIds.length} 个项目${
                                u.projectAdminIds.length
                                  ? ` · ${u.projectAdminIds.length} 个项目管理员`
                                  : ''
                              }`
                            : '未分配项目'}
                        </button>
                      )}
                    </div>
                  </div>

                  <select
                    value={u.role}
                    disabled={self}
                    onChange={(e) => {
                      const nextRole = e.target.value as 'admin' | 'member';
                      void patch(u, { role: nextRole });
                      if (nextRole === 'member') setExpanded(u.id);
                    }}
                    className="h-7 w-[92px] shrink-0 rounded-md border border-line bg-white px-1.5 text-[11.5px] text-ink outline-none disabled:opacity-60"
                  >
                    <option value="admin">全局管理员</option>
                    <option value="member">成员</option>
                  </select>

                  <button
                    disabled={self}
                    onClick={() => void patch(u, { active: !u.active })}
                    className={clsx(
                      'w-[70px] rounded-md border px-1 py-0.5 text-[10.5px] font-medium transition-colors disabled:opacity-60',
                      u.active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-line bg-stone-100 text-ink-3',
                    )}
                    title={self ? '不能停用自己' : u.active ? '点击停用' : '点击启用'}
                  >
                    {u.active ? '启用中' : '已停用'}
                  </button>

                  <div className="flex w-[112px] shrink-0 items-center justify-end gap-1">
                    <button
                      onClick={() => void resetPassword(u)}
                      title="重置密码"
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-stone-100 hover:text-ink"
                    >
                      <KeyRound size={13} />
                    </button>
                    <button
                      onClick={() => void remove(u)}
                      disabled={self}
                      title={self ? '不能删除自己' : '删除账号'}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {u.role === 'member' && projectsOpen && (
                  <div className="animate-fade-up border-t border-line-soft bg-stone-50/70 px-3 py-2.5 pl-11">
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">
                        可管理的项目 / 项目角色
                      </span>
                      <span className="text-[10px] text-ink-3">
                        {u.projectIds.length === 0 ? '不选则只能只读浏览' : '修改后立即保存'}
                      </span>
                    </div>
                    <ProjectRoleEditor
                      selected={u.projectIds}
                      admins={u.projectAdminIds}
                      onToggle={(projectId) => toggleProject(u, projectId)}
                      onRole={(projectId, nextRole) => setProjectRole(u, projectId, nextRole)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-dashed border-line bg-stone-50/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            <UserPlus size={12} /> 添加账号
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="用户名" className="w-[142px]">
              <input
                className={clsx(inputClass, 'num')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="zhangsan"
                onKeyDown={(e) => e.key === 'Enter' && void add()}
              />
            </Field>
            <Field label="显示名称" className="w-[132px]">
              <input
                className={inputClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="张三"
                onKeyDown={(e) => e.key === 'Enter' && void add()}
              />
            </Field>
            <Field label="密码" className="w-[142px]">
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                onKeyDown={(e) => e.key === 'Enter' && void add()}
              />
            </Field>
            <Field label="全局角色" className="w-[108px]">
              <select
                className={clsx(inputClass, 'py-[7px]')}
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
              >
                <option value="member">成员</option>
                <option value="admin">全局管理员</option>
              </select>
            </Field>
            <Button
              variant="primary"
              onClick={() => void add()}
              disabled={busy || !username.trim() || password.length < 6}
            >
              <UserRound size={13} /> 添加
            </Button>
          </div>

          {role === 'member' ? (
            <div className="mt-3 rounded-md border border-line bg-white p-2.5">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">
                  可管理的项目 / 项目角色
                </span>
                <span className="text-[10px] text-ink-3">不选则只能只读浏览</span>
              </div>
              <ProjectRoleEditor
                selected={selectedProjects}
                admins={selectedAdmins}
                onToggle={(projectId) => {
                  setSelectedProjects((ids) => toggle(ids, projectId));
                  setSelectedAdmins((ids) => ids.filter((id) => id !== projectId));
                }}
                onRole={(projectId, nextRole) =>
                  setSelectedAdmins((ids) =>
                    nextRole === 'admin'
                      ? [...new Set([...ids, projectId])]
                      : ids.filter((id) => id !== projectId),
                  )
                }
              />
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-ink-3">全局管理员自动拥有全部项目的全部权限。</p>
          )}

          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
            注意：项目管理员可以改项目设置和成员，但不能创建账号或管理全局人员/日历；项目管理员身份只有全局管理员能指定。
          </p>
        </div>
      </div>
    </Modal>
  );
}
