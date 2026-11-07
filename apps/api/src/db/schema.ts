import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

// 登录账号。没有账号时前端会引导创建第一个管理员（见 routes.auth.ts 的 /api/auth/setup）
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  username: varchar('username', { length: 60 }).notNull().unique(),
  displayName: varchar('display_name', { length: 60 }).notNull(),
  /** scrypt$salt$hash，绝不下发到前端 */
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: mysqlEnum('role', ['admin', 'member']).notNull().default('member'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: datetime('last_login_at'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 账号 ↔ 可管理的项目。管理员隐含管理全部项目，不在表里重复存
export const projectMembers = mysqlTable(
  'project_members',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    projectId: varchar('project_id', { length: 36 }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex('uk_project_member').on(t.userId, t.projectId),
    index('idx_pm_project').on(t.projectId),
  ],
);

// 登录会话。浏览器只拿到随机 token，库里只存 sha256(token)
export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: datetime('expires_at').notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_session_user').on(t.userId)],
);

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  note: text('note'),
  sort: int('sort').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const persons = mysqlTable('persons', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  role: varchar('role', { length: 60 }),
  color: varchar('color', { length: 16 }).notNull().default('slate'),
  dailyHours: decimal('daily_hours', { precision: 4, scale: 2 }).notNull().default('8.00'),
  active: boolean('active').notNull().default(true),
  sort: int('sort').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 单例表：公司日历基础设置
export const calendarSettings = mysqlTable('calendar_settings', {
  id: tinyint('id').primaryKey().default(1),
  name: varchar('name', { length: 60 }).notNull().default('公司日历'),
  weekend: varchar('weekend', { length: 16 }).notNull().default('0,6'),
  version: varchar('version', { length: 32 }).notNull().default('2026.1'),
});

// 法定节假日 / 调休补班
export const calendarExceptions = mysqlTable(
  'calendar_exceptions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    type: mysqlEnum('type', ['holiday', 'workday']).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
  },
  (t) => [uniqueIndex('uk_cal_date').on(t.date)],
);

export const tasks = mysqlTable(
  'tasks',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 }).notNull(),
    parentId: varchar('parent_id', { length: 36 }),
    depth: tinyint('depth').notNull().default(1),
    sort: int('sort').notNull().default(0),
    name: varchar('name', { length: 200 }).notNull(),
    ownerId: varchar('owner_id', { length: 36 }),
    estimateHours: decimal('estimate_hours', { precision: 8, scale: 2 }).notNull().default('0.00'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    /** task = 普通任务，milestone = 里程碑（零工期，只看完成/未完成） */
    kind: mysqlEnum('kind', ['task', 'milestone']).notNull().default('task'),
    progressMode: mysqlEnum('progress_mode', ['auto', 'manual']).notNull().default('auto'),
    manualProgress: tinyint('manual_progress'),
    doneAt: datetime('done_at'),
    note: text('note'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_task_project').on(t.projectId), index('idx_task_parent').on(t.parentId)],
);

// 变更日志
export const changeLog = mysqlTable(
  'change_log',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 }).notNull(),
    taskId: varchar('task_id', { length: 36 }),
    taskName: varchar('task_name', { length: 200 }).notNull(),
    action: mysqlEnum('action', ['create', 'update', 'delete', 'postpone', 'import']).notNull(),
    field: varchar('field', { length: 40 }),
    beforeValue: varchar('before_value', { length: 255 }),
    afterValue: varchar('after_value', { length: 255 }),
    actor: varchar('actor', { length: 60 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index('idx_log_project').on(t.projectId, t.createdAt)],
);

// 人员 / 任务级别的单日覆盖（加班、请假）
export const dayOverrides = mysqlTable(
  'day_overrides',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    scope: mysqlEnum('scope', ['person', 'task']).notNull(),
    scopeId: varchar('scope_id', { length: 36 }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    work: boolean('work').notNull(),
    hours: decimal('hours', { precision: 4, scale: 2 }),
    note: varchar('note', { length: 120 }),
  },
  (t) => [
    uniqueIndex('uk_override').on(t.scope, t.scopeId, t.date),
    index('idx_override_scope').on(t.scope, t.scopeId),
  ],
);