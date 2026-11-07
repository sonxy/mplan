#!/usr/bin/env bash
# 本地发布脚本：构建前端 → rsync 到服务器 → 远端安装/建表/建管理员/重启服务
# 用法：bash scripts/deploy.sh [--skip-build]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      cat <<'HELP'
用法: bash scripts/deploy.sh [--skip-build]

  --skip-build  跳过本地前端构建（使用现有 apps/web/dist）
  -h, --help    显示帮助

配置文件: 仓库根目录 .deploy.env（从 .deploy.env.example 复制）
HELP
      exit 0
      ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m错误：%s\033[0m\n' "$*" >&2; exit 1; }

ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.deploy.env}"
[ -f "$ENV_FILE" ] || fail "找不到 ${ENV_FILE}，请先：cp .deploy.env.example .deploy.env 并填写"
# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

: "${SERVER_HOST:?缺少 SERVER_HOST}"
: "${SERVER_PORT:?缺少 SERVER_PORT}"
: "${SERVER_USER:?缺少 SERVER_USER}"
: "${SERVER_PASS:?缺少 SERVER_PASS}"
: "${REMOTE_DIR:?缺少 REMOTE_DIR}"
: "${PUBLIC_PORT:?缺少 PUBLIC_PORT}"
: "${MYSQL_CONTAINER:?缺少 MYSQL_CONTAINER}"
: "${MYSQL_ROOT_PASS:?缺少 MYSQL_ROOT_PASS}"
: "${MYSQL_HOST:?缺少 MYSQL_HOST}"
: "${MYSQL_PORT:?缺少 MYSQL_PORT}"
: "${MYSQL_DB:?缺少 MYSQL_DB}"
: "${MYSQL_USER:?缺少 MYSQL_USER}"
: "${MYSQL_PASS:?缺少 MYSQL_PASS}"
: "${ADMIN_USER:?缺少 ADMIN_USER}"
: "${ADMIN_PASSWORD:?缺少 ADMIN_PASSWORD}"

SERVER_HOST="${SERVER_HOST}"
PUBLIC_HOST="${PUBLIC_HOST:-$SERVER_HOST}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://${PUBLIC_HOST}:${PUBLIC_PORT}}"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
PNPM_VERSION="${PNPM_VERSION:-11.22.0}"
ADMIN_NAME="${ADMIN_NAME:-管理员}"

case "$REMOTE_DIR" in
  /*) ;;
  *) fail "REMOTE_DIR 必须是绝对路径" ;;
esac
[[ "$MYSQL_DB" =~ ^[a-zA-Z0-9_]+$ ]] || fail "MYSQL_DB 只能包含字母、数字、下划线"

command -v ssh >/dev/null || fail "本机缺少 ssh"
command -v rsync >/dev/null || fail "本机缺少 rsync"
command -v curl >/dev/null || fail "本机缺少 curl"
command -v pnpm >/dev/null || fail "本机缺少 pnpm"

# ---------- 1. 本地构建 ----------
if [ "$SKIP_BUILD" -eq 0 ]; then
  step "构建前端（apps/web/dist）"
  pnpm --filter @mplan/web build
else
  step "跳过前端构建（--skip-build）"
fi
[ -f "$ROOT_DIR/apps/web/dist/index.html" ] || fail "缺少 apps/web/dist/index.html，请先构建"

# ---------- 2. SSH 密码（askpass，避免把密码放进进程参数） ----------
ASKPASS_FILE="$(mktemp "${TMPDIR:-/tmp}/mplan-askpass.XXXXXX")"
cat > "$ASKPASS_FILE" <<'ASKPASS'
#!/bin/sh
printf '%s\n' "$M_SSH_PASS"
ASKPASS
chmod 700 "$ASKPASS_FILE"

RUNTIME_ENV_LOCAL=""
REMOTE_ENV_UPLOADED=0
cleanup() {
  rm -f "$ASKPASS_FILE"
  [ -n "$RUNTIME_ENV_LOCAL" ] && rm -f "$RUNTIME_ENV_LOCAL"
  if [ "$REMOTE_ENV_UPLOADED" -eq 1 ]; then
    M_SSH_PASS="$SERVER_PASS" SSH_ASKPASS="$ASKPASS_FILE" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}" \
      ssh -p "$SERVER_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
      "$SERVER_USER@$SERVER_HOST" "rm -f '$REMOTE_DIR/deploy/runtime.env'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

export M_SSH_PASS="$SERVER_PASS"
export SSH_ASKPASS="$ASKPASS_FILE"
export SSH_ASKPASS_REQUIRE=force
export DISPLAY="${DISPLAY:-:0}"

SSH_ARGS=(-p "$SERVER_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
ssh_run() { ssh "${SSH_ARGS[@]}" "$SERVER_USER@$SERVER_HOST" "$@"; }
RSYNC_SSH="ssh -p $SERVER_PORT -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

# ---------- 3. 准备目录 ----------
step "连接服务器 ${SERVER_USER}@${SERVER_HOST}，准备目录"
ssh_run "mkdir -p '$REMOTE_DIR' '$REMOTE_DIR/deploy' '$REMOTE_DIR/scripts'"

# ---------- 4. 同步代码 ----------
step "同步代码到 ${REMOTE_DIR}（不覆盖服务器上的 .env / node_modules）"
rsync -az --delete --human-readable \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.chrome' \
  --exclude '.pnpm-store' \
  --exclude '.deploy.env' \
  --exclude 'apps/api/.env' \
  --exclude '/deploy/' \
  --exclude '*.log' \
  -e "$RSYNC_SSH" \
  "$ROOT_DIR/" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/"

# ---------- 5. 上传运行时配置 ----------
step "上传本次部署配置"
RUNTIME_ENV_LOCAL="$(mktemp "${TMPDIR:-/tmp}/mplan-runtime.XXXXXX")"
chmod 600 "$RUNTIME_ENV_LOCAL"
cat > "$RUNTIME_ENV_LOCAL" <<ENV
APP_DIR=$(printf '%q' "$REMOTE_DIR")
NODE_VERSION=$(printf '%q' "$NODE_VERSION")
PNPM_VERSION=$(printf '%q' "$PNPM_VERSION")
MYSQL_CONTAINER=$(printf '%q' "$MYSQL_CONTAINER")
MYSQL_ROOT_PASS=$(printf '%q' "$MYSQL_ROOT_PASS")
MYSQL_HOST=$(printf '%q' "$MYSQL_HOST")
MYSQL_PORT=$(printf '%q' "$MYSQL_PORT")
MYSQL_DB=$(printf '%q' "$MYSQL_DB")
MYSQL_USER=$(printf '%q' "$MYSQL_USER")
MYSQL_PASS=$(printf '%q' "$MYSQL_PASS")
PUBLIC_PORT=$(printf '%q' "$PUBLIC_PORT")
PUBLIC_ORIGIN=$(printf '%q' "$PUBLIC_ORIGIN")
ADMIN_USER=$(printf '%q' "$ADMIN_USER")
ADMIN_PASSWORD=$(printf '%q' "$ADMIN_PASSWORD")
ADMIN_NAME=$(printf '%q' "$ADMIN_NAME")
ENV
rsync -az -e "$RSYNC_SSH" "$RUNTIME_ENV_LOCAL" \
  "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/deploy/runtime.env"
REMOTE_ENV_UPLOADED=1
ssh_run "chmod 600 '$REMOTE_DIR/deploy/runtime.env'"

# ---------- 6. 远端部署 ----------
step "执行服务器端部署"
ssh_run "bash '$REMOTE_DIR/scripts/remote-deploy.sh'"

# ---------- 7. 结果 ----------
step "部署完成"
echo "  访问地址   http://${PUBLIC_HOST}:${PUBLIC_PORT}/"
echo "  管理员     ${ADMIN_USER}"
echo "  初始密码   ${ADMIN_PASSWORD}（仅首次部署创建；已存在则不会重置）"
echo "  服务器目录 ${REMOTE_DIR}"

if curl -fsS -m 8 "http://${PUBLIC_HOST}:${PUBLIC_PORT}/api/health" >/dev/null 2>&1; then
  echo "  公网检查   通过"
else
  echo
  echo "  ⚠ 公网 http://${PUBLIC_HOST}:${PUBLIC_PORT}/ 当前不可达。"
  echo "    服务器本机已启动；通常是阿里云安全组没有放行 ${PUBLIC_PORT}。"
  echo "    请在 ECS 控制台 → 安全组 → 入方向，放行 TCP ${PUBLIC_PORT} 后重试。"
  echo "    也可以在服务器上先验证：curl http://127.0.0.1:${PUBLIC_PORT}/api/health"
fi
