// ---- Obsidian Panel: Task Scheduler ----
// Checks every 30 s whether any server has a scheduled task due.
// Stores schedule config in servers.json per-server.

import { loadServers } from "./config-store";
import { stopContainer, startContainer, inspectContainer } from "./docker";
import { createBackup, pruneBackups } from "./backups";

const CHECK_INTERVAL_MS = 30_000;

let _interval: ReturnType<typeof setInterval> | null = null;

/** Tracks the last HH:MM a task was executed for a given server+task key.
 *  Prevents double-firing when the 30 s check interval hits the same minute twice. */
const lastFired = new Map<string, string>();

/** Servers for which a crash-loop auto-stop has already been triggered. */
const crashLoopStopped = new Set<string>();

/** Guards against overlapping ticks (a slow backup must not start a second
 *  parallel tick while the first is still running). */
let ticking = false;

export function startScheduler(): void {
  if (_interval) return;
  console.log("[scheduler] Started (checks every 30 s)");
  _interval = setInterval(() => { void tick(); }, CHECK_INTERVAL_MS);
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const servers = await loadServers();
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    for (const srv of servers) {
      const schedule = srv.schedule;
      if (!schedule) continue;

      // ---- Scheduled restart (fast stop+start on the SAME container — the
      // container recreation stays a manual "Recreate" action) ----
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

      // ---- Scheduled backup (keeps the 5 most recent) ----
      if (schedule.backup && schedule.backup === currentTime) {
        const key = `${srv.id}:backup`;
        if (lastFired.get(key) !== currentTime) {
          lastFired.set(key, currentTime);
          console.log(`[scheduler] Backing up server "${srv.name}" (scheduled ${schedule.backup})`);
          try {
            const bk = await createBackup(srv, "scheduled");
            await pruneBackups(srv.id, ["scheduled"], 5);
            console.log(`[scheduler] Backup of "${srv.name}" completed: ${bk.name} (${(bk.size / 1e6).toFixed(1)} MB)`);
          } catch (err: any) {
            console.error(`[scheduler] Failed to backup "${srv.name}":`, err.message);
          }
        }
      }
    }

    // ---- Crash-loop detection: a container stuck in an endless restart loop
    // (RestartPolicy unless-stopped) burns CPU forever. If it is NOT running
    // and has restarted excessively, stop it so the loop ends. ----
    for (const srv of servers) {
      if (!srv.containerId || crashLoopStopped.has(srv.id)) continue;
      try {
        const info = await inspectContainer(srv.containerId);
        if (!info.running && info.restartCount >= 15) {
          crashLoopStopped.add(srv.id);
          console.warn(`[scheduler] Server "${srv.name}" restarted ${info.restartCount}x without staying up — stopping container to break the crash loop.`);
          await stopContainer(srv.containerId).catch(() => {});
        }
      } catch {
        // container inspect failed — skip
      }
    }
  } finally {
    ticking = false;
  }
}

/** Graceful restart without recreating the container. */
async function restartContainer(srv: any): Promise<void> {
  const containerId = srv.containerId;
  if (!containerId) return;
  await stopContainer(containerId);
  await startContainer(containerId);
}
