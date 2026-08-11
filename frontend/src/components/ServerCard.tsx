"use client";

import Link from "next/link";
import { Users, Clock } from "lucide-react";
import { formatBytes, formatRam, tagStyle, typeLabel } from "@/lib/format";
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

/** Pterodactyl-style server card: banner header + power buttons + live bars. */
export default function ServerCard({
  s, motd, liveCpu = 0, liveMem, playerCount,
  acting, stopConfirm, restartConfirm,
  onOpen, onStart, onStop, onRestart, onStopConfirm, onRestartConfirm, onCancelConfirm,
}: Props) {
  const isRunning = s.status === "running";
  const cpu = Math.min(100, liveCpu);
  const memPct = liveMem && s.ram ? Math.min(100, (liveMem / (s.ram * 1e6)) * 100) : 0;

  const bannerClass = !isRunning
    ? "bg-[linear-gradient(135deg,#17181b,#101114_60%,#0a0b0d)]"
    : s.serverType === "fabric"
      ? "bg-[linear-gradient(135deg,#3a2f12,#251c07_55%,#110d04)]"
      : s.serverType === "velocity"
        ? "bg-[linear-gradient(135deg,#12312a,#0a201c_55%,#061311)]"
        : "bg-[linear-gradient(135deg,#1c2433,#141a26_55%,#0d1119)]";
  const textureClass = !isRunning ? "" : s.serverType === "fabric" ? "banner-texture-amber" : s.serverType === "velocity" ? "banner-texture-cyan" : "banner-texture";

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
      className={`group surface relative flex flex-col overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-1 hover:border-accent hover:shadow-[0_18px_44px_-12px_rgba(0,0,0,0.7),0_0_30px_rgba(157,78,221,0.18)] ${
        isRunning ? "card-glow-online border-online/20" : "opacity-75"
      }`}
    >
      {/* ── Banner ── */}
      <div className={`relative flex h-28 items-end p-4 ${bannerClass}`}>
        <div className={`pointer-events-none absolute inset-0 ${textureClass}`} />
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          {s.tag && (
            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur ${tagStyle(s.tag)}`}>
              {s.tag}
            </span>
          )}
          <span className={`flex items-center gap-1.5 rounded-full bg-void/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur ${isRunning ? "text-online" : "text-warn"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-online pulse-dot" : "bg-warn"}`} />
            {isRunning ? "Online" : "Offline"}
          </span>
        </div>
        <h2 className="relative z-10 truncate text-lg font-extrabold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">{s.name}</h2>
        <span className="absolute bottom-3 right-3 z-10 rounded-full border border-white/15 bg-void/50 px-2 py-0.5 text-[10px] font-bold text-purple-200 backdrop-blur">
          {typeLabel(s.serverType)} · {s.version}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col p-4">
        <p className="mb-3.5 truncate text-xs text-muted">{isRunning && motd ? motd : "—"}</p>

        <div className="mb-3.5 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1.5 flex justify-between text-[11px]">
              <b className={cpu >= 80 ? "text-danger" : cpu >= 50 ? "text-warn" : "text-online"}>{isRunning ? `${cpu.toFixed(0)}%` : "—"}</b>
              <span className="text-muted">CPU</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-edge">
              <div className={`h-full rounded-full ${cpu >= 80 ? "bg-danger" : cpu >= 50 ? "bg-warn" : "bg-online"}`} style={{ width: `${cpu}%` }} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-[11px]">
              <b className={memPct >= 90 ? "text-danger" : memPct >= 75 ? "text-warn" : "text-white"}>{isRunning && liveMem ? formatBytes(liveMem) : formatRam(s.ram)}</b>
              <span className="text-muted">RAM</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-edge">
              <div className={`h-full rounded-full ${memPct >= 90 ? "bg-danger" : memPct >= 75 ? "bg-warn" : "bg-accent"}`} style={{ width: `${memPct}%` }} />
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{isRunning ? `${playerCount?.online ?? 0}/${playerCount?.max ?? 20}` : "—"}</span>
          {isRunning && uptime && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{uptime}</span>}
          <span className="font-mono">:{s.port}</span>
        </div>

        {/* ── Power buttons ── */}
        <div className="relative z-20 mt-auto flex gap-2">
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(); }}
            className="flex-1 rounded-xl bg-accent py-2.5 text-[13px] font-bold text-white transition hover:bg-accent-strong">
            ▸ Open
          </button>
          {isRunning ? (
            <>
              {restartConfirm ? (
                <div className="flex items-center gap-1 rounded-xl border border-warn/30 bg-warn/10 px-2">
                  <span className="text-[10px] font-medium text-warn">Restart?</span>
                  <button onClick={(e) => { e.stopPropagation(); onRestart(); }} disabled={acting} className="rounded bg-warn px-1.5 py-0.5 text-[10px] font-bold text-black disabled:opacity-50">Yes</button>
                  <button onClick={(e) => { e.stopPropagation(); onCancelConfirm(); }} className="rounded bg-edge px-1.5 py-0.5 text-[10px] text-slate-300">No</button>
                </div>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); onRestartConfirm(); }} title="Restart" aria-label="Restart"
                  className="rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[13px] font-bold text-warn transition hover:bg-warn/20">↻</button>
              )}
              {stopConfirm ? (
                <div className="flex items-center gap-1 rounded-xl border border-danger/30 bg-danger/10 px-2">
                  <span className="text-[10px] font-medium text-danger">Stop?</span>
                  <button onClick={(e) => { e.stopPropagation(); onStop(); }} disabled={acting} className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50">Yes</button>
                  <button onClick={(e) => { e.stopPropagation(); onCancelConfirm(); }} className="rounded bg-edge px-1.5 py-0.5 text-[10px] text-slate-300">No</button>
                </div>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); onStopConfirm(); }} title="Stop" aria-label="Stop"
                  className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] font-bold text-danger transition hover:bg-danger/20">■</button>
              )}
            </>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onStart(); }} disabled={acting}
              className="flex-1 rounded-xl border border-online/30 bg-online/10 py-2.5 text-[13px] font-bold text-online transition hover:bg-online/20 disabled:opacity-50">
              ▶ Start
            </button>
          )}
        </div>
      </div>

      <Link href={`/servers/${s.id}`} className="absolute inset-0 z-10" />
    </div>
  );
}
