const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/opt/mcpanel/data';
const SERVERS_DIR = path.join(DATA_DIR, 'servers');
const DB_PATH = path.join(DATA_DIR, 'panel.db');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

fs.mkdirSync(SERVERS_DIR, { recursive: true });
fs.mkdirSync('/tmp/mcpanel-uploads', { recursive: true });

// ─── Database ───────────────────────────────────────────────────────────────
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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// CF API key: DB first, then env var
let cfApiKey = getSetting('cf_api_key') || process.env.CF_API_KEY || '';

// On startup: reset servers stuck in 'running' state (processes are gone after panel restart)
db.prepare("UPDATE servers SET status = 'stopped' WHERE status = 'running' OR status = 'installing'").run();

// Create default admin if not exists
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hash);
  console.log('[Panel] Default user created: admin / admin');
}

// ─── App Setup ──────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseMemoryMB(val) {
  if (!val) return 2048;
  const s = String(val).trim().toUpperCase();
  if (s.endsWith('G')) return Math.floor(parseFloat(s) * 1024);
  if (s.endsWith('M')) return Math.floor(parseFloat(s));
  const n = parseInt(s);
  return isNaN(n) ? 2048 : n;
}

function getSystemRamMB() {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf8');
    const match = content.match(/MemTotal:\s+(\d+)\s+kB/);
    if (match) return Math.floor(parseInt(match[1]) / 1024);
  } catch {}
  return null;
}

function getRequiredJavaVersion(mcVersion) {
  if (!mcVersion) return 21;
  const parts = String(mcVersion).replace(/[^0-9.]/g, '').split('.');
  const minor = parseInt(parts[1]) || 0;
  const patch = parseInt(parts[2]) || 0;
  if (minor >= 21) return 21;
  if (minor === 20 && patch >= 5) return 21;
  if (minor >= 17) return 17;
  if (minor >= 13) return 11;
  return 8; // Forge < 1.13 (LaunchWrapper) requires Java 8 – URLClassLoader broke in Java 9+
}

function getJavaBinary(mcVersion) {
  const ver = getRequiredJavaVersion(mcVersion);
  const candidates = [
    `/usr/lib/jvm/java-${ver}-openjdk-amd64/bin/java`,
    `/usr/lib/jvm/java-${ver}-openjdk/bin/java`,
    `/usr/lib/jvm/java-${ver}/bin/java`,
    `/usr/local/lib/jvm/java-${ver}/bin/java`,
    // Adoptium/Temurin paths (used for Java 8 on Debian 12+)
    `/usr/lib/jvm/temurin-${ver}/bin/java`,
    `/usr/lib/jvm/temurin-${ver}-amd64/bin/java`,
    `/usr/lib/jvm/temurin-${ver}-jdk-amd64/bin/java`,
    `/usr/lib/jvm/temurin-${ver}-jdk-amd64/jre/bin/java`,
    `/usr/lib/jvm/adoptopenjdk-${ver}-hotspot-amd64/bin/java`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'java';
}

function runProc(bin, args, cwd, emit) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, stdio: 'pipe' });
    const onLine = d => d.toString().split('\n').filter(l => l.trim()).forEach(l => emit(l));
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)));
    proc.on('error', reject);
  });
}

async function fetchToFile(url, dest, emit) {
  const resp = await axios({ url, method: 'GET', responseType: 'stream', timeout: 300000 });
  const total = parseInt(resp.headers['content-length'] || '0');
  let downloaded = 0, lastPct = -10;
  resp.data.on('data', chunk => {
    downloaded += chunk.length;
    if (total > 0) {
      const pct = Math.floor(downloaded / total * 100);
      if (pct >= lastPct + 10) { lastPct = pct; emit(`  ${pct}% (${(downloaded / 1048576).toFixed(1)} MB)`); }
    }
  });
  const writer = fs.createWriteStream(dest);
  resp.data.pipe(writer);
  await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });
}

async function ensureJava(ver, emit) {
  const candidates = [
    `/usr/lib/jvm/java-${ver}-openjdk-amd64/bin/java`,
    `/usr/lib/jvm/java-${ver}-openjdk/bin/java`,
    `/usr/lib/jvm/java-${ver}/bin/java`,
    `/usr/local/lib/jvm/java-${ver}/bin/java`,
    `/usr/lib/jvm/temurin-${ver}/bin/java`,
    `/usr/lib/jvm/temurin-${ver}-amd64/bin/java`,
    `/usr/lib/jvm/temurin-${ver}-jdk-amd64/bin/java`,
    `/usr/lib/jvm/temurin-${ver}-jdk-amd64/jre/bin/java`,
    `/usr/lib/jvm/adoptopenjdk-${ver}-hotspot-amd64/bin/java`,
  ];
  for (const p of candidates) { if (fs.existsSync(p)) { emit(`Java ${ver} gefunden: ${p}`); return p; } }

  emit(`Java ${ver} nicht gefunden – versuche Installation...`);

  // Java 8 is not in Debian 12+ repos – install via Adoptium/Temurin
  if (ver === 8) {
    try {
      emit('Füge Adoptium Repository hinzu (für Java 8)...');
      await runProc('apt-get', ['-y', 'install', 'wget', 'apt-transport-https', 'gnupg'], '/', emit);
      await runProc('bash', ['-c',
        'wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /usr/share/keyrings/adoptium.gpg'
      ], '/', emit);
      await runProc('bash', ['-c',
        '. /etc/os-release && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $VERSION_CODENAME main" > /etc/apt/sources.list.d/adoptium.list'
      ], '/', emit);
      await runProc('apt-get', ['update', '-qq'], '/', emit);
      await runProc('apt-get', ['-y', 'install', 'temurin-8-jdk'], '/', emit);
      for (const p of candidates) { if (fs.existsSync(p)) { emit(`Java 8 (Temurin) installiert: ${p}`); return p; } }
    } catch (e) { emit(`Adoptium-Installation fehlgeschlagen: ${e.message}`); }
  } else {
    try {
      await runProc('apt-get', ['-y', 'install', `openjdk-${ver}-jdk-headless`], '/', emit);
      for (const p of candidates) { if (fs.existsSync(p)) { emit(`Java ${ver} installiert: ${p}`); return p; } }
    } catch (e) { emit(`apt-get fehlgeschlagen: ${e.message}`); }
  }

  emit('Verwende System-Java als Fallback');
  return 'java';
}

async function autoInstallServer(serverId, type, version, emit) {
  const serverDir = getServerDir(serverId);
  db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('installing', serverId);
  io.to(`server:${serverId}`).emit('server:status', 'installing');
  try {
    const javaVer = getRequiredJavaVersion(version);
    emit(`Starte Installation: ${type} ${version} (Java ${javaVer} erforderlich)`);
    const javaBin = await ensureJava(javaVer, emit);

    if (type === 'paper') {
      emit(`Lade Paper-Builds für ${version}...`);
      const buildsResp = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${version}`);
      const builds = buildsResp.data.builds;
      const build = builds[builds.length - 1];
      const buildResp = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}`);
      const dlName = buildResp.data.downloads.application.name;
      const dlUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}/downloads/${dlName}`;
      emit(`Lade Paper ${version} Build #${build} herunter...`);
      await fetchToFile(dlUrl, path.join(serverDir, 'server.jar'), emit);

    } else if (type === 'vanilla') {
      emit(`Lade Minecraft Version-Manifest...`);
      const mfResp = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const vInfo = mfResp.data.versions.find(v => v.id === version);
      if (!vInfo) throw new Error(`Version ${version} nicht gefunden`);
      const metaResp = await axios.get(vInfo.url);
      const srvUrl = metaResp.data.downloads?.server?.url;
      if (!srvUrl) throw new Error(`Kein Server-JAR für Minecraft ${version}`);
      emit(`Lade Vanilla ${version} herunter...`);
      await fetchToFile(srvUrl, path.join(serverDir, 'server.jar'), emit);

    } else if (type === 'fabric') {
      emit(`Lade Fabric Installer...`);
      const instResp = await axios.get('https://meta.fabricmc.net/v2/versions/installer');
      const instVer = instResp.data[0]?.version;
      if (!instVer) throw new Error('Kein Fabric Installer gefunden');
      const instUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
      const instPath = path.join(serverDir, 'fabric-installer.jar');
      await fetchToFile(instUrl, instPath, emit);
      emit(`Installiere Fabric Server für MC ${version}...`);
      await runProc(javaBin, ['-jar', instPath, 'server', '-mcversion', version, '-downloadMinecraft'], serverDir, emit);
      try { fs.unlinkSync(instPath); } catch {}
      emit(`Fabric ${version} installiert!`);

    } else if (type === 'purpur') {
      emit(`Lade Purpur ${version}...`);
      const pResp = await axios.get(`https://api.purpurmc.org/v2/purpur/${version}`);
      const latestBuild = pResp.data.builds.latest;
      const dlUrl = `https://api.purpurmc.org/v2/purpur/${version}/${latestBuild}/download`;
      emit(`Lade Purpur ${version} Build #${latestBuild} herunter...`);
      await fetchToFile(dlUrl, path.join(serverDir, 'server.jar'), emit);
    }

    emit(`✅ Installation abgeschlossen! Server kann jetzt gestartet werden.`);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    io.to(`server:${serverId}`).emit('server:status', 'stopped');
    io.to(`server:${serverId}`).emit('server:installed');
  } catch (e) {
    emit(`❌ Installationsfehler: ${e.message}`, 'err');
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    io.to(`server:${serverId}`).emit('server:status', 'stopped');
  }
}

// ─── Process Registry ───────────────────────────────────────────────────────
const processes = {};

function getServerDir(serverId) {
  return path.join(SERVERS_DIR, String(serverId));
}

function buildJavaArgs(srv, serverDir) {
  const jvmArgs = srv.java_args.split(' ').filter(Boolean);
  const memArgs = [`-Xmx${srv.memory}M`, `-Xms${Math.floor(srv.memory / 2)}M`];
  const tailArgs = ['--nogui', '--port', String(srv.port)];

  // Forge 1.17+ style: no server.jar, but run.sh + unix_args.txt
  const runShPath = path.join(serverDir, 'run.sh');
  if (!fs.existsSync(path.join(serverDir, 'server.jar')) && fs.existsSync(runShPath)) {
    try {
      const runSh = fs.readFileSync(runShPath, 'utf8');
      const match = runSh.match(/@(libraries\/[^\s"']+unix_args\.txt)/);
      if (match) {
        const argsFile = path.join(serverDir, match[1]);
        if (fs.existsSync(argsFile)) {
          const forgeArgs = fs.readFileSync(argsFile, 'utf8').trim().split(/\s+/).filter(Boolean);
          return [...jvmArgs, ...memArgs, ...forgeArgs, ...tailArgs];
        }
      }
    } catch {}
  }

  // Fabric uses fabric-server-launch.jar only when no server.jar exists
  let jarFile = 'server.jar';
  if (!fs.existsSync(path.join(serverDir, 'server.jar')) && fs.existsSync(path.join(serverDir, 'fabric-server-launch.jar'))) {
    jarFile = 'fabric-server-launch.jar';
  }
  return [...jvmArgs, ...memArgs, '-jar', jarFile, ...tailArgs];
}

function startServer(serverId) {
  const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!srv) return { error: 'Server not found' };
  if (processes[serverId]) return { error: 'Already running' };
  if (srv.status === 'installing') return { error: 'Server wird noch installiert – bitte warten' };

  const serverDir = getServerDir(serverId);
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');

  const javaBin = getJavaBinary(srv.version);
  const args = buildJavaArgs(srv, serverDir);

  const proc = spawn(javaBin, args, { cwd: serverDir });
  const logBuffer = [];

  const onData = (data, type) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      const entry = { time: new Date().toISOString(), text: line, type };
      logBuffer.push(entry);
      if (logBuffer.length > 1000) logBuffer.shift();
      io.to(`server:${serverId}`).emit('console:line', entry);
    });
  };

  proc.stdout.on('data', d => onData(d, 'out'));
  proc.stderr.on('data', d => onData(d, 'err'));
  proc.on('close', code => {
    const msg = { time: new Date().toISOString(), text: `[Panel] Process exited with code ${code}`, type: 'sys' };
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
  p.proc.stdin.write('stop\n');
  setTimeout(() => { if (processes[serverId]) p.proc.kill('SIGKILL'); }, 10000);
  return { success: true };
}

// ─── Auth Routes ────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ success: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { current, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password)) {
    return res.status(400).json({ error: 'Aktuelles Passwort falsch' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true });
});

// ─── Settings Routes ─────────────────────────────────────────────────────────
app.get('/api/settings', authMiddleware, (req, res) => {
  res.json({
    cfKeySet: !!cfApiKey,
    setupSkipped: getSetting('setup_skipped') === '1'
  });
});

// Validate + save CurseForge API key
app.post('/api/settings/cf-key', authMiddleware, async (req, res) => {
  const { key } = req.body;
  if (!key || !key.trim()) return res.status(400).json({ error: 'API Key darf nicht leer sein' });
  const trimmed = key.trim();
  try {
    await axios.get('https://api.curseforge.com/v1/games/432', {
      headers: { 'x-api-key': trimmed, 'Accept': 'application/json' },
      timeout: 10000
    });
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) {
      return res.status(400).json({ error: 'Ungültiger API Key (Zugriff verweigert)' });
    }
    return res.status(400).json({ error: `Verbindungsfehler: ${e.message}` });
  }
  cfApiKey = trimmed;
  setSetting('cf_api_key', trimmed);
  res.json({ success: true });
});

// Mark setup as skipped (user clicked "Überspringen")
app.post('/api/settings/setup-skip', authMiddleware, (req, res) => {
  setSetting('setup_skipped', '1');
  res.json({ success: true });
});

// ─── System Info ────────────────────────────────────────────────────────────
app.get('/api/system/info', authMiddleware, (req, res) => {
  const totalRamMB = getSystemRamMB();
  res.json({
    totalRamMB,
    availableForServersMB: totalRamMB !== null ? totalRamMB - 1024 : null
  });
});

// ─── Version Lists ──────────────────────────────────────────────────────────
const versionCache = {};
const VERSION_CACHE_TTL = 5 * 60 * 1000; // 5 Minuten

app.get('/api/versions/:type', authMiddleware, async (req, res) => {
  const { type } = req.params;
  const now = Date.now();
  if (versionCache[type] && now - versionCache[type].ts < VERSION_CACHE_TTL) {
    return res.json(versionCache[type].data);
  }
  try {
    let data;
    if (type === 'paper') {
      const resp = await axios.get('https://api.papermc.io/v2/projects/paper', { timeout: 10000 });
      data = { versions: [...resp.data.versions].reverse() };
    } else if (type === 'purpur') {
      const resp = await axios.get('https://api.purpurmc.org/v2/purpur', { timeout: 10000 });
      data = { versions: [...resp.data.versions].reverse() };
    } else if (type === 'vanilla') {
      const resp = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { timeout: 10000 });
      data = { versions: resp.data.versions.filter(v => v.type === 'release').map(v => v.id) };
    } else if (type === 'fabric') {
      const resp = await axios.get('https://meta.fabricmc.net/v2/versions/game', { timeout: 10000 });
      data = { versions: resp.data.filter(v => v.stable).map(v => v.version) };
    } else {
      return res.json({ versions: [] });
    }
    versionCache[type] = { ts: now, data };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: `Versionen konnten nicht geladen werden: ${e.message}` });
  }
});

// ─── Server Routes ──────────────────────────────────────────────────────────
app.get('/api/servers', authMiddleware, (req, res) => {
  const servers = db.prepare('SELECT * FROM servers ORDER BY id').all();
  servers.forEach(s => { if (processes[s.id]) s.status = 'running'; });
  res.json(servers);
});

app.post('/api/servers', authMiddleware, async (req, res) => {
  const { name, type, version, modpack_id, modpack_name, port, memory: memoryRaw, java_args } = req.body;

  const memory = parseMemoryMB(memoryRaw || '2048');
  const systemRam = getSystemRamMB();
  if (systemRam !== null) {
    const maxAllowed = systemRam - 1024;
    if (memory > maxAllowed) {
      return res.status(400).json({
        error: `Nicht genug RAM! Angefordert: ${memory} MB, Verfügbar: ${maxAllowed} MB (${systemRam} MB gesamt, 1024 MB für OS reserviert)`
      });
    }
  }

  const srv = db.prepare(`
    INSERT INTO servers (name, type, version, modpack_id, modpack_name, port, memory, java_args)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, type, version, modpack_id || null, modpack_name || null,
         port, memory, java_args || '-XX:+UseG1GC -XX:+ParallelRefProcEnabled');

  const serverId = srv.lastInsertRowid;
  fs.mkdirSync(getServerDir(serverId), { recursive: true });

  const autoTypes = ['paper', 'vanilla', 'fabric', 'purpur'];
  if (autoTypes.includes(type) && version) {
    res.json({ id: serverId, name, status: 'installing' });
    const emit = (text, t = 'sys') => {
      io.to(`server:${serverId}`).emit('console:line', { time: new Date().toISOString(), text: `[Installer] ${text}`, type: t });
    };
    autoInstallServer(serverId, type, version, emit);
  } else {
    res.json({ id: serverId, name, status: 'stopped' });
  }
});

app.delete('/api/servers/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  if (processes[id]) stopServer(id);
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  fs.rmSync(getServerDir(id), { recursive: true, force: true });
  res.json({ success: true });
});

app.put('/api/servers/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, memory: memoryRaw, java_args, port } = req.body;
  const memory = parseMemoryMB(memoryRaw);
  const systemRam = getSystemRamMB();
  if (systemRam !== null && memory > systemRam - 1024) {
    return res.status(400).json({ error: `Nicht genug RAM! Max: ${systemRam - 1024} MB` });
  }
  db.prepare('UPDATE servers SET name=?, memory=?, java_args=?, port=? WHERE id=?')
    .run(name, memory, java_args, port, id);
  res.json({ success: true });
});

app.get('/api/servers/:id/stats', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const proc = processes[id];
  if (!proc || !proc.pid) return res.json({ running: false, cpu: 0, memory: 0 });
  try {
    const statusContent = fs.readFileSync(`/proc/${proc.pid}/status`, 'utf8');
    const vmRss = parseInt((statusContent.match(/VmRSS:\s+(\d+)/) || [,0])[1]) || 0;
    const statContent = fs.readFileSync(`/proc/${proc.pid}/stat`, 'utf8').split(' ');
    const totalTicks = parseInt(statContent[13]) + parseInt(statContent[14]);
    const now = Date.now();
    let cpu = 0;
    if (!proc._prevTicks) { proc._prevTicks = totalTicks; proc._prevTime = now; }
    else {
      const elapsed = (now - proc._prevTime) / 1000;
      if (elapsed > 0) cpu = Math.min(100, ((totalTicks - proc._prevTicks) / 100 / elapsed) * 100);
      proc._prevTicks = totalTicks; proc._prevTime = now;
    }
    res.json({ running: true, cpu: Math.round(cpu * 10) / 10, memory: vmRss * 1024 });
  } catch {
    res.json({ running: true, cpu: 0, memory: 0 });
  }
});

app.post('/api/servers/:id/start', authMiddleware, (req, res) => {
  res.json(startServer(parseInt(req.params.id)));
});
app.post('/api/servers/:id/stop', authMiddleware, (req, res) => {
  res.json(stopServer(parseInt(req.params.id)));
});
app.post('/api/servers/:id/restart', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  stopServer(id);
  setTimeout(() => res.json(startServer(id)), 3000);
});
app.post('/api/servers/:id/command', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const p = processes[id];
  if (!p) return res.status(400).json({ error: 'Server not running' });
  p.proc.stdin.write(req.body.command + '\n');
  res.json({ success: true });
});
app.get('/api/servers/:id/logs', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  res.json(processes[id] ? processes[id].logs : []);
});

// ─── File Manager Routes ────────────────────────────────────────────────────
const upload = multer({ dest: '/tmp/mcpanel-uploads/', limits: { fileSize: 500 * 1024 * 1024, files: 20 } });

function safePath(serverId, reqPath) {
  const base = getServerDir(serverId);
  const full = path.resolve(base, reqPath || '');
  if (!full.startsWith(base)) throw new Error('Path traversal denied');
  return full;
}

app.get('/api/servers/:id/files', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const dir = safePath(id, req.query.path || '');
    const entries = fs.readdirSync(dir).map(name => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() };
    }).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
    res.json(entries);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/servers/:id/files/download', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const filePath = safePath(id, req.query.path);
    if (fs.statSync(filePath).isDirectory()) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}.zip"`);
      const archive = archiver('zip');
      archive.pipe(res);
      archive.directory(filePath, path.basename(filePath));
      archive.finalize();
    } else { res.download(filePath); }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/servers/:id/files/read', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    res.json({ content: fs.readFileSync(safePath(id, req.query.path), 'utf8') });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/write', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    fs.writeFileSync(safePath(id, req.body.path), req.body.content || '');
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/mkdir', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    fs.mkdirSync(safePath(id, req.body.path), { recursive: true });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/servers/:id/files', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    fs.rmSync(safePath(id, req.query.path), { recursive: true, force: true });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/rename', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    fs.renameSync(safePath(id, req.body.from), safePath(id, req.body.to));
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/servers/:id/files/upload', authMiddleware, upload.array('files'), (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const dir = safePath(id, req.body.path || '');
    for (const file of req.files) {
      const dest = path.join(dir, file.originalname);
      try {
        fs.renameSync(file.path, dest);
      } catch (e) {
        if (e.code === 'EXDEV') {
          // Cross-filesystem move (e.g. tmpfs → ext4): copy then delete
          fs.copyFileSync(file.path, dest);
          fs.unlinkSync(file.path);
        } else { throw e; }
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── CurseForge Routes ──────────────────────────────────────────────────────
const CF_BASE = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;
const MODPACKS_CLASS_ID = 4471;

function cfHeaders() {
  return { 'x-api-key': cfApiKey, 'Accept': 'application/json' };
}

app.get('/api/curseforge/search', authMiddleware, async (req, res) => {
  if (!cfApiKey) return res.status(400).json({ error: 'CurseForge API Key nicht konfiguriert' });
  try {
    const { q, page = 0 } = req.query;
    const resp = await axios.get(`${CF_BASE}/mods/search`, {
      headers: cfHeaders(),
      params: { gameId: MINECRAFT_GAME_ID, classId: MODPACKS_CLASS_ID, searchFilter: q || '', pageSize: 20, index: page * 20, sortField: 2, sortOrder: 'desc' }
    });
    res.json(resp.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/curseforge/modpack/:id', authMiddleware, async (req, res) => {
  if (!cfApiKey) return res.status(400).json({ error: 'CurseForge API Key nicht konfiguriert' });
  try {
    const resp = await axios.get(`${CF_BASE}/mods/${req.params.id}`, { headers: cfHeaders() });
    res.json(resp.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/curseforge/modpack/:id/files', authMiddleware, async (req, res) => {
  if (!cfApiKey) return res.status(400).json({ error: 'CurseForge API Key nicht konfiguriert' });
  try {
    const resp = await axios.get(`${CF_BASE}/mods/${req.params.id}/files`, {
      headers: cfHeaders(),
      params: { pageSize: 50, sortField: 1, sortOrder: 'desc' }
    });
    res.json(resp.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/servers/:id/install-modpack', authMiddleware, async (req, res) => {
  const serverId = parseInt(req.params.id);
  const { fileId, downloadUrl } = req.body;
  if (!cfApiKey) return res.status(400).json({ error: 'CurseForge API Key nicht konfiguriert' });

  res.json({ success: true, message: 'Installation started' });

  const emit = (text, type = 'sys') => {
    io.to(`server:${serverId}`).emit('console:line', { time: new Date().toISOString(), text: `[Installer] ${text}`, type });
  };

  try {
    emit('Lade Download-URL...');
    let url = downloadUrl;
    if (!url) {
      const fileResp = await axios.get(`${CF_BASE}/mods/${req.body.modpackId}/files/${fileId}`, { headers: cfHeaders() });
      url = fileResp.data.data.downloadUrl;
    }
    emit(`Lade Modpack von CurseForge herunter...`);
    const serverDir = getServerDir(serverId);
    const zipPath = path.join(serverDir, '_modpack.zip');
    await fetchToFile(url, zipPath, emit);

    emit('Entpacke Modpack...');
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: serverDir })).promise();
    fs.unlinkSync(zipPath);

    const manifestPath = path.join(serverDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      emit(`Modpack: ${manifest.name} ${manifest.version}`);

      // ── Auto-detect mod loader and install server JAR ──────────────
      const mcVersion = manifest.minecraft?.version;
      const primaryLoader = manifest.minecraft?.modLoaders?.find(l => l.primary);
      const loaderId = primaryLoader?.id || '';

      if (mcVersion && loaderId) {
        const javaVer = getRequiredJavaVersion(mcVersion);
        const javaBin = await ensureJava(javaVer, emit);

        if (loaderId.startsWith('fabric-')) {
          emit(`Erkannt: Fabric (MC ${mcVersion}) – installiere Fabric Server...`);
          const instResp = await axios.get('https://meta.fabricmc.net/v2/versions/installer');
          const instVer = instResp.data[0]?.version;
          const instUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
          const instPath = path.join(serverDir, 'fabric-installer.jar');
          await fetchToFile(instUrl, instPath, emit);
          await runProc(javaBin, ['-jar', instPath, 'server', '-mcversion', mcVersion, '-downloadMinecraft'], serverDir, emit);
          try { fs.unlinkSync(instPath); } catch {}
          db.prepare('UPDATE servers SET type=?, version=? WHERE id=?').run('fabric', mcVersion, serverId);
          emit('✅ Fabric Server installiert!');

        } else if (loaderId.startsWith('forge-')) {
          const forgeVer = loaderId.replace('forge-', '');
          emit(`Erkannt: Forge ${forgeVer} (MC ${mcVersion}) – installiere Forge Server...`);
          const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVer}/forge-${mcVersion}-${forgeVer}-installer.jar`;
          const installerPath = path.join(serverDir, 'forge-installer.jar');
          await fetchToFile(installerUrl, installerPath, emit);
          emit('Führe Forge Installer aus (kann 2–5 Min dauern)...');
          await runProc(javaBin, ['-jar', installerPath, '--installServer'], serverDir, emit);
          try { fs.unlinkSync(installerPath); } catch {}

          // Forge < 1.17: find universal JAR and copy as server.jar
          const dirFiles = fs.readdirSync(serverDir);
          const forgeJar = dirFiles.find(f => /^forge-.+\.jar$/.test(f) && !f.includes('installer'));
          if (forgeJar) {
            fs.copyFileSync(path.join(serverDir, forgeJar), path.join(serverDir, 'server.jar'));
            emit(`✅ Forge Server installiert (${forgeJar} → server.jar)`);
          } else if (fs.existsSync(path.join(serverDir, 'run.sh'))) {
            // Forge 1.17+: run.sh style – startServer handles this via buildJavaArgs
            emit('✅ Forge 1.17+ Server installiert (run.sh Modus)');
          } else {
            emit('⚠️ Forge JAR nicht gefunden – bitte server.jar manuell über den Dateimanager prüfen.', 'err');
          }
          db.prepare('UPDATE servers SET type=?, version=? WHERE id=?').run('forge', mcVersion, serverId);

        } else if (loaderId.startsWith('neoforge-')) {
          const neoVer = loaderId.replace('neoforge-', '');
          emit(`Erkannt: NeoForge ${neoVer} (MC ${mcVersion}) – installiere NeoForge Server...`);
          const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVer}/neoforge-${neoVer}-installer.jar`;
          const installerPath = path.join(serverDir, 'neoforge-installer.jar');
          await fetchToFile(installerUrl, installerPath, emit);
          emit('Führe NeoForge Installer aus...');
          await runProc(javaBin, ['-jar', installerPath, '--installServer'], serverDir, emit);
          try { fs.unlinkSync(installerPath); } catch {}
          db.prepare('UPDATE servers SET type=?, version=? WHERE id=?').run('neoforge', mcVersion, serverId);
          emit('✅ NeoForge Server installiert!');

        } else if (loaderId.startsWith('quilt-')) {
          emit(`Erkannt: Quilt (MC ${mcVersion}) – installiere Quilt Server...`);
          const instResp = await axios.get('https://meta.quiltmc.org/v3/versions/installer');
          const instVer = instResp.data[0]?.version;
          const instUrl = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/quilt-installer-${instVer}.jar`;
          const instPath = path.join(serverDir, 'quilt-installer.jar');
          await fetchToFile(instUrl, instPath, emit);
          await runProc(javaBin, ['-jar', instPath, 'install', 'server', mcVersion, '--download-server'], serverDir, emit);
          try { fs.unlinkSync(instPath); } catch {}
          db.prepare('UPDATE servers SET type=?, version=? WHERE id=?').run('quilt', mcVersion, serverId);
          emit('✅ Quilt Server installiert!');

        } else {
          emit(`⚠️ Unbekannter Mod-Loader: ${loaderId} – server.jar muss manuell hochgeladen werden.`, 'err');
        }
      }
      // ──────────────────────────────────────────────────────────────

      if (manifest.files && cfApiKey) {
        emit(`Lade ${manifest.files.length} Mods herunter...`);
        const modsDir = path.join(serverDir, 'mods');
        fs.mkdirSync(modsDir, { recursive: true });
        const batchSize = 5;
        let failedCount = 0;
        for (let i = 0; i < manifest.files.length; i += batchSize) {
          const batch = manifest.files.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(async ({ projectID, fileID }) => {
            try {
              const fr = await axios.get(`${CF_BASE}/mods/${projectID}/files/${fileID}`, { headers: cfHeaders() });
              const modUrl = fr.data.data.downloadUrl;
              if (!modUrl) return { ok: false, id: `${projectID}/${fileID}`, reason: 'Keine Download-URL verfügbar' };
              const modResp = await axios({ url: modUrl, method: 'GET', responseType: 'stream' });
              const modWriter = fs.createWriteStream(path.join(modsDir, fr.data.data.fileName));
              modResp.data.pipe(modWriter);
              await new Promise((resolve, reject) => { modWriter.on('finish', resolve); modWriter.on('error', reject); });
              return { ok: true };
            } catch (e) {
              return { ok: false, id: `${projectID}/${fileID}`, reason: e.message };
            }
          }));
          const batchFailed = batchResults.filter(r => !r.ok);
          batchFailed.forEach(r => emit(`⚠️ Mod ${r.id} fehlgeschlagen: ${r.reason}`, 'err'));
          failedCount += batchFailed.length;
          emit(`Heruntergeladen: ${Math.min(i + batchSize, manifest.files.length)}/${manifest.files.length} Mods`);
        }
        if (failedCount > 0) emit(`⚠️ ${failedCount} von ${manifest.files.length} Mods konnten nicht heruntergeladen werden.`, 'err');
      }
    }
    emit('Installation abgeschlossen!');
    io.to(`server:${serverId}`).emit('server:installed');
  } catch (e) { emit(`Fehler: ${e.message}`, 'err'); }
});

// ─── Socket.io ──────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.match(/token=([^;]+)/)?.[1];
  if (!token) return next(new Error('Unauthorized'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error('Invalid token')); }
});

io.on('connection', socket => {
  socket.on('server:join', serverId => {
    socket.join(`server:${serverId}`);
    const p = processes[serverId];
    if (p) {
      socket.emit('console:history', p.logs);
      socket.emit('server:status', 'running');
    } else {
      socket.emit('console:history', []);
      socket.emit('server:status', 'stopped');
    }
  });
  socket.on('server:leave', serverId => socket.leave(`server:${serverId}`));
  socket.on('console:command', ({ serverId, command }) => {
    const p = processes[serverId];
    if (p) p.proc.stdin.write(command + '\n');
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║        MCPanel - Ready!                  ║`);
  console.log(`║  http://localhost:${PORT}                   ║`);
  console.log(`║  Default login: admin / admin            ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});
