import clsx from 'clsx';
import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Person } from '@mplan/core';
import { resolvePersonColor } from '@mplan/core';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-white hover:bg-teal-800 active:bg-teal-900 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]',
  outline:
    'bg-white text-ink-2 border border-line hover:bg-stone-50 hover:text-ink active:bg-stone-100',
  ghost: 'text-ink-2 hover:bg-stone-100 hover:text-ink',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] rounded-md gap-1',
  md: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
};

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  label,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-stone-100 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 560,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  // 用 portal 挂到 body：抽屉本身有 transform 动画，会变成 fixed 的包含块
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-stone-900/25 px-6 pt-[9vh] backdrop-blur-[2px]">
      <div
        className="animate-fade-up flex max-h-[80vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-white shadow-2xl shadow-stone-900/10"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-stone-50/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 flex items-baseline justify-between text-[11px] font-medium tracking-wide text-ink-3 uppercase">
        {label}
        {hint && <span className="ml-2 text-[11px] font-normal normal-case tracking-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none transition-shadow placeholder:text-ink-3 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15';

export function Avatar({
  person,
  size = 20,
  showName = false,
  className,
}: {
  person: Person | null;
  size?: number;
  showName?: boolean;
  className?: string;
}) {
  if (!person) {
    return (
      <span
        className={clsx(
          'inline-flex items-center justify-center rounded-full border border-dashed border-stone-300 text-[10px] text-ink-3',
          className,
        )}
        style={{ width: size, height: size }}
        title="未分配"
      >
        ?
      </span>
    );
  }
  const color = resolvePersonColor(person.color);
  const initial = person.name.slice(0, 1);
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
        style={{
          width: size,
          height: size,
          background: color.bar,
          fontSize: Math.max(9, size * 0.45),
        }}
        title={person.name}
      >
        {initial}
      </span>
      {showName && <span className="truncate text-[12px] text-ink-2">{person.name}</span>}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-stone-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition-colors',
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = 'brand',
  className,
}: {
  value: number;
  tone?: 'brand' | 'done' | 'overdue' | 'muted';
  className?: string;
}) {
  const color =
    tone === 'done'
      ? 'bg-emerald-500'
      : tone === 'overdue'
        ? 'bg-rose-500'
        : tone === 'muted'
          ? 'bg-stone-300'
          : 'bg-brand';
  return (
    <div className={clsx('h-1 w-full overflow-hidden rounded-full bg-stone-200/80', className)}>
      <div
        className={clsx('h-full rounded-full transition-[width] duration-300', color)}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}