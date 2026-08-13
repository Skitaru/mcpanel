"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Activity, Cpu, MemoryStick, Gauge } from "lucide-react";
import { formatBytes } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const POLL_MS = 5_000;

interface HistorySample {
  t: number;
  cpu: number | null;
  mem: number | null;
  memLimit: number | null;
  tps: number | null;
}

interface Props {
  serverId: string;
  ram: number; // MB (for the RAM scale when no memLimit sample exists yet)
}

/** Tiny dependency-free area chart (SVG, scales to container width). */
function SparkArea({
  values, color, height = 110, max,
}: { values: (number | null)[]; color: string; height?: number; max: number }) {
  const id = useId();
  const nums = values.map((v) => (v == null ? 0 : Math.min(v, max)));
  if (nums.length < 2) return null;
  const W = 600;
  const H = height;
  const step = W / (nums.length - 1);
  const pts = nums.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`);
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

export default function StatusTab({ serverId, ram }: Props) {
  const [samples, setSamples] = useState<HistorySample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const lastRef = useRef<{ cpu: number; mem: number; tps: number }>({ cpu: 0, mem: 0, tps: 0 });

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/history`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const s: HistorySample[] = data.samples ?? [];
      setSamples(s);
      setError(null);
      if (s.length > 0) {
        const last = s[s.length - 1];
        lastRef.current = {
          cpu: last.cpu ?? 0,
          mem: last.mem ?? 0,
          tps: last.tps ?? 0,
        };
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { fetchHistory(); const i = setInterval(fetchHistory, POLL_MS); return () => clearInterval(i); }, [fetchHistory]);

  // "Live" = a sample arrived within the last 15 s.
  useEffect(() => {
    const iv = setInterval(() => {
      const last = samples[samples.length - 1];
      setConnected(!!last && Date.now() - last.t < 15_000);
    }, 3000);
    return () => clearInterval(iv);
  }, [samples]);

  const cpuVals = samples.map((s) => s.cpu);
  const memVals = samples.map((s) => s.mem);
  const tpsVals = samples.map((s) => s.tps);

  const memLimit = samples.length > 0
    ? (samples[samples.length - 1].memLimit ?? ram * 1024 * 1024)
    : ram * 1024 * 1024;
  const memPct = memLimit > 0 ? Math.min(100, (lastRef.current.mem / memLimit) * 100) : 0;

  const tpsColor = lastRef.current.tps >= 19 ? "var(--color-online)" : lastRef.current.tps >= 15 ? "var(--color-warn)" : "var(--color-danger)";

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
        <Activity className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="text-xs text-slate-500">Ressourcen-Verlauf · letzte 30 Min</span>
        <div className="flex-1" />
        {loading && samples.length === 0 ? (
          <span className="text-[10px] text-slate-600">lädt…</span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-online">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-online" />live
          </span>
        ) : (
          <span className="text-[10px] text-muted">keine Live-Daten</span>
        )}
      </div>

      {/* Graph cards */}
      {error && samples.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-edge bg-surface py-16">
          <Activity className="h-7 w-7 text-muted" />
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      ) : samples.length < 2 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-edge bg-surface py-16 text-center">
          <Gauge className="h-7 w-7 text-muted" />
          <p className="text-sm text-slate-500">Noch keine Verlaufsdaten</p>
          <p className="max-w-sm text-xs leading-relaxed text-slate-600">
            Die Aufzeichnung startet automatisch, sobald Live-Daten fließen
            (Console oder Dashboard geöffnet). Nach ~30 Sekunden erscheinen die ersten Kurven.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {/* CPU */}
          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                <Cpu className="h-3.5 w-3.5" /> CPU
              </span>
              <span className="text-lg font-extrabold tabular-nums text-white">
                {lastRef.current.cpu.toFixed(1)}%
              </span>
            </div>
            <SparkArea values={cpuVals} color="var(--color-online)" max={100} />
          </div>

          {/* RAM */}
          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                <MemoryStick className="h-3.5 w-3.5" /> RAM
              </span>
              <span className="text-right">
                <span className="block text-lg font-extrabold tabular-nums text-white">{formatBytes(lastRef.current.mem)}</span>
                <span className="block text-[10px] text-muted">von {formatBytes(memLimit)} · {memPct.toFixed(0)}%</span>
              </span>
            </div>
            <SparkArea values={memVals} color="var(--color-accent)" max={memLimit} />
          </div>

          {/* TPS */}
          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                <Gauge className="h-3.5 w-3.5" /> TPS
              </span>
              <span className="text-lg font-extrabold tabular-nums" style={{ color: lastRef.current.tps > 0 ? tpsColor : "var(--color-muted)" }}>
                {lastRef.current.tps > 0 ? lastRef.current.tps.toFixed(1) : "—"}
              </span>
            </div>
            <SparkArea values={tpsVals} color={tpsColor} max={20} />
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-muted">
        Ein Sample alle ~5 s · 30-Minuten-Ringpuffer (360 Samples) · zurücksetzen beim Server-Delete
      </p>
    </div>
  );
}
