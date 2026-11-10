import { type Person, type Task, type TreeRow, buildTree } from './tree.js';

/**
 * 项目模板 CSV：用 WBS 编号表达层级。
 * 编号 1 / 1.1 / 1.1.2 / 1.1.2.1 —— 点的个数就是层级，父编号就是去掉最后一段。
 * 行顺序无所谓，导入时按编号排序建树。
 */
export const CSV_HEADERS = [
  '编号',
  '类型',
  '名称',
  '负责人',
  '工时',
  '开始日期',
  '结束日期',
  '状态',
  '备注',
] as const;

export const MAX_CODE_DEPTH = 4;
const CODE_RE = /^\d+(?:\.\d+)*$/;
const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;

/**
 * 把 Excel 常见的 2026/11/9、2026.11.9、2026-11-09 统一成 YYYY-MM-DD。
 * 非法日期（如 2026-02-30）返回 null，避免 Date 自动进位后被静默导入。
 */
export function normalizeDate(value: string): string | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function codeSegments(code: string): number[] | null {
  if (!CODE_RE.test(code)) return null;
  const segments = code.split('.').map(Number);
  if (segments.some((n) => !Number.isSafeInteger(n) || n < 1)) return null;
  return segments;
}

export function parentCode(code: string): string | null {
  const i = code.lastIndexOf('.');
  return i < 0 ? null : code.slice(0, i);
}

/** 按编号的自然顺序比较：1 < 1.1 < 1.1.2 < 1.2 < 2 */
export function compareCodes(a: string, b: string): number {
  const sa = codeSegments(a) ?? [];
  const sb = codeSegments(b) ?? [];
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i] ?? -1;
    const y = sb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: readonly string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n');
}

export interface CsvRow {
  /** CSV 文件里的物理行号（1 起始），空行不会被跳过编号 */
  line: number;
  cells: string[];
}

/**
 * 极简 CSV 解析：支持引号包裹、转义引号、CRLF、BOM。
 * 返回物理行号，供导入报错定位到 Excel 原始行。
 */
export function parseCsvRows(text: string): CsvRow[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const pushRow = () => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push({ line: rowLine, cells: row });
    row = [];
    field = '';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        field += c;
        if (c === '\n') line++;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || (c === '\r' && src[i + 1] !== '\n')) {
      pushRow();
      line++;
      rowLine = line;
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) pushRow();
  return rows;
}

/** 极简 CSV 解析：只要内容，不关心行号（兼容旧调用方） */
export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((row) => row.cells);
}

/**
 * 把整个项目按树的先序顺序导出，编号按位置自动生成。
 * 父节点的工时写 0：导入时会按子节点重新汇总，避免被算两遍。
 */
export function buildProjectCsv(tasks: Task[], persons: Person[]): string {
  const tree = buildTree(tasks);
  const order: Array<{ node: TreeRow; code: string }> = [];
  const walk = (nodes: TreeRow[], prefix: string) => {
    nodes.forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      order.push({ node: n, code });
      walk(n.children, code);
    });
  };
  walk(tree, '');

  const names = new Map(persons.map((p) => [p.id, p.name]));

  const rows = order.map(({ node: t, code }) => [
    code,
    t.kind === 'milestone' ? '里程碑' : '任务',
    t.name,
    t.ownerId ? (names.get(t.ownerId) ?? '') : '',
    t.children.length ? '0' : String(t.estimateHours),
    t.startDate,
    t.dueDate,
    t.doneAt ? '已完成' : '',
    t.note ?? '',
  ]);

  return toCsv(CSV_HEADERS, rows);
}

export function csvFileName(code: string, name: string): string {
  const safe = `${code}-${name}`.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '');
  return `${safe}.csv`;
}

export interface CsvIssue {
  line: number;
  message: string;
}

export interface ParsedProjectRow {
  line: number;
  code: string;
  segments: number[];
  kind: 'task' | 'milestone';
  name: string;
  owner: string | null;
  hours: number;
  /** 工时单元格是否非空；用来决定「工时优先」还是「结束日优先」 */
  hoursProvided: boolean;
  start: string | null;
  due: string | null;
  done: boolean;
  note: string | null;
}

export interface ProjectCsvResult {
  rows: ParsedProjectRow[];
  issues: CsvIssue[];
  /** 表头级别的问题，出现后无法继续解析 */
  fatal?: string;
}

export function parseProjectCsv(text: string): ProjectCsvResult {
  const table = parseCsvRows(text);
  if (table.length === 0) return { rows: [], issues: [], fatal: '文件是空的' };

  const headers = table[0].cells.map((h) => h.trim());
  const at = (name: string) => headers.indexOf(name);
  if (at('编号') < 0) {
    return { rows: [], issues: [], fatal: '表头缺少「编号」列，请使用最新模板' };
  }
  if (at('名称') < 0) {
    return { rows: [], issues: [], fatal: '表头缺少「名称」列' };
  }

  const rows: ParsedProjectRow[] = [];
  const issues: CsvIssue[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < table.length; i++) {
    const { line, cells } = table[i];
    const get = (name: string) => {
      const idx = at(name);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const code = get('编号');
    const name = get('名称');
    if (!code && !name) continue;

    const segments = codeSegments(code);
    if (!segments) {
      issues.push({ line, message: `编号「${code}」格式不对，应形如 1 / 1.2 / 1.2.3` });
      continue;
    }
    if (segments.length > MAX_CODE_DEPTH) {
      issues.push({ line, message: `编号 ${code} 超过 ${MAX_CODE_DEPTH} 层` });
      continue;
    }
    if (!name) {
      issues.push({ line, message: '名称不能为空' });
      continue;
    }
    if (seen.has(code)) {
      issues.push({ line, message: `编号 ${code} 与第 ${seen.get(code)} 行重复` });
      continue;
    }
    seen.set(code, line);

    const startText = get('开始日期');
    const dueText = get('结束日期');
    const start = startText ? normalizeDate(startText) : null;
    const due = dueText ? normalizeDate(dueText) : null;
    if (startText && !start) {
      issues.push({
        line,
        message: `开始日期「${startText}」格式不对，请使用 YYYY-MM-DD 或 YYYY/M/D`,
      });
      continue;
    }
    if (dueText && !due) {
      issues.push({
        line,
        message: `结束日期「${dueText}」格式不对，请使用 YYYY-MM-DD 或 YYYY/M/D`,
      });
      continue;
    }

    const hoursText = get('工时');
    const hoursProvided = hoursText !== '';
    const hours = hoursText === '' ? 0 : Number(hoursText);
    if (!Number.isFinite(hours) || hours < 0) {
      issues.push({ line, message: `工时「${hoursText}」不是有效数字` });
      continue;
    }

    rows.push({
      line,
      code,
      segments,
      kind: get('类型').includes('里程碑') ? 'milestone' : 'task',
      name,
      owner: get('负责人') || null,
      hours,
      hoursProvided,
      start,
      due,
      done: /已完成|完成/.test(get('状态')),
      note: get('备注') || null,
    });
  }

  // 父编号必须存在；行序无关
  const codes = new Set(rows.map((r) => r.code));
  for (const r of rows) {
    const parent = parentCode(r.code);
    if (parent && !codes.has(parent)) {
      issues.push({ line: r.line, message: `编号 ${r.code} 的上级 ${parent} 不存在` });
    }
  }

  rows.sort((a, b) => compareCodes(a.code, b.code));
  return { rows, issues };
}