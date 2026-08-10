"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertTriangle, Plus, Users, Search, Server, Clock, HardDrive } from "lucide-react";
import { io, Socket } from "socket.io-client";
import CreateServerDialog from "@/components/CreateServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
import TopBar from "@/components/TopBar";
import ServerCard from "@/components/ServerCard";
import { CardSkeleton } from "@/components/Skeleton";
import { formatBytes, formatDisk, formatRam, typeLabel } from "@/lib/format";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const POLL_INTERVAL_MS = 5_000;

export default function DashboardPage() {
  const router = useRouter();
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
  const [searchQuery, setSearchQuery] = useState("");
  const [serverMotds, setServerMotds] = useState<Record<string, string>>({});
  const socketRef = useRef<Socket | null>(null);
  const serversRef = useRef(servers);
  serversRef.current = servers;

  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredServers = servers.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    (statusFilter === "all" ||
      (statusFilter === "running" ? s.status === "running" : s.status !== "running"))
  );

  // ---- keyboard shortcut: "/" focuses the search (skip when typing) ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.key === "/") { e.preventDefault(); searchInputRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const statusFilterChips: { id: typeof statusFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: servers.length },
    { id: "running", label: "Online", count: servers.filter(s => s.status === "running").length },
    { id: "stopped", label: "Stopped", count: servers.filter(s => s.status !== "running").length },
  ];

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
      fetch(`${API_BASE}/api/servers/${s.id}/properties`)
        .then(async r => { if (r.ok) return r.json(); return null; })
        .then(data => { if (data?.motd) setServerMotds(prev => ({ ...prev, [s.id]: data.motd })); })
        .catch(() => {});
    }
  }, [servers]);

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


  return (
    <div className="min-h-screen">
      <TopBar servers={servers} onInstallModpack={() => setModpackDialogOpen(true)} onlinePlayers={stats.totalPlayers} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">

          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error}</p>
              <button onClick={() => { setLoading(true); setError(null); fetchServers(); }} className="rounded-lg bg-accent/10 px-4 py-2 text-sm font-medium text-violet-300 transition hover:bg-accent/20">Retry</button>
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <header className="mb-8 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
                <div>
                  <h1 className="font-display font-bold text-3xl text-white tracking-tight">Dashboard</h1>
                  <p className="mt-1 text-xs text-muted">
                    {servers.length} server{servers.length !== 1 ? "s" : ""}
                    {searchQuery ? ` · ${filteredServers.length} match${filteredServers.length !== 1 ? "es" : ""}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
                    <input ref={searchInputRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter… ( / )"
                      className="w-full sm:w-40 rounded-lg border border-edge bg-surface pl-9 pr-3 py-2 text-sm text-white placeholder:text-muted focus:border-accent/40 focus:outline-none" />
                  </div>
                  <button onClick={fetchServers} className="rounded-lg border border-edge p-2 text-muted transition hover:border-accent/40 hover:text-slate-400 shrink-0" title="Refresh" aria-label="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong shadow-[0_0_20px_rgba(157,78,221,0.25)] shrink-0">
                    <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Server</span>
                  </button>
                </div>
              </header>

              {/* ── Overview Stats ── */}
              {servers.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                  <div className="surface p-4 animate-slide-up stagger-1">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Servers</div>
                    <div className="text-2xl font-bold text-white tabular-nums">{stats.total}</div>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className="flex items-center gap-1 text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{stats.running} up</span>
                      <span className="text-muted">{stats.stopped} down</span>
                    </div>
                  </div>
                  <div className="surface p-4 animate-slide-up stagger-2">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">CPU</div>
                    <div className="text-2xl font-bold text-white tabular-nums">{stats.avgCpu.toFixed(1)}<span className="text-base font-medium text-muted">%</span></div>
                    <div className="mt-2 h-1 rounded-full bg-edge overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${
                        stats.avgCpu > 80 ? "bg-danger" : stats.avgCpu > 50 ? "bg-warn" : "bg-online"
                      }`} style={{ width: `${Math.min(100, stats.avgCpu)}%` }} />
                    </div>
                  </div>
                  <div className="surface p-4 animate-slide-up stagger-3">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">RAM</div>
                    <div className="text-2xl font-bold text-white tabular-nums">
                      {stats.usedRam > 0 ? formatBytes(stats.usedRam) : "—"}
                    </div>
                    {stats.totalRam > 0 && (
                      <div className="mt-2 h-1 rounded-full bg-edge overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${
                          stats.usedRam / (stats.totalRam * 1e6) > 0.8 ? "bg-danger"
                          : stats.usedRam / (stats.totalRam * 1e6) > 0.5 ? "bg-warn" : "bg-online"
                        }`}
                          style={{ width: `${Math.min(100, (stats.usedRam / (stats.totalRam * 1e6)) * 100)}%` }} />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className="text-muted">{formatRam(stats.totalRam)} total</span>
                    </div>
                  </div>
                  <div className="surface p-4 animate-slide-up stagger-4">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Players</div>
                    <div className="text-2xl font-bold text-white tabular-nums">
                      {stats.totalPlayers}<span className="text-base font-medium text-muted">/{stats.totalMaxPlayers}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted">
                      <HardDrive className="h-3 w-3" />{formatDisk(stats.totalDisk)}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Status filter chips ── */}
              {servers.length > 0 && (
                <div className="mb-4 flex items-center gap-1.5 flex-wrap">
                  {statusFilterChips.map((chip) => {
                    const active = statusFilter === chip.id;
                    return (
                      <button
                        key={chip.id}
                        onClick={() => setStatusFilter(chip.id)}
                        aria-pressed={active}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                          active
                            ? chip.id === "running"
                              ? "border-online/30 bg-online/10 text-emerald-400"
                              : chip.id === "stopped"
                                ? "border-warn/30 bg-warn/10 text-amber-400"
                                : "border-accent/40 bg-accent/10 text-purple-200"
                            : "border-edge text-slate-400 hover:border-accent/30 hover:text-slate-200"
                        }`}
                      >
                        {chip.label}
                        <span className="tabular-nums opacity-70">{chip.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Server Cards ── */}
              {servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-20">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 to-accent/10">
                    <Server className="h-7 w-7 text-violet-400" />
                  </div>
                  <p className="text-sm font-medium text-muted mb-1">No servers yet</p>
                  <p className="text-xs text-muted mb-4">Create your first Minecraft server to get started</p>
                  <button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-strong">
                    <Plus className="h-4 w-4" /> Create Server
                  </button>
                </div>
              ) : filteredServers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-20">
                  <Search className="h-9 w-9 text-muted mb-3" />
                  <p className="text-sm font-medium text-slate-500">No servers match "{searchQuery}"</p>
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredServers.map((s) => (
                    <ServerCard
                      key={s.id}
                      s={s}
                      motd={serverMotds[s.id]}
                      liveCpu={liveStats[s.id]?.cpu}
                      liveMem={liveStats[s.id]?.mem}
                      playerCount={playerCounts[s.id]}
                      acting={actingId === s.id}
                      stopConfirm={stopConfirmId === s.id}
                      restartConfirm={restartConfirmId === s.id}
                      onOpen={() => router.push(`/servers/${s.id}`)}
                      onStart={() => handleServerAction(s.id, "start")}
                      onStop={() => handleServerAction(s.id, "stop")}
                      onRestart={() => handleServerAction(s.id, "restart")}
                      onStopConfirm={() => setStopConfirmId(s.id)}
                      onRestartConfirm={() => setRestartConfirmId(s.id)}
                      onCancelConfirm={() => { setStopConfirmId(null); setRestartConfirmId(null); }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
      </main>
      <CreateServerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={() => fetchServers()} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={() => fetchServers()} />
    </div>
  );
}
