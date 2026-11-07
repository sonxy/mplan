export interface PaletteColor {
  key: string;
  name: string;
  /** 任务条填充 */
  bar: string;
  /** 任务条边框 / 深色文字 */
  ink: string;
  /** 头像底色 */
  soft: string;
}

export const PALETTE: PaletteColor[] = [
  { key: 'teal', name: '青', bar: '#14b8a6', ink: '#0f766e', soft: '#ccfbf1' },
  { key: 'indigo', name: '靛', bar: '#6366f1', ink: '#4338ca', soft: '#e0e7ff' },
  { key: 'amber', name: '琥', bar: '#f59e0b', ink: '#b45309', soft: '#fef3c7' },
  { key: 'rose', name: '玫', bar: '#f43f5e', ink: '#be123c', soft: '#ffe4e6' },
  { key: 'sky', name: '天', bar: '#0ea5e9', ink: '#0369a1', soft: '#e0f2fe' },
  { key: 'violet', name: '紫', bar: '#a855f7', ink: '#7e22ce', soft: '#f3e8ff' },
  { key: 'lime', name: '柠', bar: '#84cc16', ink: '#4d7c0f', soft: '#ecfccb' },
  { key: 'orange', name: '橙', bar: '#fb923c', ink: '#c2410c', soft: '#ffedd5' },
  { key: 'cyan', name: '蓝', bar: '#22d3ee', ink: '#0e7490', soft: '#cffafe' },
  { key: 'slate', name: '灰', bar: '#94a3b8', ink: '#475569', soft: '#f1f5f9' },
];

export function colorFor(index: number): PaletteColor {
  return PALETTE[index % PALETTE.length];
}

export function colorByKey(key: string | null | undefined): PaletteColor {
  return PALETTE.find((c) => c.key === key) ?? PALETTE[9];
}

/** 把任意颜色值映射回调色板（用于渲染） */
export function resolvePersonColor(color: string | null | undefined): PaletteColor {
  if (!color) return PALETTE[9];
  return PALETTE.find((p) => p.key === color || p.bar === color) ?? PALETTE[9];
}