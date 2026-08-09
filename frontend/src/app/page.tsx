"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, AlertTriangle, Plus, Play, Square, RotateCw, Cpu, MemoryStick, Users, HardDrive, Search, Menu, Server, Activity, CheckCircle, XCircle, Clock } from "lucide-react";
import { io, Socket } from "socket.io-client";
import CreateServerDialog from "@/components/CreateServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
import ServerSidebar from "@/components/ServerSidebar";
import { CardSkeleton } from "@/components/Skeleton";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const POLL_INTERVAL_MS = 5_000;

function statusColor(status: ServerStatus["status"]) {
  switch (status) { case "running": return "bg-emerald-500"; case "exited": case "created": case "paused": return "bg-amber-500"; default: return "bg-[#28223D]"; }
}
function statusLabel(status: ServerStatus["status"]) {
  switch (status) { case "running": return "Online"; case "exited": return "Stopped"; case "created": return "Created"; case "paused": return "Paused"; default: return "Unknown"; }
}
function statusBadgeColor(status: ServerStatus["status"]) {
  switch (status) { case "running": return "bg-[#00F5D4]/10 text-emerald-400 border-[#00F5D4]/20"; case "exited": case "created": case "paused": return "bg-[#FEE440]/10 text-amber-400 border-[#FEE440]/20"; default: return "bg-slate-500/10 text-slate-400 border-slate-500/20"; }
}
function formatRam(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`; }
function typeLabel(t: string) { switch (t) { case "fabric": return "Fabric"; case "velocity": return "Velocity"; default: return "Paper"; } }
function typeBadgeColor(t: string) { switch (t) { case "fabric": return "bg-[#FEE440]/10 text-amber-400 border-[#FEE440]/20"; case "velocity": return "bg-[#9D4EDD]/10 text-purple-400 border-[#28223D]"; default: return "bg-[#9D4EDD]/10 text-violet-400 border-violet-500/20"; } }
function formatDisk(bytes: number | undefined) {
  if (bytes == null || bytes < 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}
function formatUptime(startedAt: string | null | undefined) {
  if (!startedAt) return null;
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
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
  const [serverIcons, setServerIcons] = useState<Record<string, string>>({});
  const [serverMotds, setServerMotds] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const serversRef = useRef(servers);
  serversRef.current = servers;

  const filteredServers = servers.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    const token = typeof window !== "undefined" ? localStorage.getItem("obsidian-token") : null;
    const socket = io(API_BASE, { transports: ["polling"], auth: { token } });
    socketRef.current = socket;
    socket.on("connect", () => { serversRef.current.forEach(s => { if (s.status === "running") socket.emit("stats:subscribe", { serverId: s.id }); }); });
    socket.on("stats:data", (p: { serverId: string; cpuPercent: number; memoryUsage: number; memoryLimit: number }) => {
      if (p.cpuPercent == null) return;
      setLiveStats(prev => ({ ...prev, [p.serverId]: { cpu: p.cpuPercent, mem: p.memoryUsage, memLimit: p.memoryLimit } }));
    });
    socket.on("stats:error", (p: { serverId: string; message: string }) => { console.warn(`[dashboard] Stats error for ${p.serverId}: ${p.message}`); });
    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    servers.forEach(s => { if (s.status === "running") socket.emit("stats:subscribe", { serverId: s.id }); else socket.emit("stats:unsubscribe", { serverId: s.id }); });
  }, [servers]);

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

  useEffect(() => {
    const pollDisk = async () => {
      for (const s of servers) {
        try { const res = await fetch(`${API_BASE}/api/servers/${s.id}/disk`); if (res.ok) { const d = await res.json(); if (d.bytes >= 0) setDiskUsage(prev => ({ ...prev, [s.id]: d.bytes })); } } catch {}
      }
    };
    if (servers.length > 0) pollDisk();
    const i = setInterval(pollDisk, 60_000); return () => clearInterval(i);
  }, [servers]);

  const fetchedMetaRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of servers) {
      if (fetchedMetaRef.current.has(s.id)) continue;
      fetchedMetaRef.current.add(s.id);
      fetch(`${API_BASE}/api/servers/${s.id}/file?path=${encodeURIComponent("/server-icon.png")}&raw=true`)
        .then(async r => { if (r.ok && r.status !== 204) return r.blob(); return null; })
        .then(blob => { if (blob) setServerIcons(prev => ({ ...prev, [s.id]: URL.createObjectURL(blob) })); })
        .catch(() => {});
      fetch(`${API_BASE}/api/servers/${s.id}/properties`)
        .then(async r => { if (r.ok) return r.json(); return null; })
        .then(data => { if (data?.motd) setServerMotds(prev => ({ ...prev, [s.id]: data.motd })); })
        .catch(() => {});
    }
  }, [servers]);

  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 30_000); return () => clearInterval(i); }, []);
  useEffect(() => { return () => { Object.values(serverIcons).forEach(url => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchServers = useCallback(async () => {
    try { const res = await fetch(`${API_BASE}/api/servers`); if (!res.ok) throw new Error(`API returned ${res.status}`); setServers(await res.json()); setError(null); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to reach backend."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchServers(); const i = setInterval(fetchServers, POLL_INTERVAL_MS); return () => clearInterval(i); }, [fetchServers]);

  const handleServerAction = useCallback(async (id: string, action: "start" | "stop" | "restart") => {
    setStopConfirmId(null); setRestartConfirmId(null); setActingId(id);
    try { await fetch(`${API_BASE}/api/servers/${id}/${action}`, { method: "POST" }); await fetchServers(); }
    catch (err) { console.error(`[panel] ${action} failed:`, err); }
    finally { setActingId(null); }
  }, [fetchServers]);

  const STAGGER = ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6", "stagger-7", "stagger-8", "stagger-9", "stagger-10", "stagger-11", "stagger-12"];

  return (
    <div className="flex min-h-screen bg-[#0B0914]">
      <ServerSidebar servers={servers} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCreateClick={() => setDialogOpen(true)} onInstallModpack={() => setModpackDialogOpen(true)} />
      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-13" : "lg:ml-52"}`}>
        <div className="mx-auto max-w-6xl px-6 sm:px-8 py-6 sm:py-10">

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error}</p>
              <button onClick={() => { setLoading(true); setError(null); fetchServers(); }} className="rounded-lg bg-[#9D4EDD]/10 px-4 py-2 text-sm font-medium text-violet-300 transition hover:bg-[#9D4EDD]/20">Retry</button>
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <header className="mb-8 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setSidebarCollapsed(false)} className="lg:hidden rounded-md p-1.5 -ml-1 text-slate-400 hover:text-white hover:bg-[#9D4EDD]/5 transition" title="Open menu">
                    <Menu className="h-5 w-5" />
                  </button>
                  <div>
                    <h1 className="font-display font-bold text-3xl text-white tracking-tight">Dashboard</h1>
                    <p className="mt-1 text-xs text-[#6b6480]">
                      {servers.length} server{servers.length !== 1 ? "s" : ""}
                      {searchQuery ? ` · ${filteredServers.length} match${filteredServers.length !== 1 ? "es" : ""}` : ""}
                      {stats.running > 0 && ` · ${stats.running} running`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#6b6480] pointer-events-none" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter…"
                      className="w-full sm:w-40 rounded-lg border border-[#28223D] bg-[#151221] pl-9 pr-3 py-2 text-sm text-white placeholder:text-[#6b6480] focus:border-[#9D4EDD]/40 focus:outline-none" />
                  </div>
                  <button onClick={fetchServers} className="rounded-lg border border-[#28223D] p-2 text-[#6b6480] transition hover:border-[#9D4EDD]/40 hover:text-slate-400 shrink-0" title="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-lg bg-[#9D4EDD] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#B100E8] shadow-[0_0_20px_rgba(157,78,221,0.25)] shrink-0">
                    <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Server</span>
                  </button>
                </div>
              </header>

              {/* ── Overview Stats ── */}
              {servers.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                  <div className="surface p-4 animate-slide-up stagger-1">
                    <div className="text-[10px] font-semibold text-[#6b6480] uppercase tracking-wider mb-2">Servers</div>
                    <div className="text-2xl font-bold text-white tabular-nums">{stats.total}</div>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className="flex items-center gap-1 text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{stats.running} up</span>
                      <span className="text-[#6b6480]">{stats.stopped} down</span>
                    </div>
                  </div>
                  <div className="surface p-4 animate-slide-up stagger-2">
                    <div className="text-[10px] font-semibold text-[#6b6480] uppercase tracking-wider mb-2">CPU</div>
                    <div className="text-2xl font-bold text-white tabular-nums">{stats.avgCpu.toFixed(1)}<span className="text-base font-medium text-[#6b6480]">%</span></div>
                    <div className="mt-2 h-1 rounded-full bg-[#28223D] overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${
                        stats.avgCpu > 80 ? "bg-[#F15BB5]" : stats.avgCpu > 50 ? "bg-[#FEE440]" : "bg-[#00F5D4]"
                      }`} style={{ width: `${Math.min(100, stats.avgCpu)}%` }} />
                    </div>
                  </div>
                  <div className="surface p-4 animate-slide-up stagger-3">
                    <div className="text-[10px] font-semibold text-[#6b6480] uppercase tracking-wider mb-2">RAM</div>
                    <div className="text-2xl font-bold text-white tabular-nums">
                      {stats.totalRam >= 1e9 ? `${(stats.totalRam / 1e9).toFixed(1)}` : stats.totalRam}
                      <span className="text-base font-medium text-[#6b6480]"> GB</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className="text-emerald-400">{stats.running > 0 ? `${((stats.usedRam / (stats.totalRam * 1e6)) * 100).toFixed(0)}% used` : "—"}</span>
                    </div>
                  </div>
                  <div className="surface p-4 animate-slide-up stagger-4">
                    <div className="text-[10px] font-semibold text-[#6b6480] uppercase tracking-wider mb-2">Players</div>
                    <div className="text-2xl font-bold text-white tabular-nums">
                      {stats.totalPlayers}<span className="text-base font-medium text-[#6b6480]">/{stats.totalMaxPlayers}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[#6b6480]">
                      <HardDrive className="h-3 w-3" />{formatDisk(stats.totalDisk)}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Server Cards ── */}
              {servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#28223D] py-20">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#9D4EDD]/20 to-[#9D4EDD]/10">
                    <Server className="h-7 w-7 text-violet-400" />
                  </div>
                  <p className="text-sm font-medium text-[#6b6480] mb-1">No servers yet</p>
                  <p className="text-xs text-[#6b6480] mb-4">Create your first Minecraft server to get started</p>
                  <button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-lg bg-[#9D4EDD] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#B100E8]">
                    <Plus className="h-4 w-4" /> Create Server
                  </button>
                </div>
              ) : filteredServers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#28223D] py-20">
                  <Search className="h-8 w-8 text-[#6b6480] mb-3" />
                  <p className="text-sm font-medium text-slate-500">No servers match "{searchQuery}"</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredServers.map((s, i) => {
                    const iconUrl = serverIcons[s.id];
                    const motd = serverMotds[s.id];
                    const uptime = formatUptime(s.startedAt);
                    const isRunning = s.status === "running";

                    return (
                    <div key={s.id}
                      className={`group surface surface-hover animate-slide-up relative p-0 flex flex-col overflow-hidden ${STAGGER[i] || ""} ${isRunning ? "card-tint-running" : "card-tint-stopped"}`}>

                      <div className="p-5 flex flex-col flex-1">
                        {/* Top: icon + name + actions */}
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl overflow-hidden bg-[#0B0914] border border-[#28223D] relative">
                              <Server className="h-5 w-5 text-violet-400 absolute" />
                              {iconUrl && (
                                <img src={iconUrl} alt="" className="h-full w-full object-cover relative z-10"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <h2 className="truncate text-sm font-semibold text-white group-hover:text-violet-400 transition">{s.name}</h2>
                              {isRunning && motd && <p className="truncate text-[11px] text-[#6b6480] mt-0.5">{motd}</p>}
                            </div>
                          </div>
                          <div className="btn-group shrink-0 relative z-10" onClick={e => e.preventDefault()}>
                            {isRunning ? (<>
                              {stopConfirmId === s.id ? (
                                <div className="flex items-center gap-1 px-2 py-1">
                                  <span className="text-[10px] text-amber-400">Stop?</span>
                                  <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "stop"); }} disabled={actingId === s.id} className="rounded bg-[#FEE440] px-1.5 py-0.5 text-[10px] font-medium text-black hover:bg-[#FEE440]/80 disabled:opacity-50">Yes</button>
                                  <button onClick={e => { e.stopPropagation(); setStopConfirmId(null); }} className="rounded bg-[#28223D] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-[#3C096C]">No</button>
                                </div>
                              ) : (
                                <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setStopConfirmId(s.id); }}
                                  className="flex h-8 w-8 items-center justify-center text-amber-400 transition hover:bg-[#FEE440]/10 disabled:opacity-50" title="Stop"><Square className="h-3.5 w-3.5" /></button>
                              )}
                              {restartConfirmId === s.id ? (
                                <div className="flex items-center gap-1 px-2 py-1">
                                  <span className="text-[10px] text-amber-400">Restart?</span>
                                  <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "restart"); }} disabled={actingId === s.id} className="rounded bg-[#FEE440] px-1.5 py-0.5 text-[10px] font-medium text-black hover:bg-[#FEE440]/80 disabled:opacity-50">Yes</button>
                                  <button onClick={e => { e.stopPropagation(); setRestartConfirmId(null); }} className="rounded bg-[#28223D] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-[#3C096C]">No</button>
                                </div>
                              ) : (
                                <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setRestartConfirmId(s.id); }}
                                  className="flex h-8 w-8 items-center justify-center text-[#6b6480] transition hover:bg-[#9D4EDD]/5 hover:text-amber-400 disabled:opacity-50" title="Restart"><RotateCw className="h-3.5 w-3.5" /></button>
                              )}
                            </>) : (
                              <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); handleServerAction(s.id, "start"); }}
                                className="flex h-8 w-8 items-center justify-center text-emerald-400 transition hover:bg-[#00F5D4]/10 disabled:opacity-50" title="Start"><Play className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </div>

                        {/* Status + specs */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusColor(s.status)} ${isRunning ? "pulse-dot" : ""}`} />
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusBadgeColor(s.status)}`}>{statusLabel(s.status)}</span>
                          {isRunning && uptime && (
                            <span className="flex items-center gap-1 text-[10px] text-[#6b6480]"><Clock className="h-3 w-3" />{uptime}</span>
                          )}
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadgeColor(s.serverType)}`}>{typeLabel(s.serverType)}</span>
                          <span className="text-[11px] text-[#6b6480]">{s.version}</span>
                        </div>

                        {/* Live metrics */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 mt-auto">
                          <div className="flex flex-col items-center rounded-lg bg-[#0B0914] px-2 py-2">
                            <span className="text-[9px] text-[#6b6480] uppercase tracking-wider mb-0.5">CPU</span>
                            <span className={`text-xs font-mono font-bold tabular-nums ${
                              (liveStats[s.id]?.cpu || 0) >= 80 ? "text-[#F15BB5]" : (liveStats[s.id]?.cpu || 0) >= 50 ? "text-[#FEE440]" : "text-[#00F5D4]"
                            }`}>{Math.min(100, liveStats[s.id]?.cpu || 0).toFixed(0)}%</span>
                          </div>
                          <div className="flex flex-col items-center rounded-lg bg-[#0B0914] px-2 py-2">
                            <span className="text-[9px] text-[#6b6480] uppercase tracking-wider mb-0.5">RAM</span>
                            <span className="text-xs font-mono font-bold text-white tabular-nums">{formatRam(s.ram)}</span>
                          </div>
                          <div className="flex flex-col items-center rounded-lg bg-[#0B0914] px-2 py-2">
                            <span className="text-[9px] text-[#6b6480] uppercase tracking-wider mb-0.5">Players</span>
                            <span className="text-xs font-mono font-bold text-white tabular-nums">{playerCounts[s.id]?.online ?? 0}<span className="text-[#6b6480] font-normal">/{playerCounts[s.id]?.max ?? 20}</span></span>
                          </div>
                          <div className="flex flex-col items-center rounded-lg bg-[#0B0914] px-2 py-2">
                            <span className="text-[9px] text-[#6b6480] uppercase tracking-wider mb-0.5">Port</span>
                            <span className="text-xs font-mono font-bold text-white tabular-nums">:{s.port}</span>
                          </div>
                        </div>
                      </div>

                      <Link href={`/servers/${s.id}`} className="absolute inset-0 z-10" />
                    </div>
                    );
                  })}
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
