import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  CornerDownRight,
  Diamond,
  Download,
  History,
  LogIn,
  LogOut,
  Plus,
  Settings2,
  Undo2,
  Upload,
  UserCog,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { buildProjectCsv, csvFileName, formatCN } from '@mplan/core';
import { useApp } from '../store';
import { downloadTextFile } from '../lib/download';
import { Button, IconButton, Segmented } from './ui';

function ProjectMenu() {
  const { boot, detail, user, canEdit, canEditGlobal, canAdminCurrent, openProject, setModal, notify } =
    useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = detail?.project;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-stone-100"
      >
        <span className="max-w-[240px] truncate text-[13.5px] font-semibold text-ink">
          {current?.name ?? '选择项目'}
        </span>
        {current && (
          <span className="rounded border border-line bg-stone-50 px-1 py-px text-[10px] font-medium tracking-wide text-ink-3">
            {current.code}
          </span>
        )}
        <ChevronDown size={14} className="text-ink-3" />
      </button>

      {open && (
        <div className="animate-fade-up absolute top-full left-0 z-[90] mt-1.5 w-[288px] overflow-hidden rounded-xl border border-line bg-white p-1 shadow-xl shadow-stone-900/10">
          <div className="px-2 py-1.5 text-[10px] font-medium tracking-wider text-ink-3 uppercase">
            项目
          </div>
          {(boot?.projects ?? []).map((p) => {
            const active = p.id === current?.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setOpen(false);
                  if (!active) void openProject(p.id);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-teal-50' : 'hover:bg-stone-50',
                )}
              >
                <span className="flex-1 truncate text-[13px] text-ink">{p.name}</span>
                <span className="text-[10px] text-ink-3">{p.code}</span>
                {active && <Check size={13} className="text-brand" />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-line-soft" />
          {canAdminCurrent && (
            <button
              onClick={() => {
                setOpen(false);
                setModal('projectSettings');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-stone-50"
            >
              <Settings2 size={14} /> 项目设置 / 成员
            </button>
          )}
          {canEditGlobal && (
            <button
              onClick={() => {
                setOpen(false);
                setModal('newProject');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-stone-50"
            >
              <Plus size={14} /> 新建项目
            </button>
          )}
          {canEdit ? (
            <button
              onClick={() => {
                setOpen(false);
                setModal('import');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-stone-50"
            >
              <Upload size={14} /> 导入 CSV 模板
            </button>
          ) : (
            <div className="px-2 py-1.5 text-[11.5px] leading-relaxed text-ink-3">
              {user
                ? '当前项目只读：你的账号没有被分配这个项目'
                : '只读模式：登录后才能新建 / 导入项目'}
            </div>
          )}
          <button
            disabled={!detail || !boot}
            onClick={() => {
              setOpen(false);
              if (!detail || !boot) return;
              downloadTextFile(
                csvFileName(detail.project.code, detail.project.name),
                buildProjectCsv(detail.tasks, boot.persons),
              );
              notify('已导出 CSV', 'ok');
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-stone-50 disabled:opacity-40"
          >
            <Download size={14} /> 导出当前项目 CSV
          </button>
          <div className="px-2 pt-1 pb-1.5 text-[11px] text-ink-3">
            共 {boot?.projects.length ?? 0} 个项目
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, setModal, logout } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">
          只读
        </span>
        <Button size="sm" variant="outline" onClick={() => setModal('login')}>
          <LogIn size={13} /> 登录
        </Button>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg py-1 pr-1 pl-1.5 transition-colors hover:bg-stone-100"
        title={`${user.displayName} · ${user.role === 'admin' ? '管理员' : '成员'}`}
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-[11px] font-medium text-white">
          {user.displayName.slice(0, 1)}
        </span>
        <span className="max-w-[96px] truncate text-[12.5px] font-medium text-ink">
          {user.displayName}
        </span>
        <ChevronDown size={13} className="text-ink-3" />
      </button>

      {open && (
        <div className="animate-fade-up absolute top-full right-0 z-[90] mt-1.5 w-[216px] overflow-hidden rounded-xl border border-line bg-white p-1 shadow-xl shadow-stone-900/10">
          <div className="px-2 py-1.5">
            <div className="truncate text-[12.5px] font-semibold text-ink">{user.displayName}</div>
            <div className="num mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-3">
              @{user.username}
              <span className="text-stone-300">·</span>
              {user.role === 'admin' ? '管理员' : '成员'}
            </div>
            <div className="mt-0.5 text-[10.5px] text-ink-3">
              {user.role === 'admin'
                ? '全部项目可编辑'
                : user.projectIds.length
                  ? `管理 ${user.projectIds.length} 个项目${
                      user.projectAdminIds.length
                        ? ` · ${user.projectAdminIds.length} 个项目管理员`
                        : ''
                    }`
                  : '还没有分配可管理的项目'}
            </div>
          </div>
          <div className="my-1 h-px bg-line-soft" />
          {user.role === 'admin' && (
            <button
              onClick={() => {
                setOpen(false);
                setModal('users');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-stone-50"
            >
              <UserCog size={14} /> 用户管理
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-stone-50"
          >
            <LogOut size={14} /> 退出登录
          </button>
          <div className="px-2 pt-1 pb-1.5 text-[10.5px] text-ink-3">
            退出后自动回到只读模式
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const {
    boot,
    zoom,
    setZoom,
    view,
    setView,
    setModal,
    pingToday,
    addTask,
    detail,
    history,
    undo,
    canEdit,
    user,
    dayWidthScale,
    setDayWidthScale,
  } = useApp();

  return (
    <header className="flex h-[50px] shrink-0 items-center gap-3 border-b border-line bg-white px-3">
      <div className="flex items-center gap-2 pr-1">
        <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-brand text-[13px] font-bold text-white">
          m
        </div>
        <span className="text-[14px] font-semibold tracking-tight text-ink">mplan</span>
      </div>

      <div className="h-4 w-px bg-line" />

      <ProjectMenu />

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={pingToday}
          className="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-2 transition-colors hover:bg-stone-100 sm:flex"
          title="回到今天"
        >
          <CornerDownRight size={13} className="text-ink-3" />
          今天 {boot ? formatCN(boot.today) : ''}
        </button>

        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'project', label: '项目', title: '按任务层级看' },
            { value: 'people', label: '人员', title: '按人看排期与负载' },
          ]}
        />

        <div className="h-4 w-px bg-line" />

        <Segmented
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 'day', label: '日', title: '按天' },
            { value: 'week', label: '周', title: '按周' },
            { value: 'month', label: '月', title: '按月' },
          ]}
        />

        {zoom === 'day' && (
          <>
            <div className="h-4 w-px bg-line" />
            <Segmented
              value={String(dayWidthScale) as '1' | '2' | '3'}
              onChange={(v) => setDayWidthScale(Number(v) as 1 | 2 | 3)}
              options={[
                { value: '1', label: '1×', title: '标准列宽（30px/天）' },
                { value: '2', label: '2×', title: '两倍列宽（60px/天）' },
                { value: '3', label: '3×', title: '三倍列宽（90px/天）' },
              ]}
            />
          </>
        )}

        <div className="h-4 w-px bg-line" />

        {canEdit && (
          <IconButton
            label="撤销 (⌘Z)"
            onClick={() => void undo()}
            disabled={history.length === 0}
            className={clsx(history.length === 0 && 'opacity-30')}
          >
            <Undo2 size={15} />
          </IconButton>
        )}

        <IconButton label="人员" onClick={() => setModal('people')}>
          <Users size={15} />
        </IconButton>
        <IconButton label="日历与节假日" onClick={() => setModal('calendar')}>
          <CalendarDays size={15} />
        </IconButton>
        <IconButton label="变更日志" onClick={() => setModal('changes')}>
          <History size={15} />
        </IconButton>

        {canEdit && (
          <>
            <Button
              variant="outline"
              onClick={() => void addTask(null, 'milestone')}
              disabled={!detail}
              className="ml-1"
              title="新建里程碑"
            >
              <Diamond size={13} /> 里程碑
            </Button>

            <Button
              variant="primary"
              onClick={() => void addTask(null)}
              disabled={!detail}
              className="ml-1"
            >
              <Plus size={14} /> 新建任务
            </Button>
          </>
        )}

        {user && detail && !canEdit && (
          <span
            className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700"
            title="当前项目未分配给你的账号，可以只读浏览"
          >
            只读
          </span>
        )}

        <div className="h-4 w-px bg-line" />
        <UserMenu />
      </div>
    </header>
  );
}