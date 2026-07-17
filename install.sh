#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║           MCPanel — One-Line Installer                      ║
# ║   curl -fsSL https://raw.githubusercontent.com/Skitaru/mcpanel/main/install.sh | bash  ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/mcpanel}"
PANEL_PORT="${PANEL_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
API_KEY="${API_KEY:-}"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
USE_LOCAL=false
REPO_URL="https://github.com/Skitaru/mcpanel.git"
TOTAL_STEPS=8

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) PANEL_DIR="$2"; shift 2 ;;
    --port) PANEL_PORT="$2"; shift 2 ;;
    --fe-port) FRONTEND_PORT="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --local) USE_LOCAL=true; shift ;;
    --help)
      echo "Usage: bash install.sh [OPTIONS]"
      echo "  --dir DIR       Install directory (default: /opt/mcpanel)"
      echo "  --port PORT     Backend port (default: 3000)"
      echo "  --fe-port PORT  Frontend port (default: 3001)"
      echo "  --api-key KEY   Pre-set API key"
      echo "  --local         Use local files"
      exit 0 ;;
    *) shift ;;
  esac
done

G='\033[0;32m'; B='\033[1;34m'; Y='\033[0;33m'
R='\033[0;31m'; W='\033[1;37m'; D='\033[0;90m'; N='\033[0m'
BOLD='\033[1m'; DIM='\033[2m'

step() {
  local n="$1" total="$2" label="$3"
  local pct=$(( n * 100 / total ))
  local filled=$(( n * 30 / total ))
  local bar=""
  for i in $(seq 1 $filled);  do bar="${bar}█"; done
  for i in $(seq $((filled+1)) 30); do bar="${bar}░"; done
  clear
  echo
  echo -e "  ${G}▓▒░${N} ${BOLD}${W}MCPANEL${N} ${DIM}·  Installer${N}"
  echo -e "  ${G}────────────────────────────────${N}"
  echo
  echo -e "  ${G}[${bar}]${N} ${DIM}${pct}%${N}  ${W}${n}/${total}${N}  ${BOLD}${label}${N}"
  echo
  echo -e "  ${D}────────────────────────────────────────────────${N}"
  echo
}

ok()   { echo -e "  ${G}✔${N}  $1"; }
fail() { echo -e "  ${R}✖  $1${N}"; exit 1; }
warn() { echo -e "  ${Y}⚠${N}  $1"; }
info() { echo -e "  ${D}→${N}  ${DIM}$1${N}"; }
run() {
  local label="$1"; shift
  info "$label"
  if "$@" >> /tmp/mcpanel-install.log 2>&1; then ok "$label"
  else fail "$label (check /tmp/mcpanel-install.log)"; fi
}

[ "$EUID" -ne 0 ] && { echo -e "${R}Please run as root.${N}"; exit 1; }
. /etc/os-release 2>/dev/null || true
case "${ID:-}" in debian|ubuntu) ;; *) fail "Debian or Ubuntu required." ;; esac

if [ -d "$PANEL_DIR" ] && [ -f "$PANEL_DIR/servers.json" ]; then
  clear
  echo; echo -e "  ${Y}⚠${N}  MCPanel is already installed."; echo
  printf "  Reinstall? Data stays. [y/N]: "; read -r ans
  case "$ans" in [yY]) ;; *) echo -e "  ${D}Cancelled.${N}"; exit 0 ;; esac
  systemctl stop mcpanel-backend mcpanel-frontend 2>/dev/null || true
fi

{
step 1 $TOTAL_STEPS "Install dependencies"
info "${PRETTY_NAME:-Debian}"
run "apt update" apt-get update -qq
run "curl git tar" apt-get install -y -qq curl wget gnupg ca-certificates lsb-release git unzip tar

step 2 $TOTAL_STEPS "Install Docker"
if command -v docker &>/dev/null; then warn "Already installed"
else
  run "Docker GPG" bash -c 'install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg'
  run "Docker repo" bash -c "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \$(lsb_release -cs) stable\" > /etc/apt/sources.list.d/docker.list"
  run "apt update" apt-get update -qq
  run "docker-ce" apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run "Enable Docker" systemctl enable --now docker
fi

step 3 $TOTAL_STEPS "Install Node.js 20"
if command -v node &>/dev/null && node -e 'process.exit(+process.version.slice(1)>=18?0:1)' 2>/dev/null; then warn "Already installed ($(node --version))"
else
  run "NodeSource" bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  run "nodejs" apt-get install -y -qq nodejs
fi

step 4 $TOTAL_STEPS "Create directories"
mkdir -p "$PANEL_DIR"/{data,frontend}
ok "$PANEL_DIR"

step 5 $TOTAL_STEPS "Deploy panel files"
if $USE_LOCAL && [ -f "$INSTALL_DIR/package.json" ]; then
  info "Using local files..."
  cp -r "$INSTALL_DIR/src" "$INSTALL_DIR/package.json" "$INSTALL_DIR/tsconfig.json" "$PANEL_DIR/"
  cp -r "$INSTALL_DIR/frontend/." "$PANEL_DIR/frontend/"
  ok "Files copied"
else
  rm -rf /tmp/mcpanel-repo
  run "Clone repo" git clone --depth 1 "$REPO_URL" /tmp/mcpanel-repo
  cp -r /tmp/mcpanel-repo/src /tmp/mcpanel-repo/package.json /tmp/mcpanel-repo/tsconfig.json "$PANEL_DIR/"
  cp -r /tmp/mcpanel-repo/frontend/. "$PANEL_DIR/frontend/"
  rm -rf /tmp/mcpanel-repo
  ok "Files deployed"
fi

step 6 $TOTAL_STEPS "Build panel"
run "Backend deps" bash -c "cd $PANEL_DIR && npm install --silent"
run "Backend build" bash -c "cd $PANEL_DIR && npx tsc"
run "Frontend deps" bash -c "cd $PANEL_DIR/frontend && npm install --silent"
run "Frontend build" bash -c "cd $PANEL_DIR/frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:$PANEL_PORT npx next build"

step 7 $TOTAL_STEPS "Configure services"
[ -z "$API_KEY" ] && API_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
cat > "$PANEL_DIR/.env" << EOF
PANEL_PORT=$PANEL_PORT
PANEL_API_KEY=$API_KEY
BACKEND_URL=http://127.0.0.1:$PANEL_PORT
EOF
chmod 600 "$PANEL_DIR/.env"
ok "Config saved"

cat > /etc/systemd/system/mcpanel-backend.service << 'SVC'
[Unit]
Description=MCPanel Backend
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mcpanel
EnvironmentFile=/opt/mcpanel/.env
ExecStart=/usr/bin/node /opt/mcpanel/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

cat > /etc/systemd/system/mcpanel-frontend.service << 'SVC'
[Unit]
Description=MCPanel Frontend
After=network.target mcpanel-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mcpanel/frontend
ExecStart=/usr/bin/npx next start -p 3001
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

run "Reload systemd" systemctl daemon-reload
run "Enable services" bash -c "systemctl enable mcpanel-backend mcpanel-frontend"

step 8 $TOTAL_STEPS "Start MCPanel"
systemctl start mcpanel-backend; sleep 2
systemctl start mcpanel-frontend; sleep 3
systemctl is-active mcpanel-backend --quiet && ok "Backend running" || warn "Backend may need a moment"
systemctl is-active mcpanel-frontend --quiet && ok "Frontend running" || warn "Frontend may need a moment"

if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow $PANEL_PORT/tcp 2>/dev/null
  ufw allow $FRONTEND_PORT/tcp 2>/dev/null
fi

} 2>&1 | tee /tmp/mcpanel-install.log

IP=$(hostname -I | awk '{print $1}')
clear
echo
echo -e "  ${G}▓▒░${N} ${BOLD}${W}MCPANEL${N} ${DIM}·  Installer${N}"
echo -e "  ${G}────────────────────────────────${N}"
echo
echo -e "  ${G}✔${N}  ${BOLD}Installation complete${N}"
echo
echo -e "  ${D}Panel:${N}  ${W}http://${IP}:${FRONTEND_PORT}${N}"
echo -e "  ${D}Login:${N}  ${W}admin / admin${N}"
echo
echo -e "  ${D}Services:${N}"
echo -e "  systemctl restart mcpanel-backend"
echo -e "  journalctl -u mcpanel-backend -f"
echo
