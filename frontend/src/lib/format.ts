import type { ServerStatus } from "./types";

// ---------------------------------------------------------------------------
// Shared formatting helpers — single source of truth for the whole UI.
// (Previously duplicated in dashboard, server detail and ConsoleTab.)
// ---------------------------------------------------------------------------

export function statusColor(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "bg-emerald-500";
    case "exited": case "created": case "paused": return "bg-amber-500";
    default: return "bg-edge";
  }
}

export function statusLabel(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "Online";
    case "exited": return "Stopped";
    case "created": return "Created";
    case "paused": return "Paused";
    default: return "Unknown";
  }
}

export function statusBadgeColor(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "bg-online/10 text-emerald-400 border-online/20";
    case "exited": case "created": case "paused": return "bg-warn/10 text-amber-400 border-warn/20";
    default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
}

export function typeLabel(t: string) {
  switch (t) {
    case "fabric": return "Fabric";
    case "velocity": return "Velocity";
    default: return "Paper";
  }
}

export function typeBadgeColor(t: string) {
  switch (t) {
    case "fabric": return "bg-warn/10 text-amber-400 border-warn/20";
    case "velocity": return "bg-accent/10 text-purple-400 border-edge";
    default: return "bg-accent/10 text-violet-400 border-violet-500/20";
  }
}

export function formatRam(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb} MB`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function formatDisk(bytes: number | undefined) {
  if (bytes == null || bytes < 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

export function formatUptime(startedAt: string | null | undefined) {
  if (!startedAt) return null;
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const TAG_STYLES: Record<string, string> = {
  survival: "bg-online/10 text-emerald-300 border-online/25",
  modded: "bg-warn/10 text-amber-300 border-warn/25",
  proxy: "bg-accent/15 text-purple-300 border-accent/35",
  creative: "bg-pink-500/10 text-pink-300 border-pink-500/25",
  test: "bg-slate-500/10 text-slate-300 border-slate-500/25",
};

/** Deterministic badge style for a server tag (grouping label). */
export function tagStyle(tag: string) {
  const key = tag.toLowerCase();
  if (TAG_STYLES[key]) return TAG_STYLES[key];
  const palettes = [
    "bg-online/10 text-emerald-300 border-online/25",
    "bg-warn/10 text-amber-300 border-warn/25",
    "bg-accent/15 text-purple-300 border-accent/35",
    "bg-pink-500/10 text-pink-300 border-pink-500/25",
    "bg-sky-500/10 text-sky-300 border-sky-500/25",
  ];
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palettes[h % palettes.length];
}
