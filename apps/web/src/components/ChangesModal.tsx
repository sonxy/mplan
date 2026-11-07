import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { RefreshCw, UserRound } from 'lucide-react';
import { useApp } from '../store';
import { api, type ChangeEntry } from '../api';
import { Button, IconButton, Modal } from './ui';

const ACTION_LABEL: Record<ChangeEntry['action'], string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
  postpone: '顺延',
  import: '导入',
};

const ACTION_STYLE: Record<ChangeEntry['action'], string> = {
  create: 'bg-emerald-50 text-emerald-700',
  update: 'bg-sky-50 text-sky-700',
  delete: 'bg-rose-50 text-rose-600',
  postpone: 'bg-amber-50 text-amber-700',
  import: 'bg-violet-50 text-violet-700',
};

const FIELD_LABEL: Record<string, string> = {
  name: '名称',
  owner: '负责人',
  hours: '工时',
  dates: '日期',
  kind: '类型',
  done: '状态',
  note: '备注',
};

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function ChangesModal() {
  const { modal, setModal, detail, notify, user } = useApp();
  const open = modal === 'changes' && Boolean(detail);
  const projectId = detail?.project.id;

  const [items, setItems] = useState<ChangeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.changes(projectId, 200);
      setItems(res.changes);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const groups = useMemo(() => {
    const map = new Map<string, ChangeEntry[]>();
    for (const c of items) {
      const key = dayOf(c.createdAt);
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="变更日志"
      subtitle={`${detail?.project.name ?? ''} · 最近 ${items.length} 条`}
      width={680}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ink-3">
            操作人由登录账号自动记录，前端无法伪造
          </span>
          <Button variant="outline" onClick={() => setModal(null)}>
            关闭
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-stone-50/60 px-2.5 py-2">
        <UserRound size={14} className="text-ink-3" />
        {user ? (
          <>
            <span className="text-[11.5px] text-ink-2">当前操作人</span>
            <span className="text-[12px] font-medium text-ink">{user.displayName}</span>
            <span className="text-[10.5px] text-ink-3">之后的改动都会记在这个账号下</span>
          </>
        ) : (
          <span className="text-[11.5px] text-ink-3">当前未登录 · 只读查看变更记录</span>
        )}
        <IconButton label="刷新" onClick={() => void load()} className="ml-auto">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      {items.length === 0 && !loading && (
        <div className="py-10 text-center text-[12px] text-ink-3">
          还没有变更记录。改一个日期、拖一下任务条，这里就会有记录。
        </div>
      )}

      <div className="space-y-4">
        {groups.map(([day, list]) => (
          <div key={day}>
            <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-medium tracking-wide text-ink-3">
              <span>{day}</span>
              <span className="h-px flex-1 bg-line" />
              <span className="font-normal">{list.length} 条</span>
            </div>
            <div className="space-y-1">
              {list.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] hover:bg-stone-50"
                >
                  <span className="num w-9 shrink-0 text-[10.5px] text-ink-3">
                    {timeOf(c.createdAt)}
                  </span>
                  <span
                    className={clsx(
                      'w-10 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-medium',
                      ACTION_STYLE[c.action],
                    )}
                  >
                    {ACTION_LABEL[c.action]}
                  </span>
                  <span className="max-w-[190px] shrink-0 truncate font-medium text-ink">
                    {c.taskName}
                  </span>
                  {c.field && (
                    <span className="shrink-0 text-[10.5px] text-ink-3">
                      {FIELD_LABEL[c.field] ?? c.field}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-ink-2">
                    {c.before && (
                      <>
                        <span className="truncate line-through decoration-stone-300">{c.before}</span>
                        <span className="text-stone-300">→</span>
                      </>
                    )}
                    <span className="truncate">{c.after ?? ''}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-3">{c.actor ?? '未署名'}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}