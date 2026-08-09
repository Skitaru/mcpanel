"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, AlertTriangle, Plus, Play, Square, RotateCw, Cpu, MemoryStick, Users, HardDrive, Search, Menu, Server, Wifi, Zap, CheckCircle, XCircle, Clock } from "lucide-react";
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
function statusAccent(status: ServerStatus["status"]) {
  switch (status) { case "running": return "via-emerald-500/50"; case "exited": case "created": case "paused": return "via-amber-500/50"; default: return "via-slate-500/30"; }
}
function formatRam(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`; }
function typeLabel(t: string) { switch (t) { case "fabric": return "Fabric"; case "velocity": return "Velocity"; default: return "Paper"; } }
function typeBadgeColor(t: string) { switch (t) { case "fabric": return "bg-[#FEE440]/10 text-amber-400 border-[#FEE440]/20"; case "velocity": return "bg-purple-500/10 text-purple-400 border-[#28223D]"; default: return "bg-[#9D4EDD]/10 text-violet-400 border-violet-500/20"; } }
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

/** Brief flash animation when a value changes. */
function FlashValue({ value }: { value: string | number }) {
  const key = `${value}`;
  return <span key={key} className="value-flash inline-block">{value}</span>;
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
    const token = typeof window !== "undefined" ? localStorage.getItem("obsidian-token") : null;
    const socket = io(API_BASE, { transports: ["polling"], auth: { token } });
    socketRef.current = socket;
    socket.on("connect", () => { serversRef.current.forEach(s => { if (s.status === "running") socket.emit("stats:subscribe", { serverId: s.id }); }); });
    socket.on("stats:data", (p: { serverId: string; cpuPercent: number; memoryUsage: number; memoryLimit: number }) => {
      if (p.cpuPercent == null) return;
      setLiveStats(prev => ({ ...prev, [p.serverId]: { cpu: p.cpuPercent, mem: p.memoryUsage, memLimit: p.memoryLimit } }));
    });
    socket.on("stats:error", (p: { serverId: string; message: string }) => {
      console.warn(`[dashboard] Stats error for ${p.serverId}: ${p.message}`);
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

  // ---- Server icons + MOTD (fetch once on server list change) ----
  const fetchedMetaRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of servers) {
      if (fetchedMetaRef.current.has(s.id)) continue;
      fetchedMetaRef.current.add(s.id);

      // Fetch server icon
      fetch(`${API_BASE}/api/servers/${s.id}/file?path=${encodeURIComponent("/server-icon.png")}&raw=true`)
        .then(async r => { if (r.ok && r.status !== 204) return r.blob(); return null; })
        .then(blob => { if (blob) setServerIcons(prev => ({ ...prev, [s.id]: URL.createObjectURL(blob) })); })
        .catch(() => {});

      // Fetch MOTD
      fetch(`${API_BASE}/api/servers/${s.id}/properties`)
        .then(async r => { if (r.ok) return r.json(); return null; })
        .then(data => { if (data?.motd) setServerMotds(prev => ({ ...prev, [s.id]: data.motd })); })
        .catch(() => {});
    }
  }, [servers]);

  // Tick every 30s for live uptime display
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      Object.values(serverIcons).forEach(url => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <button onClick={() => { setLoading(true); setError(null); fetchServers(); }} className="rounded-lg bg-[#9D4EDD]/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-[#9D4EDD]/10">Retry</button>
            </div>
          ) : (
            <>
              {/* Header */}
              <header className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => setSidebarCollapsed(false)} className="lg:hidden rounded-md p-1.5 -ml-1 text-slate-400 hover:text-white hover:bg-[#9D4EDD]/5 transition" title="Open menu">
                    <Menu className="h-5 w-5" />
                  </button>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#9D4EDD]/20 to-[#9D4EDD]/10 shadow-lg">
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
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600 pointer-events-none" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter…"
                      className="w-full sm:w-36 rounded-lg border border-[#28223D] bg-[#0B0914] pl-8 pr-3 py-2 text-sm text-white placeholder:text-[#6b6480] focus:border-[#9D4EDD]/40 focus:outline-none" />
                  </div>
                  <button onClick={fetchServers} className="rounded-lg border border-[#28223D] p-2 text-slate-600 transition hover:border-[#9D4EDD]/40 hover:text-slate-400 shrink-0" title="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDialogOpen(true)} className="hover-scale flex items-center gap-2 rounded-lg bg-[#9D4EDD] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#B100E8] shadow-lg shrink-0">
                    <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Server</span>
                  </button>
                </div>
              </header>

              {/* Stats Bar */}
              {servers.length > 0 && (
                <div className="mb-6 space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="surface flex items-center gap-3 p-4 animate-slide-up stagger-1">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9D4EDD]/10">
                        <Server className="h-4 w-4 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Total</p>
                        <p className="text-lg font-bold text-white">{stats.total}</p>
                      </div>
                    </div>
                    <div className="surface flex items-center gap-3 p-4 animate-slide-up stagger-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00F5D4]/10">
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
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F15BB5]/10">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Issues</p>
                        <p className="text-lg font-bold text-red-400">{stats.error}</p>
                      </div>
                    </div>
                  </div>

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
                        <span className="text-[#6b6480]">/ {stats.totalRam >= 1024 ? `${(stats.totalRam / 1024).toFixed(1)} GB` : `${stats.totalRam} MB`}</span>
                      </div>
                      {stats.totalMaxPlayers > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Users className="h-3.5 w-3.5" />
                          <span>Players</span>
                          <span className="font-mono font-medium text-white tabular-nums">{stats.totalPlayers}</span>
                          <span className="text-[#6b6480]">/ {stats.totalMaxPlayers}</span>
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

              {/* Server Cards */}
              {servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#28223D] py-20">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#9D4EDD]/20 to-[#9D4EDD]/10">
                    <Server className="h-7 w-7 text-violet-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 mb-1">No servers yet</p>
                  <p className="text-xs text-[#6b6480] mb-4">Create your first Minecraft server to get started</p>
                  <button onClick={() => setDialogOpen(true)} className="hover-scale flex items-center gap-2 rounded-lg bg-[#9D4EDD] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#B100E8]">
                    <Plus className="h-4 w-4" /> Create Server
                  </button>
                </div>
              ) : filteredServers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#28223D] py-20">
                  <Search className="h-8 w-8 text-[#6b6480] mb-3" />
                  <p className="text-sm font-medium text-slate-500">No servers match &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredServers.map((s, i) => {
                    const iconUrl = serverIcons[s.id];
                    const motd = serverMotds[s.id];
                    const uptime = formatUptime(s.startedAt);

                    return (
                    <div key={s.id}
                      className={`group surface surface-hover animate-slide-up relative p-0 flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${STAGGER[i] || ""} ${s.status === "running" ? "card-tint-running" : "card-tint-stopped"}`}>

                      {/* Status accent line */}
                      <div className={`card-accent bg-gradient-to-r from-transparent ${statusAccent(s.status)} to-transparent`} />

                      {/* Card body */}
                      <div className="p-4 flex flex-col flex-1">
                        {/* Top row: icon + name + type badge + actions */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {/* Server icon */}
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg overflow-hidden bg-gradient-to-br from-[#9D4EDD]/20 to-[#9D4EDD]/10 border border-[#28223D] relative">
                              <Server className="h-5 w-5 text-violet-400 absolute" />
                              {iconUrl && (
                                <img src={iconUrl} alt="" className="h-full w-full object-cover relative z-10"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <h2 className="truncate text-sm font-semibold text-white group-hover:text-violet-400 transition">{s.name}</h2>
                              {s.status === "running" && motd && (
                                <p className="truncate text-[11px] text-slate-500 mt-0.5">{motd}</p>
                              )}
                            </div>
                          </div>
                          {/* Action button group */}
                          <div className="btn-group shrink-0 relative z-10" onClick={e => e.preventDefault()}>
                            {s.status === "running" ? (
                              <>
                                {stopConfirmId === s.id ? (
                                  <div className="flex items-center gap-1 px-2 py-1">
                                    <span className="text-[10px] text-amber-400">Stop?</span>
                                    <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "stop"); }} disabled={actingId === s.id} className="rounded bg-[#FEE440] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#FEE440]/80 disabled:opacity-50">Yes</button>
                                    <button onClick={e => { e.stopPropagation(); setStopConfirmId(null); }} className="rounded bg-[#28223D] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-[#3C096C]">No</button>
                                  </div>
                                ) : (
                                  <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setStopConfirmId(s.id); }}
                                    className="flex h-7 w-7 items-center justify-center text-amber-400 transition hover:bg-[#FEE440]/10 disabled:opacity-50" title="Stop">
                                    <Square className="h-3 w-3" />
                                  </button>
                                )}
                                {restartConfirmId === s.id ? (
                                  <div className="flex items-center gap-1 px-2 py-1">
                                    <span className="text-[10px] text-amber-400">Restart?</span>
                                    <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "restart"); }} disabled={actingId === s.id} className="rounded bg-[#FEE440] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#FEE440]/80 disabled:opacity-50">Yes</button>
                                    <button onClick={e => { e.stopPropagation(); setRestartConfirmId(null); }} className="rounded bg-[#28223D] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-[#3C096C]">No</button>
                                  </div>
                                ) : (
                                  <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setRestartConfirmId(s.id); }}
                                    className="flex h-7 w-7 items-center justify-center text-slate-500 transition hover:bg-[#9D4EDD]/5 hover:text-amber-400 disabled:opacity-50" title="Restart">
                                    <RotateCw className="h-3 w-3" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); handleServerAction(s.id, "start"); }}
                                className="flex h-7 w-7 items-center justify-center text-emerald-400 transition hover:bg-[#00F5D4]/10 disabled:opacity-50" title="Start">
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
                          {s.status === "running" && uptime && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Clock className="h-3 w-3" />
                              {uptime}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-600">{s.version}</span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadgeColor(s.serverType)}`}>
                            {typeLabel(s.serverType)}
                          </span>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 mt-auto">
                          <div className="flex items-center gap-1.5 rounded-md bg-[#9D4EDD]/[0.04] px-2.5 py-2">
                            <Wifi className="h-3 w-3 shrink-0 text-slate-600" />
                            <div className="min-w-0">
                              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6b6480]">Port</p>
                              <p className="text-xs font-mono font-medium text-white">:{s.port}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 rounded-md bg-[#9D4EDD]/[0.04] px-2.5 py-2">
                            <MemoryStick className="h-3 w-3 shrink-0 text-slate-600" />
                            <div className="min-w-0">
                              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6b6480]">RAM</p>
                              <p className="text-xs font-medium text-white">{formatRam(s.ram)}</p>
                            </div>
                          </div>
                          {s.status === "running" && (
                            <>
                              <div className="flex items-center gap-1.5 rounded-md bg-[#9D4EDD]/[0.04] px-2.5 py-2">
                                <Users className="h-3 w-3 shrink-0 text-emerald-400" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6b6480]">Players</p>
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-medium text-white tabular-nums">
                                      <FlashValue value={playerCounts[s.id]?.online ?? 0} />{/*  */}
                                      <span className="font-normal text-slate-600">/{(playerCounts[s.id]?.max ?? (s.port ? 20 : 0))}</span>
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 rounded-md bg-[#9D4EDD]/[0.04] px-2.5 py-2">
                                <Zap className={`h-3 w-3 shrink-0 ${(liveStats[s.id]?.cpu ? Math.min(100, liveStats[s.id].cpu) : 0) >= 80 ? "text-red-400" : (liveStats[s.id]?.cpu ? Math.min(100, liveStats[s.id].cpu) : 0) >= 50 ? "text-amber-400" : "text-emerald-400"}`} />
                                <div className="min-w-0">
                                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6b6480]">CPU</p>
                                  <p className="text-xs font-mono font-medium text-white tabular-nums"><FlashValue value={(liveStats[s.id]?.cpu ? Math.min(100, liveStats[s.id].cpu) : 0).toFixed(1)} />%</p>
                                </div>
                              </div>
                            </>
                          )}
                          {s.status !== "running" && diskUsage[s.id] != null && diskUsage[s.id] >= 0 && (
                            <div className="flex items-center gap-1.5 rounded-md bg-[#9D4EDD]/[0.04] px-2.5 py-2">
                              <HardDrive className="h-3 w-3 shrink-0 text-slate-600" />
                              <div className="min-w-0">
                                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6b6480]">Disk</p>
                                <p className="text-xs font-medium text-white">{formatDisk(diskUsage[s.id])}</p>
                              </div>
                            </div>
                          )}
                        </div>

                      </div>

                      {/* Click overlay */}
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
