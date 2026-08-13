// ---- Obsidian Panel: SFTP server ----
// SFTP-Zugang über die Panel-Zugangsdaten (gleicher Login wie das Web-Panel).
// Das virtuelle Root zeigt jeden Server als benannten Ordner (Servername →
// dataPath). Kein Shell-Zugang — reine Dateiübertragung.
//
// Sicherheit:
//  - Host-Key wird beim ersten Start generiert (RSA 2048, sftp_hostkey)
//  - Brute-Force-Bremse: 5 Fehlversuche/IP → 60 s Sperre
//  - Virtuelle Pfade können nicht aus dem Server-Data-Dir ausbrechen
//    (realpath-Containment — auch Symlink-Ziele werden geprüft)

import crypto from "node:crypto";
import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import type { Dir, Stats } from "node:fs";
import path from "node:path";
import { Server } from "ssh2";
import { verifyCredentials, getConfigUsername } from "./auth";
import { loadServers } from "./config-store";

// ---- SFTP-Status-Codes (SSH_FX_*) ----
const STATUS = {
  OK: 0, EOF: 1, NO_SUCH_FILE: 2, PERMISSION_DENIED: 3, FAILURE: 4,
  BAD_MESSAGE: 5, NO_CONNECTION: 6, CONNECTION_LOST: 7, OP_UNSUPPORTED: 8,
} as const;

// ---- SSH_FXF_* open flags ----
const OPEN_MODE = {
  READ: 0x00000001, WRITE: 0x00000002, APPEND: 0x00000004,
  CREAT: 0x00000008, TRUNC: 0x00000010, EXCL: 0x00000020,
} as const;

const HOSTKEY_PATH = path.resolve(process.cwd(), "sftp_hostkey");
const SFTP_PORT = process.env.SFTP_PORT ? parseInt(process.env.SFTP_PORT, 10) : 2222;
const SFTP_BIND = process.env.SFTP_BIND || "0.0.0.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal view of the ssh2 SFTP stream we actually use. */
interface SftpStream {
  on(event: string, listener: (...args: any[]) => void): void;
  handle(reqid: number, handle: Buffer | string): void;
  attrs(reqid: number, attrs: Record<string, unknown>): void;
  name(reqid: number, names: { filename: string; longname: string; attrs?: Record<string, unknown> }[]): void;
  data(reqid: number, data: Buffer | string): void;
  status(reqid: number, code: number, message?: string): void;
  end(): void;
}

/** One visible server folder in the virtual root. */
interface ServerEntry {
  name: string;
  dataPath: string;
  /** realpath(dataPath) — containment anchor for symlink checks. */
  realRoot: string;
}

type Resolved =
  | { type: "root" }                                  // all-Modus: "/" (Serverliste)
  | { type: "server"; entry: ServerEntry }            // all-Modus: "/<name>"
  | { type: "serverroot"; entry: ServerEntry }        // server-Modus: "/" = dataPath
  | { type: "real"; entry: ServerEntry; abs: string } // tiefer Pfad
  | { type: "none" };

type Handle =
  | { kind: "file"; fh: FileHandle }
  | { kind: "dir"; dir: Dir }
  | { kind: "rootdir"; exhausted: boolean };

// ---------------------------------------------------------------------------
// Host key (generated once)
// ---------------------------------------------------------------------------

function getHostKey(): string {
  if (fs.existsSync(HOSTKEY_PATH)) {
    return fs.readFileSync(HOSTKEY_PATH, "utf8");
  }
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  // ssh2's key parser only accepts PKCS1 ("BEGIN RSA PRIVATE KEY") or OpenSSH
  // format — NOT PKCS8. Exporting as pkcs1 avoids "Unsupported key format".
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
  fs.writeFileSync(HOSTKEY_PATH, pem, { mode: 0o600 });
  console.log(`[sftp] Generated host key: ${HOSTKEY_PATH}`);
  return pem;
}

// ---------------------------------------------------------------------------
// Brute-force protection (per IP)
// ---------------------------------------------------------------------------

const attempts = new Map<string, { fails: number; until: number }>();

function isBlocked(ip: string): boolean {
  const a = attempts.get(ip);
  if (!a) return false;
  if (a.until > Date.now()) return true;
  // Not blocked — keep the counter so consecutive failures accumulate.
  // Only clean up fully expired lockouts (fails reset to 0 when a lockout
  // was active) to avoid unbounded memory growth.
  if (a.fails === 0) attempts.delete(ip);
  return false;
}

function recordFail(ip: string): void {
  const a = attempts.get(ip) ?? { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= 5) {
    a.until = Date.now() + 60_000;
    a.fails = 0;
  }
  attempts.set(ip, a);
}

function recordSuccess(ip: string): void {
  attempts.delete(ip);
}

// ---------------------------------------------------------------------------
// Virtual filesystem
// ---------------------------------------------------------------------------

/** Split + normalize a client-supplied virtual path into clean segments.
 *  "." / "./" / ".." / "/" all resolve to the root (no segments). */
function splitVirtual(vpath: string): string[] {
  // normalize: "." stays ".", "./" stays "./", "/a/./b" → "/a/b",
  // "/a/../b" → "/b", "../x" stays "../x" (traversal above root clamps to root)
  const norm = path.posix.normalize(vpath.replace(/\\/g, "/"));
  const segs = norm.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.length === 0 || segs[0] === "..") return [];
  return segs;
}

/** A login can either see all servers (virtual root) or be pinned to one. */
type SftpScope =
  | { type: "all"; entries: Map<string, ServerEntry> }
  | { type: "server"; entry: ServerEntry };

/** Resolve virtual segments to a real location. */
function resolveVirtual(segs: string[], scope: SftpScope): Resolved {
  if (scope.type === "server") {
    // Root IS the server's data dir — everything below maps into it.
    if (segs.length === 0) return { type: "serverroot", entry: scope.entry };
    return { type: "real", entry: scope.entry, abs: path.join(scope.entry.dataPath, ...segs) };
  }
  if (segs.length === 0) return { type: "root" };
  const entry = scope.entries.get(segs[0]);
  if (!entry) return { type: "none" };
  if (segs.length === 1) return { type: "server", entry };
  return { type: "real", entry, abs: path.join(entry.dataPath, ...segs.slice(1)) };
}

/**
 * Verify that a real path (or its nearest existing parent) stays inside the
 * server's real root. This blocks symlink escapes and traversal.
 */
async function assertInside(realRoot: string, abs: string): Promise<boolean> {
  let p = abs;
  for (;;) {
    try {
      const real = await fsp.realpath(p);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      const parent = path.dirname(p);
      if (parent === p) return false;
      p = parent;
    }
  }
}

/** Load the current server list into the virtual root mapping. */
async function buildEntries(): Promise<Map<string, ServerEntry>> {
  const servers = await loadServers();
  const entries = new Map<string, ServerEntry>();
  const used = new Set<string>();
  for (const s of servers) {
    if (!s.dataPath) continue;
    let realRoot: string;
    try {
      realRoot = await fsp.realpath(s.dataPath);
    } catch {
      continue; // data dir doesn't exist (yet) — hide the folder
    }
    let name = s.name.replace(/[/\\]/g, "-");
    if (!name) continue;
    if (used.has(name)) name = `${name} (${s.id.slice(0, 8)})`;
    used.add(name);
    entries.set(name, { name, dataPath: s.dataPath, realRoot });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

function attrsFromStat(st: Stats): Record<string, unknown> {
  return {
    mode: st.mode,
    uid: st.uid,
    gid: st.gid,
    size: Number(st.size),
    atime: Math.floor(Number(st.atimeMs) / 1000),
    mtime: Math.floor(Number(st.mtimeMs) / 1000),
  };
}

const DIR_MODE = 0o40755;
const FILE_MODE = 0o100644;

function errStatus(err: unknown): number {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return STATUS.NO_SUCH_FILE;
  if (code === "EACCES" || code === "EPERM") return STATUS.PERMISSION_DENIED;
  return STATUS.FAILURE;
}

/** OpenSSH-style longname for directory listings. */
function longname(attrs: Record<string, unknown>, name: string): string {
  const mode = (attrs.mode as number) ?? FILE_MODE;
  const size = (attrs.size as number) ?? 0;
  const mtime = (attrs.mtime as number) ?? 0;
  const dt = new Date(mtime * 1000);
  const dateStr = dt.toISOString().slice(0, 16).replace("T", " ");
  const perms = (mode & 0o170000) === 0o040000 ? "d" : "-";
  return `${perms}rw-r--r--   1 0 0 ${String(size).padStart(12)} ${dateStr} ${name}`;
}

// ---------------------------------------------------------------------------
// Server-entries cache (the SFTP root reflects servers.json)
// ---------------------------------------------------------------------------

let entriesCache: Map<string, ServerEntry> | null = null;
let entriesCacheAt = 0;
const ENTRIES_TTL_MS = 15_000;

/** (Re)build and cache the virtual root mapping. */
async function refreshEntries(): Promise<void> {
  const loaded = await buildEntries();
  entriesCache = loaded;
  entriesCacheAt = Date.now();
}

/** Current root mapping — synchronous. Filled from cache; a stale/empty cache
 *  kicks off an async refresh and returns what we have so far. */
function getEntries(): Map<string, ServerEntry> {
  if (!entriesCache || Date.now() - entriesCacheAt > ENTRIES_TTL_MS) {
    if (!entriesCache) entriesCache = new Map();
    refreshEntries().catch((err) => {
      console.error("[sftp] Failed to build server entries:", err);
    });
  }
  return entriesCache;
}

// ---------------------------------------------------------------------------
// Per-server login ("admin.<server>") — root is pinned to one server folder
// ---------------------------------------------------------------------------

/** SFTP username suffix for a server folder. The frontend sends the server
 *  name with spaces replaced by "_"; the backend matches both forms. */
export function sftpUsernameFor(base: string, serverName: string): string {
  return `${base}.${serverName.replace(/\s+/g, "_")}`;
}

/** Find a server entry by its login suffix (exact or "_"-for-space form). */
function findEntryBySuffix(suffix: string, entries: Map<string, ServerEntry>): ServerEntry | undefined {
  const exact = entries.get(suffix);
  if (exact) return exact;
  const spaced = suffix.replace(/_/g, " ");
  for (const e of entries.values()) if (e.name === spaced) return e;
  return undefined;
}

/** Build the scope for an SFTP session: pinned to one server or all servers. */
function buildScope(suffix: string | null, entries: Map<string, ServerEntry>): SftpScope {
  if (suffix) {
    const entry = findEntryBySuffix(suffix, entries);
    if (entry) return { type: "server", entry };
    console.warn(`[sftp] Unknown server suffix in login: "${suffix}" — falling back to all servers`);
  }
  return { type: "all", entries };
}

// ---------------------------------------------------------------------------
// SFTP session handler
// ---------------------------------------------------------------------------

function handleSftp(sftp: SftpStream, scope: SftpScope): void {
  const handles = new Map<number, Handle>();
  let handleCount = 0;

  const newHandle = (h: Handle): Buffer => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(handleCount++);
    handles.set(handleCount - 1, h);
    return buf;
  };

  const getHandle = (buf: Buffer): Handle | undefined =>
    handles.get(buf.length === 4 ? buf.readUInt32BE(0) : -1);

  const freeHandle = (h: Handle): Promise<void> => {
    if (h.kind === "file") return h.fh.close().catch(() => undefined);
    if (h.kind === "dir") return h.dir.close().catch(() => undefined);
    return Promise.resolve();
  };

  const fail = (reqid: number, err: unknown): void =>
    sftp.status(reqid, errStatus(err), (err as Error)?.message);

  // ---- OPEN (file) ----
  sftp.on("OPEN", (reqid: number, filename: string, flags: number) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type !== "real") return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    assertInside(res.entry.realRoot, res.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      let fsFlags: string;
      if ((flags & OPEN_MODE.READ) && (flags & OPEN_MODE.WRITE)) {
        if (flags & OPEN_MODE.APPEND) fsFlags = "a+";
        else if (flags & OPEN_MODE.CREAT && flags & OPEN_MODE.EXCL) fsFlags = "wx+";
        else fsFlags = "r+";
      } else if (flags & OPEN_MODE.WRITE) {
        if (flags & OPEN_MODE.APPEND) fsFlags = "a";
        else if (flags & OPEN_MODE.CREAT && flags & OPEN_MODE.EXCL) fsFlags = "wx";
        else fsFlags = "w";
      } else {
        fsFlags = "r";
      }
      try {
        const fh = await fsp.open(res.abs, fsFlags);
        sftp.handle(reqid, newHandle({ kind: "file", fh }));
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- READ ----
  sftp.on("READ", (reqid: number, handleBuf: Buffer, offset: number, length: number) => {
    const h = getHandle(handleBuf);
    if (!h || h.kind !== "file") return sftp.status(reqid, STATUS.FAILURE);
    const buf = Buffer.alloc(Math.min(length, 64 * 1024));
    h.fh.read(buf, 0, buf.length, offset)
      .then(({ bytesRead }) => {
        if (bytesRead === 0) return sftp.status(reqid, STATUS.EOF);
        sftp.data(reqid, buf.subarray(0, bytesRead));
      })
      .catch((err) => fail(reqid, err));
  });

  // ---- WRITE ----
  sftp.on("WRITE", (reqid: number, handleBuf: Buffer, offset: number, data: Buffer) => {
    const h = getHandle(handleBuf);
    if (!h || h.kind !== "file") return sftp.status(reqid, STATUS.FAILURE);
    h.fh.write(data, 0, data.length, offset)
      .then(() => sftp.status(reqid, STATUS.OK))
      .catch((err) => fail(reqid, err));
  });

  // ---- FSTAT ----
  sftp.on("FSTAT", (reqid: number, handleBuf: Buffer) => {
    const h = getHandle(handleBuf);
    if (!h || h.kind !== "file") return sftp.status(reqid, STATUS.FAILURE);
    h.fh.stat()
      .then((st) => sftp.attrs(reqid, attrsFromStat(st)))
      .catch((err) => fail(reqid, err));
  });

  // ---- FSETSTAT ----
  sftp.on("FSETSTAT", (reqid: number, handleBuf: Buffer, attrs: any) => {
    const h = getHandle(handleBuf);
    if (!h || h.kind !== "file") return sftp.status(reqid, STATUS.FAILURE);
    const ops: Promise<void>[] = [];
    if (typeof attrs?.size === "number") ops.push(h.fh.truncate(attrs.size));
    if (typeof attrs?.mtime === "number" || typeof attrs?.atime === "number") {
      const atime = typeof attrs.atime === "number" ? attrs.atime : attrs.mtime;
      const mtime = typeof attrs.mtime === "number" ? attrs.mtime : attrs.atime;
      ops.push(h.fh.utimes(new Date(atime * 1000), new Date(mtime * 1000)));
    }
    if (typeof attrs?.mode === "number") ops.push(h.fh.chmod(attrs.mode));
    Promise.all(ops).then(
      () => sftp.status(reqid, STATUS.OK),
      (err) => fail(reqid, err),
    );
  });

  // ---- CLOSE ----
  sftp.on("CLOSE", (reqid: number, handleBuf: Buffer) => {
    const h = getHandle(handleBuf);
    if (!h) return sftp.status(reqid, STATUS.FAILURE);
    handles.delete(handleBuf.length === 4 ? handleBuf.readUInt32BE(0) : -1);
    freeHandle(h).then(
      () => sftp.status(reqid, STATUS.OK),
      (err) => fail(reqid, err),
    );
  });

  // ---- OPENDIR ----
  sftp.on("OPENDIR", (reqid: number, dirname: string) => {
    const segs = splitVirtual(dirname);
    const res = resolveVirtual(segs, scope);
    if (res.type === "root") return sftp.handle(reqid, newHandle({ kind: "rootdir", exhausted: false }));
    if (res.type === "none") return sftp.status(reqid, STATUS.NO_SUCH_FILE);
    const abs = res.type === "server" || res.type === "serverroot" ? res.entry.dataPath : res.abs;
    assertInside(res.entry.realRoot, abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        const dir = await fsp.opendir(abs);
        sftp.handle(reqid, newHandle({ kind: "dir", dir }));
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- READDIR ----
  sftp.on("READDIR", (reqid: number, handleBuf: Buffer) => {
    const h = getHandle(handleBuf);
    if (!h) return sftp.status(reqid, STATUS.FAILURE);
    if (h.kind === "rootdir") {
      // The client re-requests READDIR until EOF — serve entries once, then EOF.
      if (h.exhausted) return sftp.status(reqid, STATUS.EOF);
      h.exhausted = true;
      const names = (scope.type === "all" ? [...scope.entries.values()] : [scope.entry]).map((e) => ({
        filename: e.name,
        longname: longname({ mode: DIR_MODE, size: 0, mtime: 0 }, e.name),
        attrs: { mode: DIR_MODE, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 },
      }));
      return names.length ? sftp.name(reqid, names) : sftp.status(reqid, STATUS.EOF);
    }
    if (h.kind !== "dir") return sftp.status(reqid, STATUS.FAILURE);
    (async () => {
      const batch: { filename: string; longname: string; attrs: Record<string, unknown> }[] = [];
      for (let i = 0; i < 100; i++) {
        const d = await h.dir.read();
        if (!d) break;
        const st = d.isSymbolicLink()
          ? { mode: 0o120777, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 }
          : await fsp.lstat(path.join(h.dir.path, d.name)).then(attrsFromStat, () => null);
        batch.push({
          filename: d.name,
          longname: longname(st ?? { mode: d.isDirectory() ? DIR_MODE : FILE_MODE, size: 0, mtime: 0 }, d.name),
          attrs: st ?? { mode: d.isDirectory() ? DIR_MODE : FILE_MODE, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 },
        });
      }
      if (batch.length === 0) return sftp.status(reqid, STATUS.EOF);
      sftp.name(reqid, batch);
    })().catch((err) => fail(reqid, err));
  });

  // ---- STAT / LSTAT ----
  const statHandler = (symlink: boolean) => (reqid: number, filename: string) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type === "root" || res.type === "server" || res.type === "serverroot") {
      return sftp.attrs(reqid, { mode: DIR_MODE, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 });
    }
    if (res.type !== "real") return sftp.status(reqid, STATUS.NO_SUCH_FILE);
    assertInside(res.entry.realRoot, res.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        const st = symlink ? await fsp.lstat(res.abs) : await fsp.stat(res.abs);
        sftp.attrs(reqid, attrsFromStat(st));
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  };
  sftp.on("STAT", statHandler(false));
  sftp.on("LSTAT", statHandler(true));

  // ---- SETSTAT ----
  sftp.on("SETSTAT", (reqid: number, filename: string, attrs: any) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type !== "real") return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    assertInside(res.entry.realRoot, res.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      const ops: Promise<void>[] = [];
      if (typeof attrs?.size === "number") ops.push(fsp.truncate(res.abs, attrs.size));
      if (typeof attrs?.mtime === "number" || typeof attrs?.atime === "number") {
        const atime = typeof attrs.atime === "number" ? attrs.atime : attrs.mtime;
        const mtime = typeof attrs.mtime === "number" ? attrs.mtime : attrs.atime;
        ops.push(fsp.utimes(res.abs, new Date(atime * 1000), new Date(mtime * 1000)));
      }
      if (typeof attrs?.mode === "number") ops.push(fsp.chmod(res.abs, attrs.mode));
      Promise.all(ops).then(
        () => sftp.status(reqid, STATUS.OK),
        (err) => fail(reqid, err),
      );
    }).catch((err) => fail(reqid, err));
  });

  // ---- REMOVE ----
  sftp.on("REMOVE", (reqid: number, filename: string) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type !== "real") return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    assertInside(res.entry.realRoot, res.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        await fsp.unlink(res.abs);
        sftp.status(reqid, STATUS.OK);
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- MKDIR ----
  sftp.on("MKDIR", (reqid: number, filename: string) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type !== "real") return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    assertInside(res.entry.realRoot, res.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        await fsp.mkdir(res.abs, { recursive: false });
        sftp.status(reqid, STATUS.OK);
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- RMDIR ----
  sftp.on("RMDIR", (reqid: number, filename: string) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type !== "real") return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    assertInside(res.entry.realRoot, res.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        await fsp.rmdir(res.abs);
        sftp.status(reqid, STATUS.OK);
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- RENAME ----
  sftp.on("RENAME", (reqid: number, oldPath: string, newPath: string) => {
    const from = resolveVirtual(splitVirtual(oldPath), scope);
    const to = resolveVirtual(splitVirtual(newPath), scope);
    if (from.type !== "real" || to.type !== "real") {
      return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    }
    Promise.all([
      assertInside(from.entry.realRoot, from.abs),
      assertInside(to.entry.realRoot, to.abs),
    ]).then(async ([a, b]) => {
      if (!a || !b) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        await fsp.rename(from.abs, to.abs);
        sftp.status(reqid, STATUS.OK);
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- REALPATH ----
  sftp.on("REALPATH", (reqid: number, filename: string) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type === "none") return sftp.status(reqid, STATUS.NO_SUCH_FILE);
    const virt = res.type === "root" || res.type === "serverroot" ? "/"
      : res.type === "server"
        ? `/${res.entry.name}`
        : `/${res.entry.name}/${segs.slice(1).join("/")}`;
    sftp.name(reqid, [{ filename: virt, longname: "", attrs: {} }]);
  });

  // ---- READLINK ----
  sftp.on("READLINK", (reqid: number, filename: string) => {
    const segs = splitVirtual(filename);
    const res = resolveVirtual(segs, scope);
    if (res.type !== "real") return sftp.status(reqid, STATUS.NO_SUCH_FILE);
    fsp.readlink(res.abs).then(
      (target) => sftp.name(reqid, [{ filename: target, longname: "", attrs: {} }]),
      (err) => fail(reqid, err),
    );
  });

  // ---- SYMLINK (target first per SFTP spec, ssh2 emits linkPath, targetPath) ----
  sftp.on("SYMLINK", (reqid: number, linkPath: string, targetPath: string) => {
    const linkRes = resolveVirtual(splitVirtual(linkPath), scope);
    if (linkRes.type !== "real") return sftp.status(reqid, STATUS.PERMISSION_DENIED);
    assertInside(linkRes.entry.realRoot, linkRes.abs).then(async (ok) => {
      if (!ok) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      const targetAbs = targetPath.startsWith("/")
        ? (() => { const r = resolveVirtual(splitVirtual(targetPath), scope); return r.type === "real" ? r.abs : null; })()
        : path.join(path.dirname(linkRes.abs), targetPath);
      if (!targetAbs) return sftp.status(reqid, STATUS.PERMISSION_DENIED);
      try {
        await fsp.symlink(targetAbs, linkRes.abs);
        sftp.status(reqid, STATUS.OK);
      } catch (err) {
        fail(reqid, err);
      }
    }).catch((err) => fail(reqid, err));
  });

  // ---- EXTENDED (statvfs etc.) — not supported ----
  sftp.on("EXTENDED", (reqid: number) => sftp.status(reqid, STATUS.OP_UNSUPPORTED));
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export function startSftpServer(): void {
  const hostKey = getHostKey();
  // Pre-fill the entries cache so the very first SFTP connection already
  // sees the current server list (no empty-root race).
  refreshEntries().catch((err) => console.error("[sftp] Failed to build server entries:", err));

  const server = new Server({ hostKeys: [hostKey] }, (client, info) => {
    const ip = info?.ip ?? "unknown";
    client.on("authentication", (ctx) => {
      if (ctx.method !== "password") {
        return ctx.reject(["password"]);
      }
      if (isBlocked(ip)) {
        return ctx.reject(["password"]);
      }
      // Per-server logins use "<base>.<server>" (e.g. "admin.Test"). Split the
      // base username off so the panel password still validates, then pin the
      // SFTP root to that one server.
      getConfigUsername().then((base) => {
        if (!base) return ctx.reject(["password"]);
        let authUser = ctx.username;
        let serverSuffix: string | null = null;
        if (ctx.username === base) {
          authUser = base;
        } else if (ctx.username.startsWith(`${base}.`)) {
          authUser = base;
          serverSuffix = ctx.username.slice(base.length + 1);
        } else {
          return ctx.reject(["password"]);
        }
        verifyCredentials(authUser, ctx.password).then((ok) => {
          if (ok) {
            recordSuccess(ip);
            (client as any)._sftpServerSuffix = serverSuffix;
            ctx.accept();
          } else {
            recordFail(ip);
            ctx.reject(["password"]);
          }
        }).catch(() => ctx.reject(["password"]));
      }).catch(() => ctx.reject(["password"]));
    });

    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        // No shell / command execution — SFTP only.
        session.on("shell", (_a, reject) => reject());
        session.on("exec", (_a, reject) => reject());
        session.on("sftp", (sftpAccept) => {
          const sftp = sftpAccept() as unknown as SftpStream;
          // Register handlers SYNCHRONOUSLY — ssh2 answers any request that
          // arrives without a listener with OP_UNSUPPORTED. The entries map
          // comes from the (pre-filled) cache, so early requests work too.
          const suffix = (client as any)._sftpServerSuffix ?? null;
          handleSftp(sftp, buildScope(suffix, getEntries()));
          refreshEntries().catch((err) => console.error("[sftp] Failed to build server entries:", err));
        });
      });
    });

    client.on("error", (err) => {
      // ECONNRESET etc. during probing is normal — keep the log quiet.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ECONNRESET" && code !== "ETIMEDOUT") {
        console.error(`[sftp] Connection error from ${ip}:`, err.message);
      }
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`[sftp] Port ${SFTP_PORT} already in use — SFTP server disabled.`);
    } else {
      console.error("[sftp] Server error:", err);
    }
  });

  server.listen(SFTP_PORT, SFTP_BIND, () => {
    console.log(`[sftp] SFTP server listening on ${SFTP_BIND}:${SFTP_PORT} (panel credentials)`);
  });
}

/** Current SFTP port — used by the frontend info endpoint. */
export function getSftpPort(): number {
  return SFTP_PORT;
}
