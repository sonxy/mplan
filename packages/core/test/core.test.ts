import { describe, expect, it } from 'vitest';
import {
  type DayOverrideMap,
  type Task,
  CSV_HEADERS,
  buildProjectCsv,
  computeAutoShift,
  parseCsv,
  parseProjectCsv,
  projectOverdueWorkdays,
  addWorkdays,
  buildAxis,
  buildCompanyCalendar,
  countWorkdays,
  deriveTask,
  durationFromHours,
  isWorkday,
  makeCalendar,
  recentWorkdays,
  rescheduleByDue,
  rescheduleByHours,
  shiftTaskWorkdays,
} from '../src/index.js';

const company = buildCompanyCalendar();
const plain = makeCalendar(company);

const task = (over: Partial<Parameters<typeof deriveTask>[0]> = {}) => ({
  startDate: '2026-10-08',
  dueDate: '2026-10-20',
  estimateHours: 80,
  progressMode: 'auto' as const,
  manualProgress: null,
  doneAt: null,
  ...over,
});

describe('公司日历（2026 国务院安排）', () => {
  it('周末不上班', () => {
    expect(isWorkday('2026-10-17', plain)).toBe(false); // 周六
    expect(isWorkday('2026-10-18', plain)).toBe(false); // 周日
    expect(isWorkday('2026-10-19', plain)).toBe(true); // 周一
  });

  it('国庆 10/1-10/7 放假', () => {
    for (const d of ['2026-10-01', '2026-10-05', '2026-10-07']) {
      expect(isWorkday(d, plain)).toBe(false);
    }
    expect(isWorkday('2026-10-08', plain)).toBe(true);
  });

  it('调休补班日照常上班（9/20 周日、10/10 周六）', () => {
    expect(isWorkday('2026-09-20', plain)).toBe(true);
    expect(isWorkday('2026-10-10', plain)).toBe(true);
  });

  it('春节 9 天连休', () => {
    expect(isWorkday('2026-02-15', plain)).toBe(false);
    expect(isWorkday('2026-02-23', plain)).toBe(false);
    expect(isWorkday('2026-02-24', plain)).toBe(true);
    expect(isWorkday('2026-02-28', plain)).toBe(true); // 周六补班
  });
});

describe('工时 ↔ 日期', () => {
  it('80 小时 = 10 个工作日', () => {
    expect(durationFromHours(80)).toBe(10);
    expect(durationFromHours(79)).toBe(10);
    expect(durationFromHours(81)).toBe(11);
    expect(durationFromHours(1)).toBe(1);
  });

  it('从 10/8 开始 80 小时，跨过周末和调休结束于 10/20', () => {
    const r = rescheduleByHours('2026-10-08', 80, plain);
    expect(r.dueDate).toBe('2026-10-20');
  });

  it('开始日落在节假日时自动顺延到下一个工作日', () => {
    const r = rescheduleByHours('2026-10-01', 8, plain);
    expect(r.startDate).toBe('2026-10-08');
    expect(r.dueDate).toBe('2026-10-08');
  });

  it('改结束日反算工时', () => {
    const r = rescheduleByDue('2026-10-08', '2026-10-20', plain);
    expect(r.estimateHours).toBe(80);
  });

  it('结束日落在周末时回退到最近工作日', () => {
    const r = rescheduleByDue('2026-10-08', '2026-10-17', plain);
    expect(r.dueDate).toBe('2026-10-16');
    expect(r.estimateHours).toBe(64); // 8 个工作日
  });

  it('平移保持工期不变', () => {
    const r = shiftTaskWorkdays('2026-10-08', '2026-10-20', 3, plain);
    expect(r.startDate).toBe('2026-10-12');
    expect(r.dueDate).toBe('2026-10-23');
    expect(countWorkdays(r.startDate, r.dueDate, plain)).toBe(10);
  });
});

describe('按时间推算进度', () => {
  it('10 天任务做到第 5 个工作日 = 50%', () => {
    const d = deriveTask(task(), '2026-10-13', plain);
    expect(d.durationDays).toBe(10);
    expect(d.elapsedDays).toBe(5);
    expect(d.progress).toBeCloseTo(0.5);
    expect(d.status).toBe('doing');
  });

  it('未开始是 0%', () => {
    const d = deriveTask(task(), '2026-10-01', plain);
    expect(d.progress).toBe(0);
    expect(d.status).toBe('todo');
  });

  it('到期未完成会逾期，进度封顶 99% 而不是 100%', () => {
    const d = deriveTask(task(), '2026-10-23', plain);
    expect(d.overdue).toBe(true);
    expect(d.status).toBe('overdue');
    expect(d.progress).toBeLessThan(1);
    expect(d.overdueWorkdays).toBe(3); // 10/21、10/22、10/23
  });

  it('只有显式完成才是 100%', () => {
    const d = deriveTask(task({ doneAt: '2026-10-20T10:00:00Z' }), '2026-10-21', plain);
    expect(d.progress).toBe(1);
    expect(d.status).toBe('done');
  });

  it('手动进度优先于时间推算', () => {
    const d = deriveTask(
      task({ progressMode: 'manual', manualProgress: 30 }),
      '2026-10-14',
      plain,
    );
    expect(d.progress).toBeCloseTo(0.3);
  });
});

describe('加班占用节假日', () => {
  const overtime: DayOverrideMap = { '2026-10-17': { work: true } };
  const cal = makeCalendar(company, overtime);

  it('加班日对本人算工作日', () => {
    expect(isWorkday('2026-10-17', cal)).toBe(true);
    expect(isWorkday('2026-10-17', plain)).toBe(false);
  });

  it('加班会把工期算长，进度分母跟着变', () => {
    expect(countWorkdays('2026-10-08', '2026-10-20', cal)).toBe(11);
    const d = deriveTask(task(), '2026-10-13', cal);
    expect(d.durationDays).toBe(11);
    expect(d.progress).toBeCloseTo(5 / 11);
  });

  it('请假优先级最高，人不在任务不推进', () => {
    const leave = makeCalendar(company, { '2026-10-14': { work: false } });
    expect(isWorkday('2026-10-14', leave)).toBe(false);
    expect(deriveTask(task(), '2026-10-14', leave).elapsedDays).toBe(5);
  });

  it('加班日会被插进压缩工作日轴', () => {
    const axis = buildAxis('2026-10-01', '2026-10-31', company);
    expect(axis.columns).toHaveLength(18);
    expect(axis.indexByDate.has('2026-10-17')).toBe(false);

    const axis2 = buildAxis('2026-10-01', '2026-10-31', company, ['2026-10-17']);
    expect(axis2.columns).toHaveLength(19);
    expect(axis2.indexByDate.get('2026-10-17')).toBeDefined();
    expect(axis2.columns.find((c) => c.date === '2026-10-17')?.overtime).toBe(true);
  });
});

describe('工作日偏移', () => {
  it('跨长假正确跳转', () => {
    expect(addWorkdays('2026-09-30', 1, plain)).toBe('2026-10-08');
    expect(addWorkdays('2026-10-08', -1, plain)).toBe('2026-09-30');
  });

  it('最近 3 个工作日会跳过周末', () => {
    // 2026-11-09 是周一；最近 3 个工作日 = 上周四、上周五、今天
    expect(recentWorkdays('2026-11-09', plain, 3)).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
    ]);
    // 2026-11-10 是周二；最近 3 个工作日 = 上周五、周一、今天
    expect(recentWorkdays('2026-11-10', plain, 3)).toEqual([
      '2026-11-06',
      '2026-11-09',
      '2026-11-10',
    ]);
    expect(recentWorkdays('2026-11-09', plain, 0)).toEqual([]);
  });
});
describe('CSV 导入导出（编号制）', () => {
  const persons = [
    { id: 'p1', name: '林岚', role: null, color: 'rose', dailyHours: 8, active: true },
    { id: 'p2', name: '周野', role: null, color: 'indigo', dailyHours: 8, active: true },
  ];
  const base = {
    projectId: 'proj',
    progressMode: 'auto' as const,
    manualProgress: null,
    doneAt: null,
    note: null,
  };
  const tasks = [
    { ...base, id: 'm1', parentId: null, depth: 1, sort: 0, name: '品牌与视觉', ownerId: null, estimateHours: 0, startDate: '2026-11-09', dueDate: '2026-11-20', kind: 'task' as const },
    { ...base, id: 'f1', parentId: 'm1', depth: 2, sort: 0, name: '首页, 改版', ownerId: 'p1', estimateHours: 40, startDate: '2026-11-09', dueDate: '2026-11-13', kind: 'task' as const, doneAt: '2026-11-12T10:00:00Z' },
    { ...base, id: 'k1', parentId: 'm1', depth: 2, sort: 1, name: '评审"定稿"', ownerId: 'p2', estimateHours: 0, startDate: '2026-11-20', dueDate: '2026-11-20', kind: 'milestone' as const },
    { ...base, id: 'm2', parentId: null, depth: 1, sort: 1, name: '产品内容', ownerId: null, estimateHours: 0, startDate: '2026-11-09', dueDate: '2026-11-20', kind: 'task' as const },
  ];

  it('第一列是编号', () => {
    const csv = buildProjectCsv(tasks, persons);
    expect(csv.split('\n')[0]).toBe(CSV_HEADERS.join(','));
    expect(csv.split('\n')[0].startsWith('编号,')).toBe(true);
  });

  it('编号按树位置生成', () => {
    const rows = parseCsv(buildProjectCsv(tasks, persons));
    expect(rows.slice(1).map((r) => r[0])).toEqual(['1', '1.1', '1.2', '2']);
  });

  it('父节点工时写 0，里程碑标类型，负责人翻译成名字', () => {
    const rows = parseCsv(buildProjectCsv(tasks, persons));
    expect(rows[1]).toEqual(['1', '任务', '品牌与视觉', '', '0', '2026-11-09', '2026-11-20', '', '']);
    expect(rows[2][3]).toBe('林岚');
    expect(rows[2][4]).toBe('40');
    expect(rows[2][7]).toBe('已完成');
    expect(rows[3][1]).toBe('里程碑');
  });

  it('区分工时留空和显式填写（0 也算显式）', () => {
    const text = [
      '编号,类型,名称,负责人,工时,开始日期',
      '1,任务,模块,,1,2026-11-10',
      '1.1,任务,子任务甲,,,2026-11-10',
      '1.2,任务,子任务乙,,0,2026-11-10',
    ].join('\n');
    const { rows, issues } = parseProjectCsv(text);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.hours, r.hoursProvided])).toEqual([
      [1, true],
      [0, false],
      [0, true],
    ]);
  });

  it('逗号、引号会被正确转义并能解析回来', () => {
    const csv = buildProjectCsv(tasks, persons);
    expect(csv).toContain('"首页, 改版"');
    expect(csv).toContain('"评审""定稿"""');
  });

  it('层级由编号推导，行的顺序无所谓', () => {
    const text = [
      '编号,类型,名称,负责人,工时,开始日期',
      '1.1,任务,子任务甲,林岚,8,2026-11-09',
      '2,任务,另一个模块,,0,2026-11-09',
      '1,任务,主模块,,0,2026-11-09',
      '1.2,里程碑,节点乙,周野,0,2026-11-20',
    ].join('\n');
    const { rows, issues } = parseProjectCsv(text);
    expect(issues).toEqual([]);
    expect(rows.map((r) => r.code)).toEqual(['1', '1.1', '1.2', '2']);
    expect(rows.map((r) => r.segments.length)).toEqual([1, 2, 2, 1]);
    expect(rows[2].kind).toBe('milestone');
  });

  it('父编号不存在 / 编号重复 / 格式不对 / 超过 4 层都会报错', () => {
    const text = [
      '编号,类型,名称,负责人,工时,开始日期',
      '1.1,任务,孤儿,林岚,8,2026-11-09',
      '2,任务,模块,,0,2026-11-09',
      '2,任务,重复编号,,0,2026-11-09',
      '三,任务,格式错,,0,2026-11-09',
      '3.1.1.1.1,任务,太深了,,0,2026-11-09',
    ].join('\n');
    const { issues } = parseProjectCsv(text);
    const messages = issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('的上级 1 不存在');
    expect(messages).toContain('与第 3 行重复');
    expect(messages).toContain('格式不对');
    expect(messages).toContain('超过 4 层');
  });

  it('缺少编号列时给出明确提示', () => {
    const { fatal } = parseProjectCsv('层级,名称\n1,模块');
    expect(fatal).toContain('编号');
  });

  it('兼容 Excel 的斜杠 / 点号日期，并统一补零', () => {
    const text = [
      '编号,类型,名称,负责人,工时,开始日期,结束日期',
      '1,任务,模块,,0,2026/11/9,2026.11.10',
      '1.1,任务,子任务,林岚,8,2026-11-11,2026-11-12',
    ].join('\n');
    const { rows, issues } = parseProjectCsv(text);
    expect(issues).toEqual([]);
    expect(rows[0].start).toBe('2026-11-09');
    expect(rows[0].due).toBe('2026-11-10');
    expect(rows[1].start).toBe('2026-11-11');
  });

  it('非法日期会被拒绝，不会静默进位', () => {
    const text = [
      '编号,类型,名称,负责人,工时,开始日期,结束日期',
      '1,任务,模块,,0,2026-11-09,2026-11-09',
      '1.1,任务,子任务,,0,2026/2/30,2026-11-10',
    ].join('\n');
    const { issues } = parseProjectCsv(text);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
    expect(issues[0].message).toContain('开始日期');
    expect(issues[0].message).toContain('格式不对');
  });

  it('报错行号使用 CSV 物理行号，空行不会造成偏移', () => {
    const text = [
      '编号,类型,名称,负责人,工时,开始日期,结束日期',
      '1,任务,模块,,0,2026-11-09,2026-11-09',
      '',
      '',
      '1,任务,重复编号,,0,2026-11-09,2026-11-09',
      '',
      '1.1,任务,子任务,,0,2026-13-01,2026-11-10',
    ].join('\n');
    const { issues } = parseProjectCsv(text);
    const dup = issues.find((i) => i.message.includes('重复'));
    const badDate = issues.find((i) => i.message.includes('开始日期'));
    expect(dup?.line).toBe(5);
    expect(dup?.message).toContain('与第 2 行重复');
    expect(badDate?.line).toBe(7);
  });
});

describe('改期联动（自动顺延后续）', () => {
  const makeTask = (id: string, over: Partial<Task> = {}): Task => ({
    id,
    projectId: 'p1',
    parentId: null,
    depth: 1,
    sort: 0,
    name: id,
    ownerId: 'u1',
    estimateHours: 8,
    kind: 'task',
    startDate: '2026-11-02',
    dueDate: '2026-11-06',
    progressMode: 'auto',
    manualProgress: null,
    doneAt: null,
    note: null,
    ...over,
  });

  const shift = (tasks: Task[], over: Partial<Parameters<typeof computeAutoShift>[0]> = {}) =>
    computeAutoShift({
      tasks,
      taskId: 'A',
      oldDueDate: '2026-11-06',
      newDueDate: '2026-11-10',
      company,
      ...over,
    });

  it('同负责人 / 同父级分支的后续任务平移，并行和无关任务不动', () => {
    const tasks = [
      makeTask('P', { dueDate: '2026-11-20' }),
      makeTask('Q', { dueDate: '2026-11-20' }),
      makeTask('A', { parentId: 'P', depth: 2 }),
      makeTask('B', {
        parentId: 'P',
        depth: 2,
        ownerId: 'u1',
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
      }),
      makeTask('C', {
        parentId: 'Q',
        depth: 2,
        ownerId: 'u2',
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
      }),
      makeTask('D', {
        parentId: 'P',
        depth: 2,
        ownerId: 'u2',
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
      }),
      makeTask('E', {
        parentId: 'P',
        depth: 2,
        ownerId: 'u1',
        startDate: '2026-11-06',
        dueDate: '2026-11-06',
      }),
      makeTask('F', {
        parentId: 'P',
        depth: 2,
        ownerId: 'u1',
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
        doneAt: '2026-11-10T00:00:00.000Z',
      }),
    ];
    const res = shift(tasks);
    expect(res.deltaWorkdays).toBe(2);
    expect(res.targets.map((t) => t.taskId)).toEqual(['B', 'D']);
    expect(res.targets[0]).toMatchObject({ startDate: '2026-11-11', dueDate: '2026-11-12' });
  });

  it('同父级分支包括兄弟汇总节点下面的叶子', () => {
    const tasks = [
      makeTask('P', { dueDate: '2026-11-20' }),
      makeTask('A', { parentId: 'P', depth: 2 }),
      makeTask('S', { parentId: 'P', depth: 2, dueDate: '2026-11-20' }),
      makeTask('L', {
        parentId: 'S',
        depth: 3,
        ownerId: 'u2',
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
      }),
    ];
    expect(shift(tasks).targets.map((t) => t.taskId)).toEqual(['L']);
  });

  it('结束日没往后移动就不联动', () => {
    const tasks = [makeTask('A'), makeTask('B', { startDate: '2026-11-09' })];
    expect(shift(tasks, { newDueDate: '2026-11-05' }).targets).toEqual([]);
    expect(shift(tasks, { newDueDate: '2026-11-06' }).targets).toEqual([]);
  });

  it('负责人为空时只按父级分支匹配，不把所有未分配任务都推走', () => {
    const tasks = [
      makeTask('P', { dueDate: '2026-11-20' }),
      makeTask('Q', { dueDate: '2026-11-20' }),
      makeTask('A', { parentId: 'P', depth: 2, ownerId: null }),
      makeTask('B', {
        parentId: 'P',
        depth: 2,
        ownerId: 'u2',
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
      }),
      makeTask('C', {
        parentId: 'Q',
        depth: 2,
        ownerId: null,
        startDate: '2026-11-09',
        dueDate: '2026-11-10',
      }),
    ];
    expect(shift(tasks).targets.map((t) => t.taskId)).toEqual(['B']);
  });

  it('父级为空时只按负责人匹配', () => {
    const tasks = [
      makeTask('A', { ownerId: 'u1' }),
      makeTask('B', { ownerId: 'u1', startDate: '2026-11-09', dueDate: '2026-11-10' }),
      makeTask('C', { ownerId: 'u2', startDate: '2026-11-09', dueDate: '2026-11-10' }),
    ];
    expect(shift(tasks).targets.map((t) => t.taskId)).toEqual(['B']);
  });

  it('平移时按负责人日历归一化，工期不变', () => {
    const tasks = [makeTask('A'), makeTask('B', { startDate: '2026-11-09', dueDate: '2026-11-10' })];
    const res = shift(tasks, {
      personOverrides: { u1: { '2026-11-11': { work: false } } },
    });
    expect(res.targets[0]).toMatchObject({ startDate: '2026-11-12', dueDate: '2026-11-13' });
  });

  it('里程碑平移后仍为零工期', () => {
    const tasks = [
      makeTask('A'),
      makeTask('M', {
        kind: 'milestone',
        startDate: '2026-11-09',
        dueDate: '2026-11-09',
        estimateHours: 0,
      }),
    ];
    expect(shift(tasks).targets[0]).toMatchObject({
      startDate: '2026-11-11',
      dueDate: '2026-11-11',
    });
  });
});

describe('项目计划超期', () => {
  const t = (id: string, over: Partial<Task> = {}): Task => ({
    id,
    projectId: 'p1',
    parentId: null,
    depth: 1,
    sort: 0,
    name: id,
    ownerId: 'u1',
    estimateHours: 8,
    kind: 'task',
    startDate: '2026-11-02',
    dueDate: '2026-11-20',
    progressMode: 'auto',
    manualProgress: null,
    doneAt: null,
    note: null,
    ...over,
  });

  it('按未完成叶子任务的最晚结束日算工作日', () => {
    const tasks = [
      t('P', { dueDate: '2026-11-30' }),
      t('A', { parentId: 'P', depth: 2, dueDate: '2026-11-24' }),
      t('B', {
        parentId: 'P',
        depth: 2,
        dueDate: '2026-11-25',
        doneAt: '2026-11-20T00:00:00.000Z',
      }),
    ];
    expect(projectOverdueWorkdays(tasks, '2026-11-20', company)).toBe(2); // 11/23、11/24
  });

  it('没设项目完成日 / 全部完成时不算超期', () => {
    const tasks = [t('A', { dueDate: '2026-11-24' })];
    expect(projectOverdueWorkdays(tasks, null, company)).toBe(0);
    expect(
      projectOverdueWorkdays(
        tasks.map((x) => ({ ...x, doneAt: '2026-11-20T00:00:00.000Z' })),
        '2026-11-20',
        company,
      ),
    ).toBe(0);
  });
});
