#!/usr/bin/env bash
# 在服务器上执行：安装 Node/pnpm、建库、建表、创建管理员、启动 API 和 nginx
# 由 scripts/deploy.sh 调用，不直接手动执行。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ENV="$APP_DIR/deploy/runtime.env"
[ -f "$RUNTIME_ENV" ] || {
  echo "缺少 ${RUNTIME_ENV}，请通过 scripts/deploy.sh 执行" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
. "$RUNTIME_ENV"
set +a
trap 'rm -f "$RUNTIME_ENV"' EXIT

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m错误：%s\033[0m\n' "$*" >&2; exit 1; }

: "${NODE_VERSION:?}"
: "${PNPM_VERSION:?}"
: "${MYSQL_CONTAINER:?}"
: "${MYSQL_ROOT_PASS:?}"
: "${MYSQL_HOST:?}"
: "${MYSQL_PORT:?}"
: "${MYSQL_DB:?}"
: "${MYSQL_USER:?}"
: "${MYSQL_PASS:?}"
: "${PUBLIC_PORT:?}"
: "${PUBLIC_ORIGIN:?}"
: "${ADMIN_USER:?}"
: "${ADMIN_PASSWORD:?}"
ADMIN_NAME="${ADMIN_NAME:-管理员}"
[[ "$MYSQL_DB" =~ ^[a-zA-Z0-9_]+$ ]] || fail "MYSQL_DB 只能包含字母、数字、下划线"
[[ "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || fail "PUBLIC_PORT 必须是数字"

# ---------- 1. 检查 ----------
step "检查服务器环境"
command -v curl >/dev/null || fail "服务器缺少 curl"
command -v tar >/dev/null || fail "服务器缺少 tar"
command -v docker >/dev/null || fail "服务器缺少 docker"
command -v systemctl >/dev/null || fail "服务器缺少 systemd"
docker inspect "$MYSQL_CONTAINER" >/dev/null 2>&1 || fail "找不到 MySQL 容器：$MYSQL_CONTAINER"
[ -f "$APP_DIR/apps/web/dist/index.html" ] || fail "缺少前端构建产物 apps/web/dist（请先在本地构建）"

# ---------- 2. Node / pnpm ----------
step "准备 Node.js $NODE_VERSION + pnpm $PNPM_VERSION"
NODE_ROOT=/opt/nodejs
NODE_HOME="$NODE_ROOT/$NODE_VERSION"
if [ ! -x "$NODE_HOME/bin/node" ]; then
  mkdir -p "$NODE_ROOT"
  TMP_DIR="$(mktemp -d)"
  URL="https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"
  echo "下载 $URL"
  curl -fL --retry 3 --connect-timeout 20 -o "$TMP_DIR/node.tar.gz" "$URL"
  tar -xzf "$TMP_DIR/node.tar.gz" -C "$NODE_ROOT"
  mv "$NODE_ROOT/node-v${NODE_VERSION}-linux-x64" "$NODE_HOME"
  rm -rf "$TMP_DIR"
fi
export PATH="$NODE_HOME/bin:$PATH"
echo "node $(node -v)"

if [ ! -x "$NODE_HOME/bin/pnpm" ] || [ "$("$NODE_HOME/bin/pnpm" -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  npm install -g "pnpm@$PNPM_VERSION" --registry=https://registry.npmmirror.com
fi
echo "pnpm $(pnpm -v)"

# ---------- 3. 服务用户 ----------
step "准备服务用户 mplan"
if ! id -u mplan >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin mplan
  echo "已创建系统用户 mplan"
else
  echo "系统用户 mplan 已存在"
fi

# ---------- 4. 数据库 ----------
step "创建数据库 ${MYSQL_DB}（不写演示数据）"
docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASS" \
  -e "CREATE DATABASE IF NOT EXISTS $MYSQL_DB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
echo "数据库就绪"

# ---------- 5. 依赖 ----------
step "安装项目依赖"
cd "$APP_DIR"
pnpm install --frozen-lockfile

# ---------- 6. 环境变量 ----------
step "写入 apps/api/.env"
cat > "$APP_DIR/apps/api/.env" <<ENV
DATABASE_URL=mysql://${MYSQL_USER}:${MYSQL_PASS}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DB}
HOST=127.0.0.1
PORT=8787
CORS_ORIGIN=${PUBLIC_ORIGIN},http://127.0.0.1:${PUBLIC_PORT},http://localhost:${PUBLIC_PORT}
SESSION_DAYS=7
COOKIE_SECURE=0
ENV
chmod 600 "$APP_DIR/apps/api/.env"

# ---------- 7. 建表 + 初始管理员 ----------
step "同步表结构（不执行 db:seed）"
pnpm --filter @mplan/api exec drizzle-kit push --force

step "创建初始管理员（已存在则跳过）"
MPLAN_ADMIN_USER="$ADMIN_USER" \
MPLAN_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
MPLAN_ADMIN_NAME="$ADMIN_NAME" \
pnpm --filter @mplan/api admin:create

# ---------- 8. 权限 ----------
chown -R mplan:mplan "$APP_DIR"
chmod 600 "$APP_DIR/apps/api/.env"

# ---------- 9. API systemd ----------
step "配置并启动 mplan-api systemd 服务"
cat > /etc/systemd/system/mplan-api.service <<UNIT
[Unit]
Description=mplan API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mplan
Group=mplan
WorkingDirectory=$APP_DIR/apps/api
EnvironmentFile=$APP_DIR/apps/api/.env
Environment=NODE_ENV=production
Environment=PATH=$NODE_HOME/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_HOME/bin/node --import tsx src/index.ts
Restart=always
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mplan-api >/dev/null
systemctl restart mplan-api

API_OK=0
for _ in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then API_OK=1; break; fi
  sleep 1
done
if [ "$API_OK" -ne 1 ]; then
  journalctl -u mplan-api -n 60 --no-pager || true
  fail "API 没有在 30 秒内启动，请检查 journalctl -u mplan-api"
fi
echo "API 健康检查通过"

# ---------- 10. nginx ----------
step "配置并启动 nginx（监听 ${PUBLIC_PORT}）"
mkdir -p "$APP_DIR/deploy"
cat > "$APP_DIR/deploy/nginx.conf" <<NGINX
server {
    listen $PUBLIC_PORT;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 20m;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;
    gzip_min_length 1024;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location /assets/ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /healthz {
        default_type text/plain;
        return 200 "ok\n";
    }
}
NGINX
chown mplan:mplan "$APP_DIR/deploy/nginx.conf"

if ! docker image inspect nginx:alpine >/dev/null 2>&1; then
  docker pull nginx:alpine
fi
docker rm -f mplan-web >/dev/null 2>&1 || true
docker run -d \
  --name mplan-web \
  --restart unless-stopped \
  --network host \
  -v "$APP_DIR/apps/web/dist:/usr/share/nginx/html:ro" \
  -v "$APP_DIR/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine >/dev/null

WEB_OK=0
for _ in $(seq 1 20); do
  if curl -fsS -m 2 "http://127.0.0.1:$PUBLIC_PORT/healthz" >/dev/null 2>&1; then WEB_OK=1; break; fi
  sleep 1
done
if [ "$WEB_OK" -ne 1 ]; then
  docker logs --tail 40 mplan-web || true
  fail "nginx 没有在 20 秒内启动"
fi
echo "nginx 健康检查通过"

step "服务器端部署完成"
echo "  本地 API   http://127.0.0.1:8787/api/health"
echo "  本地 Web   http://127.0.0.1:$PUBLIC_PORT/"
echo "  管理员     $ADMIN_USER"
