<div align="center">

# mplan

**精简版项目排期工具：4 层任务树 + 压缩工作日甘特图 + 按时间推算进度**

匿名只读浏览 · 按项目授权编辑 · 管理员管理账号与全局设置

[功能特性](#功能特性) · [快速开始](#快速开始) · [初始化脚本](#初始化脚本) · [常用命令](#常用命令) · [项目结构](#项目结构) · [文档](#文档) · [路线图](docs/ROADMAP.md)

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.4-4479A1?logo=mysql&logoColor=white)


</div>

![项目视图](docs/images/project.png)

## 简介

mplan 是一个面向 10 人以内小团队的自托管轻量排期工具。它不试图做复杂的任务依赖和自动求解，而是把三件事做顺：

- **拆任务**：模块 → 一级功能点 → 二级功能点 → 细分功能点，最多 4 层
- **看排期**：压缩掉周末和节假日的甘特图，按人员维度查看负载
- **算进度**：进度由已过工作日推算，完成状态由人确认

不登录也能直接打开页面只读浏览全部项目；登录后普通成员只能编辑管理员分配的项目，管理员可以编辑全部项目并管理账号、人员和公司日历。

## 功能特性

### 任务与排期

- **4 层任务树**：服务端强制 `MAX_DEPTH = 4`，第 5 层直接拒绝
- **工时 ↔ 日期联动**：8h/天，改工时重排结束日，改日期反算工时；拖拽平移保留非 8 倍数的工时
- **公司日历**：内置 2026 年法定节假日与调休补班，可在界面中编辑；支持个人加班 / 请假和任务级加班
- **里程碑**：零工期菱形节点，不占工期，只区分达成 / 未达成
- **逾期顺延**：把当前任务及其后未完成任务按公司日历整体后移
- **甘特拖拽**：整条平移、拉两端改工期、工作日吸附、Esc 取消、边缘自动滚动
- **日视图列宽**：1× / 2× / 3× 三档（30 / 60 / 90px 每天），仅日视图生效，刷新后恢复 1×
- **晨会聚焦（当前项目）**：最近 3 个工作日（今天 + 前两个工作日），汇总前天/昨天完成、今天计划、今天到期、逾期与未分配；非焦点任务淡化，编辑仍在甘特图上完成

![晨会聚焦](docs/images/standup.png)
- **撤销 / 重做**：`⌘Z` / `⌘⇧Z`，覆盖拖拽与改期，最多 50 步

### 权限与协作

- **匿名只读**：不登录可浏览全部项目、任务详情、人员、日历和变更日志
- **按项目授权**：成员只能编辑被管理员分配的项目，其他项目仍然只读
- **账号管理**：管理员可新增 / 停用 / 改角色 / 重置密码 / 分配项目；首个账号自动成为管理员
- **变更日志**：新建 / 修改 / 删除 / 顺延 / 导入，带前后值，操作人来自登录会话，无法伪造

![用户管理与项目分配](docs/images/auth-users.png)

### 视图与数据

- **项目 / 人员两种视图**：人员视图按负责人分组，并提示单日超载
- **筛选 / 搜索**：按名称、备注、负责人、状态筛选；人员列表只显示当前项目有任务的负责人，命中项保留祖先上下文
- **CSV 导入 / 导出**：WBS 编号（`1` / `1.2` / `1.2.3`）表达层级，导入前校验、导出后可改再导回；日期兼容 `YYYY-MM-DD` / `YYYY/M/D` / `YYYY.MM.DD`，报错行号对应 CSV 原始行
- **演示数据**：2 个项目、7 个人、38 个任务、2 个里程碑、5 条变更日志

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite 7 + TypeScript | SPA，Tailwind v4 手写样式 |
| 状态 | Zustand | 单 store，服务端数据 + 少量 UI 状态 |
| 后端 | Fastify 5 + Zod + Drizzle ORM | 单进程 API，Zod 校验，Drizzle 类型推导 |
| 数据库 | MySQL 8.4 | 日期统一 `DATE` + `YYYY-MM-DD` 字符串，避免时区偏移 |
| 共享核心 | `packages/core` | 日期、工作日历、工期、进度、甘特轴、CSV 的纯函数 |
| 测试 | Vitest | 只覆盖 `packages/core`，31 个用例 |
| 验收 | CDP 截图脚本 | `scripts/shot.mjs`，可执行页面内脚本并截图 |

## 快速开始

### 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | **>= 22** | `scripts/shot.mjs` 依赖全局 WebSocket |
| pnpm | 11.x | workspace 必须用 pnpm |
| Docker / OrbStack | 任意较新版本 | 只用来跑 MySQL；如果 3308 已有 MySQL 8.4 可跳过 |
| MySQL | 8.4 | 由 `docker-compose.yml` 启动 |

> 默认端口：前端 `5173`、API `8787`、MySQL `3308`。起服务前确认这三个端口空闲。

### 方式一：一键初始化（推荐）

```bash
# 在仓库根目录执行
pnpm bootstrap

# 初始化完成后启动前后端
pnpm dev
```

`pnpm bootstrap` 等价于执行 [`scripts/init.sh`](scripts/init.sh)，会完成：

1. 检查 Node.js / pnpm 版本
2. `pnpm install`
3. 从 `apps/api/.env.example` 创建 `apps/api/.env`（已存在则跳过）
4. 启动 MySQL 并等待健康检查通过
5. `pnpm db:push` 建表 / 同步结构
6. `pnpm db:seed` 写入演示数据和默认管理员

启动后访问：

| 服务 | 地址 | 凭据 |
|---|---|---|
| 前端 | http://localhost:5173 | 未登录只读；默认账号 `admin / mplan123` |
| API | http://localhost:8787/api/health | 读接口匿名，写接口需会话 |
| MySQL | 127.0.0.1:3308 | `root / mplan`，库 `mplan` |

> 默认账号由 `db:seed` 创建。**首次登录后请在右上角「用户管理」里重置密码。**
> 如果数据库里一个账号都没有，打开页面点「登录」会进入「初始化管理员」流程，创建的第一个账号自动成为管理员。

### 方式二：手动初始化

```bash
# 1. 安装依赖
pnpm install

# 2. 准备环境变量（仓库里的 .env 已存在时可跳过）
cp apps/api/.env.example apps/api/.env

# 3. 启动 MySQL（映射到 3308）
pnpm db:up

# 4. 建表
pnpm db:push

# 5. 写入演示数据和默认管理员
pnpm db:seed

# 6. 启动 API + 前端
pnpm dev
```

如果依赖已经装好，`pnpm setup` 可以代替第 3–5 步（`db:up → db:push → db:seed`）。

## 初始化脚本

初始化脚本位于 [`scripts/init.sh`](scripts/init.sh)，也可以直接执行：

```bash
bash scripts/init.sh              # 安装依赖 + 初始化数据库 + 写入演示数据
bash scripts/init.sh --skip-seed  # 只安装依赖 / 建表，不写演示数据
bash scripts/init.sh --help       # 查看参数
```

| 参数 | 作用 |
|---|---|
| `--skip-seed` | 跳过 `db:seed`，不会重置业务数据；适合升级已有环境 |
| `-h` / `--help` | 显示帮助 |

脚本做的事：

- 校验 Node.js >= 22、pnpm 是否可用
- 执行 `pnpm install`
- 缺少 `apps/api/.env` 时从 `.env.example` 复制
- 检查 3308 是否已监听；没有则 `docker compose up -d mysql` 并等待就绪
- `pnpm db:push` 同步表结构
- 默认执行 `pnpm db:seed` 写入演示数据

> **注意**：`db:seed` 会清空业务数据并重建演示项目，账号会保留，但**项目授权会随项目一起清空**（项目 id 会重新生成）。
> 已有真实数据的环境请使用 `--skip-seed`，或只执行 `pnpm db:push`。

## 配置项

配置文件位于 `apps/api/.env`（已加入 `.gitignore`），模板见 [`apps/api/.env.example`](apps/api/.env.example)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `mysql://root:mplan@127.0.0.1:3308/mplan` | MySQL 连接串 |
| `PORT` | `8787` | API 端口 |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | 允许发起写请求的前端 Origin，逗号分隔 |
| `SESSION_DAYS` | `7` | 登录会话有效期（天） |
| `COOKIE_SECURE` | `0` | 走 HTTPS 时设为 `1`，会话 Cookie 带 `Secure` |
| `MPLAN_SEED_USER` | `admin` | `db:seed` 创建默认管理员的用户名 |
| `MPLAN_SEED_PASSWORD` | `mplan123` | 默认管理员密码（仅 `users` 表为空时生效） |
| `MPLAN_SEED_NAME` | `管理员` | 默认管理员显示名称 |

修改端口时，要同步修改 `docker-compose.yml` 和 `apps/api/.env`。

## 使用说明

### 权限模型

| 身份 | 只读浏览 | 编辑项目 | 人员 / 日历 / 项目增删 | 账号管理 |
|---|---|---|---|---|
| 未登录 | ✅ 全部项目 | ❌ | ❌ | ❌ |
| 成员 `member` | ✅ 全部项目 | ✅ 仅被分配的项目 | ❌ | ❌ |
| 管理员 `admin` | ✅ 全部项目 | ✅ 全部项目 | ✅ | ✅ |

- 登录 / 退出：右上角「登录」或头像菜单
- 分配项目：头像菜单 →「用户管理」→ 添加成员时勾选项目，或点成员行下方的项目数随时调整
- 不选项目 = 可以登录、可以看全部项目，但全部只读
- 详细说明见 [docs/AUTH.md](docs/AUTH.md)

### CSV 导入 / 导出

- 界面顶部项目菜单 →「导出当前项目 CSV」 / 「导入 CSV 模板」
- WBS 编号：`1` 是一级，`1.2` 是它的子级，最多 4 段
- 根目录 [`项目模板-v2.csv`](项目模板-v2.csv) 是当前生效的模板；`项目模板-v3-上级名称.csv` 是已废弃的备选
- 导入前会预览并校验：编号格式、层级、重复、负责人是否存在、日期格式等
- 日期列支持 `YYYY-MM-DD`、`YYYY/M/D`、`YYYY.MM.DD`（Excel 默认显示也能直接用），导入后会统一成 `YYYY-MM-DD`
- 报错行号是 CSV 的物理行号，不会因为中间有空行而偏移

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm bootstrap` | 首次初始化：依赖 + env + MySQL + 建表 + 演示数据 |
| `pnpm release` | 生产发布：构建前端 → rsync → 建库建表 → 创建管理员 → 重启服务 |
| `pnpm setup` | `db:up → db:push → db:seed`（不安装依赖） |
| `pnpm dev` | 同时启动 API（8787）和前端（5173） |
| `pnpm dev:api` | 只启动 API（tsx watch） |
| `pnpm dev:web` | 只启动前端（Vite） |
| `pnpm db:up` | 启动 MySQL 容器 |
| `pnpm db:down` | 停止 MySQL 容器 |
| `pnpm db:push` | 按 `schema.ts` 同步表结构（drizzle-kit push，不是 migration） |
| `pnpm db:seed` | 重建演示数据（会清空业务数据，账号保留、项目授权清空） |
| `pnpm test` | 运行 `packages/core` 单测（31 个） |
| `pnpm typecheck` | 全 workspace 类型检查 |
| `pnpm --filter @mplan/web build` | 构建前端生产包到 `apps/web/dist` |
| `node scripts/shot.mjs http://localhost:5173/ out.png [脚本文件] [等待毫秒]` | CDP 截图 + 页面内脚本验收 |

## 项目结构

```text
mplan/
├─ apps/
│  ├─ api/                     # Fastify + Drizzle + MySQL
│  │  ├─ src/db/schema.ts      # 10 张表：账号 / 会话 / 项目授权 + 业务 7 张
│  │  ├─ src/db/seed.ts        # 演示数据 + 默认管理员
│  │  ├─ src/lib/auth.ts       # 密码 / 会话 / Cookie / 登录拦截 / 项目权限
│  │  ├─ src/lib/data.ts       # 行 ↔ DTO、日历加载、父节点区间重算
│  │  ├─ src/lib/log.ts        # 变更日志写入 + 操作人
│  │  ├─ src/routes.ts         # 业务 REST 接口
│  │  ├─ src/routes.auth.ts    # 登录 / 初始化 / 账号与项目分配
│  │  └─ src/index.ts          # API 入口
│  └─ web/                     # React 19 + Vite + Tailwind v4
│     ├─ src/components/       # Board / TaskDrawer / LoginModal / UsersModal…
│     ├─ src/lib/gantt.ts      # 甘特渲染模型 / 几何 / 人员视图
│     ├─ src/store.ts          # Zustand：登录态 / 项目 / 筛选 / 撤销栈
│     └─ src/api.ts            # fetch 封装 + DTO 类型
├─ packages/
│  └─ core/                    # 前后端共用纯函数
│     ├─ src/date.ts           # YYYY-MM-DD + UTC 零点日历运算
│     ├─ src/calendar.ts       # 公司日历 ⊕ 个人加班/请假 ⊕ 任务加班
│     ├─ src/schedule.ts       # 工时 ↔ 工期、进度推算
│     ├─ src/derive.ts         # 任务视角的日历拼装 + 派生
│     ├─ src/tree.ts           # 4 层树构建 / 父节点汇总
│     ├─ src/axis.ts           # 压缩工作日轴
│     ├─ src/csv.ts            # CSV 解析 / 生成 / 校验
│     └─ test/core.test.ts     # 31 个单测
├─ scripts/
│  ├─ init.sh                  # 首次初始化脚本
│  ├─ deploy.sh                # 本地发布：构建 / rsync / 远端部署
│  ├─ remote-deploy.sh         # 服务器端安装与启动
│  └─ shot.mjs                 # CDP 截图 + 页面内脚本
├─ docs/                       # 开发手册 / 权限 / 设计 / 发布说明
├─ docker-compose.yml          # MySQL 8.4，映射 3308
├─ 项目模板-v2.csv             # CSV 导入模板
└─ package.json                # workspace 根脚本
```

## 架构说明

```text
┌──────────────────────────┐
│      packages/core       │  纯函数：日期 / 日历 / 工期 / 进度 / 甘特轴 / CSV
│  (api 和 web 同时依赖)   │  无 IO，全部可单测
└───────────┬──────────────┘
     ┌──────┴──────┐
     ▼             ▼
┌──────────┐  ┌──────────┐
│ apps/api │  │ apps/web │
│ Fastify  │  │ React SPA│
│ Drizzle  │  │ Zustand  │
└────┬─────┘  └──────────┘
     ▼
  MySQL 8.4
```

三个关键设计取舍：

1. **进度是推算值，完成是事实值**：进度 = 已过工作日 ÷ 总工作日，封顶 99%；`done_at` 只能由人写。
2. **工时和日期是同一个自由度**：`工期 = ceil(工时 / (8 × 人数))`，改哪边都重算另一边。
3. **日历是三层覆盖**：公司（节假日 / 调休）→ 人员（加班 / 请假）→ 任务（加班），优先级为 `请假 > 任务加班 > 人员加班 > 公司例外 > 周末规则`。

更详细的设计背景见 [docs/DESIGN.md](docs/DESIGN.md)。

## 测试与验收

```bash
pnpm typecheck                  # 三个包类型检查
pnpm test                       # 31 个 core 单测
pnpm --filter @mplan/web build  # 生产构建

# API 探活
curl -s localhost:8787/api/health

# 匿名写接口应返回 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/api/projects \
  -H 'content-type: application/json' -d '{"name":"x","startDate":"2026-11-05"}'
```

界面验收可以用 CDP 脚本：

```bash
node scripts/shot.mjs http://localhost:5173/ .chrome/shot.png [页面脚本] [等待毫秒]
```

演示数据正常时应看到：2 个项目、7 个人、38 个任务、2 个里程碑、5 条变更日志。

## 部署

项目自带一套发布脚本，目标环境是「服务器本地 Node + Docker nginx + 已有 MySQL 容器」，**发布过程不会写入演示数据**：

```bash
cp .deploy.env.example .deploy.env   # 填写 SSH / MySQL / 端口 / 初始管理员
chmod 600 .deploy.env
pnpm release                         # 构建前端 → rsync → 建库建表 → 创建管理员 → 重启服务
```

发布脚本会：

- 本地构建 `apps/web/dist`，同步到服务器 `/opt/mplan`
- 在服务器安装 / 复用 Node.js 22 和 pnpm
- 创建 MySQL 库并执行 `drizzle-kit push`，**不执行 `db:seed`**
- 创建初始管理员（已存在不会重置密码）
- 通过 systemd 启动 API（`127.0.0.1:8787`），通过 Docker nginx 暴露前端（默认 `8102`）
- 检查本机与公网健康状态；公网不通时提示放行阿里云安全组端口

完整说明见 [docs/DEPLOY.md](docs/DEPLOY.md)。

其他部署要点：

- **数据库**：生产可复用已有 MySQL；本地开发使用 `docker compose up -d mysql`，数据在 Docker volume `mplan_mysql`。
- **API**：生产由 `mplan-api.service` 托管；也可以 `pnpm --filter @mplan/api start` 手动启动。
- **前端**：`pnpm --filter @mplan/web build`，把 `apps/web/dist` 交给 Nginx / 静态服务器，并把 `/api` 反代到 8787。
- **HTTPS**：设置 `COOKIE_SECURE=1`，并把实际访问域名加入 `CORS_ORIGIN`。
- **表结构变更**：当前没有 migration 文件，使用 `drizzle-kit push`。生产环境建议先切到 `drizzle-kit generate + migrate`，避免删列 / 改类型丢数据。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 文档导航：按角色阅读、当前状态、维护约定 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | **开发与维护手册**：架构、数据模型、接口契约、改代码菜谱、已知问题、下一步 |
| [docs/AUTH.md](docs/AUTH.md) | 登录与权限：会话、项目授权、只读边界、用户管理、验收命令 |
| [docs/DESIGN.md](docs/DESIGN.md) | 设计取舍：自动进度、工时与日期、节假日与加班、拖拽与撤销 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 生产发布：服务器拓扑、`scripts/deploy.sh`、初始化管理员、安全组与运维 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 后续优化建议（讨论稿）：可靠性、通知、我的任务、移动端等 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

## 已知限制

- 任务依赖（FS）和自动排期未实现，顺延是手工触发的
- 授权到项目级，不细分到具体任务 / 负责人
- 没有移动端布局、没有甘特虚拟滚动
- 没有登录审计、SSO、找回密码
- 2027 年节假日数据待国务院发文后补充
- 没有 migration 文件，`db:push` 可能丢数据，生产环境需谨慎

更多技术债和后续优先级见 [docs/DEVELOPMENT.md §9–§10](docs/DEVELOPMENT.md)。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。