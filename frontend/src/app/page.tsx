"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, AlertTriangle, Plus, Play, Square, RotateCw, Cpu, MemoryStick, Users, HardDrive, Search, Menu, Server, Wifi, Zap, CheckCircle, XCircle } from "lucide-react";
import { io, Socket } from "socket.io-client";
import CreateServerDialog from "@/components/CreateServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
import ServerSidebar from "@/components/ServerSidebar";
import { CardSkeleton } from "@/components/Skeleton";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const POLL_INTERVAL_MS = 5_000;

function statusColor(status: ServerStatus["status"]) {
  switch (status) { case "running": return "bg-emerald-500"; case "exited": case "created": case "paused": return "bg-amber-500"; default: return "bg-slate-600"; }
}
function statusLabel(status: ServerStatus["status"]) {
  switch (status) { case "running": return "Online"; case "exited": return "Stopped"; case "created": return "Created"; case "paused": return "Paused"; default: return "Unknown"; }
}
function statusBadgeColor(status: ServerStatus["status"]) {
  switch (status) { case "running": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"; case "exited": case "created": case "paused": return "bg-amber-500/10 text-amber-400 border-amber-500/20"; default: return "bg-slate-500/10 text-slate-400 border-slate-500/20"; }
}
function statusAccent(status: ServerStatus["status"]) {
  switch (status) { case "running": return "via-emerald-500/50"; case "exited": case "created": case "paused": return "via-amber-500/50"; default: return "via-slate-500/30"; }
}
function formatRam(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`; }
function typeLabel(t: string) { switch (t) { case "fabric": return "Fabric"; case "velocity": return "Velocity"; default: return "Paper"; } }
function typeBadgeColor(t: string) { switch (t) { case "fabric": return "bg-amber-500/10 text-amber-400 border-amber-500/20"; case "velocity": return "bg-purple-500/10 text-purple-400 border-purple-500/20"; default: return "bg-violet-500/10 text-violet-400 border-violet-500/20"; } }
function formatDisk(bytes: number | undefined) {
  if (bytes == null || bytes < 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

export default function DashboardPage() {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [modpackDialogOpen, setModpackDialogOpen] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [stopConfirmId, setStopConfirmId] = useState<string | null>(null);
  const [restartConfirmId, setRestartConfirmId] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<Record<string, { cpu: number; mem: number; memLimit: number }>>({});
  const [playerCounts, setPlayerCounts] = useState<Record<string, { online: number; max: number; players: { name: string; id: string }[] }>>({});
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const socketRef = useRef<Socket | null>(null);

  const filteredServers = servers.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ---- Derived stats ----
  const stats = {
    total: servers.length,
    running: servers.filter(s => s.status === "running").length,
    stopped: servers.filter(s => s.status === "exited" || s.status === "created").length,
    error: servers.filter(s => s.status !== "running" && s.status !== "exited" && s.status !== "created" && s.status !== "paused").length,
    totalRam: servers.reduce((a, s) => a + (s.ram || 0), 0),
    usedRam: servers.filter(s => s.status === "running").reduce((a, s) => a + (liveStats[s.id]?.mem || 0), 0),
    totalPlayers: servers.filter(s => s.status === "running").reduce((a, s) => a + (playerCounts[s.id]?.online || 0), 0),
    totalMaxPlayers: servers.reduce((a, s) => a + (playerCounts[s.id]?.max || 0), 0),
    totalDisk: servers.reduce((a, s) => a + (diskUsage[s.id] || 0), 0),
    avgCpu: (() => {
      const runningServers = servers.filter(s => s.status === "running" && liveStats[s.id]?.cpu != null);
      if (runningServers.length === 0) return 0;
      return runningServers.reduce((a, s) => a + Math.min(100, liveStats[s.id].cpu), 0) / runningServers.length;
    })(),
  };

  // ---- Socket.IO ----
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("mcpanel-token") : null;
    const socket = io(API_BASE, { transports: ["polling"], auth: { token } });
    socketRef.current = socket;
    socket.on("connect", () => { servers.forEach(s => { if (s.status === "running") socket.emit("stats:subscribe", { serverId: s.id }); }); });
    socket.on("stats:data", (p: { serverId: string; cpuPercent: number; memoryUsage: number; memoryLimit: number }) => {
      if (p.cpuPercent == null) return;
      setLiveStats(prev => ({ ...prev, [p.serverId]: { cpu: p.cpuPercent, mem: p.memoryUsage, memLimit: p.memoryLimit } }));
    });
    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    servers.forEach(s => { if (s.status === "running") socket.emit("stats:subscribe", { serverId: s.id }); else socket.emit("stats:unsubscribe", { serverId: s.id }); });
  }, [servers]);

  // ---- Players poll ----
  useEffect(() => {
    const poll = async () => {
      for (const s of servers.filter(s => s.status === "running")) {
        try {
          const res = await fetch(`${API_BASE}/api/servers/${s.id}/players`);
          if (res.ok) { const d = await res.json(); if (!d.unreachable) setPlayerCounts(prev => ({ ...prev, [s.id]: { online: d.online, max: d.max, players: d.players ?? [] } })); }
        } catch {}
      }
    };
    poll(); const i = setInterval(poll, 15_000); return () => clearInterval(i);
  }, [servers]);

  // ---- Disk poll ----
  useEffect(() => {
    const pollDisk = async () => {
      for (const s of servers) {
        try {
          const res = await fetch(`${API_BASE}/api/servers/${s.id}/disk`);
          if (res.ok) { const d = await res.json(); if (d.bytes >= 0) setDiskUsage(prev => ({ ...prev, [s.id]: d.bytes })); }
        } catch {}
      }
    };
    if (servers.length > 0) pollDisk();
    const i = setInterval(pollDisk, 60_000); return () => clearInterval(i);
  }, [servers]);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setServers(await res.json()); setError(null);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to reach backend."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchServers(); const i = setInterval(fetchServers, POLL_INTERVAL_MS); return () => clearInterval(i); }, [fetchServers]);

  const handleServerAction = useCallback(async (id: string, action: "start" | "stop" | "restart") => {
    setStopConfirmId(null); setRestartConfirmId(null); setActingId(id);
    try { await fetch(`${API_BASE}/api/servers/${id}/${action}`, { method: "POST" }); await fetchServers(); }
    catch (err) { console.error(`[panel] ${action} failed:`, err); }
    finally { setActingId(null); }
  }, [fetchServers]);

  // ==============================================================
  // Render
  // ==============================================================

  const STAGGER = ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6", "stagger-7", "stagger-8", "stagger-9", "stagger-10", "stagger-11", "stagger-12"];

  return (
    <div className="flex min-h-screen">
      <ServerSidebar servers={servers} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCreateClick={() => setDialogOpen(true)} onInstallModpack={() => setModpackDialogOpen(true)} />
      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-13" : "lg:ml-52"}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error}</p>
              <button onClick={() => { setLoading(true); setError(null); fetchServers(); }} className="rounded-lg bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.06]">Retry</button>
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <header className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => setSidebarCollapsed(false)} className="lg:hidden rounded-md p-1.5 -ml-1 text-slate-400 hover:text-white hover:bg-white/[0.04] transition" title="Open menu">
                    <Menu className="h-5 w-5" />
                  </button>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/10 shadow-lg">
                    <Server className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-white">Dashboard</h1>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {servers.length} server{servers.length !== 1 ? "s" : ""}
                      {searchQuery ? ` · ${filteredServers.length} match${filteredServers.length !== 1 ? "es" : ""}` : ""}
                      {stats.running > 0 && ` · ${stats.running} running`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600 pointer-events-none" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter servers…"
                      className="w-36 sm:w-48 rounded-lg border border-[#1a1f2e] bg-[#0a0c10] pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
                  </div>
                  <button onClick={fetchServers} className="rounded-lg border border-[#1a1f2e] p-2 text-slate-600 transition hover:border-[#252b3b] hover:text-slate-400" title="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDialogOpen(true)} className="hover-scale flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 shadow-lg">
                    <Plus className="h-4 w-4" /> New Server
                  </button>
                </div>
              </header>

              {/* ── Stats Bar ── */}
              {servers.length > 0 && (
                <div className="mb-6 space-y-4">
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="surface flex items-center gap-3 p-4 animate-slide-up stagger-1">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
                        <Server className="h-4 w-4 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Total</p>
                        <p className="text-lg font-bold text-white">{stats.total}</p>
                      </div>
                    </div>
                    <div className="surface flex items-center gap-3 p-4 animate-slide-up stagger-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Running</p>
                        <p className="text-lg font-bold text-emerald-400">{stats.running}</p>
                      </div>
                    </div>
                    <div className="surface flex items-center gap-3 p-4 animate-slide-up stagger-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-500/10">
                        <XCircle className="h-4 w-4 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Stopped</p>
                        <p className="text-lg font-bold text-slate-400">{stats.stopped}</p>
                      </div>
                    </div>
                    <div className="surface flex items-center gap-3 p-4 animate-slide-up stagger-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Issues</p>
                        <p className="text-lg font-bold text-red-400">{stats.error}</p>
                      </div>
                    </div>
                  </div>

                  {/* Quick stats row */}
                  {stats.running > 0 && (
                    <div className="surface flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 animate-slide-up stagger-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Cpu className="h-3.5 w-3.5" />
                        <span>CPU</span>
                        <span className="font-mono font-medium text-white tabular-nums">{stats.avgCpu.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <MemoryStick className="h-3.5 w-3.5" />
                        <span>RAM</span>
                        <span className="font-mono font-medium text-white tabular-nums">
                          {stats.usedRam >= 1e9 ? `${(stats.usedRam / 1e9).toFixed(1)}G` : `${(stats.usedRam / 1e6).toFixed(0)}M`}
                        </span>
                        <span className="text-slate-700">/ {stats.totalRam >= 1024 ? `${(stats.totalRam / 1024).toFixed(1)} GB` : `${stats.totalRam} MB`}</span>
                      </div>
                      {stats.totalMaxPlayers > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Users className="h-3.5 w-3.5" />
                          <span>Players</span>
                          <span className="font-mono font-medium text-white tabular-nums">{stats.totalPlayers}</span>
                          <span className="text-slate-700">/ {stats.totalMaxPlayers}</span>
                        </div>
                      )}
                      {stats.totalDisk > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <HardDrive className="h-3.5 w-3.5" />
                          <span>Disk</span>
                          <span className="font-mono font-medium text-white tabular-nums">{formatDisk(stats.totalDisk)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Server Cards ── */}
              {servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1a1f2e] py-20">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/10">
                    <Server className="h-7 w-7 text-violet-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 mb-1">No servers yet</p>
                  <p className="text-xs text-slate-700 mb-4">Create your first Minecraft server to get started</p>
                  <button onClick={() => setDialogOpen(true)} className="hover-scale flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500">
                    <Plus className="h-4 w-4" /> Create Server
                  </button>
                </div>
              ) : filteredServers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1a1f2e] py-20">
                  <Search className="h-8 w-8 text-slate-700 mb-3" />
                  <p className="text-sm font-medium text-slate-500">No servers match &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredServers.map((s, i) => (
                    <div key={s.id}
                      className={`group surface surface-hover animate-slide-up relative p-0 flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${STAGGER[i] || ""}`}>

                      {/* Status accent line */}
                      <div className={`card-accent bg-gradient-to-r from-transparent ${statusAccent(s.status)} to-transparent`} />

                      {/* Card body */}
                      <div className="p-4 flex flex-col flex-1">
                        {/* Top row: dot + name + type badge + actions */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-violet-500/10">
                              <Server className="h-4 w-4 text-violet-400" />
                            </div>
                            <div className="min-w-0">
                              <h2 className="truncate text-sm font-semibold text-white group-hover:text-violet-400 transition">{s.name}</h2>
                            </div>
                          </div>
                          {/* Action button group */}
                          <div className="btn-group shrink-0" onClick={e => e.preventDefault()}>
                            {s.status === "running" ? (
                              <>
                                {stopConfirmId === s.id ? (
                                  <div className="flex items-center gap-1 px-2 py-1">
                                    <span className="text-[10px] text-amber-400">Stop?</span>
                                    <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "stop"); }} disabled={actingId === s.id} className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-amber-500 disabled:opacity-50">Yes</button>
                                    <button onClick={e => { e.stopPropagation(); setStopConfirmId(null); }} className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-500">No</button>
                                  </div>
                                ) : (
                                  <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setStopConfirmId(s.id); }}
                                    className="flex h-7 w-7 items-center justify-center text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50" title="Stop">
                                    <Square className="h-3 w-3" />
                                  </button>
                                )}
                                {restartConfirmId === s.id ? (
                                  <div className="flex items-center gap-1 px-2 py-1">
                                    <span className="text-[10px] text-amber-400">Restart?</span>
                                    <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "restart"); }} disabled={actingId === s.id} className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-amber-500 disabled:opacity-50">Yes</button>
                                    <button onClick={e => { e.stopPropagation(); setRestartConfirmId(null); }} className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-500">No</button>
                                  </div>
                                ) : (
                                  <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setRestartConfirmId(s.id); }}
                                    className="flex h-7 w-7 items-center justify-center text-slate-500 transition hover:bg-white/[0.04] hover:text-amber-400 disabled:opacity-50" title="Restart">
                                    <RotateCw className="h-3 w-3" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); handleServerAction(s.id, "start"); }}
                                className="flex h-7 w-7 items-center justify-center text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50" title="Start">
                                <Play className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Status badge row */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusColor(s.status)} ${s.status === "running" ? "pulse-dot" : ""}`} />
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusBadgeColor(s.status)}`}>
                            {statusLabel(s.status)}
                          </span>
                          <span className="text-[11px] text-slate-600">{s.version}</span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadgeColor(s.serverType)}`}>
                            {typeLabel(s.serverType)}
                          </span>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 mt-auto">
                          <div className="flex items-center gap-1.5 rounded-md bg-white/[0.02] px-2.5 py-2">
                            <Wifi className="h-3 w-3 shrink-0 text-slate-600" />
                            <div className="min-w-0">
                              <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-700">Port</p>
                              <p className="text-xs font-mono font-medium text-white">:{s.port}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 rounded-md bg-white/[0.02] px-2.5 py-2">
                            <MemoryStick className="h-3 w-3 shrink-0 text-slate-600" />
                            <div className="min-w-0">
                              <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-700">RAM</p>
                              <p className="text-xs font-medium text-white">{formatRam(s.ram)}</p>
                            </div>
                          </div>
                          {s.status === "running" && (
                            <>
                              <div className="flex items-center gap-1.5 rounded-md bg-white/[0.02] px-2.5 py-2">
                                <Users className="h-3 w-3 shrink-0 text-emerald-400" />
                                <div className="min-w-0">
                                  <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-700">Players</p>
                                  <p className="text-xs font-medium text-white">
                                    {playerCounts[s.id]?.online ?? 0}
                                    <span className="font-normal text-slate-600">/{playerCounts[s.id]?.max ?? s.port ? 20 : 0}</span>
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 rounded-md bg-white/[0.02] px-2.5 py-2">
                                <Zap className={`h-3 w-3 shrink-0 ${(liveStats[s.id]?.cpu ? Math.min(100, liveStats[s.id].cpu) : 0) >= 80 ? "text-red-400" : (liveStats[s.id]?.cpu ? Math.min(100, liveStats[s.id].cpu) : 0) >= 50 ? "text-amber-400" : "text-emerald-400"}`} />
                                <div className="min-w-0">
                                  <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-700">CPU</p>
                                  <p className="text-xs font-mono font-medium text-white tabular-nums">{(liveStats[s.id]?.cpu ? Math.min(100, liveStats[s.id].cpu) : 0).toFixed(1)}%</p>
                                </div>
                              </div>
                            </>
                          )}
                          {s.status !== "running" && diskUsage[s.id] != null && diskUsage[s.id] >= 0 && (
                            <div className="flex items-center gap-1.5 rounded-md bg-white/[0.02] px-2.5 py-2">
                              <HardDrive className="h-3 w-3 shrink-0 text-slate-600" />
                              <div className="min-w-0">
                                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-700">Disk</p>
                                <p className="text-xs font-medium text-white">{formatDisk(diskUsage[s.id])}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Click overlay */}
                      <Link href={`/servers/${s.id}`} className="absolute inset-0 z-10" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <CreateServerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={() => fetchServers()} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={() => fetchServers()} />
    </div>
  );
}
