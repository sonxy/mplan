import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  buildCompanyCalendar,
  flattenHolidaySpecs,
  makeCalendar,
  rescheduleByHours,
  type DayOverrideMap,
} from '@mplan/core';
import { db } from './client.js';
import { hashPassword } from '../lib/auth.js';
import {
  calendarExceptions,
  calendarSettings,
  changeLog,
  dayOverrides,
  persons,
  projectMembers,
  projects,
  tasks,
  users,
} from './schema.js';

const company = buildCompanyCalendar();

interface PersonSpec {
  name: string;
  role: string;
  color: string;
}

const PERSON_SPECS: PersonSpec[] = [
  { name: '陈墨', role: '产品经理', color: 'teal' },
  { name: '林岚', role: '视觉设计', color: 'rose' },
  { name: '周野', role: '前端开发', color: 'indigo' },
  { name: '苏晴', role: '前端开发', color: 'sky' },
  { name: '郑凯', role: '后端开发', color: 'violet' },
  { name: '何雨', role: '内容运营', color: 'amber' },
  { name: '唐宁', role: '测试工程师', color: 'lime' },
];

interface TaskSpec {
  name: string;
  owner?: string;
  hours?: number;
  start?: string;
  done?: boolean;
  milestone?: boolean;
  note?: string;
  children?: TaskSpec[];
}

const WEB3: TaskSpec[] = [
  {
    name: '品牌与视觉',
    children: [
      {
        name: '首页改版',
        children: [
          {
            name: '首屏 Hero 区',
            children: [
              { name: '视觉稿设计', owner: '林岚', hours: 40, start: '2026-10-12', done: true },
              {
                name: '前端实现',
                owner: '周野',
                hours: 80,
                start: '2026-10-19',
                note: '周末加了班，仍落后于计划',
              },
            ],
          },
          {
            name: '品牌故事',
            children: [
              { name: '品牌文案', owner: '何雨', hours: 24, start: '2026-10-26', done: true },
              { name: '手绘插画', owner: '林岚', hours: 32, start: '2026-10-28', done: true },
            ],
          },
          {
            name: '设计定稿评审',
            owner: '陈墨',
            milestone: true,
            start: '2026-11-20',
          },
        ],
      },
      {
        name: '全站视觉规范',
        children: [
          { name: '色彩与字体', owner: '林岚', hours: 16, start: '2026-11-02', done: true },
          { name: '组件视觉规范', owner: '林岚', hours: 40, start: '2026-11-04' },
        ],
      },
    ],
  },
  {
    name: '产品内容体系',
    children: [
      {
        name: '内容架构',
        children: [
          { name: '导航与信息架构', owner: '陈墨', hours: 32, start: '2026-10-19', done: true },
          { name: '页面清单梳理', owner: '陈墨', hours: 16, start: '2026-10-26', done: true },
        ],
      },
      {
        name: '内容生产',
        children: [
          { name: '产品文案', owner: '何雨', hours: 40, start: '2026-11-02' },
          { name: '客户案例包装', owner: '何雨', hours: 32, start: '2026-11-16' },
        ],
      },
    ],
  },
  {
    name: '前端工程',
    children: [
      {
        name: '技术选型与脚手架',
        children: [
          { name: '工程脚手架', owner: '周野', hours: 24, start: '2026-10-12', done: true },
          { name: '组件库选型', owner: '周野', hours: 16, start: '2026-10-15', done: true },
        ],
      },
      {
        name: '页面开发',
        children: [
          { name: '首页开发', owner: '周野', hours: 64, start: '2026-10-28' },
          { name: '产品页开发', owner: '苏晴', hours: 96, start: '2026-11-02' },
          { name: '案例页开发', owner: '苏晴', hours: 64, start: '2026-11-23' },
        ],
      },
      {
        name: '性能与兼容',
        children: [
          { name: '首屏性能优化', owner: '周野', hours: 40, start: '2026-12-07' },
          { name: '浏览器兼容', owner: '周野', hours: 24, start: '2026-12-14' },
        ],
      },
    ],
  },
  {
    name: '上线',
    children: [
      { name: '正式上线', milestone: true, start: '2027-01-29' },
      {
        name: '测试验收',
        children: [
          { name: '功能测试', owner: '唐宁', hours: 80, start: '2026-12-21' },
          { name: '回归测试', owner: '唐宁', hours: 40, start: '2027-01-06' },
        ],
      },
      {
        name: '部署与切换',
        children: [
          { name: 'CDN 与域名切换', owner: '郑凯', hours: 24, start: '2027-01-18' },
          { name: '监控告警接入', owner: '郑凯', hours: 16, start: '2027-01-25' },
        ],
      },
    ],
  },
];

const DASH: TaskSpec[] = [
  {
    name: '设计与需求',
    children: [
      { name: '指标口径梳理', owner: '陈墨', hours: 24, start: '2026-11-02' },
      { name: '看板视觉设计', owner: '林岚', hours: 32, start: '2026-11-05' },
    ],
  },
  {
    name: '数据与开发',
    children: [
      { name: '数据源接入', owner: '郑凯', hours: 40, start: '2026-11-09' },
      { name: '看板前端开发', owner: '苏晴', hours: 80, start: '2026-11-16' },
    ],
  },
  {
    name: '验收上线',
    children: [{ name: '联调与测试', owner: '唐宁', hours: 24, start: '2026-12-07' }],
  },
];

async function main() {
  console.log('清空旧数据…');
  await db.delete(changeLog);
  await db.delete(dayOverrides);
  await db.delete(tasks);
  // 项目 id 每次都会重新生成，旧的项目授权无法沿用，一并清掉避免留下孤儿行
  await db.delete(projectMembers);
  await db.delete(projects);
  await db.delete(persons);
  await db.delete(calendarExceptions);
  await db.delete(calendarSettings);

  console.log('写入公司日历…');
  await db.insert(calendarSettings).values({
    id: 1,
    name: '公司日历',
    weekend: '0,6',
    version: '2026.1',
  });
  const exceptions = flattenHolidaySpecs();
  await db.insert(calendarExceptions).values(
    exceptions.map((e) => ({ id: randomUUID(), ...e })),
  );

  console.log('写入人员…');
  const personIdByName = new Map<string, string>();
  for (let i = 0; i < PERSON_SPECS.length; i++) {
    const p = PERSON_SPECS[i];
    const id = randomUUID();
    personIdByName.set(p.name, id);
    await db.insert(persons).values({
      id,
      name: p.name,
      role: p.role,
      color: p.color,
      dailyHours: '8.00',
      active: true,
      sort: i,
    });
  }

  // 人员级加班 / 请假
  const personOverrides: Record<string, DayOverrideMap> = {};
  const zhou = personIdByName.get('周野')!;
  personOverrides[zhou] = { '2026-10-24': { work: true, hours: 8, note: '周末赶工' } };
  const su = personIdByName.get('苏晴')!;
  personOverrides[su] = { '2026-11-20': { work: false, note: '年假' } };

  for (const [personId, map] of Object.entries(personOverrides)) {
    for (const [date, v] of Object.entries(map)) {
      await db.insert(dayOverrides).values({
        id: randomUUID(),
        scope: 'person',
        scopeId: personId,
        date,
        work: v.work,
        hours: v.hours != null ? String(v.hours) : null,
        note: v.note ?? null,
      });
    }
  }

  const projectDefs = [
    {
      id: randomUUID(),
      name: '企业官网 3.0 改版',
      code: 'WEB3',
      startDate: '2026-10-12',
      dueDate: '2027-01-29',
      note: '品牌升级 + 内容重构 + 前端重写，春节前上线。',
      sort: 0,
      specs: WEB3,
    },
    {
      id: randomUUID(),
      name: '数据看板 1.0',
      code: 'DASH',
      startDate: '2026-11-02',
      dueDate: '2026-12-18',
      note: '给销售团队用的实时经营看板。',
      sort: 1,
      specs: DASH,
    },
  ];

  for (const p of projectDefs) {
    await db.insert(projects).values({
      id: p.id,
      name: p.name,
      code: p.code,
      startDate: p.startDate,
      dueDate: p.dueDate,
      note: p.note,
      sort: p.sort,
    });

    const insertNodes = async (
      specs: TaskSpec[],
      parentId: string | null,
      depth: number,
    ): Promise<{ start: string; due: string }> => {
      let minStart = '9999-12-31';
      let maxDue = '0000-01-01';

      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const id = randomUUID();
        let start: string;
        let due: string;
        let hours = spec.hours ?? 0;
        let doneAt: Date | null = null;

        if (spec.children?.length) {
          // 先给父节点占好 id，子节点才能指回来
          const range = await insertNodes(spec.children, id, depth + 1);
          start = range.start;
          due = range.due;
          hours = 0;
        } else if (spec.milestone) {
          const ownerKey = spec.owner ? personIdByName.get(spec.owner) : undefined;
          const cal = makeCalendar(company, ownerKey ? personOverrides[ownerKey] : undefined);
          start = rescheduleByHours(spec.start!, 8, cal).startDate;
          due = start;
          hours = 0;
        } else {
          const ownerKey = spec.owner ? personIdByName.get(spec.owner) : undefined;
          const cal = makeCalendar(company, ownerKey ? personOverrides[ownerKey] : undefined);
          const r = rescheduleByHours(spec.start!, hours || 8, cal);
          start = r.startDate;
          due = r.dueDate;
          if (spec.done) doneAt = new Date(`${due}T18:00:00+08:00`);
        }

        if (start < minStart) minStart = start;
        if (due > maxDue) maxDue = due;

        const ownerId = spec.owner ? (personIdByName.get(spec.owner) ?? null) : null;
        await db.insert(tasks).values({
          id,
          projectId: p.id,
          parentId,
          depth,
          sort: i,
          name: spec.name,
          ownerId,
          estimateHours: String(hours),
          kind: spec.milestone ? 'milestone' : 'task',
          startDate: start,
          dueDate: due,
          progressMode: 'auto',
          manualProgress: null,
          doneAt,
          note: spec.note ?? null,
        });
      }
      return { start: minStart, due: maxDue };
    };

    await insertNodes(p.specs, null, 1);
  }

  console.log('写入变更日志示例…');
  const web3Id = projectDefs[0].id;
  const logSeeds: Array<{
    daysAgo: number;
    actor: string;
    taskName: string;
    action: 'create' | 'update' | 'postpone' | 'import' | 'delete';
    field?: string;
    before?: string;
    after?: string;
  }> = [
    { daysAgo: 9, actor: '陈墨', taskName: '企业官网 3.0 改版', action: 'import', after: '36 行' },
    {
      daysAgo: 5,
      actor: '陈墨',
      taskName: '设计定稿评审',
      action: 'create',
      after: '里程碑',
    },
    {
      daysAgo: 4,
      actor: '周野',
      taskName: '前端实现',
      action: 'update',
      field: 'dates',
      before: '2026-10-19 → 2026-10-29',
      after: '2026-10-19 → 2026-11-02',
    },
    {
      daysAgo: 3,
      actor: '林岚',
      taskName: '组件视觉规范',
      action: 'update',
      field: 'hours',
      before: '32h',
      after: '40h',
    },
    {
      daysAgo: 2,
      actor: '苏晴',
      taskName: '产品页开发',
      action: 'update',
      field: 'dates',
      before: '2026-11-02 → 2026-11-17',
      after: '2026-11-02 → 2026-11-19',
    },
  ];
  for (const l of logSeeds) {
    await db.insert(changeLog).values({
      id: randomUUID(),
      projectId: web3Id,
      taskId: null,
      taskName: l.taskName,
      action: l.action,
      field: l.field ?? null,
      beforeValue: l.before ?? null,
      afterValue: l.after ?? null,
      actor: l.actor,
      createdAt: new Date(Date.now() - l.daysAgo * 86_400_000),
    });
  }

  console.log('确保至少有一个管理员账号…');
  const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
  if (existingUsers.length === 0) {
    const username = process.env.MPLAN_SEED_USER ?? 'admin';
    const password = process.env.MPLAN_SEED_PASSWORD ?? 'mplan123';
    await db.insert(users).values({
      id: randomUUID(),
      username,
      displayName: process.env.MPLAN_SEED_NAME ?? '管理员',
      passwordHash: await hashPassword(password),
      role: 'admin',
      active: true,
    });
    console.log(`  默认账号：${username} / ${password}（登录后请在「用户管理」里重置密码）`);
  } else {
    console.log('  已有账号，跳过');
  }

  console.log('种子数据完成 ✓');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });