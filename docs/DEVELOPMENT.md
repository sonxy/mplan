# mplan 开发与维护手册

> 最后更新：2026-11-09
> 面向：项目维护和自托管部署
> 配套阅读：[README.md](../README.md)（怎么跑）、[AUTH.md](AUTH.md)（登录与项目权限）、[DEPLOY.md](DEPLOY.md)（怎么部署）、[DESIGN.md](DESIGN.md)（为什么这么设计）、[ROADMAP.md](ROADMAP.md)（下一步讨论）

---

## 0. 一页纸现状

一个「精简版 OmniPlan」：4 层任务树 + 压缩工作日甘特图 + 按时间推算进度，面向 10 人以内的小团队自托管。**能跑、能演示、核心链路有测试，也有登录与只读权限。**

| 维度 | 现状 |
|---|---|
| 版本 / 状态 | `0.1.0` / 个人项目（已公开，未附许可证） |
| 代码量 | 约 1 万行 TS/TSX（不含依赖） |
| 技术栈 | React 19 + Vite 7 / Fastify 5 + Drizzle + MySQL 8.4 / Tailwind v4 / Zustand |
| 接口 | 33 个 REST 端点；读接口公开，写接口需登录（8 个登录/账号接口 + 3 个项目成员接口 + 2 个项目归档接口 + 1 个批量日期接口 + 1 个项目重新初始化接口） |
| 数据表 | 10 张（`users` / `sessions` / `project_members` + 业务 7 张） |
| 测试 | 41 个单测（只覆盖 `packages/core`）+ CDP 截图脚本 + 可选 CI 配置 |
| 部署 | 本地 Docker Compose；自托管 systemd + Docker nginx（见 [DEPLOY.md](DEPLOY.md)） |
| 版本控制 | ✅ Git 仓库（`.github/workflows/ci.yml` 可选启用） |

### 已完成

| 需求 | 状态 | 备注 |
|---|---|---|
| 匿名只读 / 按项目授权编辑 | ✅ | 写接口先过 `attachAuth()` 登录拦截，再按项目 `requireProjectAccess()`；匿名写 401、越权写 403 |
| 登录 / 退出 / 首次初始化 | ✅ | HttpOnly 会话 Cookie，密码 scrypt 哈希，登录按 IP 限流 |
| 用户管理 | ✅ | 全局管理员增删账号、改角色、停用、重置密码、分配项目与项目管理员；变更日志自动署名 |
| 项目管理员 | ✅ | 按项目指定；可改项目信息、管理普通成员、编辑项目内任务；不能创建账号或管全局人员/日历 |
| 项目设置 / 归档 | ✅ | 项目管理员可改名称/编号/日期/备注、管理成员、归档与恢复；归档后不再出现在项目列表里 |
| 最多 4 层：模块 → 一级 → 二级 → 细分 | ✅ | 服务端强制 `MAX_DEPTH = 4` |
| 起止时间 / 人员 / 工时 / 完成状态 | ✅ | |
| 8h/天，工时自动算结束时间 | ✅ | 双向联动，改哪边都重算 |
| 日历排除周末 / 法定节假日 / 调休 | ✅ | 内置 2026 国务院安排，可在线编辑 |
| 甘特图显示人员 | ✅ | 配色 + 头像 + 姓名 |
| 人员维度视图 | ✅ | 顶部「项目 / 人员」切换，含超载提示 |
| 条上快捷完成 | ✅ | 悬浮圆形按钮 |
| 条拖拽改期 + 边缘自动滚动 | ✅ | 平移保留工时，拉边重算工时 |
| 日视图列宽 | ✅ | 1× / 2× / 3×（30 / 60 / 90px 每天）；仅日视图显示控件，刷新恢复 1× |
| 晨会聚焦 | ✅ | 当前项目 + 最近 3 个工作日；前天/昨天完成、今天计划、今天到期、逾期、未分配；非焦点任务淡化 |
| 加班占用节假日 | ✅ | 人员级 + 任务级，插入黄色加班列 |
| 撤销 / 重做 | ✅ | `⌘Z` / `⌘⇧Z`，覆盖拖拽、日期输入、工时修改与整批联动 |
| 改期联动 | ✅ | 同负责人 / 同父级分支、开始日更晚的未完成任务按工作日 delta 平移；默认开启，可关；拖拽有 ghost 预览 |
| 筛选 / 搜索 | ✅ | 名称、负责人、状态；人员筛选只列当前项目有任务的负责人；保留祖先上下文 |
| CSV 模板导入 / 导出 | ✅ | WBS 编号制，往返闭环 |
| 里程碑 | ✅ | 零工期菱形节点 |
| 变更日志 | ✅ | 五类动作 + 前后值 + 署名 |
| 逾期整体顺延 | ✅ | 按公司日历统一偏移 |
| 生产发布 | ✅ | `scripts/deploy.sh` + systemd `mplan-api` + Docker nginx `mplan-web`；不写演示数据 |
| 初始管理员 | ✅ | `scripts/remote-deploy.sh` 调 `admin:create`，重复发布不会重置密码 |

### 明确没做

任务依赖（FS）、移动端、跨项目晨会、更细粒度的权限（任务/负责人级）、SSO、找回密码、登录审计、甘特虚拟滚动、导出跟随筛选、2027 节假日数据、甘特截图导出；生产运维方面的 HTTPS、自动备份、发布回滚、API/UI 自动化测试也还没做。

---

## 1. 五分钟跑起来

### 前置

| 工具 | 本机版本 | 说明 |
|---|---|---|
| Node | v26.7.0 | 需要 ≥ 22（用了全局 WebSocket，`scripts/shot.mjs` 依赖它） |
| pnpm | 11.22.0 | workspace 必须用 pnpm |
| Docker / OrbStack | 29.8.2 | 只用来跑 MySQL |

### 命令

```bash
pnpm install          # registry 已固定到 npmmirror（见 .npmrc）
pnpm db:up            # 起 MySQL 容器，映射到 3308
pnpm db:push          # 按 schema 建表（drizzle-kit push，不是 migration）
pnpm db:seed          # 灌演示数据（重建业务数据，账号保留，项目授权清空）
pnpm dev              # 同时起 api(8787) + web(5173)
```

也可以一条命令完成「依赖 + env + MySQL + 建表 + 演示数据」：

```bash
pnpm bootstrap        # 等价于 bash scripts/init.sh；加 --skip-seed 可跳过演示数据
```

生产发布不走 `bootstrap`，使用：

```bash
pnpm release            # 构建 + rsync + 建表 + 创建管理员 + 重启服务（不执行 db:seed）
```

生产环境没有演示数据；初始管理员由发布脚本创建，密码只存在本机 `.deploy.env`。

### 端口与凭据

| 服务 | 地址 | 凭据 |
|---|---|---|
| Web | http://localhost:5173 | 未登录只读；默认账号 `admin / mplan123` |
| API | http://localhost:8787 | 读接口匿名；写接口需会话 Cookie |
| MySQL | 127.0.0.1:**3308** | `root / mplan`，库 `mplan` |

> 3308 是故意避开本机已有 MySQL 的 3307。改端口要同步改 `docker-compose.yml` 和 `apps/api/.env`。

### 起完先验这几条

```bash
curl -s localhost:8787/api/health                  # {"ok":true,"today":"..."}
curl -s localhost:8787/api/bootstrap | grep auth   # auth.canEdit = false（匿名只读）
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/api/projects \
  -H 'content-type: application/json' -d '{"name":"x","startDate":"2026-11-05"}'   # 401
pnpm typecheck                                     # 三个包全绿
pnpm test                                          # 31 passed
pnpm --filter @mplan/web build                     # 构建通过
```

打开页面应看到「企业官网 3.0 改版」、38 个任务、2 个里程碑、一个紫色菱形在 11-20；右上角显示「只读 + 登录」。点登录用 `admin / mplan123` 进入可编辑态。

---

## 2. 架构

```
                 ┌──────────────────────────┐
                 │      packages/core       │  纯函数：日期 / 日历 / 工期 / 进度 / 甘特轴 / CSV
                 │  (被 api 和 web 同时依赖)  │  没有任何 IO，全部可单测
                 └───────────┬──────────────┘
                    ┌────────┴────────┐
                    ▼                 ▼
            ┌──────────────┐   ┌──────────────┐
            │   apps/api   │   │   apps/web   │
            │  Fastify     │   │  React SPA   │
            │  Drizzle     │   │  Zustand     │
            └──────┬───────┘   └──────────────┘
                   ▼
              MySQL 8.4
```

**为什么把 core 拆出来**：工期、进度、工作日历这三件事前端要即时算（拖拽预览、进度条），后端要权威地算（落库、顺延）。只要有两份实现就一定会漂移。所以全部收进 core，前端算完直接调接口，后端用同一份函数复核。

### 目录地图

```
mplan/
├─ packages/core/src/
│  ├─ date.ts          # YYYY-MM-DD 字符串 + UTC 零点纯日历运算（不存时间戳）
│  ├─ calendar.ts      # 公司日历 ⊕ 个人加班/请假 ⊕ 任务加班，含优先级
│  ├─ schedule.ts      # 工时↔工期、进度推算、里程碑分支
│  ├─ derive.ts        # 任务视角的日历拼装 + 派生（这是最常被调用的入口）
│  ├─ tree.ts          # 4 层树构建、按 sort 排序、父节点汇总
│  ├─ axis.ts          # 压缩工作日轴、今天定位
│  ├─ palette.ts       # 10 色调色板
│  ├─ holidays-cn.ts   # 2026 法定节假日 + 调休（国办发明电〔2025〕7 号）
│  └─ csv.ts           # CSV 解析/生成、WBS 编号规则、导入校验
├─ apps/api/src/
│  ├─ db/schema.ts     # 10 张表（业务 7 张 + users / sessions / project_members）
│  ├─ db/seed.ts       # 演示数据 + 默认管理员（2 个项目 / 7 人 / 38 任务 / 5 条日志）
│  ├─ lib/auth.ts      # 密码哈希、会话、Cookie、登录限流、登录拦截、项目权限判断
│  ├─ lib/data.ts      # 行↔DTO 转换、日历加载、父节点区间重算、级联删除
│  ├─ lib/log.ts       # 变更日志写入 + 操作人（取登录用户）
│  ├─ routes.ts        # 业务 18 个路由（另有 auth 8 个）
│  └─ routes.auth.ts   # 登录 / 初始化 / 账号管理与项目分配 8 个路由
├─ apps/web/src/
│  ├─ store.ts         # Zustand：bootstrap/projectDetail/筛选/折叠/缩放/撤销栈
│  ├─ api.ts           # fetch 封装 + 所有 DTO 类型
│  ├─ lib/gantt.ts     # buildBoard（核心渲染模型）、几何、人员视图、超载估算
│  ├─ components/
│  │  ├─ Board.tsx     # 左树右轴 + 拖拽 + 里程碑菱形（最复杂，972 行）
│  │  ├─ TaskDrawer.tsx# 任务详情 + 顺延弹窗 + 里程碑开关
│  │  ├─ LoginModal.tsx / UsersModal.tsx  # 登录、首次初始化、用户管理与项目分配
│  │  ├─ FilterBar.tsx / TopBar.tsx
│  │  └─ PeopleModal / CalendarModal / ImportModal / ChangesModal / ui.tsx
├─ scripts/init.sh     # 首次初始化：依赖 / env / MySQL / db:push / db:seed
└─ scripts/shot.mjs    # CDP 截图 + 页面内脚本执行（验收全靠它）
```

---

## 3. 四个必须知道的设计决策

细节在 [DESIGN.md](DESIGN.md)，这里只给结论。

**① 进度是推算值，完成是事实值。** 进度 = 已过工作日 ÷ 总工作日，封顶 99%，库里**不存** progress；`done_at` 只能由人写。所以「10 天任务到第 5 天 = 50%」，但第 10 天不会自动 100%，而是变「逾期」。

**② 工时和日期是同一个自由度。** `工期 = ceil(工时 / (8 × 人数))`。改工时重排结束日，改结束日反算工时。拖拽平移必须走 `recalc: 'none'`，否则 20h 的任务会被 round 成 24h。

**③ 日历是三层覆盖，不是一个周末数组。** 公司（节假日/调休）→ 人员（加班/请假）→ 任务（加班）。优先级：`请假 > 任务加班 > 人员加班 > 公司例外 > 周末规则`。"请假最高"是刻意的：人不在，任务不该算推进。

**④ 权限分三层：匿名只读 / 成员按项目 / 管理员全局。** 只读是默认态，不需要登录；成员登录后只获得被分配项目的编辑权，管理员拥有全部项目。全局资源（人员、日历、项目增删、账号）只给管理员。判断只做在服务端写接口上，前端 `canEdit`（当前项目）和 `canEditGlobal`（管理员）只负责隐藏入口。授权只到项目级，不细分到任务/负责人，见 §9。

---

## 4. 数据模型

10 张表，MySQL，日期一律 `DATE` 类型（Drizzle `mode: 'string'`，进出都是 `YYYY-MM-DD`）。

| 表 | 作用 | 关键点 |
|---|---|---|
| `users` | 登录账号 | `username` 唯一；`password_hash` 为 `scrypt$salt$hash`，绝不下发 |
| `sessions` | 登录会话 | 只存 `sha256(token)`；有 `expires_at`，登录时顺手清过期 |
| `project_members` | 账号 ↔ 可管理项目 | `UNIQUE(user_id, project_id)`；`role: admin\|member`；全局管理员不进表 |
| `projects` | 项目 | `code` 唯一；`sort` 控制下拉顺序；`archived_at` 非空表示已归档（默认不返回） |
| `persons` | 人员 | `color` 是调色板 key，不是色值 |
| `calendar_settings` | 单例（id=1） | `weekend` 存 `"0,6"` 字符串 |
| `calendar_exceptions` | 公司级例外 | `date` 唯一；`type: holiday\|workday` |
| `tasks` | 任务 | `depth ≤ 4`、`kind: task\|milestone`、`parent_id + sort` |
| `day_overrides` | 个人/任务级例外 | `UNIQUE(scope, scope_id, date)`，只存与公司日历不一致的天 |
| `change_log` | 变更日志 | 任务名冗余存储，删了任务日志也还在 |

**迁移方式**：没有 migration 文件，改完 `schema.ts` 直接 `pnpm db:push`。drizzle-kit 会尽力做增量变更，但**删列/改类型可能丢数据**——开发期直接 `pnpm db:seed` 重建即可。

> 注意：`db:seed` 会清空业务数据并重建演示项目，账号会保留，但**项目授权会随项目一起清空**（项目 id 是重新生成的）；`users` 表为空时才创建默认管理员（可用 `MPLAN_SEED_USER` / `MPLAN_SEED_PASSWORD` / `MPLAN_SEED_NAME` 覆盖）。

> 从旧版本升级时，已有的 `member` 账号没有 `project_members` 记录，登录后会变成「只读」，需要管理员在「用户管理」里分配项目。

**项目归档**：`projects.archived_at` 非空即归档。`listProjects()` 默认过滤归档项目；`/api/bootstrap` 的 `archivedProjects` 只返回当前用户能管理的归档项目（全局管理员全部、项目管理员只看自己管理的）。归档项目的详情 / 变更日志对其他人按 404 返回，任务、成员和日志本身不删除；归档只隐藏入口，不锁数据，恢复后原样可见。

**父节点区间**：任何写操作后调 `recomputeParentRanges()`，自下而上把父节点的 `start_date/due_date` 重算成子节点的 min/max。父节点的 `estimate_hours` 永远是 0，展示时按子节点汇总（`rollupHours`）。

---

## 5. API 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 探活 + 服务器当天 |
| GET | `/api/auth/me` | 当前用户 + `needsSetup` |
| POST | `/api/auth/setup` | 仅 0 账号时创建首个管理员并登录 |
| POST | `/api/auth/login` | 登录，下发 HttpOnly 会话 Cookie |
| POST | `/api/auth/logout` | 删除会话 + 清 Cookie |
| GET/POST/PATCH/DELETE | `/api/auth/users` `/api/auth/users/:id` | 账号管理 + `projectIds` / `projectAdminIds`（仅全局管理员） |
| GET | `/api/bootstrap` | 未归档项目 + 当前用户可见的归档项目 / 人员 / 日历 / 个人例外 / today / auth（首屏一次性拿全） |
| GET | `/api/projects/:id` | 项目 + 任务 + 任务级例外 + 个人例外 |
| POST / DELETE | `/api/projects` `/api/projects/:id` | 项目新建 / 删除（仅全局管理员，删会级联任务） |
| PATCH | `/api/projects/:id` | 项目信息修改（全局管理员或项目管理员） |
| POST | `/api/projects/:id/archive` | 归档项目（项目管理员）：从项目列表隐藏，数据保留 |
| POST | `/api/projects/:id/unarchive` | 恢复归档项目（项目管理员） |
| GET | `/api/projects/:id/members` | 项目成员 + 可添加候选（项目管理员） |
| POST / DELETE | `/api/projects/:id/members` `/api/projects/:id/members/:userId` | 添加 / 移除普通成员（项目管理员） |
| POST / PATCH / DELETE | `/api/persons` `/api/persons/:id` | 人员增改删（删会把人从任务上摘掉） |
| PUT | `/api/persons/:id/days` | 整表替换某人的加班/请假 |
| PUT | `/api/calendar` | 整表替换周末 + 例外 |
| POST | `/api/projects/:id/tasks` | 建任务（自动算 depth/sort/结束日） |
| PATCH | `/api/tasks/:id` | 改任意字段，按 `recalc` 决定怎么重算；`shiftFollowing` 打开时联动后续任务 |
| PUT | `/api/projects/:id/task-dates` | 批量恢复日期（撤销 / 重做用），只写日期与工时，不触发联动 |
| DELETE | `/api/tasks/:id` | 级联删子树 |
| PUT | `/api/tasks/:id/days` | 任务级加班日 |
| POST | `/api/tasks/:id/postpone` | 该任务及其后未完成任务整体顺延 |
| POST | `/api/import` | CSV 导入（按编号建树，可顺手新建项目） |
| POST | `/api/projects/:id/reinitialize` | 重新初始化项目（项目管理员）：删旧任务/旧日志，按 CSV 重建，可更新项目完成日 |
| GET | `/api/projects/:id/changes` | 变更日志，默认 120 条（前端请求 200） |

**重新初始化**（`POST /api/projects/:id/reinitialize`）用于排计划初期整版覆盖：保留项目信息、成员、权限和人员库；删除当前项目全部任务、任务级加班/请假和旧变更日志；按 CSV 重建任务树，任务 ID 全部重新生成。服务端先完整校验并在一个事务里删旧 + 插新，失败不会破坏旧计划；`updateProjectDue: true` 时把项目计划完成日更新为新任务的最晚结束日，否则保留原值。前端只对项目管理员显示该模式，并要求勾选删除确认。

**导入工时优先级**：CSV「工时」单元格非空（请求里的 `hoursProvided`）时按工时排期，`1h` 保持 `1h`；结束日只做一致性校验，不一致时返回 `warnings`，不会静默反算成 `8h`。只有工时留空时才用结束日反算工时。追加导入和重新初始化共用这套规则。

### 三个必须遵守的约定

**`PATCH /api/tasks/:id` 的 `recalc`**

```ts
recalc: 'none'   // 严格写入传入的 start/due/hours（拖拽平移用，保住非 8 倍数的工时）
recalc: 'due'    // 按结束日反算工时
recalc: 'hours'  // 按工时重排结束日（默认）
```

不传时：带 `dueDate` 走 `due`，否则走 `hours`。父任务（有子节点）的日期不参与重算。

`shiftFollowing: true` 时，日期 / 工时变化会触发改期联动：同负责人或同父级分支下、开始日严格晚于原结束日的未完成叶子任务，按公司日历 delta 平移；主任务和联动任务在同一个事务里更新，响应带 `autoShift` / `shiftedTaskIds`。撤销 / 重做走 `PUT /api/projects/:id/task-dates`，只写快照、不触发联动。

**权限约定（两层）**：

1. **登录**：`GET / HEAD` 全部公开；`POST / PUT / PATCH / DELETE` 除 `/api/auth/login`、`/api/auth/setup`、`/api/auth/logout` 外都要求登录。由 `attachAuth()` 统一做，新增写路由不需要单独写 401。
2. **资源**：登录之后还要判断能不能改这个资源。
   - 任务 / 任务加班日 / 顺延 / 批量日期恢复 / 导入到已有项目：`requireProjectAccess(req, projectId)` —— 全局管理员或 `projectIds` 包含该项目；
   - 项目信息修改、项目成员管理：`requireProjectAdmin(req, projectId)` —— 全局管理员或 `projectAdminIds` 包含该项目；
   - 项目增删、人员增删改、公司日历、导入时新建项目、账号管理：`requireAdmin(req)`。

`GET /api/auth/users` 返回的每个账号带 `projectIds` / `projectAdminIds`；`POST/PATCH` 接受这两个数组（整表替换，项目管理员必须是项目成员的子集）。项目管理员身份只能由全局管理员在用户管理里指定。

**变更日志的 actor**：来自会话里的登录用户（`req.currentUser.displayName`），前端无法伪造；旧的 `x-mplan-actor` 头已经不再读取。

---

## 6. 前端要点

### 状态（Zustand，单 store）

`boot`（全局）、`detail`（当前项目全量任务）、`user` / `canEdit`（当前项目）/ `canAdminCurrent`（当前项目管理员）/ `canEditGlobal`（全局管理员）/ `isAdmin` / `needsSetup`（登录与权限）、`collapsed`、`zoom`、`dayWidthScale`（日视图 1× / 2× / 3×）、`view`、`standupMode`（晨会聚焦）、`filter`、`selectedId`、`modal`（含 `login` / `users` / `projectSettings`）、`autoShift`（联动开关，localStorage 持久化）、`history/future`（批量撤销栈）、`toast`。

所有写操作统一走 store 的 action（`patchTask` / `addTask` / `commitDates` / `removeTask`…），内部都是「调接口 → `refreshProject()` 重拉」。**没有做乐观更新**，本地延迟极低，简单优先。

**登录态**：`init()` / `refreshAll()` / `openProject()` 从 `bootstrap.auth` 和当前项目 id 计算：

```ts
canEditCurrent  = user.role === 'admin' || user.projectIds.includes(projectId)       // 任务/甘特/导入
canAdminCurrent = user.role === 'admin' || user.projectAdminIds.includes(projectId)  // 项目设置/成员
canEditGlobal   = user.role === 'admin'                                              // 人员/日历/新建项目
```

`api.ts` 里的 401 处理器会弹登录框。所有写 action 开头都有 `requireEdit(get)` 兜底：未登录时提示并打开登录弹窗，已登录但没分到项目时提示联系管理员，都不发请求。只读 UI 的入口在 `TopBar`（只读徽标 + 登录按钮 / 账号菜单），各编辑组件按对应开关隐藏或禁用控件；`PeopleModal` / `CalendarModal` 用 `canEditGlobal`，其余用 `canEdit`。

### 筛选 / 人员列表

`FilterBar` 的人员头像来自 `boot.persons ∩ 当前项目任务的 ownerId`，不是全量人员。切换项目后，如果之前选中的人在新项目里没有任务，会自动从 `filter.persons` 移除，避免筛选出空列表。

### 渲染管线

```
detail.tasks ──buildTree──▶ 树 ──筛选/折叠──▶ flat ──▶ BoardRow[]
                                                      ├─ derived（进度/状态/逾期）
                                                      ├─ color / owner
                                                      └─ dimmed（筛选时的上下文行）
```

`Board.tsx` 左右两栏不是两个滚动容器，而是**一个滚动容器 + 左侧 `position: sticky`**。所有行高固定常量：

```ts
ROW_HEIGHT = 40  HEADER_HEIGHT = 58  LEFT_WIDTH = 392
ZOOM_WIDTH = { day: 30, week: 15, month: 8 }
colWidth = ZOOM_WIDTH[zoom] * (zoom === 'day' ? dayWidthScale : 1)
```

`dayWidthScale` 只作用于日视图；周/月视图保持原列宽，宽度控件也只会在日视图出现。刷新页面不持久化，恢复 1×。

改这些常量时，左表头、行高、筛选栏、filler 行（把网格铺满视口的那块）要一起对齐。

### 晨会聚焦

顶部 `FilterBar` 右侧的「晨会」按钮会切到 `standupMode`，用同高度（42px）的 `StandupBar` 替换筛选栏，因此不压缩甘特图高度。

- `buildStandup(detail, company)` 用 `recentWorkdays(today, cal, 3)` 算最近 3 个工作日；今天是非工作日时锚定最近一个工作日
- 统计只取叶子任务/里程碑，父任务只作为上下文
- 完成按 `doneAt` 的本地日期归到对应工作日
- 焦点集合 = 窗口内完成任务 + 今天进行中/开始/到期未完成 + 全部逾期；同时加入祖先，避免树上断层
- 非焦点行用 `opacity-30` 淡化，仍可点击、拖拽、打开抽屉；操作全部沿用甘特图
- 进入晨会会清空现有筛选并强制展开所有节点；退出恢复用户的折叠状态
- 只做当前项目；跨项目晨会需要另加聚合接口（见 ROADMAP）

### 拖拽

`pointermove` / `pointerup` 挂在 `window` 上（不用 pointer capture，因为拖动中组件会重渲染）。位移必须用**内容坐标**换算：

```ts
timelineX = clientX - rect.left - LEFT_WIDTH + scroller.scrollLeft
cols      = round((timelineX - startTimelineX) / colWidth)
```

只用 `clientX - startX` 的话，边缘自动滚动时任务条会滞后于指针。

### 大项目渲染（300 任务级）

拖拽期间只允许被拖任务和 ghost 任务重渲染，别把整张表带进去：

- `BoardTaskRow` / `Bar` / `TaskCell` 都用 `memo`；传给它们的选择、完成、拖拽回调必须是**稳定引用**（`useCallback` 或 ref 转发），否则 memo 会被内联函数打破；
- `previewStart` / `previewDue` / `ghost` / `dragging` 都传原始值，不要传每次新建的 `{ start, due }` 对象；
- 网格、月份分隔线、加班列只有一层覆盖层，不要每行重复画；
- 拖拽更新用 `requestAnimationFrame` 合并，一帧最多一次 `setDrag`；
- 自动滚动的视口 `rect` 在拖拽开始时缓存，不要在每帧 `getBoundingClientRect()`；
- 拖拽期间给 Board 加 `is-dragging`，CSS 临时关掉非拖拽条的阴影和行过渡（Safari 对大量 `box-shadow` / `transition` 更敏感）。

本地 300 任务项目实测：拖拽一个任务时只有 23/310 行产生 DOM 变更（主任务 + 22 个 ghost），而不是整表重渲染。

### 弹窗

`ui.tsx` 的 `Modal` 用 `createPortal` 挂到 `body`。**必须这样**：任务抽屉有 `transform` 动画，会成为 `fixed` 的包含块，弹窗会被困在抽屉里。

---

## 7. 改代码的菜谱

### A. 加一个任务字段

1. `apps/api/src/db/schema.ts` 加列 → `pnpm db:push` → `pnpm db:seed`
2. `apps/api/src/lib/data.ts` 的 `toTask()` 映射
3. `packages/core/src/tree.ts` 的 `Task` 接口加字段
4. `apps/api/src/routes.ts` 的 `PATCH` zod schema + update 语句（需要日志就加一条 `push(...)`）
5. `apps/web/src/components/TaskDrawer.tsx` 加输入控件

### B. 加一个接口

`routes.ts` 里加 `app.xxx()`，用 `parse(zodSchema, req.body)` 校验、`httpError(msg, code)` 抛业务错误。前端在 `api.ts` 加方法 + DTO 类型，store 里包一层 action 并 `refreshProject()`。

写路由（POST/PUT/PATCH/DELETE）会被 `attachAuth()` 自动要求登录，**不要**在路由里再写一遍 401 判断。登录之后按资源再判一次：

- 属于某个项目的写操作 → `requireProjectAccess(req, projectId)`（任务、任务加班日、顺延、导入到已有项目都是这样）；
- 全局资源 → `requireAdmin(req)`（项目增删改、人员、公司日历、导入时新建项目、账号管理）。

读路由保持匿名可访问。前端用 `canEdit`（当前项目）和 `canEditGlobal`（管理员）控制入口，不要混用。

### C. 改 CSV 模板

**三处必须同步**，否则下载的模板和解析器对不上：

1. `packages/core/src/csv.ts` 的 `CSV_HEADERS` / `parseProjectCsv` / `buildProjectCsv`
2. `apps/web/src/components/ImportModal.tsx` 顶部的 `TEMPLATE_CSV`
3. 根目录的 `项目模板-v2.csv`（对外交付物）+ 文档

改完跑一次「导出 → 导入 → 比对」的往返验证（见 §8）。

### D. 加一种变更日志动作

1. `schema.ts` 的 `change_log.action` enum 加值 → `db:push`
2. `lib/log.ts` 的 `LogAction` 类型
3. `routes.ts` 对应位置调 `writeLog([...], actorOf(req))`（`actorOf` 取当前登录用户）
4. `apps/web/src/components/ChangesModal.tsx` 的 `ACTION_LABEL` / `ACTION_STYLE`

---

## 8. 验证方法

### 单测（只覆盖 core）

```bash
pnpm test   # 41 个，覆盖 2026 节假日/调休、工期换算、进度封顶、加班、改期联动、项目超期、CSV 编号/日期/行号校验、最近工作日
```

日历和工期是最容易算错的地方，改 `calendar.ts` / `schedule.ts` / `csv.ts` 必须补用例。注意 2026-10-10 是周六但属于调休补班日——这类坑只能靠测试兜住。

CSV 解析现在有两个容易回归的点：日期兼容 `YYYY/M/D`、`YYYY.MM.DD`（Excel 常见格式），以及报错行号必须是物理行号（空行不能导致偏移）。两处都有单测。

### 登录与权限

```bash
# 匿名只读
curl -s localhost:8787/api/bootstrap | grep -o '"canEdit":[a-z]*'      # false

# 匿名写 → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/api/projects \
  -H 'content-type: application/json' -d '{"name":"x","startDate":"2026-11-05"}'

# 登录并保存 Cookie
curl -c /tmp/mplan.txt -X POST localhost:8787/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"mplan123"}'

# 登录后写 → 201，并在变更日志里看到 actor = 管理员
curl -b /tmp/mplan.txt -X POST localhost:8787/api/projects \
  -H 'content-type: application/json' -d '{"name":"登录测试","code":"AUTH1","startDate":"2026-11-05"}'
```

UI 验收：

1. 无痕窗口打开首页 → 右上角「只读」、没有新建任务 / 里程碑、拖拽无效但点击能开抽屉；
2. 点登录输入 `admin / mplan123` → 写入口出现、拖拽生效；头像菜单 → 用户管理，可新增成员、勾选可管理项目、停用 / 重置密码；
3. 新建一个只勾选「企业官网 3.0 改版」的成员，用它登录 → 该项目可编辑；切到「数据看板 1.0」→ 右上角「只读」、任务抽屉只读；
4. 用成员账号打开人员 / 日历 → 只读（全局设置仅管理员）；直接 `curl` 越权项目 → 403。

注意「重置自己的密码」会强制下线一次，属预期。

### CDP 截图 + 页面内脚本

```bash
node scripts/shot.mjs http://localhost:5173/ out.png [脚本文件] [等待毫秒]
```

脚本在页面里执行（可以用 `await`、可以 `fetch` 同源接口、可以返回 JSON 打印出来）。举例：

```js
// 点开任务抽屉并改日期
const span = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === '产品文案');
span.click();
await new Promise((r) => setTimeout(r, 600));
return document.querySelector('aside')?.innerText.slice(0, 80);
```

这是本项目验收的主要手段：查 UI、点按钮、读接口、截图，一条命令。`scripts/shot.mjs` 会用 `.chrome/` 下的临时 profile（已 gitignore）。

### 端到端往返（改 CSV / 导入导出后必跑）

团建做法：界面里点「导出」→ 拦截 `URL.createObjectURL` 抓到 CSV 文本 → 原样灌回导入弹窗（新建项目）→ 拉两个项目逐字段比对。之前就是靠这个抓到了「父节点工时被算成 工期×8」的 bug。

---

## 9. 已知问题与技术债

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | 读接口无鉴权 | 能访问到服务的人可以看全部项目数据；这是「匿名只读」的有意设计 | 自托管可接受；面向公网再加一层网关认证 |
| 2 | 登录 / 失败 / 下线没有审计日志 | 只能看业务变更，查不到谁在什么时候登录过 | 需要时加 `auth_log` 表；actor 本身已来自会话 |
| 3 | 跨项目 / 跨模块依赖未建模 | 不同项目的关联任务不会自动联动，只能手工调整 | 需要时再加显式「关联任务」，不要靠时间顺序猜 |
| 4 | 无 migration 文件，`db:push` 直连 | 改 schema 可能丢数据 | 上线前切到 `drizzle-kit generate` + migrate |
| 5 | 2027 年节假日未内置 | 2027 年的任务会把节假日算成工作日 | 国务院发文后补 `holidays-cn.ts` |
| 6 | 人员超载是近似估算 | 按「工时 ÷ 工期」均摊到每天，不考虑任务依赖和半天粒度 | 够用就别动 |
| 7 | 导出不跟随筛选 | 想导出"只看某个人的任务"做不到 | 一行改动：用筛选后的 id 集合 |
| 8 | 甘特无虚拟滚动 | 40 行流畅，几百行会卡 | 行数上千再优化 |
| 9 | 无响应式，移动端不可用 | 手机上布局会挤 | 做只读视图即可 |
| 10 | 改期联动是启发式规则 | 同负责人 / 同父级分支之外的依赖不会自动推；开始日不晚于原结束日的任务按并行处理 | 需要精确关系时加显式关联，见 §10 |
| 11 | `done_at` 存的是 UTC 时间但只当布尔用 | 现在没影响，展示完成时间时会差 8 小时 | 要展示时统一转 +08:00 |
| 12 | 登录失败计数在内存里 | 重启 API 会清零；多实例不共享 | 单机部署无所谓；多实例换 Redis |
| 13 | 只读模式仍会拉全量数据 | 大项目匿名访问有一定流量 | 10 人规模无感 |
| 14 | 自托管默认没有 HTTPS | 需要自己配反向代理和证书 | 提供 HTTPS 后把 `COOKIE_SECURE=1` |
| 15 | 没有自动备份 / 恢复演练 | 数据库丢失无法快速恢复 | cron `mysqldump` + 保留策略，至少演练恢复一次 |
| 16 | 发布是原地覆盖、没有回滚 | 新版本出问题只能重新部署旧代码 | 改成 `releases/<timestamp>` + `current` 软链，保留最近 N 版 |
| 17 | 没有 API / UI 自动化测试 | 权限、导出、拖拽等回归靠手工/CDP | 引入 API 集成测试 + 关键页面 Playwright 用例 |
| 18 | 初始管理员密码以明文存在 `.deploy.env` | 拿到文件的人可登录管理员 | 首次登录强制改密；删除部署机上的明文密码 |
| 19 | 授权只到项目级 | 能编辑某项目就能改里面所有任务；旧成员没有分配项目时登录即只读 | 需要时按 `owner_id` 加一层校验；升级后给成员分配项目 |
| 20 | 没有自助改密 | 成员改密码只能找管理员；自己重置会强制下线 | 增加个人资料 / 改密弹窗，改密后保留当前会话 |

---

## 10. 下一步建议

按"性价比 / 风险"排序：

| 优先级 | 事项 | 说明 |
|---|---|---|
| P0 | 自托管 HTTPS | 绑域名 + TLS，`COOKIE_SECURE=1` |
| P0 | 自动备份 / 恢复演练 | 自托管数据库没有内置备份策略 |
| P0 | 可回滚发布 + migration | 当前原地覆盖、`db:push` 直连，出问题不好退 |
| P1 | 初始管理员密码生命周期 | 首次登录强制改密、自助改密、重置后强制下线提示 |
| P1 | 导出跟随筛选 | 一行改动，立刻可用 |
| P1 | 变更日志分页 / 按任务筛选 | 现在只有最近 120 条 |
| P1 | 通知 / 我的任务 | 逾期、今日到期、被分配；跨项目看个人任务 |
| P2 | 甘特截图导出（PNG） | 汇报刚需；CSV 已有 |
| P2 | 移动端只读甘特 | 只读比编辑简单得多 |
| P2 | 2027 节假日 | 等国务院发文 |
| P2 | 更细粒度权限 | 现在到项目级；要「只能改自己负责的任务」需在写接口按 owner 校验 |
| P2 | 登录审计 + SSO / OIDC | 面向公网或合规要求时做 |
| P3 | 任务依赖（FS）+ 自动排期 | **慎重**：会引入循环依赖和约束求解，与"精简"定位冲突。真要做，建议先做「只读依赖线 + 手工顺延」，不要做自动求解 |

---

## 11. 发布前检查清单

- [ ] 确认 git 工作区干净，CI 通过
- [ ] 确认 `apps/api/.env` 里的 `DATABASE_URL` 指向本机 3308；上线前确认 `SESSION_DAYS` / `COOKIE_SECURE` / `CORS_ORIGIN`
- [ ] 本地 `pnpm db:push` 后确认 `users` / `sessions` / `project_members` 三张表存在；首次打开页面按提示创建管理员（或 `pnpm db:seed` 用默认账号 `admin / mplan123`，登录后立即重置密码）
- [ ] 生产不需要手动建管理员：`pnpm release` 会调用 `admin:create`（已存在则跳过）
- [ ] 无痕窗口验一遍：匿名可读、匿名写 401、登录后只能改被分配的项目、越权写 403、退出后回到只读
- [ ] 在「用户管理」里给每个成员勾选可管理项目（不勾 = 登录但只读）
- [ ] 确认 5173 / 8787 / 3308 没被别的项目占用
- [ ] 跑一遍 §1 的验收命令
- [ ] 确认本地演示数据在：2 个项目、7 个人、38 个任务、2 个里程碑、5 条变更日志
- [ ] 自托管发布后确认：`systemctl is-active mplan-api`、`docker ps | grep mplan-web`、公网端口可访问
- [ ] 自托管库确认：只建表、不执行 `db:seed`；`users` 至少 1 个管理员，`projects` 为 0 或真实项目
- [ ] 备份 / 回滚方案已确认（见 [ROADMAP.md](ROADMAP.md) P0）
- [ ] `项目模板-v2.csv` 是当前生效的模板

---

## 12. 关键文件速查

| 想改什么 | 去哪个文件 |
|---|---|
| 进度 / 逾期 / 工期算法 | `packages/core/src/schedule.ts`、`derive.ts` |
| 工作日历 / 加班优先级 | `packages/core/src/calendar.ts` |
| 节假日数据 | `packages/core/src/holidays-cn.ts` |
| 甘特时间轴 / 列宽 | `packages/core/src/axis.ts`、`apps/web/src/lib/gantt.ts` |
| 甘特渲染 / 拖拽 / 里程碑 | `apps/web/src/components/Board.tsx` |
| 任务详情 / 顺延 | `apps/web/src/components/TaskDrawer.tsx` |
| 改期联动规则 / 项目超期 | `packages/core/src/shift.ts` |
| 改期联动接口 / 批量日期恢复 | `apps/api/src/routes.ts` |
| 联动开关 / ghost 预览 / 批量撤销 | `apps/web/src/components/TopBar.tsx`、`Board.tsx`、`store.ts` |
| 筛选逻辑 | `apps/web/src/lib/gantt.ts` 的 `buildBoard`、`FilterBar.tsx` |
| CSV 格式 | `packages/core/src/csv.ts` |
| 变更日志 | `apps/api/src/lib/log.ts`、`ChangesModal.tsx` |
| 登录 / 会话 / 登录拦截 / 项目权限判断 | `apps/api/src/lib/auth.ts` |
| 登录 / 账号管理 / 项目分配接口 | `apps/api/src/routes.auth.ts` |
| 项目信息 / 项目成员 / 归档 / 批量日期接口 | `apps/api/src/routes.ts` |
| 登录弹窗 / 用户管理与项目角色 | `apps/web/src/components/LoginModal.tsx`、`UsersModal.tsx` |
| 项目设置 / 成员 / 归档弹窗 | `apps/web/src/components/ProjectSettingsModal.tsx` |
| 只读态 UI | `apps/web/src/components/TopBar.tsx`、`Board.tsx`、`TaskDrawer.tsx`、`PeopleModal.tsx`、`CalendarModal.tsx` |
| 表结构 | `apps/api/src/db/schema.ts` |
| 演示数据 | `apps/api/src/db/seed.ts` |
| 初始管理员 CLI | `apps/api/src/db/create-admin.ts` |
| 业务接口 | `apps/api/src/routes.ts`（登录/账号在 `routes.auth.ts`） |
| 生产发布 | `scripts/deploy.sh`、`scripts/remote-deploy.sh`、[DEPLOY.md](DEPLOY.md) |
| 文档导航 / 路线图 | `docs/README.md`、[ROADMAP.md](ROADMAP.md) |