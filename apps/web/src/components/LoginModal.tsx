import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useApp } from '../store';
import { Button, Field, Modal, inputClass } from './ui';

/**
 * 登录 / 首次初始化。
 * 匿名用户不弹这个框也能只读浏览，所以「取消」就是留在只读模式。
 */
export function LoginModal() {
  const { modal, setModal, needsSetup, login, setupAdmin } = useApp();
  const open = modal === 'login';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setDisplayName('');
    setError('');
  }, [open]);

  const submit = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      if (needsSetup) {
        await setupAdmin(username.trim(), password, displayName.trim() || undefined);
      } else {
        await login(username.trim(), password);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setModal(null)}
      title={needsSetup ? '初始化管理员' : '登录 mplan'}
      subtitle={
        needsSetup
          ? '数据库里还没有任何账号。创建的第一个账号就是管理员，之后可以在这里管理成员。'
          : '登录后才能修改项目；不登录也可以只读浏览甘特图和任务详情。'
      }
      width={420}
      footer={
        <>
          <Button variant="outline" onClick={() => setModal(null)}>
            留作只读
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || !username.trim() || !password}
          >
            {needsSetup ? <ShieldCheck size={13} /> : <LogIn size={13} />}
            {needsSetup ? '创建并登录' : '登录'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="用户名">
          <input
            autoFocus
            autoComplete="username"
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={needsSetup ? 'admin' : '请输入用户名'}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </Field>

        {needsSetup && (
          <Field label="显示名称" hint="会记在变更日志里">
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：张三"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </Field>
        )}

        <Field label="密码" hint={needsSetup ? '至少 6 位' : undefined}>
          <input
            type="password"
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-700">
            {error}
          </p>
        )}

        <div
          className={clsx(
            'flex items-start gap-2 rounded-lg bg-stone-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-3',
          )}
        >
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>
            {needsSetup
              ? '这个账号拥有用户管理权限。创建完成后，可以在右上角账号菜单里添加其他成员。'
              : '没有账号时，可以只读查看所有项目。账号由管理员在「用户管理」里创建。'}
          </span>
        </div>
      </div>
    </Modal>
  );
}