#!/usr/bin/env bash
# mplan 首次初始化：安装依赖 → 准备 .env → 启动 MySQL → 建表 → 灌演示数据
# 用法：bash scripts/init.sh [--skip-seed]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_SEED=0
for arg in "$@"; do
  case "$arg" in
    --skip-seed) SKIP_SEED=1 ;;
    -h|--help)
      cat <<'HELP'
用法: bash scripts/init.sh [--skip-seed]

  --skip-seed   只建表，不写演示数据（不会重置已有业务数据）
  -h, --help    显示帮助
HELP
      exit 0
      ;;
    *)
      echo "未知参数: $arg（用 --help 查看用法）" >&2
      exit 1
      ;;
  esac
done

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$*"
}
fail() {
  printf '\033[1;31m错误：%s\033[0m\n' "$*" >&2
  exit 1
}
need() {
  command -v "$1" >/dev/null 2>&1 || fail "找不到 $1，请先安装"
}

# ---------- 1. 环境检查 ----------
step "检查运行环境"
need node
need pnpm
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 需要 >= 22（当前 $(node -v)）"

# ---------- 2. 安装依赖 ----------
step "安装依赖（pnpm install）"
pnpm install

# ---------- 3. 环境变量 ----------
step "准备 apps/api/.env"
if [ -f apps/api/.env ]; then
  echo "已存在 apps/api/.env，跳过"
else
  cp apps/api/.env.example apps/api/.env
  echo "已从 apps/api/.env.example 创建 apps/api/.env"
fi

# ---------- 4. MySQL ----------
step "启动 MySQL（127.0.0.1:3308）"
port_open() {
  (exec 3<>/dev/tcp/127.0.0.1/3308) >/dev/null 2>&1
}
if port_open; then
  echo "3308 已在监听，跳过 docker compose up"
else
  need docker
  docker compose up -d mysql

  READY=0
  printf '等待 MySQL 就绪'
  for _ in $(seq 1 60); do
    if docker compose exec -T mysql mysqladmin ping -h 127.0.0.1 -pmplan --silent >/dev/null 2>&1; then
      READY=1
      break
    fi
    printf '.'
    sleep 1
  done
  printf '\n'
  [ "$READY" -eq 1 ] || fail "MySQL 60 秒内没有就绪，请检查：docker compose logs mysql"
fi

# ---------- 5. 建表 ----------
step "同步数据库结构（drizzle-kit push）"
pnpm db:push

# ---------- 6. 演示数据 ----------
if [ "$SKIP_SEED" -eq 1 ]; then
  step "跳过演示数据（--skip-seed）"
else
  step "写入演示数据"
  echo "注意：db:seed 会清空业务数据并重建演示项目；账号保留，项目授权会清空。"
  pnpm db:seed
fi

# ---------- 7. 完成 ----------
step "初始化完成"
cat <<'DONE'
  前端      http://localhost:5173
  API       http://localhost:8787/api/health
  MySQL     127.0.0.1:3308（库 mplan，root / mplan）
  默认账号  admin / mplan123（首次登录后请在「用户管理」里重置密码）

  下一步：pnpm dev
DONE
