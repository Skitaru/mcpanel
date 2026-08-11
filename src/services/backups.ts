// ---- Obsidian Panel: Backup service ----
// Backups live on the server under <BACKUP_ROOT>/<serverId>/ and are managed
// through the panel UI (list / download / restore / delete). Backups run
// WITHOUT stopping the container (no downtime; world files may be marginally
// inconsistent, which is standard practice for MC panels).

import path from "node:path";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { ServerConfig } from "../types";
import { inspectContainer, stopContainer, startContainer } from "./docker";

/** Root folder holding one subfolder per server id. */
export const BACKUP_ROOT = path.resolve(process.cwd(), "backups");

export type BackupKind = "manual" | "scheduled" | "auto";

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string; // ISO timestamp
  kind: BackupKind;
}

/** Progress state for an async backup job (polled by the frontend). */
export interface BackupJob {
  jobId: string;
  serverId: string;
  name: string;
  percent: number; // 0–100
  status: "running" | "done" | "error";
  writtenBytes: number;
  totalBytes: number;
  message?: string;
}

const backupJobs = new Map<string, BackupJob>();

/** Get the current progress of an async backup job. */
export function getBackupJob(jobId: string): BackupJob | undefined {
  return backupJobs.get(jobId);
}

function serverBackupDir(serverId: string): string {
  return path.join(BACKUP_ROOT, serverId);
}

/** Resolve a backup archive path, refusing any path-traversal name. */
export function backupPathFor(serverId: string, name: string): string | null {
  if (!name || name !== path.basename(name) || !name.endsWith(".tar.gz")) return null;
  return path.join(serverBackupDir(serverId), name);
}

/** Run an execFile and reject on error (small local helper). */
function run(cmd: string, args: string[], timeout: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Total size (bytes) of the data dir — the reference value for backup progress. */
async function dirSize(dataPath: string): Promise<number> {
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("du", ["-sb", dataPath], { timeout: 30_000, encoding: "utf-8" }, (err, out) =>
        err ? reject(err) : resolve({ stdout: out }),
      );
    });
    return parseInt(stdout.trim().split(/\s+/)[0], 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Write a gzipped tar archive of the data dir. `onProgress(percent, written, total)`
 * is called as raw (uncompressed) bytes flow through — progress compares processed
 * bytes against the total dir size, so it reflects real work done.
 */
async function writeBackupArchive(
  dataPath: string,
  backupPath: string,
  onProgress?: (percent: number, writtenBytes: number, totalBytes: number) => void,
): Promise<void> {
  const totalBytes = await dirSize(dataPath);
  const tar = spawn("tar", ["-cf", "-", "-C", dataPath, "."], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const gzip = createGzip();
  const out = createWriteStream(backupPath);

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (onProgress && totalBytes > 0) {
        onProgress(Math.min(99, Math.round((written / totalBytes) * 100)), written, totalBytes);
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(tar.stdout, counter, gzip, out);
  } catch (err) {
    tar.kill();
    throw err;
  }
  if (onProgress) onProgress(100, written, totalBytes);
}

/**
 * Create a backup of a server's data dir (no stop, no download).
 * Returns metadata about the created archive.
 */
export async function createBackup(server: ServerConfig, kind: BackupKind): Promise<BackupInfo> {
  // Skip empty / missing data dirs — nothing to back up.
  try {
    const entries = await readdir(server.dataPath);
    if (entries.length === 0) throw new Error("empty");
  } catch {
    throw new Error(`Nothing to back up — data directory is empty (${server.dataPath}).`);
  }

  const dir = serverBackupDir(server.id);
  await fs.promises.mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = kind === "scheduled" ? "scheduled-backup" : kind === "auto" ? "auto" : "backup";
  const name = `${prefix}-${server.id.slice(0, 8)}-${timestamp}.tar.gz`;
  const backupPath = path.join(dir, name);

  await writeBackupArchive(server.dataPath, backupPath);

  const st = await stat(backupPath);
  return { name, size: st.size, createdAt: new Date().toISOString(), kind };
}

/**
 * Start a backup in the background and return immediately with a job id.
 * Progress can be polled via {@link getBackupJob}. Job entries are cleaned up
 * 60 s after completion.
 */
export function startBackupJob(server: ServerConfig, kind: BackupKind): { jobId: string; name: string } {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = serverBackupDir(server.id);
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = kind === "scheduled" ? "scheduled-backup" : kind === "auto" ? "auto" : "backup";
  const name = `${prefix}-${server.id.slice(0, 8)}-${timestamp}.tar.gz`;
  const backupPath = path.join(dir, name);

  const job: BackupJob = {
    jobId,
    serverId: server.id,
    name,
    percent: 0,
    status: "running",
    writtenBytes: 0,
    totalBytes: 0,
  };
  backupJobs.set(jobId, job);

  // Fail fast on empty data dirs.
  try {
    const entries = fs.readdirSync(server.dataPath);
    if (entries.length === 0) throw new Error("empty");
  } catch {
    job.status = "error";
    job.message = "Data directory is empty — nothing to back up.";
    return { jobId, name };
  }

  writeBackupArchive(server.dataPath, backupPath, (percent, writtenBytes, totalBytes) => {
    job.percent = percent;
    job.writtenBytes = writtenBytes;
    job.totalBytes = totalBytes;
  })
    .then(() => {
      job.percent = 100;
      job.status = "done";
      const st = fs.statSync(backupPath);
      job.writtenBytes = st.size;
    })
    .catch((err: any) => {
      job.status = "error";
      job.message = err?.message ?? "Backup failed.";
      try { fs.unlinkSync(backupPath); } catch { /* partial file */ }
    })
    .finally(() => {
      // Clean up job entries after 60 s (like modpack install progress).
      setTimeout(() => backupJobs.delete(jobId), 60_000);
    });

  return { jobId, name };
}

/** List all backups for a server, newest first. */
export async function listBackups(serverId: string): Promise<BackupInfo[]> {
  const dir = serverBackupDir(serverId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const result: BackupInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".tar.gz")) continue;
    try {
      const st = await stat(path.join(dir, name));
      const kind: BackupKind = name.startsWith("scheduled-backup-")
        ? "scheduled"
        : name.startsWith("auto-")
          ? "auto"
          : "manual";
      result.push({ name, size: st.size, createdAt: st.mtime.toISOString(), kind });
    } catch {
      // file vanished between readdir and stat
    }
  }
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}

/** Delete old backups of the given kinds, keeping only the `keep` newest. */
export async function pruneBackups(serverId: string, kinds: BackupKind[], keep: number): Promise<void> {
  const all = await listBackups(serverId);
  for (const kind of kinds) {
    const ofKind = all.filter((b) => b.kind === kind);
    for (const old of ofKind.slice(keep)) {
      const p = backupPathFor(serverId, old.name);
      if (p) {
        try { await unlink(p); } catch { /* already gone */ }
      }
    }
  }
}

/** Delete a single backup. Returns true if something was removed. */
export async function deleteBackup(serverId: string, name: string): Promise<boolean> {
  const p = backupPathFor(serverId, name);
  if (!p) return false;
  try {
    await unlink(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore a server's data dir from a local tar.gz archive.
 * - Pre-scans the archive for path traversal (tar-slip) and rejects unsafe ones.
 * - Stops the container if running, swaps the data dir, restarts if it was running.
 */
export async function restoreFromArchive(server: ServerConfig, archivePath: string): Promise<void> {
  // ---- tar-slip protection: reject absolute / ../ entries before extracting ----
  const listing = await new Promise<string>((resolve, reject) => {
    execFile("tar", ["-tzf", archivePath], {
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf-8",
    }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  for (const entry of listing.split("\n")) {
    const e = entry.trim();
    if (!e) continue;
    if (e.startsWith("/") || e.split("/").includes("..")) {
      throw new Error("Archive contains unsafe paths (path traversal) and was rejected.");
    }
  }

  // ---- stop container if running ----
  let wasRunning = false;
  if (server.containerId) {
    try { wasRunning = (await inspectContainer(server.containerId)).running; } catch { /* unknown */ }
    try { await stopContainer(server.containerId); } catch { /* already stopped */ }
  }

  // ---- extract to temp dir first; only swap data if extraction succeeds ----
  const tmpDir = path.join("/tmp/mcpanel-restore", server.id);
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  await fs.promises.mkdir(tmpDir, { recursive: true });
  try {
    await run("tar", ["-xzf", archivePath, "-C", tmpDir, "--no-absolute-filenames"], 300_000);
  } catch (err) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  // ---- swap data dir ----
  await fs.promises.mkdir(server.dataPath, { recursive: true });
  for (const entry of await fs.promises.readdir(server.dataPath)) {
    await fs.promises.rm(path.join(server.dataPath, entry), { recursive: true, force: true });
  }
  for (const entry of await fs.promises.readdir(tmpDir)) {
    const src = path.join(tmpDir, entry);
    const dst = path.join(server.dataPath, entry);
    // fs.cp is EXDEV-resistant (copies across devices if needed).
    await fs.promises.cp(src, dst, { recursive: true });
    await fs.promises.rm(src, { recursive: true, force: true });
  }
  await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  // ---- restart if it was running ----
  if (server.containerId && wasRunning) {
    try { await startContainer(server.containerId); } catch (err: any) {
      console.error(`[backups] Restore re-start failed for "${server.name}":`, err.message);
    }
  }
}
