// ---- Obsidian Panel: Shared live stats store ----
// Updated by websocket stats handler, read by Discord status embed updater.

interface LiveStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  tps5s?: number;
  players?: { online: number; max: number };
  uptimeSeconds: number;
  startTime: number;
}

const store = new Map<string, LiveStats>();

export function setLiveStats(serverId: string, stats: Partial<LiveStats>): void {
  const existing = store.get(serverId);
  if (existing) {
    Object.assign(existing, stats);
  } else {
    store.set(serverId, {
      cpuPercent: 0, memoryUsage: 0, memoryLimit: 0, uptimeSeconds: 0, startTime: Date.now(),
      ...stats,
    });
  }
}

export function getLiveStats(serverId: string): LiveStats {
  const s = store.get(serverId);
  if (!s) return { cpuPercent: 0, memoryUsage: 0, memoryLimit: 0, uptimeSeconds: 0, startTime: Date.now() };
  s.uptimeSeconds = Math.floor((Date.now() - s.startTime) / 1000);
  return s;
}

export function initLiveStats(serverId: string, memoryLimit: number): void {
  store.set(serverId, { cpuPercent: 0, memoryUsage: 0, memoryLimit, uptimeSeconds: 0, startTime: Date.now() });
}

export function clearLiveStats(serverId: string): void {
  store.delete(serverId);
}
