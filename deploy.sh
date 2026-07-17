#!/usr/bin/env bash
# =============================================================================
#  MCPanel — Debian Deployment Script
#  One-command setup for the Minecraft Server Panel on Debian 12/13.
#
#  Usage (as root):
#    curl -fsSL https://raw.githubusercontent.com/.../deploy.sh | bash
#
#  Or locally after transferring the project:
#    chmod +x deploy.sh && sudo ./deploy.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[MCPanel]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ---------------------------------------------------------------------------
# 1. Preflight checks
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then err "Please run as root (sudo ./deploy.sh)"; fi
if ! grep -qi debian /etc/os-release 2>/dev/null; then
  log "Warning: This script is designed for Debian. Proceeding anyway..."
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_USER="${PANEL_USER:-mcpanel}"
PANEL_HOME="/opt/mcpanel"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"

log "Project dir : ${PROJECT_DIR}"
log "Install path: ${PANEL_HOME}"
log "Panel user  : ${PANEL_USER}"
log "Backend     : port ${BACKEND_PORT}"
log "Frontend    : port ${FRONTEND_PORT}"

# ---------------------------------------------------------------------------
# 2. System dependencies
# ---------------------------------------------------------------------------
log "Installing system packages..."
apt-get update -qq

# Node.js 22 (via NodeSource)
if ! command -v node &>/dev/null || [[ $(node -v) != v22* ]]; then
  log "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
ok "Node.js $(node -v)"

# Build tools + essentials
apt-get install -y git curl tar gzip 2>/dev/null || true

# Docker (if not installed)
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable --now docker
fi
ok "Docker $(docker --version 2>/dev/null || echo 'installed')"

# ---------------------------------------------------------------------------
# 3. Create panel user & directory
# ---------------------------------------------------------------------------
if ! id -u "${PANEL_USER}" &>/dev/null; then
  useradd -r -m -d "${PANEL_HOME}" -s /bin/bash "${PANEL_USER}"
  usermod -aG docker "${PANEL_USER}"
  ok "Created user '${PANEL_USER}' (added to docker group)"
else
  log "User '${PANEL_USER}' already exists"
fi

# Only copy if deploying from a different directory
if [[ "${PROJECT_DIR}" != "${PANEL_HOME}" ]]; then
  log "Copying project to ${PANEL_HOME}..."
  rsync -a --delete \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.next' \
    --exclude='data' \
    --exclude='servers.json' \
    "${PROJECT_DIR}/" "${PANEL_HOME}/"
fi

chown -R "${PANEL_USER}:${PANEL_USER}" "${PANEL_HOME}"

# ---------------------------------------------------------------------------
# 4. Backend setup
# ---------------------------------------------------------------------------
log "Installing backend dependencies..."
cd "${PANEL_HOME}"
sudo -u "${PANEL_USER}" npm install

log "Building backend (TypeScript)..."
sudo -u "${PANEL_USER}" npm run build
ok "Backend built → dist/"

# Create data directory
mkdir -p "${PANEL_HOME}/data"
chown "${PANEL_USER}:${PANEL_USER}" "${PANEL_HOME}/data"

# ---------------------------------------------------------------------------
# 5. Frontend setup
# ---------------------------------------------------------------------------
log "Installing frontend dependencies..."
cd "${PANEL_HOME}/frontend"
sudo -u "${PANEL_USER}" npm install

log "Building frontend (Next.js)..."
sudo -u "${PANEL_USER}" npx next build
ok "Frontend built → .next/"

# ---------------------------------------------------------------------------
# 6. systemd services
# ---------------------------------------------------------------------------
log "Creating systemd services..."

cat > /etc/systemd/system/mcpanel-backend.service << SYSTEMD
[Unit]
Description=MCPanel Backend Daemon
After=docker.service network.target
Wants=docker.service

[Service]
Type=simple
User=${PANEL_USER}
WorkingDirectory=${PANEL_HOME}
Environment=PANEL_PORT=${BACKEND_PORT}
Environment=NODE_ENV=production
ExecStart=$(which node) dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SYSTEMD

cat > /etc/systemd/system/mcpanel-frontend.service << SYSTEMD
[Unit]
Description=MCPanel Frontend (Next.js)
After=network.target mcpanel-backend.service
Wants=mcpanel-backend.service

[Service]
Type=simple
User=${PANEL_USER}
WorkingDirectory=${PANEL_HOME}/frontend
Environment=PORT=${FRONTEND_PORT}
Environment=NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
Environment=NODE_ENV=production
ExecStart=$(which node) node_modules/.bin/next start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
ok "systemd units created"

# ---------------------------------------------------------------------------
# 7. Firewall (optional — only if ufw is active)
# ---------------------------------------------------------------------------
if command -v ufw &>/dev/null && ufw status | grep -qw active; then
  ufw allow ${BACKEND_PORT}/tcp comment "MCPanel Backend"
  ufw allow ${FRONTEND_PORT}/tcp comment "MCPanel Frontend"
  ok "Firewall rules added for ports ${BACKEND_PORT}, ${FRONTEND_PORT}"
fi

# ---------------------------------------------------------------------------
# 8. Start services
# ---------------------------------------------------------------------------
log "Starting services..."
systemctl enable --now mcpanel-backend mcpanel-frontend
sleep 2

# ---------------------------------------------------------------------------
# 9. Verify
# ---------------------------------------------------------------------------
echo ""
echo "============================================="
echo -e "  ${GREEN}MCPanel deployed successfully!${NC}"
echo "============================================="
echo ""
echo "  Backend:  http://$(hostname -I | awk '{print $1}'):${BACKEND_PORT}"
echo "  Frontend: http://$(hostname -I | awk '{print $1}'):${FRONTEND_PORT}"
echo ""
echo "  Health check:"
echo "    curl http://localhost:${BACKEND_PORT}/api/health"
echo ""
echo "  Service management:"
echo "    systemctl status mcpanel-backend"
echo "    systemctl status mcpanel-frontend"
echo "    journalctl -u mcpanel-backend -f"
echo "    journalctl -u mcpanel-frontend -f"
echo ""
echo "  Data lives in: ${PANEL_HOME}/data/"
echo "  Config file:   ${PANEL_HOME}/servers.json"
echo ""

# Quick health check
sleep 1
if curl -sf http://localhost:${BACKEND_PORT}/api/health >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓ Backend is healthy${NC}"
else
  echo -e "  ${RED}✗ Backend health check failed — check journalctl${NC}"
fi
