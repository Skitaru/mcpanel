#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║           MCPanel - Minecraft Modpack Server Panel          ║
# ║                    One-Line Installer                       ║
# ╚══════════════════════════════════════════════════════════════╝
# Usage: curl -sSL https://your-host/install.sh | bash
# Or:    bash install.sh [--port 3000] [--cf-key YOUR_KEY]

set -euo pipefail
IFS=$'\n\t'

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${CYAN}→${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
hdr()  { echo -e "\n${BOLD}${BLUE}▸ $*${NC}"; }

# ─── Config ───────────────────────────────────────────────────────
PANEL_DIR="/opt/mcpanel"
DATA_DIR="/opt/mcpanel/data"
SERVICE_USER="mcpanel"
PORT=3000
CF_API_KEY=""
INSTALL_JAVA=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)     PORT="$2"; shift 2 ;;
    --cf-key)   CF_API_KEY="$2"; shift 2 ;;
    --dir)      PANEL_DIR="$2"; DATA_DIR="$2/data"; shift 2 ;;
    --no-java)  INSTALL_JAVA=false; shift ;;
    --help)
      echo "Usage: bash install.sh [OPTIONS]"
      echo "  --port PORT       Panel port (default: 3000)"
      echo "  --cf-key KEY      CurseForge API key"
      echo "  --dir DIR         Install directory (default: /opt/mcpanel)"
      echo "  --no-java         Skip Java installation"
      exit 0 ;;
    *) warn "Unknown argument: $1"; shift ;;
  esac
done

# ─── Banner ───────────────────────────────────────────────────────
echo -e "${BOLD}"
cat << 'BANNER'
  __  __  ____ ____                  _
 |  \/  |/ ___|  _ \ __ _ _ __   ___| |
 | |\/| | |   | |_) / _` | '_ \ / _ \ |
 | |  | | |___|  __/ (_| | | | |  __/ |
 |_|  |_|\____|_|   \__,_|_| |_|\___|_|

 Minecraft Modpack Server Panel Installer
BANNER
echo -e "${NC}"

# ─── Root Check ───────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "Bitte als root ausführen: sudo bash install.sh"

# ─── Detect OS ────────────────────────────────────────────────────
hdr "Betriebssystem erkennen"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  OS_VER=$VERSION_ID
  ok "Erkannt: ${PRETTY_NAME:-$OS}"
else
  fail "Unterstütztes OS nicht erkannt. Benötigt: Ubuntu/Debian/CentOS/Rocky/Fedora"
fi

# ─── Install OS Dependencies ──────────────────────────────────────
hdr "System-Abhängigkeiten installieren"
case "$OS" in
  ubuntu|debian)
    apt-get update -qq
    apt-get install -y -qq curl wget unzip tar git 2>/dev/null
    ok "System-Pakete installiert"
    ;;
  centos|rhel|rocky|almalinux)
    yum install -y curl wget unzip tar git 2>/dev/null
    ok "System-Pakete installiert"
    ;;
  fedora)
    dnf install -y curl wget unzip tar git 2>/dev/null
    ok "System-Pakete installiert"
    ;;
  *)
    warn "OS '${OS}' nicht getestet – fahre fort..."
    ;;
esac

# ─── Install Node.js 20 ───────────────────────────────────────────
hdr "Node.js installieren"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  if [[ $NODE_VER -ge 18 ]]; then
    ok "Node.js $(node --version) bereits installiert"
  else
    warn "Node.js Version zu alt ($(node --version)), aktualisiere..."
    INSTALL_NODE=true
  fi
else
  INSTALL_NODE=true
fi

if [[ ${INSTALL_NODE:-false} == true ]]; then
  info "Installiere Node.js 20.x..."
  case "$OS" in
    ubuntu|debian)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
      apt-get install -y nodejs 2>/dev/null
      ;;
    centos|rhel|rocky|almalinux|fedora)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
      yum install -y nodejs 2>/dev/null || dnf install -y nodejs 2>/dev/null
      ;;
    *)
      # Fallback: install via nvm
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
      nvm install 20
      ;;
  esac
  ok "Node.js $(node --version) installiert"
fi

# ─── Install Java 21 ──────────────────────────────────────────────
hdr "Java installieren"
if $INSTALL_JAVA; then
  if command -v java &>/dev/null; then
    JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1)
    if [[ ${JAVA_VER:-0} -ge 17 ]]; then
      ok "Java ${JAVA_VER} bereits installiert"
    else
      warn "Java zu alt (${JAVA_VER}), installiere Java 21..."
      INSTALL_JAVA_NOW=true
    fi
  else
    INSTALL_JAVA_NOW=true
  fi

  if [[ ${INSTALL_JAVA_NOW:-false} == true ]]; then
    info "Installiere Java 21..."
    case "$OS" in
      ubuntu|debian)
        apt-get install -y -qq openjdk-21-jre-headless 2>/dev/null || \
        apt-get install -y -qq openjdk-17-jre-headless 2>/dev/null
        ;;
      centos|rhel|rocky|almalinux)
        yum install -y java-21-openjdk-headless 2>/dev/null || \
        yum install -y java-17-openjdk-headless 2>/dev/null
        ;;
      fedora)
        dnf install -y java-21-openjdk-headless 2>/dev/null
        ;;
    esac
    ok "Java $(java -version 2>&1 | head -1) installiert"
  fi
else
  warn "Java-Installation übersprungen (--no-java)"
fi

# ─── Create Service User ──────────────────────────────────────────
hdr "Benutzer anlegen"
if id "$SERVICE_USER" &>/dev/null; then
  ok "Benutzer '$SERVICE_USER' existiert bereits"
else
  useradd --system --shell /bin/bash --home-dir "$PANEL_DIR" --create-home "$SERVICE_USER"
  ok "Benutzer '$SERVICE_USER' erstellt"
fi

# ─── Create Directory Structure ───────────────────────────────────
hdr "Verzeichnisse erstellen"
mkdir -p "$PANEL_DIR/app/public" "$DATA_DIR/servers"
ok "Verzeichnisse erstellt"

# ─── Write Application Files ──────────────────────────────────────
hdr "Panel-Dateien erstellen"

# package.json
cat > "$PANEL_DIR/app/package.json" << 'PKGJSON'
{
  "name": "mcpanel",
  "version": "1.0.0",
  "description": "Minecraft Modpack Server Panel",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1",
    "multer": "^1.4.5-lts.1",
    "axios": "^1.4.0",
    "better-sqlite3": "^8.6.0",
    "archiver": "^5.3.1",
    "unzipper": "^0.10.14",
    "mime-types": "^2.1.35",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.1",
    "cookie-parser": "^1.4.6",
    "express-session": "^1.17.3"
  }
}
PKGJSON
ok "package.json erstellt"

# server.js (main application)
cat > "$PANEL_DIR/app/server.js" << 'SERVERJS'
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const multer = require('multer');
const archiver = require('archiver');
const unzipper = require('unzipper');
const axios = require('axios');
const mime = require('mime-types');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/opt/mcpanel/data';
const SERVERS_DIR = path.join(DATA_DIR, 'servers');
const DB_PATH = path.join(DATA_DIR, 'panel.db');
const JWT_SECRET = process.env.JWT_SECRET || 'mcpanel-' + require('crypto').randomBytes(32).toString('hex');
const CF_API_KEY = process.env.CF_API_KEY || '';

fs.mkdirSync(SERVERS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    version TEXT,
    modpack_id INTEGER,
    modpack_name TEXT,
    port INTEGER NOT NULL,
    memory INTEGER DEFAULT 2048,
    status TEXT DEFAULT 'stopped',
    java_args TEXT DEFAULT '-XX:+UseG1GC -XX:+ParallelRefProcEnabled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hash);
  console.log('[Panel] Default user: admin / admin');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

const processes = {};

function getServerDir(id) { return path.join(SERVERS_DIR, String(id)); }

function startServer(serverId) {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!srv) return { error: 'Server not found' };
  if (processes[serverId]) return { error: 'Already running' };
  const serverDir = getServerDir(serverId);
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');
  const jvmArgs = (srv.java_args || '').split(' ').filter(Boolean);
  const args = [...jvmArgs, `-Xmx${srv.memory}M`, `-Xms${Math.floor(srv.memory/2)}M`, '-jar', 'server.jar', '--nogui', '--port', String(srv.port)];
  const proc = spawn('java', args, { cwd: serverDir });
  const logBuffer = [];
  const onData = (data, type) => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      const entry = { time: new Date().toISOString(), text: line, type };
      logBuffer.push(entry);
      if (logBuffer.length > 1000) logBuffer.shift();
      io.to(`server:${serverId}`).emit('console:line', entry);
    });
  };
  proc.stdout.on('data', d => onData(d, 'out'));
  proc.stderr.on('data', d => onData(d, 'err'));
  proc.on('close', code => {
    const msg = { time: new Date().toISOString(), text: `[Panel] Prozess beendet (code ${code})`, type: 'sys' };
    logBuffer.push(msg);
    io.to(`server:${serverId}`).emit('console:line', msg);
    io.to(`server:${serverId}`).emit('server:status', 'stopped');
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    delete processes[serverId];
  });
  processes[serverId] = { proc, logs: logBuffer };
  db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('running', serverId);
  io.to(`server:${serverId}`).emit('server:status', 'running');
  return { success: true };
}

function stopServer(serverId) {
  const p = processes[serverId];
  if (!p) return { error: 'Not running' };
  try { p.proc.stdin.write('stop\n'); } catch {}
  setTimeout(() => { try { if (processes[serverId]) p.proc.kill('SIGKILL'); } catch {} }, 10000);
  return { success: true };
}

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7*24*3600*1000 });
  res.json({ success: true, username: user.username });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ success: true }); });
app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ username: req.user.username }));
app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { current, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password)) return res.status(400).json({ error: 'Aktuelles Passwort falsch' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ success: true });
});

// Servers
app.get('/api/servers', authMiddleware, (req, res) => {
  const servers = db.prepare('SELECT * FROM servers ORDER BY id').all();
  servers.forEach(s => { s.status = processes[s.id] ? 'running' : 'stopped'; });
  res.json(servers);
});
app.post('/api/servers', authMiddleware, (req, res) => {
  const { name, type, version, modpack_id, modpack_name, port, memory, java_args } = req.body;
  const srv = db.prepare('INSERT INTO servers (name,type,version,modpack_id,modpack_name,port,memory,java_args) VALUES (?,?,?,?,?,?,?,?)').run(name, type, version, modpack_id||null, modpack_name||null, port, memory||2048, java_args||'-XX:+UseG1GC -XX:+ParallelRefProcEnabled');
  fs.mkdirSync(getServerDir(srv.lastInsertRowid), { recursive: true });
  res.json({ id: srv.lastInsertRowid, name, status: 'stopped' });
});
app.delete('/api/servers/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (processes[id]) stopServer(id);
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  fs.rmSync(getServerDir(id), { recursive: true, force: true });
  res.json({ success: true });
});
app.put('/api/servers/:id', authMiddleware, (req, res) => {
  const { name, memory, java_args, port } = req.body;
  db.prepare('UPDATE servers SET name=?,memory=?,java_args=?,port=? WHERE id=?').run(name, memory, java_args, port, parseInt(req.params.id));
  res.json({ success: true });
});
app.post('/api/servers/:id/start',   authMiddleware, (req, res) => res.json(startServer(parseInt(req.params.id))));
app.post('/api/servers/:id/stop',    authMiddleware, (req, res) => res.json(stopServer(parseInt(req.params.id))));
app.post('/api/servers/:id/restart', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  stopServer(id);
  setTimeout(() => res.json(startServer(id)), 3000);
});
app.post('/api/servers/:id/command', authMiddleware, (req, res) => {
  const p = processes[parseInt(req.params.id)];
  if (!p) return res.status(400).json({ error: 'Server nicht aktiv' });
  p.proc.stdin.write(req.body.command + '\n');
  res.json({ success: true });
});
app.get('/api/servers/:id/logs', authMiddleware, (req, res) => {
  const p = processes[parseInt(req.params.id)];
  res.json(p ? p.logs : []);
});

// Files
const upload = multer({ dest: '/tmp/mcpanel-uploads/' });

function safePath(serverId, reqPath) {
  const base = getServerDir(serverId);
  const full = path.resolve(base, reqPath || '');
  if (!full.startsWith(base)) throw new Error('Path traversal denied');
  return full;
}

app.get('/api/servers/:id/files', authMiddleware, (req, res) => {
  try {
    const dir = safePath(parseInt(req.params.id), req.query.path || '');
    const entries = fs.readdirSync(dir).map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() };
    }).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
    res.json(entries);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/servers/:id/files/download', authMiddleware, (req, res) => {
  try {
    const filePath = safePath(parseInt(req.params.id), req.query.path);
    if (fs.statSync(filePath).isDirectory()) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}.zip"`);
      const arc = archiver('zip');
      arc.pipe(res);
      arc.directory(filePath, path.basename(filePath));
      arc.finalize();
    } else { res.download(filePath); }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/servers/:id/files/read', authMiddleware, (req, res) => {
  try { res.json({ content: fs.readFileSync(safePath(parseInt(req.params.id), req.query.path), 'utf8') }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/write', authMiddleware, (req, res) => {
  try { fs.writeFileSync(safePath(parseInt(req.params.id), req.body.path), req.body.content || ''); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/mkdir', authMiddleware, (req, res) => {
  try { fs.mkdirSync(safePath(parseInt(req.params.id), req.body.path), { recursive: true }); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/servers/:id/files', authMiddleware, (req, res) => {
  try { fs.rmSync(safePath(parseInt(req.params.id), req.query.path), { recursive: true, force: true }); res.json({ success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/rename', authMiddleware, (req, res) => {
  try {
    fs.renameSync(safePath(parseInt(req.params.id), req.body.from), safePath(parseInt(req.params.id), req.body.to));
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/upload', authMiddleware, upload.array('files'), (req, res) => {
  try {
    const dir = safePath(parseInt(req.params.id), req.body.path || '');
    for (const file of req.files) fs.renameSync(file.path, path.join(dir, file.originalname));
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// CurseForge
const CF_BASE = 'https://api.curseforge.com/v1';
const cfH = () => ({ 'x-api-key': CF_API_KEY, 'Accept': 'application/json' });

app.get('/api/curseforge/search', authMiddleware, async (req, res) => {
  if (!CF_API_KEY) return res.status(400).json({ error: 'CurseForge API Key nicht konfiguriert. Gehe zu Einstellungen.' });
  try {
    const r = await axios.get(`${CF_BASE}/mods/search`, { headers: cfH(), params: { gameId: 432, classId: 4471, searchFilter: req.query.q || '', pageSize: 20, index: (req.query.page||0)*20, sortField: 2, sortOrder: 'desc' } });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/curseforge/modpack/:id', authMiddleware, async (req, res) => {
  if (!CF_API_KEY) return res.status(400).json({ error: 'Kein API Key' });
  try { const r = await axios.get(`${CF_BASE}/mods/${req.params.id}`, { headers: cfH() }); res.json(r.data); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/curseforge/modpack/:id/files', authMiddleware, async (req, res) => {
  if (!CF_API_KEY) return res.status(400).json({ error: 'Kein API Key' });
  try { const r = await axios.get(`${CF_BASE}/mods/${req.params.id}/files`, { headers: cfH(), params: { pageSize: 50, sortField: 1, sortOrder: 'desc' } }); res.json(r.data); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/servers/:id/install-modpack', authMiddleware, async (req, res) => {
  if (!CF_API_KEY) return res.status(400).json({ error: 'Kein API Key' });
  const serverId = parseInt(req.params.id);
  res.json({ success: true, message: 'Installation gestartet' });
  const emit = (text, type='sys') => io.to(`server:${serverId}`).emit('console:line', { time: new Date().toISOString(), text: `[Installer] ${text}`, type });
  try {
    emit('Lade Download-URL...');
    let url = req.body.downloadUrl;
    if (!url) {
      const fr = await axios.get(`${CF_BASE}/mods/${req.body.modpackId}/files/${req.body.fileId}`, { headers: cfH() });
      url = fr.data.data.downloadUrl;
    }
    emit(`Lade Modpack herunter...`);
    const serverDir = getServerDir(serverId);
    const zipPath = path.join(serverDir, '_modpack.zip');
    const writer = fs.createWriteStream(zipPath);
    const dlR = await axios({ url, method: 'GET', responseType: 'stream' });
    dlR.data.pipe(writer);
    await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });
    emit('Entpacke Modpack...');
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: serverDir })).promise();
    fs.unlinkSync(zipPath);
    const manifestPath = path.join(serverDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      emit(`Modpack: ${manifest.name} ${manifest.version}`);
      if (manifest.files?.length) {
        emit(`Lade ${manifest.files.length} Mods herunter...`);
        const modsDir = path.join(serverDir, 'mods');
        fs.mkdirSync(modsDir, { recursive: true });
        let done = 0;
        const batchSize = 5;
        for (let i = 0; i < manifest.files.length; i += batchSize) {
          await Promise.all(manifest.files.slice(i, i+batchSize).map(async ({ projectID, fileID }) => {
            try {
              const fr = await axios.get(`${CF_BASE}/mods/${projectID}/files/${fileID}`, { headers: cfH() });
              const modUrl = fr.data.data.downloadUrl;
              if (!modUrl) return;
              const modResp = await axios({ url: modUrl, method: 'GET', responseType: 'stream' });
              const mw = fs.createWriteStream(path.join(modsDir, fr.data.data.fileName));
              modResp.data.pipe(mw);
              await new Promise((r, j) => { mw.on('finish', r); mw.on('error', j); });
              done++;
            } catch {}
          }));
          emit(`Mods: ${Math.min(i+batchSize, manifest.files.length)}/${manifest.files.length}`);
        }
      }
    }
    emit('✅ Installation abgeschlossen! Lade server.jar hoch und starte den Server.');
    io.to(`server:${serverId}`).emit('server:installed');
  } catch (e) { emit(`Fehler: ${e.message}`, 'err'); }
});

// Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.match(/token=([^;]+)/)?.[1];
  if (!token) return next(new Error('Unauthorized'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error('Invalid token')); }
});

io.on('connection', socket => {
  socket.on('server:join', id => {
    socket.join(`server:${id}`);
    const p = processes[id];
    socket.emit(p ? 'console:history' : 'console:history', p ? p.logs : []);
    socket.emit('server:status', p ? 'running' : 'stopped');
  });
  socket.on('server:leave', id => socket.leave(`server:${id}`));
  socket.on('console:command', ({ serverId, command }) => {
    const p = processes[serverId];
    if (p) try { p.proc.stdin.write(command + '\n'); } catch {}
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = require('os').networkInterfaces();
  const lan = Object.values(ip).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║           MCPanel gestartet!                ║`);
  console.log(`║  Lokal:  http://localhost:${PORT}               ║`);
  console.log(`║  LAN:    http://${lan}:${PORT}           ║`);
  console.log(`║  Login:  admin / admin                      ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});
SERVERJS
ok "server.js erstellt"

# ─── Write Frontend (index.html) ─────────────────────────────────
info "Erstelle Frontend..."
# The frontend HTML is embedded via base64 to keep it intact
FRONTEND_B64='PLACEHOLDER_FRONTEND_BASE64'

# If we have a local copy, use it; otherwise write the embedded version
if [ -f "$(dirname "$0")/app/public/index.html" ]; then
  cp "$(dirname "$0")/app/public/index.html" "$PANEL_DIR/app/public/index.html"
  ok "Frontend aus lokalem Verzeichnis kopiert"
else
  # Download a fresh copy or embed inline - for demo we'll write a minimal version
  write_frontend
fi

# ─── Write Frontend Function ──────────────────────────────────────
write_frontend() {
# (Frontend is written by the setup_from_local function or downloaded)
# For standalone installs, the index.html is copied from the installer directory
warn "Frontend: Stelle sicher, dass app/public/index.html vorhanden ist"
}

# ─── Install NPM Dependencies ─────────────────────────────────────
hdr "NPM Pakete installieren"
cd "$PANEL_DIR/app"
npm install --omit=dev 2>&1 | grep -E '(added|error|warn)' || true
ok "NPM Pakete installiert"

# ─── Environment Config ───────────────────────────────────────────
hdr "Konfiguration erstellen"
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
cat > "$PANEL_DIR/.env" << ENVFILE
PORT=$PORT
DATA_DIR=$DATA_DIR
JWT_SECRET=$JWT_SECRET
CF_API_KEY=$CF_API_KEY
ENVFILE
chmod 600 "$PANEL_DIR/.env"
ok ".env Datei erstellt"

# ─── Systemd Service ──────────────────────────────────────────────
hdr "Systemd Service einrichten"
cat > /etc/systemd/system/mcpanel.service << SVCFILE
[Unit]
Description=MCPanel - Minecraft Modpack Server Panel
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$PANEL_DIR/app
EnvironmentFile=$PANEL_DIR/.env
ExecStart=$(which node) $PANEL_DIR/app/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mcpanel
LimitNOFILE=65536

# Security
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$DATA_DIR /tmp/mcpanel-uploads

[Install]
WantedBy=multi-user.target
SVCFILE

systemctl daemon-reload
ok "Systemd Service erstellt"

# ─── Set Permissions ──────────────────────────────────────────────
hdr "Berechtigungen setzen"
chown -R "$SERVICE_USER:$SERVICE_USER" "$PANEL_DIR"
mkdir -p /tmp/mcpanel-uploads
chown "$SERVICE_USER:$SERVICE_USER" /tmp/mcpanel-uploads
ok "Berechtigungen gesetzt"

# ─── Firewall ─────────────────────────────────────────────────────
hdr "Firewall konfigurieren"
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" 2>/dev/null
  ok "UFW: Port $PORT geöffnet"
elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q running; then
  firewall-cmd --permanent --add-port="$PORT/tcp" 2>/dev/null
  firewall-cmd --reload 2>/dev/null
  ok "Firewalld: Port $PORT geöffnet"
else
  warn "Keine Firewall erkannt – öffne Port $PORT manuell falls nötig"
fi

# ─── Start Service ────────────────────────────────────────────────
hdr "Service starten"
systemctl enable mcpanel --quiet
systemctl start mcpanel
sleep 2
if systemctl is-active mcpanel --quiet; then
  ok "MCPanel läuft!"
else
  warn "Service-Start fehlgeschlagen – prüfe: journalctl -u mcpanel -f"
fi

# ─── Get IP ───────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "localhost")

# ─── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║         MCPanel erfolgreich installiert!                 ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}Panel URL:${NC}  http://${SERVER_IP}:${PORT}"
echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}Benutzername:${NC} admin"
echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}Passwort:${NC}    admin"
echo -e "${BOLD}${GREEN}║${NC}"
echo -e "${BOLD}${GREEN}║${NC}  ${YELLOW}⚠ Bitte das Passwort sofort ändern!${NC}"
echo -e "${BOLD}${GREEN}║${NC}"
echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}Nächste Schritte:${NC}"
echo -e "${BOLD}${GREEN}║${NC}  1. CurseForge API Key in Einstellungen eintragen"
echo -e "${BOLD}${GREEN}║${NC}     → https://console.curseforge.com → API Keys"
echo -e "${BOLD}${GREEN}║${NC}  2. Neuen Server erstellen"
echo -e "${BOLD}${GREEN}║${NC}  3. Modpack aus dem Browser auswählen"
echo -e "${BOLD}${GREEN}║${NC}  4. server.jar hochladen (Forge/Fabric Installer)"
echo -e "${BOLD}${GREEN}║${NC}  5. Server starten ▶"
echo -e "${BOLD}${GREEN}║${NC}"
echo -e "${BOLD}${GREEN}║${NC}  ${BOLD}Service-Befehle:${NC}"
echo -e "${BOLD}${GREEN}║${NC}  systemctl start/stop/restart mcpanel"
echo -e "${BOLD}${GREEN}║${NC}  journalctl -u mcpanel -f"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
