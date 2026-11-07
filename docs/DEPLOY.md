# mplan 发布说明

推荐的自托管方式：**服务器本地 Node 进程 + Docker nginx + 已有 MySQL 容器**。发布脚本不会写入任何演示数据。
>
> 下面的端口、路径、服务名都是示例，可以按自己的服务器修改 `.deploy.env` 和 systemd / nginx 配置。

## 1. 服务器拓扑

```text
公网 :8102
   │
   ▼
mplan-web（Docker nginx，host network）
   ├─ /           → /opt/mplan/apps/web/dist
   └─ /api/*      → 127.0.0.1:8787
                       │
                       ▼
                  mplan-api（systemd，Node 22 + tsx）
                       │
                       ▼
                  mysql-latest（127.0.0.1:3306 / 库 mplan）
```

| 组件 | 位置 / 名称 | 说明 |
|---|---|---|
| 前端静态文件 | `/opt/mplan/apps/web/dist` | 本地构建后 rsync 上去 |
| 项目代码 | `/opt/mplan` | `mplan` 系统用户运行 API |
| Node.js | `/opt/nodejs/22.14.0` | 由脚本按需安装 |
| API 服务 | `systemd: mplan-api` | 监听 `127.0.0.1:8787` |
| Web 服务 | `docker: mplan-web` | nginx:alpine，监听公网端口 `8102` |
| 数据库 | `mysql-latest` / `mplan` | 复用服务器已有容器，仅建库建表 |

## 2. 发布前准备

1. 本地安装 `ssh`、`rsync`、`curl`、`pnpm`
2. 服务器已安装 Docker，且 MySQL 容器在运行
3. 云厂商安全组 / 防火墙入方向放行 **TCP 8102**（或改成本机可用的其他端口）
4. 复制配置模板：

```bash
cp .deploy.env.example .deploy.env
chmod 600 .deploy.env
# 编辑 .deploy.env：SSH、MySQL、PUBLIC_PORT、初始管理员
```

`.deploy.env` 含密码，已加入 `.gitignore`，不要提交。

## 3. 一键发布

```bash
pnpm release
# 或
bash scripts/deploy.sh
```

可选参数：

```bash
bash scripts/deploy.sh --skip-build   # 跳过本地前端构建
```

脚本会：

1. 本地执行 `pnpm --filter @mplan/web build`
2. 通过 SSH 密码（askpass，不把密码写进进程参数）连接服务器
3. `rsync` 代码到 `/opt/mplan`，保留服务器上的 `.env`、`node_modules`、`deploy/`
4. 按需下载 Node.js 22 和 pnpm
5. 创建 MySQL 库 `mplan`（`utf8mb4`）
6. `pnpm install --frozen-lockfile`
7. 写 `apps/api/.env`（生产配置）
8. `drizzle-kit push --force` 建表，**不执行 `db:seed`**
9. 创建初始管理员（已存在则跳过，不重置密码）
10. 生成并重启 `mplan-api` systemd 服务
11. 生成 nginx 配置并重启 `mplan-web` 容器
12. 检查服务器本机健康状态和公网可达性

发布完成后访问：

```text
http://<SERVER_HOST>:<PUBLIC_PORT>/
```

初始管理员信息在 `.deploy.env` 的 `ADMIN_USER` / `ADMIN_PASSWORD` 中。**首次登录后请立即修改密码。**

## 4. 安全组

发布脚本只能检查公网是否可达，不能修改云厂商安全组。若输出：

```text
⚠ 公网 http://x.x.x.x:8102/ 当前不可达。
```

请到云厂商控制台放行对应端口，例如阿里云 ECS：

```text
ECS → 实例 → 安全组 → 配置规则 → 入方向 → 手动添加
协议类型：TCP
端口范围：8102/8102
授权对象：0.0.0.0/0（或实际办公网出口 IP）
```

放行后重新执行脚本，或直接在浏览器打开。

如果暂时不能修改安全组，可以先通过 SSH 隧道在本机预览（部署脚本默认把 `127.0.0.1:8102` 加入 `CORS_ORIGIN`）：

```bash
ssh -L 8102:127.0.0.1:8102 root@<SERVER_HOST>
# 然后打开 http://127.0.0.1:8102/
```

## 5. 日常运维

```bash
# API 状态 / 日志
systemctl status mplan-api
journalctl -u mplan-api -f

# Web 容器
docker ps --filter name=mplan-web
docker logs -f mplan-web

# 本机检查
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8102/api/health

# 重启
systemctl restart mplan-api
docker restart mplan-web
```

数据库备份（在服务器上）：

```bash
docker exec mysql-latest mysqldump -uroot -p'<MYSQL_ROOT_PASS>' \
  --single-transaction --routines --triggers mplan \
  > /opt/mplan/backup-$(date +%Y%m%d-%H%M%S).sql
```

## 6. 更新与回滚

- **更新**：本地改完代码后重新执行 `pnpm release`。脚本会覆盖代码、重启服务，保留 `.env`、`node_modules` 和数据库；初始管理员不会重置。
- **不会执行 seed**：生产库不会被演示数据覆盖。
- **回滚**：当前是原地发布，没有内建多版本目录。建议每次发布前备份代码和数据库：

```bash
# 服务器上
tar -czf /opt/mplan-backup-$(date +%Y%m%d-%H%M%S).tgz -C /opt mplan
```

或后续把发布脚本改成 `releases/<timestamp>` + `current` 软链。

## 7. 安全建议

- 当前是 HTTP，Cookie 的 `Secure` 为 0；有域名和证书后，把 `COOKIE_SECURE=1` 并配置 HTTPS。
- 如果 MySQL 的 `3306` 端口映射到公网，建议只允许内网 / 白名单访问。
- `.deploy.env`、`apps/api/.env` 都含密码，权限保持 `600`；发布时的 `deploy/runtime.env` 是临时文件，脚本结束会自动删除。
- 生产环境不要执行 `pnpm db:seed`（会清空业务数据）。
