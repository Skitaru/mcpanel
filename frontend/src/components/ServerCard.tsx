"use client";

import Link from "next/link";
import { typeLabel, tagStyle } from "@/lib/format";
import type { ServerStatus } from "@/lib/types";

interface Props {
  s: ServerStatus;
  motd?: string;
  /** Live CPU percent (0–100). */
  liveCpu?: number;
  /** Live memory usage in bytes. */
  liveMem?: number;
  playerCount?: { online: number; max: number };
  acting: boolean;
  stopConfirm: boolean;
  restartConfirm: boolean;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onStopConfirm: () => void;
  onRestartConfirm: () => void;
  onCancelConfirm: () => void;
}

const TYPE_ICON: Record<string, string> = {
  paper: "🌍",
  fabric: "🧩",
  velocity: "🕸️",
  custom: "📦",
};

const TYPE_TILE_BG: Record<string, string> = {
  paper: "bg-accent/15",
  fabric: "bg-warn/10",
  velocity: "bg-online/10",
  custom: "bg-edge/60",
};

/** Compact grouped-list row (V5): icon tile + name + meta + status + actions. */
export default function ServerCard({
  s, motd, liveCpu = 0, liveMem, playerCount,
  acting, stopConfirm, restartConfirm,
  onOpen, onStart, onStop, onRestart, onStopConfirm, onRestartConfirm, onCancelConfirm,
}: Props) {
  const isRunning = s.status === "running";

  const uptime = (() => {
    if (!s.startedAt) return null;
    const seconds = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000);
    if (seconds < 0) return null;
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  })();

  return (
    <div
      className={`group surface relative flex items-center gap-3 rounded-xl px-3.5 py-3 transition-all duration-200 hover:border-accent hover:bg-surface2 ${
        isRunning ? "border-online/20 card-glow-online" : "opacity-80"
      }`}
    >
      {/* ── Icon tile ── */}
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base ${TYPE_TILE_BG[s.serverType] ?? "bg-edge/60"}`}>
        {TYPE_ICON[s.serverType] ?? "📦"}
      </div>

      {/* ── Name + meta ── */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[13px] font-bold text-white">{s.name}</h3>
          {s.tag && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${tagStyle(s.tag)}`}>{s.tag}</span>}
          <span className="shrink-0 rounded-full border border-edge bg-void px-2 py-0.5 text-[9px] font-semibold text-muted">
            {typeLabel(s.serverType)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
          <span className="font-mono">:{s.port}</span>
          <span>👥 {isRunning ? `${playerCount?.online ?? 0}/${playerCount?.max ?? 20}` : "—"}</span>
          {isRunning && uptime && <span>⏱ {uptime}</span>}
          {isRunning && motd && <span className="hidden sm:inline truncate max-w-[220px]">{motd}</span>}
        </div>
      </div>

      {/* ── Status ── */}
      <span className={`flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${isRunning ? "text-online" : "text-warn"}`}>
        <span className={`h-2 w-2 rounded-full ${isRunning ? "bg-online pulse-dot" : "bg-warn"}`} />
        <span className="hidden md:inline">{isRunning ? "Online" : "Stopped"}</span>
      </span>

      {/* ── Actions ── */}
      <div className="relative z-20 flex shrink-0 items-center gap-1.5">
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(); }}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${isRunning ? "bg-accent text-white hover:bg-accent-strong" : "border border-online/30 bg-online/10 text-online hover:bg-online/20"}`}>
          {isRunning ? "▸ Open" : "▶ Start"}
        </button>

        {isRunning && (
          <>
            {restartConfirm ? (
              <div className="flex items-center gap-1 rounded-lg border border-warn/30 bg-warn/10 px-1.5 py-1">
                <span className="text-[9px] font-medium text-warn">Restart?</span>
                <button onClick={(e) => { e.stopPropagation(); onRestart(); }} disabled={acting} className="rounded bg-warn px-1.5 py-0.5 text-[9px] font-bold text-black disabled:opacity-50">Yes</button>
                <button onClick={(e) => { e.stopPropagation(); onCancelConfirm(); }} className="rounded bg-edge px-1.5 py-0.5 text-[9px] text-slate-300">No</button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onRestartConfirm(); }} title="Restart" aria-label="Restart"
                className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] font-bold text-warn transition hover:bg-warn/20">↻</button>
            )}
            {stopConfirm ? (
              <div className="flex items-center gap-1 rounded-lg border border-danger/30 bg-danger/10 px-1.5 py-1">
                <span className="text-[9px] font-medium text-danger">Stop?</span>
                <button onClick={(e) => { e.stopPropagation(); onStop(); }} disabled={acting} className="rounded bg-danger px-1.5 py-0.5 text-[9px] font-bold text-white disabled:opacity-50">Yes</button>
                <button onClick={(e) => { e.stopPropagation(); onCancelConfirm(); }} className="rounded bg-edge px-1.5 py-0.5 text-[9px] text-slate-300">No</button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onStopConfirm(); }} title="Stop" aria-label="Stop"
                className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] font-bold text-danger transition hover:bg-danger/20">■</button>
            )}
          </>
        )}
      </div>

      <Link href={`/servers/${s.id}`} className="absolute inset-0 z-10 rounded-xl" aria-label={`${s.name} öffnen`} />
    </div>
  );
}
