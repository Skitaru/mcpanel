// ---- Minecraft Server Panel: Task Scheduler ----
// Checks every 30 s whether any server has a scheduled task due.
// Stores schedule config in servers.json per-server.

import { loadServers, saveServers } from "./config-store";
import {
  stopContainer,
  startContainer,
  deleteContainer,
  createContainer,
  resolveJavaImage,
} from "./docker";
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import fs from "node:fs";

const CHECK_INTERVAL_MS = 30_000;

let _interval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (_interval) return;
  console.log("[scheduler] Started (checks every 30 s)");
  _interval = setInterval(tick, CHECK_INTERVAL_MS);
}

async function tick(): Promise<void> {
  const servers = loadServers();
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const srv of servers) {
    const schedule = srv.schedule;
    if (!schedule) continue;

    // ---- Scheduled restart ----
    if (schedule.restart && schedule.restart === currentTime && srv.containerId) {
      console.log(`[scheduler] Restarting server "${srv.name}" (scheduled ${schedule.restart})`);
      try {
        await restartContainer(srv);
        console.log(`[scheduler] Server "${srv.name}" restarted successfully`);
      } catch (err: any) {
        console.error(`[scheduler] Failed to restart "${srv.name}":`, err.message);
      }
    }

    // ---- Scheduled backup ----
    if (schedule.backup && schedule.backup === currentTime) {
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

async function restartContainer(srv: any): Promise<void> {
  const containerId = srv.containerId;
  if (!containerId) return;

  // Stop + remove + recreate + start
  try { await stopContainer(containerId); } catch {}
  try { await deleteContainer(containerId); } catch {}

  const javaImage = srv.serverType === "velocity"
    ? "eclipse-temurin:21-jre-alpine"
    : (srv.serverType === "fabric"
      ? resolveJavaImageFallback(srv.version)
      : resolveJavaImage(srv.version));

  let jarName = "paper.jar";
  if (srv.serverType === "fabric") jarName = "fabric-server-launch.jar";
  else if (srv.serverType === "velocity") jarName = "velocity.jar";

  const newId = await createContainer(srv, javaImage, {
    jarName,
    javaArgs: srv.javaArgs,
  });

  await startContainer(newId);

  // Update the containerId in servers.json
  const all = loadServers();
  const idx = all.findIndex((s: any) => s.id === srv.id);
  if (idx >= 0) { all[idx].containerId = newId; saveServers(all); }
}

function resolveJavaImageFallback(version: string): string {
  const img = resolveJavaImage(version);
  if (img === "eclipse-temurin:16-jre-alpine" || img === "eclipse-temurin:8-jre-alpine") {
    return "eclipse-temurin:17-jre-alpine";
  }
  return img;
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

  const stat = fs.statSync(backupPath);
  console.log(`[scheduler] Backup saved: ${backupName} (${(stat.size / 1e6).toFixed(1)} MB)`);

  // Keep only the 5 most recent scheduled backups
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(`scheduled-backup-${srv.id.slice(0, 8)}-`) && f.endsWith(".tar.gz"))
    .sort()
    .reverse();
  for (const old of backups.slice(5)) {
    try { fs.unlinkSync(path.join(backupDir, old)); } catch {}
  }
}
