#!/usr/bin/env bash
# LiveCG 一键安装（Linux 单机）：构建 → 生成 .env → 数据目录 → systemd 服务 → 启动 → 自检 → 生成 CS2 配置
#
# 在项目根目录用普通账号运行（需要 sudo 权限，系统级的步骤会自动用 sudo）：
#   deploy/install.sh
#   deploy/install.sh --data-dir /var/lib/livecg --room final
#
# 选项：
#   --user <账号>       运行服务的账号，默认是当前账号
#   --data-dir <目录>   数据目录，默认 /var/lib/livecg（只在新建 .env 时写入）
#   --room <房间>       生成 CS2 配置时用的房间，默认 default 房间
#   --url <地址>        OB 机访问 LiveCG 的地址，默认 http://<本机第一个局域网 IP>:<端口>
#   --no-service        不安装 systemd 服务（只构建、生成配置）
#
# 可以重复运行：已有的 .env 不会被覆盖，服务会被更新并重启。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC_USER="$(id -un)"
DATA_DIR="/var/lib/livecg"
ROOM=""
URL=""
WITH_SERVICE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SVC_USER="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --room) ROOM="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --no-service) WITH_SERVICE=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知选项：$1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; }
die() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
cd "$REPO"

# ───────────── 1. 运行环境 ─────────────
step "检查 Node.js 与 pnpm"
command -v node >/dev/null || die "找不到 node：先安装 Node.js 22 或更新（建议用 NodeSource 的软件源装到系统里）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js $(node -v) 太旧，需要 22 或更新"
ok "Node.js $(node -v)（$(command -v node)）"
command -v pnpm >/dev/null || die "找不到 pnpm：运行 corepack enable pnpm（或 npm i -g pnpm）后重试"
ok "pnpm $(pnpm -v)（$(command -v pnpm)）"
id "$SVC_USER" >/dev/null 2>&1 || die "账号 $SVC_USER 不存在（--user 指定的账号要先建好）"

# ───────────── 2. 构建 ─────────────
step "安装依赖并构建控制台"
pnpm install --frozen-lockfile
pnpm build
ok "构建完成"

# ───────────── 3. .env ─────────────
step "配置 .env"
rand() { node -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('hex'))"; }
set_env() { # set_env KEY VALUE：已有该行则替换，没有则追加
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
if [ -f .env ]; then
  ok ".env 已存在，保持不变"
  grep -q '^CS2_GSI_TOKEN=change-me' .env && warn ".env 里 CS2_GSI_TOKEN 还是 change-me，请改成随机字符串"
else
  cp .env.example .env
  set_env CS2_GSI_TOKEN "$(rand 16)"
  set_env LIVECG_DATA_DIR "$DATA_DIR"
  set_env LIVECG_CS2_CAPTURE 1
  ok "已从 .env.example 生成：随机 CS2_GSI_TOKEN、LIVECG_DATA_DIR=$DATA_DIR、联调期间开启 CS2 录制"
  ok "管理员初始密码留空：首次启动随机生成，首次登录必须修改"
fi
env_get() { sed -n "s/^$1=//p" .env | tail -n1; }
PORT="$(env_get PORT)"; PORT="${PORT:-3000}"
DATA_DIR="$(env_get LIVECG_DATA_DIR)"; DATA_DIR="${DATA_DIR:-$REPO/data/runtime}"
[ -n "$(env_get LIVECG_PEER_URL)" ] && warn "LIVECG_PEER_URL 已设置：本脚本按单机安装，主备请参考 docs/DEPLOYMENT-CHECKLIST.md"
[ "$(env_get LIVECG_AUTH)" = "off" ] && warn "LIVECG_AUTH=off 会关闭登录，播出现场不要这样配"
if [ "$SVC_USER" != "$(id -un)" ]; then
  $SUDO chgrp "$(id -gn "$SVC_USER")" .env && chmod 640 .env
else
  chmod 600 .env
fi
ok ".env 权限已收紧（含 token）"

# ───────────── 4. 数据目录 ─────────────
step "数据目录 $DATA_DIR"
$SUDO mkdir -p "$DATA_DIR"
$SUDO chown "$SVC_USER:$(id -gn "$SVC_USER")" "$DATA_DIR"
$SUDO chmod 750 "$DATA_DIR"
ok "已建好，归 $SVC_USER 所有"

# ───────────── 5. systemd 服务 ─────────────
if [ "$WITH_SERVICE" -eq 1 ]; then
  step "安装 systemd 服务 livecg（运行账号 $SVC_USER）"
  [ -d /run/systemd/system ] || die "这台机器没有运行 systemd；可加 --no-service 跳过，改为手动 pnpm --filter @livecg/server start"
  if [ "$SVC_USER" != "$(id -un)" ]; then
    $SUDO -u "$SVC_USER" test -r "$REPO/package.json" -a -r "$REPO/.env" \
      || die "账号 $SVC_USER 读不到 $REPO（家目录权限？）：把项目放到 /opt/LiveCG 之类的位置，或不加 --user 用当前账号运行服务"
  fi
  # systemd 的 PATH 里没有 nvm 等装在家目录的 node，显式写进服务
  NODE_DIR="$(dirname "$(command -v node)")"
  UNIT="$(mktemp)"
  sed -e "s|^User=.*|User=$SVC_USER|" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=$REPO|" \
      -e "s|^ExecStart=[^ ]*pnpm|ExecStart=$(command -v pnpm)|" \
      -e "s|^\[Service\]|[Service]\nEnvironment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin|" \
      deploy/livecg.service > "$UNIT"
  $SUDO install -m 644 "$UNIT" /etc/systemd/system/livecg.service
  rm -f "$UNIT"
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable livecg >/dev/null 2>&1
  $SUDO systemctl restart livecg
  ok "已安装并（重新）启动"

  step "等待服务就绪"
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$PORT/api/presets" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS "http://127.0.0.1:$PORT/api/presets" >/dev/null 2>&1 \
    || die "30 秒内没有起来，看日志：journalctl -u livecg -n 50 --no-pager"
  ok "http://127.0.0.1:$PORT/ 已响应"
  PW_FILE="$DATA_DIR/initial-admin-password.txt"
  if $SUDO test -f "$PW_FILE"; then
    ok "管理员 admin 的初始密码：$($SUDO cat "$PW_FILE")（首次登录后必须修改，改完删除 $PW_FILE）"
  fi
fi

# ───────────── 6. 防火墙提示 ─────────────
step "防火墙"
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  $SUDO ufw status | grep -q "^$PORT/tcp.*ALLOW" && ok "ufw 已放行 $PORT/tcp" \
    || warn "ufw 已开启但没放行 $PORT：sudo ufw allow $PORT/tcp"
elif command -v firewall-cmd >/dev/null && $SUDO firewall-cmd --state >/dev/null 2>&1; then
  $SUDO firewall-cmd --list-ports | grep -qw "$PORT/tcp" && ok "firewalld 已放行 $PORT/tcp" \
    || warn "firewalld 已开启但没放行 $PORT：sudo firewall-cmd --permanent --add-port=$PORT/tcp && sudo firewall-cmd --reload"
else
  ok "没有检测到开启的 ufw / firewalld；如有其它防火墙，放行 TCP $PORT（入）"
fi

# ───────────── 7. 自检与 CS2 配置 ─────────────
step "自检（pnpm preflight）"
pnpm --silent preflight || warn "自检有 ✗，按提示处理后再运行 pnpm preflight"

step "生成 CS2 配置"
CFG_ARGS=()
[ -n "$ROOM" ] && CFG_ARGS+=(--room "$ROOM")
[ -n "$URL" ] && CFG_ARGS+=(--url "$URL")
pnpm --silent cs2:cfg "${CFG_ARGS[@]}" || warn "CS2 配置没有生成，按提示处理后运行 pnpm cs2:cfg"

step "完成"
echo "  控制台：http://<本机 IP>:$PORT/  （admin 登录 → 建操作员账号 → 「设备 → CasparCG」）"
if [ "$WITH_SERVICE" -eq 1 ]; then
  echo "  日志：journalctl -u livecg -f"
else
  echo "  没有安装服务：手动启动用 pnpm --filter @livecg/server start"
fi
echo "  之后按 docs/QUICK-CHECKLIST-CS2.md 的 B 节起逐项联调"
