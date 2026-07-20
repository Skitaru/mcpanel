#!/usr/bin/env bash
# Baut den self-contained install.sh aus den Quelldateien.
# Führe dies aus, um install_standalone.sh zu generieren.
# Dann: curl -sSL https://dein-server/install_standalone.sh | bash

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Baue self-contained Installer..."

SERVER_JS_B64=$(base64 -w0 "$SCRIPT_DIR/app/server.js")
HTML_B64=$(base64 -w0 "$SCRIPT_DIR/app/public/index.html")
PKG_B64=$(base64 -w0 "$SCRIPT_DIR/app/package.json")

cat > "$SCRIPT_DIR/install_standalone.sh" << OUTEREOF
#!/usr/bin/env bash
# MCPanel - Self-Contained Installer
# Verwendung: curl -sSL https://dein-server/install_standalone.sh | bash
set -euo pipefail; IFS=\$'\n\t'

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "\${GREEN}✓\${NC} \$*"; }
info() { echo -e "\${CYAN}→\${NC} \$*"; }
warn() { echo -e "\${YELLOW}⚠\${NC} \$*"; }
fail() { echo -e "\${RED}✗\${NC} \$*"; exit 1; }
hdr()  { echo -e "\n\${BOLD}\${BLUE}▸ \$*\${NC}"; }

PANEL_DIR="/opt/mcpanel"
DATA_DIR="/opt/mcpanel/data"
SERVICE_USER="mcpanel"
PORT=3000
CF_API_KEY=""
INSTALL_JAVA=true

while [[ \$# -gt 0 ]]; do
  case "\$1" in
    --port)    PORT="\$2"; shift 2 ;;
    --cf-key)  CF_API_KEY="\$2"; shift 2 ;;
    --dir)     PANEL_DIR="\$2"; DATA_DIR="\$2/data"; shift 2 ;;
    --no-java) INSTALL_JAVA=false; shift ;;
    --help)
      echo "Verwendung: bash install_standalone.sh [OPTIONEN]"
      echo "  --port PORT    Panel Port (Standard: 3000)"
      echo "  --cf-key KEY   CurseForge API Key"
      echo "  --dir DIR      Installationsverzeichnis (Standard: /opt/mcpanel)"
      echo "  --no-java      Java-Installation überspringen"
      exit 0 ;;
    *) warn "Unbekanntes Argument: \$1"; shift ;;
  esac
done

echo -e "\${BOLD}"
cat << 'BANNER'
  __  __  ____ ____                  _
 |  \\/  |/ ___|  _ \\ __ _ _ __   ___| |
 | |\\/| | |   | |_) / _\` | '_ \\ / _ \\ |
 | |  | | |___|  __/ (_| | | | |  __/ |
 |_|  |_|\\____|_|   \\__,_|_| |_|\\___|_|

 Minecraft Modpack Server Panel - Installer
BANNER
echo -e "\${NC}"

[[ \$EUID -ne 0 ]] && fail "Root-Rechte erforderlich: sudo bash install_standalone.sh"

hdr "Betriebssystem erkennen"
if [ -f /etc/os-release ]; then
  . /etc/os-release; OS=\$ID; ok "Erkannt: \${PRETTY_NAME:-\$ID}"
else
  fail "Unbekanntes Betriebssystem"
fi

hdr "Abhängigkeiten installieren"
case "\$OS" in
  ubuntu|debian)
    apt-get update -qq 2>/dev/null
    apt-get install -y -qq curl wget unzip tar git python3-pip 2>/dev/null
    ;;
  centos|rhel|rocky|almalinux) yum install -y curl wget unzip tar git 2>/dev/null ;;
  fedora) dnf install -y curl wget unzip tar git 2>/dev/null ;;
  *) warn "OS '\${OS}' nicht getestet – fahre fort..." ;;
esac
ok "System-Pakete installiert"

hdr "Node.js 20.x installieren"
NODE_OK=false
if command -v node &>/dev/null; then
  NV=\$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  [[ \${NV:-0} -ge 18 ]] && NODE_OK=true && ok "Node.js \$(node --version) vorhanden"
fi
if ! \$NODE_OK; then
  info "Installiere Node.js 20.x..."
  case "\$OS" in
    ubuntu|debian)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
      apt-get install -y nodejs >/dev/null 2>&1
      ;;
    centos|rhel|rocky|almalinux|fedora)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
      yum install -y nodejs >/dev/null 2>&1 || dnf install -y nodejs >/dev/null 2>&1
      ;;
    *)
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash >/dev/null 2>&1
      export NVM_DIR="\$HOME/.nvm"; [ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
      nvm install 20 >/dev/null 2>&1
      ;;
  esac
  ok "Node.js \$(node --version) installiert"
fi

hdr "Java installieren (21 + 8)"
if \$INSTALL_JAVA; then
  # Java 21 (für MC 1.20.5+, Panel-Betrieb)
  JAVA21_OK=false
  if /usr/lib/jvm/java-21-openjdk-amd64/bin/java -version &>/dev/null 2>&1; then JAVA21_OK=true && ok "Java 21 vorhanden"; fi
  if ! \$JAVA21_OK; then
    info "Installiere Java 21..."
    case "\$OS" in
      ubuntu|debian) apt-get install -y -qq openjdk-21-jre-headless 2>/dev/null ;;
      centos|rhel|rocky|almalinux) yum install -y java-21-openjdk-headless 2>/dev/null ;;
      fedora) dnf install -y java-21-openjdk-headless 2>/dev/null ;;
    esac
    ok "Java 21 installiert"
  fi

  # Java 8 via Adoptium (für Forge < 1.13 / SkyFactory, FTB etc.)
  JAVA8_OK=false
  [ -f /usr/lib/jvm/temurin-8/bin/java ] && JAVA8_OK=true && ok "Java 8 (Temurin) vorhanden"
  if ! \$JAVA8_OK; then
    info "Installiere Java 8 (Temurin) für alte Forge-Modpacks..."
    case "\$OS" in
      ubuntu|debian)
        apt-get install -y -qq wget apt-transport-https gnupg 2>/dev/null
        wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public \
          | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg 2>/dev/null
        . /etc/os-release && echo \
          "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb \${VERSION_CODENAME} main" \
          > /etc/apt/sources.list.d/adoptium.list
        apt-get update -qq 2>/dev/null
        apt-get install -y -qq temurin-8-jdk 2>/dev/null && ok "Java 8 (Temurin) installiert" || warn "Java 8 konnte nicht installiert werden"
        ;;
      *) warn "Java 8 auf diesem OS manuell installieren" ;;
    esac
  fi
fi

hdr "Benutzer und Verzeichnisse anlegen"
id "\$SERVICE_USER" &>/dev/null || useradd --system --shell /bin/bash --home-dir "\$PANEL_DIR" --create-home "\$SERVICE_USER"
mkdir -p "\$PANEL_DIR/app/public" "\$DATA_DIR/servers"
ok "Benutzer '\$SERVICE_USER' und Verzeichnisse bereit"

hdr "Anwendungsdateien schreiben"
info "Schreibe package.json..."
echo '${PKG_B64}' | base64 -d > "\$PANEL_DIR/app/package.json"
ok "package.json"

info "Schreibe server.js..."
echo '${SERVER_JS_B64}' | base64 -d > "\$PANEL_DIR/app/server.js"
ok "server.js"

info "Schreibe Frontend (index.html)..."
echo '${HTML_B64}' | base64 -d > "\$PANEL_DIR/app/public/index.html"
ok "index.html"

hdr "NPM Pakete installieren"
cd "\$PANEL_DIR/app"
npm install --omit=dev 2>&1 | grep -E '(added|warn.*WARN|error)' || true
ok "NPM Pakete installiert"

hdr "Konfiguration erstellen"
JWT_SECRET=\$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
cat > "\$PANEL_DIR/.env" << ENVEOF
PORT=\$PORT
DATA_DIR=\$DATA_DIR
JWT_SECRET=\$JWT_SECRET
CF_API_KEY=\$CF_API_KEY
ENVEOF
chmod 600 "\$PANEL_DIR/.env"
ok ".env erstellt"

hdr "Systemd Service einrichten"
cat > /etc/systemd/system/mcpanel.service << SVCEOF
[Unit]
Description=MCPanel - Minecraft Modpack Server Panel
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=\$SERVICE_USER
Group=\$SERVICE_USER
WorkingDirectory=\$PANEL_DIR/app
EnvironmentFile=\$PANEL_DIR/.env
ExecStart=\$(which node) \$PANEL_DIR/app/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcpanel
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=\$PANEL_DIR \$DATA_DIR /tmp/mcpanel-uploads /usr/lib/jvm

[Install]
WantedBy=multi-user.target
SVCEOF
systemctl daemon-reload
ok "Systemd Service konfiguriert"

hdr "Berechtigungen setzen"
chown -R "\$SERVICE_USER:\$SERVICE_USER" "\$PANEL_DIR"
mkdir -p /tmp/mcpanel-uploads && chown "\$SERVICE_USER:\$SERVICE_USER" /tmp/mcpanel-uploads
ok "Berechtigungen gesetzt"

hdr "Firewall konfigurieren"
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
  ufw allow "\$PORT/tcp" 2>/dev/null && ok "UFW: Port \$PORT freigegeben"
elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q running; then
  firewall-cmd --permanent --add-port="\$PORT/tcp" 2>/dev/null
  firewall-cmd --reload 2>/dev/null && ok "Firewalld: Port \$PORT freigegeben"
else
  warn "Keine aktive Firewall erkannt"
fi

hdr "Service starten"
systemctl enable mcpanel --quiet 2>/dev/null
systemctl start mcpanel
sleep 2
systemctl is-active mcpanel --quiet && ok "MCPanel läuft!" || warn "Prüfe: journalctl -u mcpanel -f"

SERVER_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}' || echo "localhost")

echo ""
echo -e "\${BOLD}\${GREEN}╔══════════════════════════════════════════════════════════╗\${NC}"
echo -e "\${BOLD}\${GREEN}║         MCPanel erfolgreich installiert! ✅              ║\${NC}"
echo -e "\${BOLD}\${GREEN}╠══════════════════════════════════════════════════════════╣\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}  \${BOLD}🌐 Panel:\${NC}     http://\${SERVER_IP}:\${PORT}"
echo -e "\${BOLD}\${GREEN}║\${NC}  \${BOLD}👤 Login:\${NC}     admin / admin"
echo -e "\${BOLD}\${GREEN}║\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}  \${YELLOW}⚠  Bitte Passwort sofort ändern!\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}  \${BOLD}Nächste Schritte:\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}  1. Öffne http://\${SERVER_IP}:\${PORT} im Browser"
echo -e "\${BOLD}\${GREEN}║\${NC}  2. CurseForge API Key eintragen (Einstellungen)"
echo -e "\${BOLD}\${GREEN}║\${NC}     → https://console.curseforge.com → API Keys"
echo -e "\${BOLD}\${GREEN}║\${NC}  3. Neuen Server + Modpack auswählen"
echo -e "\${BOLD}\${GREEN}║\${NC}  4. server.jar hochladen, Server starten ▶"
echo -e "\${BOLD}\${GREEN}║\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}  \${BOLD}Verwaltung:\${NC}"
echo -e "\${BOLD}\${GREEN}║\${NC}  systemctl status mcpanel"
echo -e "\${BOLD}\${GREEN}║\${NC}  journalctl -u mcpanel -f"
echo -e "\${BOLD}\${GREEN}╚══════════════════════════════════════════════════════════╝\${NC}"
echo ""
OUTEREOF

chmod +x "$SCRIPT_DIR/install_standalone.sh"
echo ""
echo "✅ Standalone-Installer erstellt: install_standalone.sh"
echo ""
echo "Verwende:"
echo "  Lokal:   sudo bash install_standalone.sh"
echo "  Remote:  curl -sSL https://dein-server/install_standalone.sh | sudo bash"
echo "  Mit Key: sudo bash install_standalone.sh --cf-key DEIN_KEY --port 3000"
echo ""
wc -c "$SCRIPT_DIR/install_standalone.sh" | awk '{printf "Dateigröße: %.1f KB\n", $1/1024}'
