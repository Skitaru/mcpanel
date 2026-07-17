#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║           MCPanel — One-Line Installer                      ║
# ║   curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash  ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'
B='\033[1;34m'; W='\033[1;37m'; D='\033[0;90m'; N='\033[0m'
ok()   { echo -e "  ${G}✔${N}  $*"; }
info() { echo -e "  ${C}→${N}  ${D}$*${N}"; }
warn() { echo -e "  ${Y}⚠${N}  $*"; }
fail() { echo -e "  ${R}✖${N}  $*"; exit 1; }
step() { echo -e "\n${B}▸${N} ${W}$*${N}"; echo -e "  ${D}────────────────────────────────────────${N}"; }
banner() {
  echo -e "\n${W}"
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║        MCPanel Installer            ║"
  echo "  ║   Minecraft Server Panel            ║"
  echo "  ╚══════════════════════════════════════╝"
  echo -e "${N}"
}

# ── Config ───────────────────────────────────────────────────────
PANEL_DIR="${PANEL_DIR:-/opt/mcpanel}"
PANEL_PORT="${PANEL_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
API_KEY="${API_KEY:-}"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
USE_LOCAL=false

# ── Parse args ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)   PANEL_DIR="$2"; shift 2 ;;
    --port)  PANEL_PORT="$2"; shift 2 ;;
    --fe-port) FRONTEND_PORT="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --local) USE_LOCAL=true; shift ;;
    --help)
      echo "Usage: bash install.sh [OPTIONS]"
      echo "  --dir DIR         Install directory (default: /opt/mcpanel)"
      echo "  --port PORT       Backend port (default: 3000)"
      echo "  --fe-port PORT    Frontend port (default: 3001)"
      echo "  --api-key KEY     Pre-set API key"
      echo "  --local           Use local files instead of downloading"
      exit 0 ;;
    *) warn "Unknown: $1"; shift ;;
  esac
done

banner

# ── Root check ──────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "Please run as root: sudo bash install.sh"

# ── OS detection ────────────────────────────────────────────────
step "Detecting operating system"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS="${ID:-unknown}"
  OS_VER="${VERSION_ID:-unknown}"
  ok "Detected: ${PRETTY_NAME:-$OS $OS_VER}"
else
  fail "Cannot detect OS. Debian 11/12/13 or Ubuntu 22.04/24.04 required."
fi

case "$OS" in
  debian|ubuntu) ;;
  *) fail "Unsupported OS '$OS'. Debian/Ubuntu required." ;;
esac

# ── Install dependencies ────────────────────────────────────────
step "Installing system dependencies"
apt-get update -qq
apt-get install -y -qq curl wget gnupg ca-certificates lsb-release \
  apt-transport-https git unzip tar build-essential 2>/dev/null
ok "System packages installed"

# ── Install Docker ──────────────────────────────────────────────
step "Installing Docker"
if command -v docker &>/dev/null; then
  ok "Docker already installed ($(docker --version))"
else
  info "Adding Docker repository..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/${OS}/gpg 2>/dev/null | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${OS} $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null
  systemctl enable --now docker
  ok "Docker installed"
fi

# ── Install Node.js 20 ──────────────────────────────────────────
step "Installing Node.js 20"
if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1 | tr -d 'v')" -ge 18 ]; then
  ok "Node.js already installed ($(node --version))"
else
  info "Adding NodeSource repository..."
  curl -fsSL https://deb.nodesource.com/setup_20.x 2>/dev/null | bash - 2>/dev/null
  apt-get install -y -qq nodejs 2>/dev/null
  ok "Node.js $(node --version) installed"
fi

# ── Create directory structure ──────────────────────────────────
step "Creating directory structure"
mkdir -p "$PANEL_DIR"/{data,frontend}
ok "Created $PANEL_DIR"

# ── Deploy panel files ──────────────────────────────────────────
step "Deploying panel files"
if $USE_LOCAL && [ -f "$INSTALL_DIR/package.json" ]; then
  info "Using local files from $INSTALL_DIR"
  # Backend
  cp -r "$INSTALL_DIR/src" "$PANEL_DIR/"
  cp "$INSTALL_DIR/package.json" "$PANEL_DIR/"
  cp "$INSTALL_DIR/package-lock.json" "$PANEL_DIR/" 2>/dev/null || true
  cp "$INSTALL_DIR/tsconfig.json" "$PANEL_DIR/"
  # Frontend
  cp -r "$INSTALL_DIR/frontend/src" "$PANEL_DIR/frontend/"
  cp "$INSTALL_DIR/frontend/package.json" "$PANEL_DIR/frontend/"
  cp "$INSTALL_DIR/frontend/package-lock.json" "$PANEL_DIR/frontend/" 2>/dev/null || true
  cp "$INSTALL_DIR/frontend/tsconfig.json" "$PANEL_DIR/frontend/"
  cp "$INSTALL_DIR/frontend/next.config.ts" "$PANEL_DIR/frontend/"
  cp "$INSTALL_DIR/frontend/postcss.config.mjs" "$PANEL_DIR/frontend/"
  cp "$INSTALL_DIR/frontend/eslint.config.mjs" "$PANEL_DIR/frontend/" 2>/dev/null || true
  cp -r "$INSTALL_DIR/frontend/public" "$PANEL_DIR/frontend/" 2>/dev/null || true
  ok "Panel files copied"
else
  info "Cloning from repository..."
  REPO_URL="${REPO_URL:-https://github.com/Skitaru/mcpanel.git}"
  if [ -d /tmp/mcpanel-repo ]; then rm -rf /tmp/mcpanel-repo; fi
  git clone --depth 1 "$REPO_URL" /tmp/mcpanel-repo 2>/dev/null || \
    fail "Failed to clone repository. Set REPO_URL or use --local."
  cp -r /tmp/mcpanel-repo/src "$PANEL_DIR/"
  cp /tmp/mcpanel-repo/package.json "$PANEL_DIR/"
  cp /tmp/mcpanel-repo/tsconfig.json "$PANEL_DIR/"
  cp -r /tmp/mcpanel-repo/frontend/src "$PANEL_DIR/frontend/"
  cp /tmp/mcpanel-repo/frontend/package.json "$PANEL_DIR/frontend/"
  cp /tmp/mcpanel-repo/frontend/tsconfig.json "$PANEL_DIR/frontend/"
  cp /tmp/mcpanel-repo/frontend/next.config.ts "$PANEL_DIR/frontend/"
  cp /tmp/mcpanel-repo/frontend/postcss.config.mjs "$PANEL_DIR/frontend/"
  cp -r /tmp/mcpanel-repo/frontend/public "$PANEL_DIR/frontend/" 2>/dev/null || true
  rm -rf /tmp/mcpanel-repo
  ok "Panel files deployed"
fi

# ── Install NPM deps + build backend ────────────────────────────
step "Building backend"
cd "$PANEL_DIR"
npm install --omit=dev 2>&1 | tail -1
npx tsc 2>&1 | tail -3 || warn "Backend build had warnings — check logs"
ok "Backend built"

# ── Install NPM deps + build frontend ───────────────────────────
step "Building frontend"
cd "$PANEL_DIR/frontend"
npm install 2>&1 | tail -1
npx next build 2>&1 | tail -3 || warn "Frontend build had warnings — check logs"
ok "Frontend built"

# ── Environment config ──────────────────────────────────────────
step "Creating configuration"
if [ -z "$API_KEY" ]; then
  API_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
fi
cat > "$PANEL_DIR/.env" << ENVFILE
PANEL_PORT=$PANEL_PORT
PANEL_API_KEY=$API_KEY
BACKEND_URL=http://127.0.0.1:$PANEL_PORT
ENVFILE
chmod 600 "$PANEL_DIR/.env"
ok "Configuration saved"

# ── Systemd: Backend ────────────────────────────────────────────
step "Setting up systemd service (backend)"
cat > /etc/systemd/system/mcpanel-backend.service << EOF
[Unit]
Description=MCPanel Backend
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR
EnvironmentFile=$PANEL_DIR/.env
ExecStart=$(which node) $PANEL_DIR/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcpanel-backend

[Install]
WantedBy=multi-user.target
EOF
ok "Backend service created"

# ── Systemd: Frontend ───────────────────────────────────────────
step "Setting up systemd service (frontend)"
cat > /etc/systemd/system/mcpanel-frontend.service << EOF
[Unit]
Description=MCPanel Frontend
After=network.target mcpanel-backend.service
Requires=mcpanel-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=$PANEL_DIR/frontend
Environment="PORT=$FRONTEND_PORT"
Environment="BACKEND_URL=http://127.0.0.1:$PANEL_PORT"
ExecStart=$(which npx) next start -p $FRONTEND_PORT
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcpanel-frontend

[Install]
WantedBy=multi-user.target
EOF
ok "Frontend service created"

systemctl daemon-reload

# ── Firewall ────────────────────────────────────────────────────
step "Configuring firewall"
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow $PANEL_PORT/tcp 2>/dev/null
  ufw allow $FRONTEND_PORT/tcp 2>/dev/null
  ok "UFW: ports $PANEL_PORT, $FRONTEND_PORT opened"
elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q running; then
  firewall-cmd --permanent --add-port=$PANEL_PORT/tcp --add-port=$FRONTEND_PORT/tcp 2>/dev/null
  firewall-cmd --reload 2>/dev/null
  ok "Firewalld: ports opened"
else
  warn "No firewall detected — open ports $PANEL_PORT and $FRONTEND_PORT manually"
fi

# ── Start services ──────────────────────────────────────────────
step "Starting MCPanel"
systemctl enable mcpanel-backend mcpanel-frontend --quiet
systemctl start mcpanel-backend
sleep 3
systemctl start mcpanel-frontend

sleep 3
BACKEND_OK=false
FRONTEND_OK=false
systemctl is-active mcpanel-backend --quiet && BACKEND_OK=true
systemctl is-active mcpanel-frontend --quiet && FRONTEND_OK=true

# ── Get IP ──────────────────────────────────────────────────────
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

# ── Done ────────────────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════════════════════╗${N}"
echo -e "${G}║         MCPanel installed!                              ║${N}"
echo -e "${G}╠══════════════════════════════════════════════════════════╣${N}"
echo -e "${G}║${N}  ${W}Frontend:${N}  http://${SERVER_IP}:${FRONTEND_PORT}"
echo -e "${G}║${N}  ${W}Backend:${N}   http://${SERVER_IP}:${PANEL_PORT}"
echo -e "${G}║${N}"
if [ -n "$API_KEY" ]; then
  echo -e "${G}║${N}  ${W}API Key:${N}   ${API_KEY}"
  echo -e "${G}║${N}"
fi
echo -e "${G}║${N}  ${W}Services:${N}"
echo -e "${G}║${N}  systemctl status mcpanel-backend"
echo -e "${G}║${N}  systemctl status mcpanel-frontend"
echo -e "${G}║${N}  journalctl -u mcpanel-backend -f"
echo -e "${G}║${N}"
echo -e "${G}║${N}  ${W}Data:${N}    $PANEL_DIR/data"
echo -e "${G}║${N}  ${W}Config:${N}  $PANEL_DIR/servers.json"
echo -e "${G}╚══════════════════════════════════════════════════════════╝${N}"
echo ""
