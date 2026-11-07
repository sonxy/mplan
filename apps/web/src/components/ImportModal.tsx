import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { parseProjectCsv } from '@mplan/core';
import { useApp } from '../store';
import { api, type ImportRowInput } from '../api';
import { downloadTextFile } from '../lib/download';
import { Button, Field, Modal, inputClass } from './ui';

const TEMPLATE_CSV = `编号,类型,名称,负责人,工时,开始日期,结束日期,状态,备注
1,,品牌与视觉,,,2026-10-12,,,模块
1.1,,首页改版,,,2026-10-12,,,
1.1.1,,首屏 Hero 区,,,2026-10-12,,,
1.1.1.1,任务,视觉稿设计,林岚,40,2026-10-12,,已完成,主视觉 + 动效稿
1.1.1.2,任务,前端实现,周野,80,2026-10-19,,,周末加了班
1.1.2,,品牌故事,,,2026-10-26,,,
1.1.2.1,任务,品牌文案,何雨,24,2026-10-26,,已完成,
1.1.2.2,任务,手绘插画,林岚,32,2026-10-28,,已完成,
1.1.3,里程碑,设计定稿评审,陈墨,0,2026-11-20,,,
1.2,,全站视觉规范,,,2026-11-02,,,
1.2.1,任务,色彩与字体,林岚,16,2026-11-02,,已完成,
1.2.2,任务,组件视觉规范,,40,2026-11-04,,,
2,,产品内容体系,,,2026-10-19,,,
2.1,,内容架构,,,2026-10-19,,,
2.1.1,任务,导航与信息架构,陈墨,32,2026-10-19,,已完成,
2.1.2,任务,页面清单梳理,陈墨,16,2026-10-26,,已完成,
2.2,,内容生产,,,2026-11-02,,,
2.2.1,任务,产品文案,何雨,40,2026-11-02,,,
2.2.2,任务,客户案例包装,何雨,32,2026-11-16,,,`;

function downloadTemplate() {
  downloadTextFile('mplan-项目模板.csv', TEMPLATE_CSV);
}

export function ImportModal() {
  const { boot, detail, modal, setModal, refreshAll, openProject, notify, canEdit, canEditGlobal } =
    useApp();
  const open = modal === 'import';

  const [mode, setMode] = useState<'current' | 'new'>('current');
  const [newName, setNewName] = useState('');
  const [autoCreate, setAutoCreate] = useState(true);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !canEditGlobal) setMode('current');
  }, [open, canEditGlobal]);

  const personNames = useMemo(
    () => new Set((boot?.persons ?? []).map((p) => p.name)),
    [boot],
  );

  const parsed = useMemo(() => {
    if (!raw.trim()) {
      return { rows: [], issues: [], warnings: [], fatal: undefined as string | undefined };
    }
    const result = parseProjectCsv(raw);
    const issues = [...result.issues];
    const warnings: string[] = [];

    for (const r of result.rows) {
      if (r.owner && !personNames.has(r.owner)) {
        if (autoCreate) warnings.push(`第 ${r.line} 行：将新建成员「${r.owner}」`);
        else issues.push({ line: r.line, message: `负责人「${r.owner}」不存在` });
      }
    }

    return { rows: result.rows, issues, warnings, fatal: result.fatal };
  }, [raw, autoCreate, personNames]);

  const badLines = useMemo(() => new Set(parsed.issues.map((i) => i.line)), [parsed.issues]);

  const canImport =
    parsed.rows.length > 0 &&
    parsed.issues.length === 0 &&
    !parsed.fatal &&
    (mode === 'current'
      ? Boolean(detail) && canEdit
      : canEditGlobal && newName.trim().length > 0);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setRaw(await file.text());
  };

  const submit = async () => {
    if (!canEdit || !canImport) return;
    setBusy(true);
    try {
      const rows: ImportRowInput[] = parsed.rows.map((r) => ({
        code: r.code,
        kind: r.kind,
        name: r.name,
        owner: r.owner,
        hours: r.hours,
        start: r.start ?? undefined,
        due: r.due ?? undefined,
        done: r.done,
        note: r.note,
      }));
      const res = await api.importCsv({
        ...(mode === 'current'
          ? { projectId: detail?.project.id }
          : { newProject: { name: newName.trim() } }),
        autoCreatePersons: autoCreate,
        rows,
      });
      await refreshAll();
      if (mode === 'new') await openProject(res.projectId);
      setModal(null);
      setRaw('');
      notify(
        `已导入 ${res.created} 行${res.personsCreated ? `，新建 ${res.personsCreated} 位成员` : ''}`,
        'ok',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const firstIssue = parsed.issues[0];

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title="导入项目模板"
      subtitle="编号 1 / 1.2 / 1.2.3 表达层级：点的个数就是层级，父编号就是去掉最后一段"
      width={760}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ink-3">
            {parsed.fatal
              ? parsed.fatal
              : parsed.rows.length > 0
                ? `解析出 ${parsed.rows.length} 行${parsed.issues.length ? `，其中 ${parsed.issues.length} 处有问题` : ''}`
                : '还没有读取到内容'}
          </span>
          <Button variant="outline" onClick={() => setModal(null)}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!canEdit || !canImport || busy}
          >
            <Upload size={13} /> 导入
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-stone-50/60 px-3 py-2.5">
          <FileSpreadsheet size={18} className="text-ink-3" />
          <div className="flex-1 text-[12px] text-ink-2">
            列：<b>编号</b> / 类型 / 名称 / 负责人 / 工时 / 开始日期 / 结束日期 / 状态 / 备注。
            行顺序无所谓，父节点的工时和日期可以留空，会自动汇总。
          </div>
          <Button size="sm" onClick={downloadTemplate}>
            <Download size={12} /> 下载模板
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              数据来源
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                选择 CSV 文件
              </Button>
              <span className="text-[11px] text-ink-3">或直接粘贴到下面</span>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              导入到
            </div>
            <div className="flex items-center gap-3 text-[12px]">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mode === 'current'}
                  onChange={() => setMode('current')}
                  disabled={!detail || !canEdit}
                />
                当前项目
              </label>
              {canEditGlobal && (
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
                  新建项目
                </label>
              )}
            </div>
          </div>
        </div>

        {!canEditGlobal && (
          <p className="text-[11px] text-ink-3">
            导入只作用于你有编辑权限的项目；新建项目仅管理员可用。
          </p>
        )}

        {mode === 'new' && (
          <Field label="新项目名称">
            <input
              className={inputClass}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：官网 4.0 改版"
            />
          </Field>
        )}

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          placeholder={
            '编号,类型,名称,负责人,工时,开始日期,结束日期,状态,备注\n1,,品牌与视觉,,,2026-10-12,,,\n1.1,,首页改版,,,2026-10-12,,,\n1.1.1,任务,视觉稿设计,林岚,40,2026-10-12,,已完成,'
          }
          className="thin-scroll h-[132px] w-full resize-none rounded-lg border border-line bg-white p-2.5 font-mono text-[11.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-teal-600"
        />

        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={autoCreate}
            onChange={(e) => setAutoCreate(e.target.checked)}
            className="h-3.5 w-3.5 accent-teal-600"
          />
          负责人不在成员表里时自动新建
        </label>

        {parsed.rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-stone-50 px-2.5 py-1.5 text-[10.5px] font-medium text-ink-3">
              <span className="w-10">编号</span>
              <span className="w-14">类型</span>
              <span className="flex-1">名称</span>
              <span className="w-16">负责人</span>
              <span className="w-12 text-right">工时</span>
              <span className="w-24">开始</span>
            </div>
            <div className="thin-scroll max-h-[188px] overflow-y-auto">
              {parsed.rows.slice(0, 60).map((r) => (
                <div
                  key={r.code}
                  className={clsx(
                    'flex items-center gap-2 border-b border-line-soft px-2.5 py-1 text-[11.5px] last:border-b-0',
                    badLines.has(r.line) ? 'bg-rose-50/70' : 'bg-white',
                  )}
                  title={
                    parsed.issues.find((i) => i.line === r.line)?.message ??
                    parsed.warnings.find((w) => w.startsWith(`第 ${r.line} 行`)) ??
                    ''
                  }
                >
                  <span className="num w-10 shrink-0 text-ink-3">{r.code}</span>
                  <span className="w-14 shrink-0">
                    {r.kind === 'milestone' ? (
                      <span className="text-[10px] text-violet-700">◆ 里程碑</span>
                    ) : (
                      <span className="text-[10px] text-ink-3">任务</span>
                    )}
                  </span>
                  <span
                    className="flex-1 truncate text-ink"
                    style={{ paddingLeft: (r.segments.length - 1) * 10 }}
                  >
                    {r.name}
                  </span>
                  <span className="w-16 truncate text-ink-2">{r.owner ?? '—'}</span>
                  <span className="num w-12 text-right text-ink-2">
                    {r.kind === 'milestone' ? '—' : r.hours}
                  </span>
                  <span className="num w-24 text-[10.5px] text-ink-3">
                    {r.start ?? '项目起始'}
                  </span>
                  {badLines.has(r.line) && <X size={11} className="shrink-0 text-rose-500" />}
                </div>
              ))}
            </div>
            {firstIssue && (
              <div className="border-t border-line bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                第 {firstIssue.line} 行：{firstIssue.message}
              </div>
            )}
            {!firstIssue && parsed.warnings.length > 0 && (
              <div className="border-t border-line bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                {parsed.warnings[0]}
                {parsed.warnings.length > 1 ? `（共 ${parsed.warnings.length} 处）` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}