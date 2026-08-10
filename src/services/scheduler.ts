// ---- Minecraft Server Panel: Task Scheduler ----
// Checks every 30 s whether any server has a scheduled task due.
// Stores schedule config in servers.json per-server.

import { loadServers, mutateServers } from "./config-store";
import {
  stopContainer,
  startContainer,
  deleteContainer,
  createContainer,
  resolveJavaImageForServer,
} from "./docker";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { readdir, stat, unlink } from "node:fs/promises";

const CHECK_INTERVAL_MS = 30_000;

let _interval: ReturnType<typeof setInterval> | null = null;

/** Tracks the last HH:MM a task was executed for a given server+task key.
 *  Prevents double-firing when the 30 s check interval hits the same minute twice. */
const lastFired = new Map<string, string>();

export function startScheduler(): void {
  if (_interval) return;
  console.log("[scheduler] Started (checks every 30 s)");
  _interval = setInterval(tick, CHECK_INTERVAL_MS);
}

async function tick(): Promise<void> {
  const servers = await loadServers();
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const srv of servers) {
    const schedule = srv.schedule;
    if (!schedule) continue;

    // ---- Scheduled restart ----
    if (schedule.restart && schedule.restart === currentTime && srv.containerId) {
      const key = `${srv.id}:restart`;
      if (lastFired.get(key) !== currentTime) {
        lastFired.set(key, currentTime);
        console.log(`[scheduler] Restarting server "${srv.name}" (scheduled ${schedule.restart})`);
        try {
          await restartContainer(srv);
          console.log(`[scheduler] Server "${srv.name}" restarted successfully`);
        } catch (err: any) {
          console.error(`[scheduler] Failed to restart "${srv.name}":`, err.message);
        }
      }
    }

    // ---- Scheduled backup ----
    if (schedule.backup && schedule.backup === currentTime) {
      const key = `${srv.id}:backup`;
      if (lastFired.get(key) !== currentTime) {
        lastFired.set(key, currentTime);
        console.log(`[scheduler] Backing up server "${srv.name}" (scheduled ${schedule.backup})`);
        try {
          await performBackup(srv);
          console.log(`[scheduler] Backup of "${srv.name}" completed`);
        } catch (err: any) {
          console.error(`[scheduler] Failed to backup "${srv.name}":`, err.message);
        }
      }
    }
  }
}

async function restartContainer(srv: any): Promise<void> {
  const containerId = srv.containerId;
  if (!containerId) return;

  // Stop + remove + recreate + start
  try { await stopContainer(containerId); } catch {}
  try { await deleteContainer(containerId); } catch {}

  const ver = srv.version === "pending" ? "1.21.1" : srv.version;
  const javaImage = resolveJavaImageForServer(ver, srv.serverType);

  // Determine the launch jar. Paper/Fabric/Velocity have fixed names; custom
  // (modpack) servers are probed from the data directory — a scheduled restart
  // must NOT recreate them with the default paper.jar.
  let jarName = "paper.jar";
  if (srv.serverType === "fabric") jarName = "fabric-server-launch.jar";
  else if (srv.serverType === "velocity") jarName = "velocity.jar";
  else if (srv.serverType === "custom") {
    const has = (p: string) => { try { return fs.existsSync(p); } catch { return false; } };
    const dir: string = srv.dataPath;
    if (has(path.join(dir, "run.sh"))) jarName = "run.sh";
    else if (has(path.join(dir, "server.jar"))) jarName = "server.jar";
    else if (has(path.join(dir, "quilt-server-launch.jar"))) jarName = "quilt-server-launch.jar";
    else if (has(path.join(dir, "fabric-server-launch.jar"))) jarName = "fabric-server-launch.jar";
  }

  const newId = await createContainer(srv, javaImage, {
    jarName,
    javaArgs: srv.javaArgs,
  });

  await startContainer(newId);

  // Update the containerId in servers.json (serialized — no lost updates).
  await mutateServers((all: any[]) => {
    const idx = all.findIndex((s: any) => s.id === srv.id);
    if (idx >= 0) all[idx].containerId = newId;
  });
}

async function performBackup(srv: any): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `scheduled-backup-${srv.id.slice(0, 8)}-${timestamp}.tar.gz`;
  const backupDir = path.resolve(srv.dataPath, "..");
  const backupPath = path.join(backupDir, backupName);

  await new Promise<void>((resolve, reject) => {
    execFile("tar", ["-czf", backupPath, "-C", srv.dataPath, "."], {
      timeout: 300_000,
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const st = await stat(backupPath);
  console.log(`[scheduler] Backup saved: ${backupName} (${(st.size / 1e6).toFixed(1)} MB)`);

  // Keep only the 5 most recent scheduled backups
  const backups = (await readdir(backupDir))
    .filter(f => f.startsWith(`scheduled-backup-${srv.id.slice(0, 8)}-`) && f.endsWith(".tar.gz"))
    .sort()
    .reverse();
  for (const old of backups.slice(5)) {
    try { await unlink(path.join(backupDir, old)); } catch {}
  }
}
