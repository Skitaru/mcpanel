"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Activity, Cpu, MemoryStick, HardDrive, Gauge, Users } from "lucide-react";
import { formatBytes } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const RES_POLL_MS = 5_000;
const SLOW_POLL_MS = 60_000;

const RES_WINDOWS = ["5m", "15m", "30m", "4h", "12h", "24h"] as const;
const PLAYER_WINDOWS = ["30m", "4h", "12h", "24h", "48h", "7d", "14d", "30d"] as const;
type ResWindow = typeof RES_WINDOWS[number];
type PlayerWindow = typeof PLAYER_WINDOWS[number];

interface HistorySample {
  t: number;
  cpu: number | null;
  mem: number | null;
  memLimit: number | null;
  tps: number | null;
  disk: number | null;
}

interface PlayerSample { t: number; online: number; }

interface Props {
  serverId: string;
  ram: number; // MB (RAM scale when no memLimit sample exists yet)
}

/** Replace nulls with the last known value (flat line between sparse polls). */
function hold(values: (number | null)[]): number[] {
  let last = 0;
  return values.map((v) => {
    if (v != null) last = v;
    return last;
  });
}

/** Tiny dependency-free area chart (SVG, scales to container width). */
function SparkArea({
  values, color, height = 110, max,
}: { values: number[]; color: string; height?: number; max: number }) {
  const id = useId();
  const nums = values.map((v) => Math.max(0, Math.min(v, max)));
  if (nums.length < 2) return null;
  const W = 600;
  const H = height;
  const step = W / (nums.length - 1);
  const pts = nums.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / (max || 1)) * H).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: `${H}px` }} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={`url(#${id})`} />
      <polyline
        points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

function WindowChips<T extends string>({ windows, value, onChange }: { windows: readonly T[]; value: T; onChange: (w: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {windows.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
            value === w
              ? "border-accent bg-accent/15 text-purple-200"
              : "border-edge bg-void text-muted hover:border-accent/40 hover:text-slate-300"
          }`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-void px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: color ?? "var(--color-ink)" }}>{value}</div>
    </div>
  );
}

export default function StatusTab({ serverId, ram }: Props) {
  const [resWindow, setResWindow] = useState<ResWindow>("30m");
  const [resData, setResData] = useState<{ samples: HistorySample[]; peak: { cpu: number; mem: number; disk: number } }>({ samples: [], peak: { cpu: 0, mem: 0, disk: 0 } });
  const [diskNow, setDiskNow] = useState<number | null>(null);

  const [playerWindow, setPlayerWindow] = useState<PlayerWindow>("24h");
  const [playerData, setPlayerData] = useState<{ samples: PlayerSample[]; peak: number; avgPlayers: number; playerHours: number }>({ samples: [], peak: 0, avgPlayers: 0, playerHours: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const lastResRef = useRef({ cpu: 0, mem: 0, tps: 0 });

  // ---- resource history (5 s) ----
  const fetchRes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/history?window=${resWindow}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResData({ samples: data.samples ?? [], peak: data.peak ?? { cpu: 0, mem: 0, disk: 0 } });
      setError(null);
      const last = (data.samples ?? [])[(data.samples ?? []).length - 1];
      if (last) lastResRef.current = { cpu: last.cpu ?? 0, mem: last.mem ?? 0, tps: last.tps ?? 0 };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load history.");
    } finally { setLoading(false); }
  }, [serverId, resWindow]);

  // ---- disk now (60 s) — also feeds the backend disk history ----
  const fetchDisk = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/disk`);
      if (res.ok) { const d = await res.json(); if (d.bytes >= 0) setDiskNow(d.bytes); }
    } catch { /* keep last */ }
  }, [serverId]);

  // ---- player history (60 s) ----
  const fetchPlayers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/player-history?window=${playerWindow}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlayerData({ samples: data.samples ?? [], peak: data.peak ?? 0, avgPlayers: data.avgPlayers ?? 0, playerHours: data.playerHours ?? 0 });
    } catch { /* keep last */ }
  }, [serverId, playerWindow]);

  useEffect(() => {
    fetchRes(); const i = setInterval(fetchRes, RES_POLL_MS); return () => clearInterval(i);
  }, [fetchRes]);

  useEffect(() => {
    fetchDisk(); const i = setInterval(fetchDisk, SLOW_POLL_MS); return () => clearInterval(i);
  }, [fetchDisk]);

  useEffect(() => {
    fetchPlayers(); const i = setInterval(fetchPlayers, SLOW_POLL_MS); return () => clearInterval(i);
  }, [fetchPlayers]);

  // "Live" = a sample arrived within the last 15 s.
  useEffect(() => {
    const iv = setInterval(() => {
      const last = resData.samples[resData.samples.length - 1];
      setConnected(!!last && Date.now() - last.t < 15_000);
    }, 3000);
    return () => clearInterval(iv);
  }, [resData.samples]);

  const cpuVals = hold(resData.samples.map((s) => s.cpu));
  const memVals = hold(resData.samples.map((s) => s.mem));
  const diskVals = hold(resData.samples.map((s) => s.disk));
  const tpsVals = hold(resData.samples.map((s) => s.tps));

  const memLimit = resData.samples.length > 0
    ? (resData.samples[resData.samples.length - 1].memLimit ?? ram * 1024 * 1024)
    : ram * 1024 * 1024;

  const currentDisk = diskNow ?? (resData.samples.length ? (resData.samples[resData.samples.length - 1].disk ?? 0) : 0);
  const diskMax = Math.max(resData.peak.disk, currentDisk, 1);
  const memMax = Math.max(memLimit, 1);
  const playerMax = Math.max(playerData.peak, 1);

  const tpsColor = lastResRef.current.tps >= 19 ? "var(--color-online)" : lastResRef.current.tps >= 15 ? "var(--color-warn)" : "var(--color-danger)";

  const resHasData = resData.samples.length >= 2;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
        <Activity className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="text-xs text-slate-500">Status · Verlauf + Spielerstatistik</span>
        <div className="flex-1" />
        {loading && !resHasData ? (
          <span className="text-[10px] text-slate-600">lädt…</span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-online">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-online" />live
          </span>
        ) : (
          <span className="text-[10px] text-muted">keine Live-Daten</span>
        )}
      </div>

      {error && !resHasData ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-edge bg-surface py-16">
          <Activity className="h-7 w-7 text-muted" />
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      ) : (
        <>
          {/* ── Ressourcen ── */}
          <div className="rounded-xl border border-edge bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                <Cpu className="h-3.5 w-3.5" /> Ressourcen
              </span>
              <WindowChips windows={RES_WINDOWS} value={resWindow} onChange={setResWindow} />
            </div>
            <div className="p-4">
              {!resHasData ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <Gauge className="h-7 w-7 text-muted" />
                  <p className="text-sm text-slate-500">Noch keine Verlaufsdaten</p>
                  <p className="max-w-sm text-xs leading-relaxed text-slate-600">
                    Die Aufzeichnung startet automatisch, sobald Live-Daten fließen.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* CPU */}
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">CPU</span>
                      <span className="text-lg font-extrabold tabular-nums text-white">{lastResRef.current.cpu.toFixed(1)}%</span>
                    </div>
                    <SparkArea values={cpuVals} color="var(--color-online)" max={100} />
                    <div className="mt-1 text-right text-[10px] text-muted">Peak <b className="text-slate-300">{resData.peak.cpu.toFixed(1)}%</b></div>
                  </div>

                  {/* RAM */}
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">RAM</span>
                      <span className="text-right">
                        <span className="block text-lg font-extrabold tabular-nums text-white">{formatBytes(lastResRef.current.mem)}</span>
                        <span className="block text-[9px] text-muted">von {formatBytes(memLimit)}</span>
                      </span>
                    </div>
                    <SparkArea values={memVals} color="var(--color-accent)" max={memMax} />
                    <div className="mt-1 text-right text-[10px] text-muted">Peak <b className="text-slate-300">{formatBytes(resData.peak.mem)}</b></div>
                  </div>

                  {/* Disk */}
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Disk</span>
                      <span className="text-lg font-extrabold tabular-nums text-white">{formatBytes(currentDisk)}</span>
                    </div>
                    <SparkArea values={diskVals} color="var(--color-warn)" max={diskMax} />
                    <div className="mt-1 text-right text-[10px] text-muted">Peak <b className="text-slate-300">{formatBytes(resData.peak.disk)}</b></div>
                  </div>

                  {/* TPS */}
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">TPS</span>
                      <span className="text-lg font-extrabold tabular-nums" style={{ color: lastResRef.current.tps > 0 ? tpsColor : "var(--color-muted)" }}>
                        {lastResRef.current.tps > 0 ? lastResRef.current.tps.toFixed(1) : "—"}
                      </span>
                    </div>
                    <SparkArea values={tpsVals} color={tpsColor} max={20} />
                    <div className="mt-1 text-right text-[10px] text-muted">Peak <b className="text-slate-300">{Math.max(...tpsVals).toFixed(1)}</b></div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Player Count History ── */}
          <div className="rounded-xl border border-edge bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                <Users className="h-3.5 w-3.5" /> Player Count History
              </span>
              <WindowChips windows={PLAYER_WINDOWS} value={playerWindow} onChange={setPlayerWindow} />
            </div>
            <div className="p-4">
              {playerData.samples.length < 2 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <Users className="h-7 w-7 text-muted" />
                  <p className="text-sm text-slate-500">Noch keine Spieler-Daten</p>
                  <p className="max-w-sm text-xs leading-relaxed text-slate-600">
                    Die Spieler-Historie wird aufgezeichnet, solange der Server über das Panel beobachtet wird.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
                    <Stat label="Peak" value={`${playerData.peak}`} color="var(--color-online)" />
                    <Stat label="Avg Players" value={playerData.avgPlayers.toFixed(1)} />
                    <Stat label="Player-Hours" value={`${playerData.playerHours.toFixed(1)} h`} color="var(--color-accent)" />
                  </div>
                  <SparkArea values={playerData.samples.map((s) => s.online)} color="var(--color-accent)" max={playerMax} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      <p className="text-center text-[10px] text-muted">
        Ressourcen: 5s-Samples · 24h-Puffer · Spieler: 60s-Samples · 30d-Puffer (RAM, verfällt bei Backend-Neustart)
      </p>
    </div>
  );
}
