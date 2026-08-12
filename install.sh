#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║     Obsidian Panel — One-Line Installer                      ║
# ║   curl -fsSL ... | bash   — or —   wget -qO- ... | bash     ║
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
INSTALL_LOG="/tmp/mcpanel-install.log"

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
      echo "  --api-key KEY   Pre-set API key (kept on reinstall)"
      echo "  --local         Use local files (dev)"
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
  echo -e "  ${G}▓▒░${N} ${BOLD}${W}OBSIDIAN PANEL${N} ${DIM}·  Installer${N}"
  echo -e "  ${G}────────────────────────────────${N}"
  echo
  echo -e "  ${G}[${bar}]${N} ${DIM}${pct}%${N}  ${W}${n}/${total}${N}  ${BOLD}${label}${N}"
  echo
  echo -e "  ${D}────────────────────────────────────────────────${N}"
  echo
}

ok()   { echo -e "  ${G}✔${N}  $1"; }
fail() { echo -e "  ${R}✖  $1${N}"; echo -e "  ${D}Full log: ${INSTALL_LOG}${N}"; exit 1; }
warn() { echo -e "  ${Y}⚠${N}  $1"; }
info() { echo -e "  ${D}→${N}  ${DIM}$1${N}"; }

# Animated status line while a step runs — writes straight to the TTY so it
# never pollutes the install log. Shows a spinner + elapsed seconds so long
# steps (Docker pull, next build) never look frozen.
spinner() {
  local pid="$1" label="$2"
  # Without a real controlling terminal (CI, piped install) there is no TTY —
  # run silently. Subshell so the redirect error is swallowed cleanly.
  if ! ( : >/dev/tty ) 2>/dev/null; then
    return 0
  fi
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0 elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  %s  %s   ${D}%ss${N}   " "${frames[$((i % 10))]}" "$label" "$elapsed" > /dev/tty 2>/dev/null || true
    i=$((i + 1)); sleep 0.1
    [ $((i % 10)) -eq 0 ] && elapsed=$((elapsed + 1))
  done
  # clear the status line (longer than any label we print)
  printf "\r%*s\r" "70" "" > /dev/tty 2>/dev/null || true
}

run() {
  local label="$1"; shift
  info "$label"
  local pid
  "$@" >> "$INSTALL_LOG" 2>&1 &
  pid=$!
  spinner "$pid" "$label"
  if wait "$pid"; then ok "$label"
  else fail "$label (check $INSTALL_LOG)"; fi
}

[ "$EUID" -ne 0 ] && { echo -e "${R}Please run as root.${N}"; exit 1; }
. /etc/os-release 2>/dev/null || true
case "${ID:-}" in debian|ubuntu) ;; *) fail "Debian or Ubuntu required." ;; esac

# Fresh install log for this run (tee appends below — truncate first).
: > "$INSTALL_LOG"

# Detect an existing installation (`.env` is the reliable marker — it always
# exists after a successful install, unlike servers.json which only appears
# once a server is created).
if [ -d "$PANEL_DIR" ] && [ -f "$PANEL_DIR/.env" ]; then
  clear
  echo; echo -e "  ${Y}⚠${N}  Obsidian Panel is already installed."; echo
  ans="n"
  printf "  Reinstall? Data stays. [y/N]: " 
  read -r ans < /dev/tty 2>/dev/null || ans="n"
  case "$ans" in [yY]) ;; *) echo -e "  ${D}Cancelled.${N}"; exit 0 ;; esac
  # Keep the existing API key unless the user explicitly passed a new one.
  if [ -z "$API_KEY" ]; then
    API_KEY="$(sed -n 's/^PANEL_API_KEY=//p' "$PANEL_DIR/.env" | head -n1)"
  fi
  systemctl stop mcpanel-backend mcpanel-frontend 2>/dev/null || true
fi

{
step 1 $TOTAL_STEPS "Install dependencies"
info "${PRETTY_NAME:-Debian}"
run "apt update" apt-get update -qq
run "curl git tar rsync" apt-get install -y -qq curl wget gnupg ca-certificates git unzip tar rsync

step 2 $TOTAL_STEPS "Install Docker"
if command -v docker &>/dev/null; then warn "Already installed"
else
  # Docker's repo URL differs between Debian and Ubuntu.
  if [ "$ID" = "ubuntu" ]; then
    DOCKER_REPO="ubuntu"
  else
    DOCKER_REPO="debian"
  fi
  DOCKER_CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-bookworm}}"
  run "Docker GPG" bash -c 'install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg'
  run "Docker repo" bash -c "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DOCKER_REPO} ${DOCKER_CODENAME} stable\" > /etc/apt/sources.list.d/docker.list"
  run "apt update" apt-get update -qq
  run "docker-ce" apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run "Enable Docker" systemctl enable --now docker
fi

step 3 $TOTAL_STEPS "Install Node.js 22"
# Next.js 16 requires Node >= 20 — accept only 20+, otherwise (re)install 22.
if command -v node &>/dev/null && node -e 'process.exit(+process.version.slice(1)>=20?0:1)' 2>/dev/null; then warn "Already installed ($(node --version))"
else
  run "NodeSource" bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
  run "nodejs" apt-get install -y -qq nodejs
fi

step 4 $TOTAL_STEPS "Create directories"
mkdir -p "$PANEL_DIR"/{data,frontend}
ok "$PANEL_DIR"

step 5 $TOTAL_STEPS "Deploy panel files"
# Remove previous sources first so deleted files don't linger and break the build.
rm -rf "$PANEL_DIR/src" "$PANEL_DIR/frontend/src"
if $USE_LOCAL && [ -f "$INSTALL_DIR/package.json" ]; then
  info "Using local files..."
  cp -r "$INSTALL_DIR/src" "$INSTALL_DIR/package.json" "$INSTALL_DIR/tsconfig.json" "$PANEL_DIR/"
  rsync -a --delete --exclude node_modules --exclude .next "$INSTALL_DIR/frontend/" "$PANEL_DIR/frontend/"
  ok "Files copied"
else
  rm -rf /tmp/mcpanel-repo
  run "Clone repo" git clone --depth 1 "$REPO_URL" /tmp/mcpanel-repo
  cp -r /tmp/mcpanel-repo/src /tmp/mcpanel-repo/package.json /tmp/mcpanel-repo/tsconfig.json "$PANEL_DIR/"
  cp -r /tmp/mcpanel-repo/frontend/. "$PANEL_DIR/frontend/"
  rm -rf /tmp/mcpanel-repo
  ok "Files deployed"
fi

step 6 $TOTAL_STEPS "Configure environment"
# Write .env BEFORE the frontend build: next.config.ts reads BACKEND_URL at
# build time to generate the /api rewrites (wrong port => broken panel).
[ -z "$API_KEY" ] && API_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
cat > "$PANEL_DIR/.env" << EOF
PANEL_PORT=$PANEL_PORT
PANEL_API_KEY=$API_KEY
BACKEND_URL=http://127.0.0.1:$PANEL_PORT
EOF
chmod 600 "$PANEL_DIR/.env"
ok "Config saved ($PANEL_DIR/.env)"

step 7 $TOTAL_STEPS "Build panel"
run "Backend deps" bash -c "cd $PANEL_DIR && npm install --silent"
run "Backend build" bash -c "cd $PANEL_DIR && npx tsc"
run "Frontend deps" bash -c "cd $PANEL_DIR/frontend && npm install --silent"
run "Frontend build" bash -c "cd $PANEL_DIR/frontend && BACKEND_URL=http://127.0.0.1:$PANEL_PORT npx next build"

step 8 $TOTAL_STEPS "Configure & start services"
cat > /etc/systemd/system/mcpanel-backend.service << SVC
[Unit]
Description=Obsidian Panel Backend
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR
EnvironmentFile=$PANEL_DIR/.env
ExecStart=/usr/bin/node $PANEL_DIR/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

cat > /etc/systemd/system/mcpanel-frontend.service << SVC
[Unit]
Description=Obsidian Panel Frontend
After=network.target mcpanel-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR/frontend
EnvironmentFile=$PANEL_DIR/.env
ExecStart=$PANEL_DIR/frontend/node_modules/.bin/next start -p $FRONTEND_PORT
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

run "Reload systemd" systemctl daemon-reload
run "Enable services" bash -c "systemctl enable mcpanel-backend mcpanel-frontend"
run "Start backend" systemctl start mcpanel-backend
run "Start frontend" systemctl start mcpanel-frontend

# Smoke test: wait up to 30 s for the backend API to answer.
tries=0
until curl -fsS "http://127.0.0.1:$PANEL_PORT/api/health" >/dev/null 2>&1; do
  tries=$((tries+1))
  [ $tries -ge 30 ] && { warn "Backend API not responding yet — run: journalctl -u mcpanel-backend -f"; break; }
  sleep 1
done
if systemctl is-active mcpanel-backend --quiet; then ok "Backend running"; else warn "Backend inactive"; fi
if systemctl is-active mcpanel-frontend --quiet; then ok "Frontend running"; else warn "Frontend inactive"; fi

if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow $FRONTEND_PORT/tcp 2>/dev/null
fi

} 2>&1 | tee -a "$INSTALL_LOG"

IP=$(hostname -I | awk '{print $1}')
clear
echo
echo -e "  ${G}▓▒░${N} ${BOLD}${W}OBSIDIAN PANEL${N} ${DIM}·  Installer${N}"
echo -e "  ${G}────────────────────────────────${N}"
echo
echo -e "  ${G}✔${N}  ${BOLD}Installation complete${N}"
echo
echo -e "  ${D}Panel:${N}  ${W}http://${IP}:${FRONTEND_PORT}${N}"
echo -e "  ${D}Login:${N}  ${W}admin / admin${N}"
echo -e "  ${D}API key:${N} ${DIM}$PANEL_DIR/.env${N}"
echo
echo -e "  ${D}Services:${N}"
echo -e "  systemctl restart mcpanel-backend mcpanel-frontend"
echo -e "  journalctl -u mcpanel-backend -f"
echo -e "  ${D}Log: $INSTALL_LOG${N}"
echo
