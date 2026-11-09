# mplan 文档导航

> 最后更新：2026-11-07
> 先读根目录 [README.md](../README.md) 了解项目，再按角色选择下面的文档。

## 按角色阅读

| 你是 | 建议阅读 |
|---|---|
| 第一次运行项目 | [README.md](../README.md) → [DEPLOY.md](DEPLOY.md) |
| 想参与开发 | [DEVELOPMENT.md](DEVELOPMENT.md) → [AUTH.md](AUTH.md) → [DESIGN.md](DESIGN.md) |
| 只关心权限 / 账号 | [AUTH.md](AUTH.md) |
| 想自己部署 | [DEPLOY.md](DEPLOY.md) |
| 想讨论产品方向 | [ROADMAP.md](ROADMAP.md) |

## 文档一览

| 文档 | 作用 | 什么时候需要更新 |
|---|---|---|
| [README.md](../README.md) | 项目介绍、功能、快速开始、初始化脚本、命令 | 功能、命令、环境要求变化 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 开发与维护：架构、数据模型、接口、改代码菜谱、技术债 | 表结构、接口、设计决策、已知问题变化 |
| [AUTH.md](AUTH.md) | 登录、会话、按项目授权、只读边界 | 权限模型、账号接口、登录方式变化 |
| [DEPLOY.md](DEPLOY.md) | 自托管发布、服务器拓扑、安全组、运维与回滚 | 发布流程、服务器组件、端口变化 |
| [DESIGN.md](DESIGN.md) | 关键设计取舍与踩坑记录 | 算法 / 交互取舍变化，或踩新坑 |
| [ROADMAP.md](ROADMAP.md) | 后续优化建议（讨论稿） | 需求评审后调整优先级 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更记录 | 每次发布 |

## 项目状态

- 版本：`0.1.0`，个人项目，暂未开源
- 功能：4 层任务树、甘特拖拽 / 撤销、公司日历、按项目授权、项目管理员、CSV 导入导出、晨会聚焦
- 测试：`packages/core` 31 个单测；本地/CI 均可跑 typecheck / test / build
- 数据库：MySQL 8.4；开发环境用 Docker Compose，生产环境可参考 [DEPLOY.md](DEPLOY.md)
- 当前没有 API / UI 自动化集成测试，欢迎补 Playwright / API 用例

## 文档维护约定

- 每篇文档开头保留「最后更新」日期。
- 文档里不写真实密码、AccessKey、`.deploy.env` 内容；密码只放本机 `.deploy.env` / `apps/api/.env`。
- 表数量、接口数量、单测数量、演示数据数量变化时，同步更新 README / DEVELOPMENT / AUTH。
- 截图放在 `docs/images/`，只保留当前版本实际引用的图片，避免文档里出现过时 UI。
- 新需求先写进 [ROADMAP.md](ROADMAP.md) 讨论，确认后再落到实现和 DEVELOPMENT。
