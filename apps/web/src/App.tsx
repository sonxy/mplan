import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { addDays, todayStr } from '@mplan/core';
import { api } from './api';
import { useApp } from './store';
import { Board } from './components/Board';
import { TaskDrawer } from './components/TaskDrawer';
import { TopBar } from './components/TopBar';
import { PeopleModal } from './components/PeopleModal';
import { CalendarModal } from './components/CalendarModal';
import { ImportModal } from './components/ImportModal';
import { ChangesModal } from './components/ChangesModal';
import { LoginModal } from './components/LoginModal';
import { UsersModal } from './components/UsersModal';
import { Button, Field, Modal, inputClass } from './components/ui';

function NewProjectModal() {
  const { modal, setModal, refreshAll, openProject, notify, canEditGlobal } = useApp();
  const open = modal === 'newProject';
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [start, setStart] = useState(todayStr());
  const [due, setDue] = useState(addDays(todayStr(), 60));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setCode('');
      setStart(todayStr());
      setDue(addDays(todayStr(), 60));
    }
  }, [open]);

  const submit = async () => {
    if (!canEditGlobal) {
      setModal(null);
      notify('只有管理员可以新建项目', 'error');
      return;
    }
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await api.createProject({
        name: name.trim(),
        code: code.trim() || undefined,
        startDate: start,
        dueDate: due || undefined,
      });
      await refreshAll();
      await openProject(id);
      setModal(null);
      notify('项目已创建', 'ok');
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
      title="新建项目"
      subtitle="项目建好后，先拆模块，再一层层往下拆到细分功能点。"
      width={480}
      footer={
        <>
          <Button variant="outline" onClick={() => setModal(null)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
            <Plus size={13} /> 创建
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="项目名称">
          <input
            autoFocus
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：官网 4.0 改版"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </Field>
        <Field label="编号" hint="留空自动生成">
          <input
            className={clsx(inputClass, 'num uppercase')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="WEB4"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始日期">
            <input
              type="date"
              className={clsx(inputClass, 'num')}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="计划完成">
            <input
              type="date"
              className={clsx(inputClass, 'num')}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div
      className={clsx(
        'animate-fade-up fixed top-[62px] left-1/2 z-[120] -translate-x-1/2 rounded-lg px-3 py-1.5 text-[12px] font-medium shadow-lg',
        toast.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-stone-900 text-white',
      )}
    >
      {toast.text}
    </div>
  );
}

export function App() {
  const { boot, detail, selectedId, init, undo, redo, filter, clearFilter, canEdit } = useApp();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void init();
  }, [init]);

  // 撤销 / 重做：拖拽改期的安全网
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        document.getElementById('task-search')?.focus();
        return;
      }
      if (key === 'z') {
        e.preventDefault();
        if (!canEdit) return;
        if (e.shiftKey) void redo();
        else void undo();
      } else if (key === 'y') {
        e.preventDefault();
        if (!canEdit) return;
        void redo();
      }
    };
    const onPlainKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape' && (filter.query || filter.persons.length || filter.status !== 'all')) {
        clearFilter();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onPlainKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onPlainKey);
    };
  }, [undo, redo, clearFilter, filter, canEdit]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Board />
        {selectedId && detail && <TaskDrawer />}
      </div>
      <PeopleModal />
      <CalendarModal />
      <ImportModal />
      <ChangesModal />
      <NewProjectModal />
      <LoginModal />
      <UsersModal />
      <Toast />
      {!boot && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-canvas">
          <div className="flex flex-col items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-brand" />
            <span className="text-[12px] text-ink-3">正在加载项目…</span>
          </div>
        </div>
      )}
    </div>
  );
}