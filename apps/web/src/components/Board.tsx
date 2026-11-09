import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, ChevronRight, Plus, X, Zap } from 'lucide-react';
import { addWorkdays, calendarFor, countWorkdays, formatCN } from '@mplan/core';
import { useApp } from '../store';
import {
  type Board as BoardModel,
  type BoardRow,
  HEADER_HEIGHT,
  LEFT_WIDTH,
  ROW_HEIGHT,
  ZOOM_WIDTH,
  type RenderRow,
  barGeometry,
  buildBoard,
  buildPeopleRows,
  monthSegments,
  todayX,
} from '../lib/gantt';
import { Avatar } from './ui';
import { FilterBar } from './FilterBar';
import { StandupBar } from './StandupBar';
import { buildStandup } from '../lib/standup';

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragSession {
  row: BoardRow;
  mode: DragMode;
  startX: number;
  colWidth: number;
  cal: ReturnType<typeof calendarFor>;
  origin: { start: string; due: string };
  cols: number;
  moved: boolean;
}

/** 拖拽中的日期预览：按工作日吸附 */
function previewDates(session: DragSession, cols: number) {
  const { origin, cal, mode } = session;
  if (mode === 'move') {
    return {
      start: addWorkdays(origin.start, cols, cal),
      due: addWorkdays(origin.due, cols, cal),
    };
  }
  if (mode === 'resize-end') {
    const due = addWorkdays(origin.due, cols, cal);
    return { start: origin.start, due: due < origin.start ? origin.start : due };
  }
  const start = addWorkdays(origin.start, cols, cal);
  return { start: start > origin.due ? origin.due : start, due: origin.due };
}

/** 没完成就不显示 100%，避免"100% 还是红的" */
function displayPct(row: BoardRow): number {
  return row.status === 'done' ? 100 : Math.min(99, Math.round(row.progress * 100));
}

/** 晨会模式强制展开所有节点，退出后恢复用户原来的折叠状态 */
const EMPTY_COLLAPSED = new Set<string>();

const OWNER_W = 76;
const HOURS_W = 46;
const PROGRESS_W = 66;

function statusTone(row: BoardRow) {
  if (row.status === 'done') {
    return { body: 'bg-emerald-50', accent: '#10b981', text: 'text-emerald-900' };
  }
  if (row.status === 'overdue') {
    return { body: 'bg-rose-50', accent: '#f43f5e', text: 'text-rose-900' };
  }
  if (row.status === 'todo') {
    return { body: 'bg-stone-100/80', accent: row.color.bar, text: 'text-ink-2' };
  }
  return { body: 'bg-white', accent: row.color.bar, text: 'text-ink' };
}

function Bar({
  row,
  board,
  colWidth,
  selected,
  canEdit,
  onSelect,
  onToggleDone,
  onDragStart,
  preview,
  dragging,
}: {
  row: BoardRow;
  board: BoardModel;
  colWidth: number;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onToggleDone: () => void;
  onDragStart: (mode: DragMode, e: React.PointerEvent) => void;
  preview?: { start: string; due: string } | null;
  dragging?: boolean;
}) {
  // 筛选时仅作为上下文出现的祖先不画条，避免误以为它也命中了
  if (row.dimmed && !dragging) return null;

  const geom = barGeometry(
    board.axis,
    preview?.start ?? row.task.startDate,
    preview?.due ?? row.task.dueDate,
    colWidth,
  );
  if (!geom) return null;

  const tone = statusTone(row);
  const width = Math.max(geom.width - 2, 10);
  const pct = displayPct(row);
  const title = `${row.task.name}\n${row.task.startDate} → ${row.task.dueDate}\n${
    row.owner?.name ?? '未分配'
  } · ${row.hours}h · ${pct}%${
    row.derived.overdue ? `\n逾期 ${row.derived.overdueWorkdays} 个工作日` : ''
  }`;

  if (row.summary) {
    const range = barGeometry(
      board.axis,
      row.task.rollupStart ?? row.task.startDate,
      row.task.rollupDue ?? row.task.dueDate,
      colWidth,
    );
    if (!range) return null;
    return (
      <div
        className="absolute top-1/2 z-10 -translate-y-1/2 cursor-pointer"
        style={{ left: range.left + 1, width: Math.max(range.width - 2, 8) }}
        onClick={onSelect}
        title={title}
      >
        <div className="relative h-[7px] rounded-[2px] bg-stone-200">
          <div
            className="absolute inset-y-0 left-0 rounded-[2px] bg-stone-400"
            style={{ width: `${pct}%` }}
          />
          <div className="absolute top-1/2 -left-[1px] h-[13px] w-[3px] -translate-y-1/2 rounded-[1.5px] bg-stone-500" />
          <div className="absolute top-1/2 -right-[1px] h-[13px] w-[3px] -translate-y-1/2 rounded-[1.5px] bg-stone-500" />
        </div>
      </div>
    );
  }

  if (row.task.kind === 'milestone') {
    const cx = geom.left + geom.width / 2;
    const gem =
      row.status === 'done'
        ? 'border-emerald-500 bg-emerald-500'
        : row.status === 'overdue'
          ? 'border-rose-500 bg-rose-500'
          : 'border-violet-500 bg-white';
    return (
      <>
        <div
          className={clsx(
            'absolute top-1/2 z-10 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-2 transition-shadow',
            canEdit ? 'cursor-grab' : 'cursor-pointer',
            gem,
            dragging && 'shadow-lg ring-2 ring-brand/40',
            row.dimmed && 'opacity-40',
          )}
          style={{ left: cx }}
          onPointerDown={(e) => {
            if (!canEdit) {
              onSelect();
              return;
            }
            onDragStart('move', e);
          }}
          title={title}
        />
        <span
          className={clsx(
            'pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 text-[10.5px] whitespace-nowrap',
            row.status === 'overdue' ? 'text-rose-600' : 'text-ink-2',
            row.dimmed && 'opacity-40',
          )}
          style={{ left: cx + 13 }}
        >
          {row.task.name}
        </span>
      </>
    );
  }

  return (
    <>
    <div
      className={clsx(
        'absolute top-1/2 z-10 flex h-[26px] -translate-y-1/2 items-center overflow-hidden rounded-[7px] border transition-shadow',
        canEdit ? 'cursor-pointer' : 'cursor-default',
        tone.body,
        dragging
          ? 'z-40 cursor-grabbing shadow-[0_0_0_2px_rgba(15,118,110,0.55),0_10px_24px_-8px_rgba(28,25,23,0.45)]'
          : selected
            ? 'shadow-[0_0_0_2px_rgba(15,118,110,0.35)]'
            : 'shadow-[0_1px_1px_rgba(28,25,23,0.04)] hover:shadow-md',
        row.status === 'overdue' && 'border-rose-300',
        row.status === 'done' && 'border-emerald-200',
        row.status === 'todo' && 'border-stone-300/70',
        row.status === 'doing' && 'border-stone-200/90',
        row.dimmed && 'opacity-40',
      )}
      style={{
        left: geom.left + 1,
        width,
        borderColor: row.status === 'doing' ? `${row.color.bar}55` : undefined,
      }}
      onPointerDown={(e) => {
        if (!canEdit) {
          onSelect();
          return;
        }
        onDragStart('move', e);
      }}
      title={dragging ? undefined : title}
      data-dragging={dragging ? '1' : undefined}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${pct}%`, background: row.color.bar, opacity: 0.16 }}
      />
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone.accent }} />

      {canEdit && width > 30 && (
        <>
          <div
            className="absolute inset-y-0 left-0 z-20 w-[7px] cursor-ew-resize"
            onPointerDown={(e) => onDragStart('resize-start', e)}
            title="拖动左边改开始时间"
          />
          <div
            className="absolute inset-y-0 right-0 z-20 w-[7px] cursor-ew-resize"
            onPointerDown={(e) => onDragStart('resize-end', e)}
            title="拖动右边改结束时间"
          />
        </>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-1.5 pl-1.5">
        {width > 52 && <Avatar person={row.owner} size={16} />}
        {width > 116 && (
          <span
            className={clsx(
              'truncate text-[11.5px] font-medium',
              row.status === 'done' ? 'text-emerald-900/75' : tone.text,
            )}
          >
            {row.task.name}
          </span>
        )}
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1 pr-1.5">
        {row.overtimeDates.length > 0 && width > 84 && (
          <Zap size={10} className="text-amber-500" fill="currentColor" />
        )}
        {row.status === 'done' && width > 40 && (
          <Check size={11} className="text-emerald-600" strokeWidth={3} />
        )}
        {row.status === 'overdue' && width > 40 && (
          <AlertTriangle size={11} className="text-rose-500" strokeWidth={2.5} />
        )}
        {width > 126 && <span className="num text-[10px] font-medium text-ink-3">{pct}%</span>}
      </div>
    </div>

    {/* 需求 6：甘特条上直接改完成状态（只读模式隐藏） */}
    {canEdit && (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggleDone();
      }}
      title={row.status === 'done' ? '取消完成' : '标记完成'}
      className={clsx(
        'absolute top-1/2 z-30 grid h-[18px] w-[18px] -translate-y-1/2 place-items-center rounded-full border opacity-0 shadow-sm transition-all group-hover:opacity-100',
        row.status === 'done'
          ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
          : 'border-stone-200 bg-white text-ink-3 hover:border-emerald-400 hover:text-emerald-600',
      )}
      style={{ left: geom.left + width + 6 }}
    >
      <Check size={10} strokeWidth={3} />
    </button>
    )}
    </>
  );
}

function TaskCell({
  row,
  selected,
  canEdit,
  onSelect,
  onToggle,
  onAddChild,
  expanded,
  indent,
  compact,
  showOwner,
}: {
  row: BoardRow;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onAddChild: () => void;
  expanded: boolean;
  indent: number;
  compact: boolean;
  showOwner: boolean;
}) {
  const nameSize = compact
    ? 'text-[12.5px] text-ink-2'
    : row.level === 1
      ? 'text-[13.5px] font-semibold text-ink'
      : row.level === 2
        ? 'text-[13px] font-medium text-ink'
        : row.level === 3
          ? 'text-[12.5px] text-ink-2'
          : 'text-[12px] text-ink-2';

  const moduleRow = indent === 0 && !compact;

  return (
    <div
      className={clsx(
        'sticky left-0 z-50 flex shrink-0 items-stretch border-r border-line transition-colors',
        selected ? 'bg-teal-50' : moduleRow ? 'bg-stone-50/80' : 'bg-white',
        !selected && 'group-hover:bg-stone-100/70',
        row.dimmed && 'opacity-45',
      )}
      style={{ width: LEFT_WIDTH }}
      onClick={onSelect}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1 pr-2"
        style={{ paddingLeft: 8 + indent * 12 }}
      >
        {!compact && row.hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="grid h-4 w-4 shrink-0 place-items-center rounded text-ink-3 hover:bg-stone-200/70 hover:text-ink"
            aria-label={expanded ? '收起' : '展开'}
          >
            <ChevronRight
              size={12}
              className="transition-transform duration-150"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {row.task.kind === 'milestone' && (
          <span
            className="h-[7px] w-[7px] shrink-0 rotate-45 rounded-[1px] border border-violet-500 bg-violet-100"
            title="里程碑"
          />
        )}
        <span className={clsx('truncate', nameSize)} title={row.task.name}>
          {row.task.name}
        </span>

        {row.task.note && (
          <span className="h-1 w-1 shrink-0 rounded-full bg-stone-300" title={row.task.note} />
        )}

        {canEdit && !compact && row.level < 4 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddChild();
            }}
            className="ml-1 grid h-4 w-4 shrink-0 place-items-center rounded text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-teal-100 hover:text-brand"
            title="添加子任务"
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center overflow-hidden" style={{ width: OWNER_W }}>
        {!showOwner ? (
          <span className="num truncate text-[9.5px] text-ink-3" title={`${row.task.startDate} → ${row.task.dueDate}`}>
            {row.task.startDate.slice(5).replace('-', '/')}–{row.task.dueDate.slice(5).replace('-', '/')}
          </span>
        ) : row.summary ? (
          <span className="text-[11px] text-stone-300">—</span>
        ) : (
          <Avatar person={row.owner} size={16} showName />
        )}
      </div>

      <div className="shrink-0 text-right" style={{ width: HOURS_W }}>
        <span
          className={clsx(
            'num text-[11.5px]',
            row.summary ? 'font-medium text-ink-3' : 'text-ink-2',
          )}
        >
          {row.task.kind === 'milestone' ? '◆' : row.hours > 0 ? `${Math.round(row.hours)}h` : '—'}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 pl-2" style={{ width: PROGRESS_W }}>
        <div className="h-[3px] w-[22px] overflow-hidden rounded-full bg-stone-200">
          <div
            className={clsx(
              'h-full rounded-full',
              row.status === 'overdue'
                ? 'bg-rose-500'
                : row.status === 'done'
                  ? 'bg-emerald-500'
                  : 'bg-brand',
              row.summary && 'opacity-60',
            )}
            style={{ width: `${displayPct(row)}%` }}
          />
        </div>
        <span
          className={clsx(
            'num w-[24px] text-right text-[10px]',
            row.status === 'overdue' ? 'font-medium text-rose-600' : 'text-ink-3',
          )}
        >
          {displayPct(row)}%
        </span>
      </div>
    </div>
  );
}

export function Board() {
  const {
    boot,
    detail,
    collapsed,
    zoom,
    view,
    selectedId,
    dayWidthScale,
    select,
    toggle,
    addTask,
    patchTask,
    commitDates,
    filter,
    clearFilter,
    todayPing,
    canEdit,
    canEditGlobal,
    user,
    setModal,
    standupMode,
    setStandupMode,
  } = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const lastProject = useRef<string | null>(null);
  const [viewportH, setViewportH] = useState(600);
  const [drag, setDrag] = useState<{ id: string; start: string; due: string } | null>(null);
  const dragSession = useRef<DragSession | null>(null);
  const standupScrollKey = useRef('');

  // 宽度倍率只作用于日视图；周/月视图保持原列宽
  const colWidth = ZOOM_WIDTH[zoom] * (zoom === 'day' ? dayWidthScale : 1);

  // 首次渲染时列表还没挂载，必须等 detail 到位后再测量
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () => setViewportH(el.clientHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [detail?.project.id]);

  const board = useMemo(
    () =>
      boot && detail
        ? buildBoard(detail, boot, standupMode ? EMPTY_COLLAPSED : collapsed, filter)
        : null,
    [boot, detail, collapsed, filter, standupMode],
  );

  const standup = useMemo(
    () => (boot && detail && board ? buildStandup(detail, board.company) : null),
    [boot, detail, board],
  );

  const timelineWidth = (board?.axis.columns.length ?? 0) * colWidth;

  const renderRows: RenderRow[] = useMemo(() => {
    if (!board || !boot || !detail) return [];
    if (view === 'project') {
      return board.rows.map((row) => ({
        kind: 'task' as const,
        key: row.task.id,
        row,
        indent: row.level - 1,
        compact: false,
        showOwner: true,
      }));
    }
    return buildPeopleRows(board, boot.persons, detail);
  }, [board, boot, detail, view]);

  const bodyHeight = renderRows.length * ROW_HEIGHT;

  const todayLine = board && detail ? todayX(board.axis, detail.today, colWidth) : null;

  // 切项目：左对齐到计划开始
  useEffect(() => {
    if (!detail || !scroller.current) return;
    if (lastProject.current === detail.project.id) return;
    lastProject.current = detail.project.id;
    scroller.current.scrollLeft = 0;
  }, [detail]);

  // 点「今天」：滚动到今天
  useEffect(() => {
    if (todayPing === 0 || !board || !detail || !scroller.current) return;
    const x = todayX(board.axis, detail.today, colWidth);
    if (x == null) return;
    const viewport = scroller.current.clientWidth - LEFT_WIDTH;
    scroller.current.scrollTo({ left: Math.max(0, x - viewport * 0.35), behavior: 'smooth' });
  }, [todayPing, board, detail, colWidth]);

  const scrollToStandup = () => {
    if (!standup || !board || !scroller.current) return;
    const x = todayX(board.axis, standup.windowStart, colWidth);
    if (x == null) return;
    const viewport = scroller.current.clientWidth - LEFT_WIDTH;
    scroller.current.scrollTo({ left: Math.max(0, x - viewport * 0.25), behavior: 'smooth' });
  };

  // 进入晨会 / 切项目时，自动滚到最近 3 个工作日的起点
  useEffect(() => {
    if (!standupMode) {
      standupScrollKey.current = '';
      return;
    }
    if (!standup || !board || !detail || !scroller.current) return;
    const key = `${detail.project.id}:${standup.windowStart}:${standup.planDate}:${colWidth}`;
    if (standupScrollKey.current === key) return;
    standupScrollKey.current = key;
    scrollToStandup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standupMode, standup, board, detail, colWidth]);

  if (!detail || !board) {
    const noProjects = Boolean(boot && boot.projects.length === 0);
    const hasArchived = (boot?.archivedProjects.length ?? 0) > 0;
    return (
      <div className="grid flex-1 place-items-center">
        <div className="text-center">
          <p className="text-[13px] text-ink-2">
            {!boot
              ? '正在加载…'
              : noProjects
                ? hasArchived
                  ? '所有项目都已归档'
                  : '还没有项目'
                : '没有可显示的项目'}
          </p>
          {noProjects && canEditGlobal && (
            <button
              onClick={() => setModal('newProject')}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white"
            >
              <Plus size={13} /> 新建第一个项目
            </button>
          )}
          {noProjects && hasArchived && (
            <p className="mt-2 text-[11.5px] text-ink-3">
              在顶部项目菜单的「已归档项目」里可以恢复。
            </p>
          )}
          {noProjects && !hasArchived && !canEditGlobal && (
            <p className="mt-2 text-[11.5px] text-ink-3">
              {user ? '请联系管理员创建项目' : '登录后由管理员创建项目'}
            </p>
          )}
        </div>
      </div>
    );
  }

  const topBar =
    standupMode && standup ? (
      <StandupBar
        summary={standup}
        onLocate={scrollToStandup}
        onExit={() => setStandupMode(false)}
      />
    ) : (
      <FilterBar matched={board.stats.matched} total={board.stats.total} />
    );

  if (board.rows.length === 0) {
    // 注意：筛选无结果时也要渲染 FilterBar，否则用户清不掉筛选、回不到项目
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {topBar}
        <div className="grid flex-1 place-items-center">
          <div className="text-center">
            {board.stats.filtering ? (
              <>
                <p className="text-[13px] text-ink-2">没有匹配的任务</p>
                <p className="mt-1 text-[11.5px] text-ink-3">
                  共 {board.stats.total} 个任务，换个关键词或清除筛选
                </p>
                <button
                  onClick={clearFilter}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-stone-50"
                >
                  <X size={13} /> 清除筛选
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-2">这个项目还没有任务</p>
                {canEdit ? (
                  <button
                    onClick={() => void addTask(null)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white"
                  >
                    <Plus size={13} /> 新建第一个模块
                  </button>
                ) : (
                  <p className="mt-2 text-[11.5px] text-ink-3">
                    {user ? '当前项目未分配给你的账号，请联系管理员' : '登录后才能新建任务'}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const months = monthSegments(board.axis, colWidth);
  const overtimeCols = board.axis.columns.filter((c) => c.overtime);
  const leafOverdue = board.rows.filter((r) => !r.summary && r.status === 'overdue').length;

  /**
   * 拖拽：整条平移 / 拉两端改期。
   * 拖动过程只改本地 preview，松手才提交，避免每个像素都打一次接口。
   */
  const startDrag = (row: BoardRow, mode: DragMode, e: React.PointerEvent) => {
    if (!canEdit || row.summary) return;
    e.preventDefault();
    e.stopPropagation();

    const el = scroller.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // 用「内容坐标」而不是 clientX：自动滚动会改变 scrollLeft，
    // 只比较 clientX 会让任务条在滚动时滞后于指针。
    const timelineX = (clientX: number) => clientX - rect.left - LEFT_WIDTH + el.scrollLeft;
    const startX = timelineX(e.clientX);

    const session: DragSession = {
      row,
      mode,
      startX: e.clientX,
      colWidth,
      cal: calendarFor(
        board.company,
        row.task.ownerId ? detail.personOverrides[row.task.ownerId] : undefined,
        detail.taskOverrides[row.task.id],
      ),
      origin: { start: row.task.startDate, due: row.task.dueDate },
      cols: 0,
      moved: false,
    };
    dragSession.current = session;

    let lastClientX = e.clientX;
    let raf = 0;

    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';
    setDrag({ id: row.task.id, start: session.origin.start, due: session.origin.due });

    const apply = (clientX: number) => {
      const dx = timelineX(clientX) - startX;
      if (Math.abs(dx) > 3) session.moved = true;
      const cols = Math.round(dx / session.colWidth);
      if (cols === session.cols) return;
      session.cols = cols;
      const next = previewDates(session, cols);
      setDrag({ id: row.task.id, start: next.start, due: next.due });
    };

    // 指针贴近左右边缘时持续滚动；越靠边越快
    const EDGE = 64;
    const tick = () => {
      const r = el.getBoundingClientRect();
      let step = 0;
      if (lastClientX > r.right - EDGE) {
        step = 4 + Math.min(1, (lastClientX - (r.right - EDGE)) / EDGE) * 16;
      } else if (lastClientX < r.left + LEFT_WIDTH + EDGE) {
        step = -(4 + Math.min(1, (r.left + LEFT_WIDTH + EDGE - lastClientX) / EDGE) * 16);
      }
      if (step !== 0) {
        const before = el.scrollLeft;
        const max = el.scrollWidth - el.clientWidth;
        el.scrollLeft = Math.max(0, Math.min(max, before + step));
        if (el.scrollLeft !== before) apply(lastClientX);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragSession.current = null;
      setDrag(null);
    };

    function onMove(ev: PointerEvent) {
      lastClientX = ev.clientX;
      apply(ev.clientX);
    }

    function onUp() {
      const cols = session.cols;
      const moved = session.moved;
      cleanup();
      if (!moved || cols === 0) {
        select(row.task.id);
        return;
      }
      const next = previewDates(session, cols);
      if (next.start === session.origin.start && next.due === session.origin.due) {
        select(row.task.id);
        return;
      }
      void commitDates(
        row.task.id,
        {
          startDate: next.start,
          dueDate: next.due,
          estimateHours: row.task.estimateHours,
        },
        session.mode === 'move' ? 'none' : 'due',
      );
    }

    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        cleanup();
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  };

  const fillerH = Math.max(0, viewportH - HEADER_HEIGHT - bodyHeight);
  const rowLines =
    'repeating-linear-gradient(to bottom, transparent 0 39px, #f0efed 39px 40px)';
  const colLines =
    zoom === 'day'
      ? `repeating-linear-gradient(to right, rgba(120,113,108,0.085) 0 1px, transparent 1px ${colWidth}px)`
      : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {topBar}
      <div ref={scroller} className="thin-scroll relative flex-1 overflow-auto bg-canvas">
        <div
          className="relative"
          style={{ width: LEFT_WIDTH + timelineWidth, minHeight: bodyHeight + HEADER_HEIGHT }}
        >
          {/* ---------- 表头 ---------- */}
          <div className="sticky top-0 z-[60] flex" style={{ height: HEADER_HEIGHT }}>
            <div
              className="sticky left-0 z-[70] flex shrink-0 flex-col justify-center border-r border-b border-line bg-white px-3"
              style={{ width: LEFT_WIDTH, height: HEADER_HEIGHT }}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                <span className="num">{board.stats.total}</span> 个任务
                <span className="text-stone-300">·</span>
                <span className="num">
                  {Math.round(board.stats.totalHours).toLocaleString()}
                </span>{' '}
                小时
                <span className="text-stone-300">·</span>
                <span className="num">{board.stats.headcount}</span> 人参与
                {leafOverdue > 0 && (
                  <>
                    <span className="text-stone-300">·</span>
                    <span className="font-medium text-rose-600">逾期 {leafOverdue}</span>
                  </>
                )}
                <span className="ml-auto text-[10px]">{detail.project.code}</span>
              </div>
              <div className="mt-1.5 flex items-center text-[10.5px] font-medium tracking-wide text-ink-3">
                <div className="flex-1">任务名称</div>
                <div style={{ width: OWNER_W }}>{view === 'people' ? '起止' : '负责人'}</div>
                <div className="text-right" style={{ width: HOURS_W }}>
                  工时
                </div>
                <div className="pl-2" style={{ width: PROGRESS_W }}>
                  进度
                </div>
              </div>
            </div>

            <div
              className="relative shrink-0 border-b border-line bg-white"
              style={{ width: timelineWidth, height: HEADER_HEIGHT }}
            >
              <div className="flex border-b border-line-soft" style={{ height: 26 }}>
                {months.map((m) => (
                  <div
                    key={m.key}
                    className="flex items-center overflow-hidden border-l border-line px-2 text-[11px] font-medium whitespace-nowrap text-ink-2"
                    style={{ width: m.width }}
                  >
                    {m.width >= 118
                      ? m.label
                      : m.width >= 64
                        ? `${Number(m.key.slice(5))}月`
                        : ''}
                  </div>
                ))}
              </div>
              <div className="relative flex" style={{ height: HEADER_HEIGHT - 26 }}>
                {overtimeCols.map((c) => (
                  <div
                    key={`ot-${c.date}`}
                    className="absolute top-0 bottom-0 bg-amber-50"
                    style={{ left: c.index * colWidth, width: colWidth }}
                  />
                ))}
                {board.axis.columns.map((c) => {
                  const isToday = c.date === detail.today;
                  const label =
                    zoom === 'day'
                      ? String(c.day)
                      : zoom === 'week' && c.dow === 1
                        ? `${Number(c.monthKey.slice(5))}/${c.day}`
                        : '';
                  return (
                    <div
                      key={c.date}
                      className={clsx(
                        'relative flex items-center justify-center',
                        c.overtime && 'bg-amber-50',
                      )}
                      style={{ width: colWidth }}
                    >
                      {isToday && zoom !== 'month' ? (
                        <span className="rounded-full bg-brand px-1 py-px text-[9px] font-medium whitespace-nowrap text-white">
                          {zoom === 'day' ? '今天' : '今'}
                        </span>
                      ) : (
                        <span
                          className={clsx(
                            'num text-[10px]',
                            c.overtime
                              ? 'text-amber-600'
                              : c.dow === 1
                                ? 'text-ink-2'
                                : 'text-ink-3',
                            zoom !== 'day' && 'origin-center scale-90',
                          )}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ---------- 今天竖线 ---------- */}
          {todayLine != null && (
            <div
              className="pointer-events-none absolute z-[15] w-px bg-teal-600/55"
              style={{
                left: LEFT_WIDTH + todayLine,
                top: HEADER_HEIGHT - 6,
                height: bodyHeight + 6,
              }}
            />
          )}

          {/* ---------- 行 ---------- */}
          {renderRows.map((rr) => {
            if (rr.kind === 'person') {
              return (
                <div
                  key={rr.key}
                  className="flex border-b border-line bg-stone-100/40"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div
                    className="sticky left-0 z-50 flex shrink-0 items-center gap-2 border-r border-line bg-stone-100/90 px-3"
                    style={{ width: LEFT_WIDTH }}
                  >
                    {rr.person ? (
                      <Avatar person={rr.person} size={22} />
                    ) : (
                      <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-stone-300 text-[10px] text-ink-3">
                        ?
                      </span>
                    )}
                    <span
                      className="truncate text-[12.5px] font-semibold text-ink"
                      title={rr.role ? `${rr.label} · ${rr.role}` : rr.label}
                    >
                      {rr.label}
                    </span>
                    <span className="num ml-auto shrink-0 text-[10.5px] text-ink-3">
                      {rr.taskCount} 任务 · {Math.round(rr.hours)}h
                    </span>
                    {rr.overloadDays > 0 && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9.5px] font-medium text-amber-800"
                        title="同一天排了超过 8 小时的工作"
                      >
                        超载 {rr.overloadDays} 天
                      </span>
                    )}
                  </div>
                  <div
                    className="relative shrink-0 bg-stone-100/40"
                    style={{
                      width: timelineWidth,
                      backgroundImage:
                        zoom === 'day'
                          ? `repeating-linear-gradient(to right, rgba(120,113,108,0.06) 0 1px, transparent 1px ${colWidth}px)`
                          : undefined,
                    }}
                  >
                    {months.slice(1).map((m) => (
                      <div
                        key={`ph-${m.key}`}
                        className="pointer-events-none absolute top-0 bottom-0 w-px bg-stone-200/80"
                        style={{ left: m.startIndex * colWidth }}
                      />
                    ))}
                  </div>
                </div>
              );
            }

            const row = rr.row;
            const selected = selectedId === row.task.id;
            const isModule = !rr.compact && rr.indent === 0;
            const faded =
              Boolean(standupMode && standup && !standup.focusIds.has(row.task.id)) && !selected;
            return (
              <div
                key={rr.key}
                className={clsx(
                  'group flex border-b border-line-soft/80 transition-opacity',
                  isModule && 'border-t border-line',
                  faded && 'opacity-30',
                )}
                style={{ height: ROW_HEIGHT }}
              >
                <TaskCell
                  row={row}
                  selected={selected}
                  canEdit={canEdit}
                  onSelect={() => select(row.task.id)}
                  onToggle={() => toggle(row.task.id)}
                  onAddChild={() => void addTask(row.task.id)}
                  expanded={!collapsed.has(row.task.id)}
                  indent={rr.indent}
                  compact={rr.compact}
                  showOwner={rr.showOwner}
                />

                <div
                  className={clsx(
                    'relative shrink-0 transition-colors',
                    selected ? 'bg-teal-500/[0.05]' : 'group-hover:bg-stone-900/[0.022]',
                    isModule && !selected && 'bg-stone-900/[0.015]',
                  )}
                  style={{
                    width: timelineWidth,
                    backgroundImage:
                      zoom === 'day'
                        ? `repeating-linear-gradient(to right, rgba(120,113,108,0.085) 0 1px, transparent 1px ${colWidth}px)`
                        : undefined,
                  }}
                >
                  {months.slice(1).map((m) => (
                    <div
                      key={m.key}
                      className="pointer-events-none absolute top-0 bottom-0 w-px bg-stone-200"
                      style={{ left: m.startIndex * colWidth }}
                    />
                  ))}
                  {overtimeCols.map((c) => (
                    <div
                      key={`row-ot-${c.date}`}
                      className="pointer-events-none absolute top-0 bottom-0 bg-amber-500/[0.06]"
                      style={{ left: c.index * colWidth, width: colWidth }}
                    />
                  ))}
                  <Bar
                    row={row}
                    board={board}
                    colWidth={colWidth}
                    selected={selected}
                    canEdit={canEdit}
                    onSelect={() => select(row.task.id)}
                    onToggleDone={() =>
                      void patchTask(row.task.id, { done: row.status !== 'done' })
                    }
                    onDragStart={(mode, e) => startDrag(row, mode, e)}
                    preview={drag?.id === row.task.id ? { start: drag.start, due: drag.due } : null}
                    dragging={drag?.id === row.task.id}
                  />
                </div>
              </div>
            );
          })}
          {fillerH > 0 && (
            <div className="flex" style={{ height: fillerH }}>
              <div
                className="sticky left-0 z-50 shrink-0 border-r border-line bg-white"
                style={{ width: LEFT_WIDTH, backgroundImage: rowLines }}
              />
              <div
                className="relative shrink-0"
                style={{
                  width: timelineWidth,
                  backgroundImage: colLines ? `${colLines}, ${rowLines}` : rowLines,
                }}
              >
                {months.map((m) => (
                  <div
                    key={`f-${m.key}`}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-stone-200"
                    style={{ left: m.startIndex * colWidth }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- 状态栏 ---------- */}
      <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-white px-3 text-[10.5px] text-ink-3">
        <span>
          可执行任务 <b className="font-medium text-ink-2">{board.stats.leafCount}</b>
        </span>
        <span className="text-stone-300">|</span>
        <span>
          已完成 <b className="font-medium text-emerald-600">{board.stats.doneCount}</b>
        </span>
        <span className="text-stone-300">|</span>
        <span>
          逾期{' '}
          <b className={clsx('font-medium', leafOverdue ? 'text-rose-600' : 'text-ink-2')}>
            {leafOverdue}
          </b>
        </span>
        <span className="text-stone-300">|</span>
        {drag ? (
          <span className="num font-medium text-brand">
            拖动中 {drag.start.slice(5).replace('-', '/')} → {drag.due.slice(5).replace('-', '/')}
            {' · '}
            {countWorkdays(drag.start, drag.due, {
              weekend: board.company.weekend,
              company: board.company.overrides,
            })}{' '}
            个工作日
          </span>
        ) : (
          <span>今天 {formatCN(detail.today)}</span>
        )}
        <span className="ml-auto">
          {standupMode && standup
            ? `晨会聚焦 ${standup.windowStart} → ${standup.planDate} · 非焦点任务已淡化`
            : drag
              ? '松手生效 · Esc 取消'
              : canEdit
                ? '拖动任务条可改期，拖两端可改工期 · 周末与法定节假日已剔除'
                : user
                  ? '只读模式 · 当前项目未分配给你的账号'
                  : '只读模式 · 登录后可拖动任务条改期'}
        </span>
      </div>
    </div>
  );
}