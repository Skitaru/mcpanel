"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertTriangle, Plus, Search, Server } from "lucide-react";
import { io, Socket } from "socket.io-client";
import CreateServerDialog from "@/components/CreateServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
import TopBar from "@/components/TopBar";
import ServerCard from "@/components/ServerCard";
import { CardSkeleton } from "@/components/Skeleton";
import { formatBytes } from "@/lib/format";
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
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "status" | "ram">("name");
  const [hostStats, setHostStats] = useState<{ cpuPercent: number; memory: { used: number; total: number }; disk: { used: number; total: number } } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [stopAllConfirm, setStopAllConfirm] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const uniqueTags = Array.from(new Set(servers.map((s) => s.tag).filter((t): t is string => !!t)));

  const filteredServers = servers
    .filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      (statusFilter === "all" ||
        (statusFilter === "running" ? s.status === "running" : s.status !== "running")) &&
      (tagFilter === null || s.tag === tagFilter)
    )
    .sort((a, b) => {
      if (sortBy === "ram") return b.ram - a.ram;
      if (sortBy === "status") return (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1);
      return a.name.localeCompare(b.name);
    });

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

  // ---- host metrics (machine-level CPU/RAM/Disk) ----
  useEffect(() => {
    const pollHost = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/stats`);
        if (res.ok) setHostStats(await res.json());
      } catch { /* backend unreachable — keep last values */ }
    };
    pollHost();
    const i = setInterval(pollHost, 5000);
    return () => clearInterval(i);
  }, []);

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

  // ---- batch start / stop ----
  const handleBatch = useCallback(async (action: "start" | "stop") => {
    setBatchBusy(true);
    setStopAllConfirm(false);
    const targets = servers.filter((s) =>
      action === "start" ? s.status !== "running" : s.status === "running",
    );
    try {
      await Promise.all(targets.map((s) => fetch(`${API_BASE}/api/servers/${s.id}/${action}`, { method: "POST" })));
      await fetchServers();
    } catch (err) {
      console.error(`[panel] batch ${action} failed:`, err);
    } finally {
      setBatchBusy(false);
    }
  }, [servers, fetchServers]);

  const handleServerAction = useCallback(async (id: string, action: "start" | "stop" | "restart") => {
    setStopConfirmId(null); setRestartConfirmId(null); setActingId(id);
    try { await fetch(`${API_BASE}/api/servers/${id}/${action}`, { method: "POST" }); await fetchServers(); }
    catch (err) { console.error(`[panel] ${action} failed:`, err); }
    finally { setActingId(null); }
  }, [fetchServers]);


  return (
    <div className="min-h-screen">
      <TopBar servers={servers} onInstallModpack={() => setModpackDialogOpen(true)} onlinePlayers={servers.filter(s => s.status === "running").reduce((a, s) => a + (playerCounts[s.id]?.online || 0), 0)} />
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

              {/* ── Host metrics (machine-level) ── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <div className="surface p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Host CPU</span>
                    <span className={`text-xl font-bold tabular-nums ${hostStats && hostStats.cpuPercent > 80 ? "text-danger" : hostStats && hostStats.cpuPercent > 50 ? "text-warn" : "text-white"}`}>
                      {hostStats ? `${hostStats.cpuPercent.toFixed(0)}%` : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-edge overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-700 ${hostStats && hostStats.cpuPercent > 80 ? "bg-danger" : hostStats && hostStats.cpuPercent > 50 ? "bg-warn" : "bg-online"}`}
                      style={{ width: `${hostStats ? Math.min(100, hostStats.cpuPercent) : 0}%` }} />
                  </div>
                </div>
                <div className="surface p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Host RAM</span>
                    <span className="text-xl font-bold tabular-nums text-white">
                      {hostStats ? formatBytes(hostStats.memory.used) : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-edge overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-800 to-accent transition-all duration-700"
                      style={{ width: `${hostStats ? Math.min(100, (hostStats.memory.used / hostStats.memory.total) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-1 text-right text-[10px] text-muted">von {hostStats ? formatBytes(hostStats.memory.total) : "—"}</div>
                </div>
                <div className="surface p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Host Disk</span>
                    <span className="text-xl font-bold tabular-nums text-white">
                      {hostStats && hostStats.disk.total > 0 ? formatBytes(hostStats.disk.used) : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-edge overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-teal-700 to-online transition-all duration-700"
                      style={{ width: `${hostStats && hostStats.disk.total > 0 ? Math.min(100, (hostStats.disk.used / hostStats.disk.total) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-1 text-right text-[10px] text-muted">von {hostStats && hostStats.disk.total > 0 ? formatBytes(hostStats.disk.total) : "—"}</div>
                </div>
                <div className="surface p-4">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Servers</span>
                  <div className="text-xl font-bold text-white tabular-nums mt-1">
                    {servers.filter(s => s.status === "running").length}<span className="text-sm font-medium text-muted">/{servers.length}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px]">
                    <span className="flex items-center gap-1 text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{servers.filter(s => s.status === "running").length} up</span>
                    <span className="text-muted">{servers.filter(s => s.status !== "running").length} down</span>
                  </div>
                </div>
              </div>

              {/* ── Toolbar: sort + batch ── */}
              {servers.length > 0 && (
                <div className="mb-4 flex items-center gap-2 flex-wrap">
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "status" | "ram")}
                    aria-label="Sort servers"
                    className="rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs text-slate-300 focus:border-accent/40 focus:outline-none">
                    <option value="name">Sort: Name</option>
                    <option value="status">Sort: Status</option>
                    <option value="ram">Sort: RAM</option>
                  </select>
                  <div className="flex-1" />
                  <button onClick={() => handleBatch("start")} disabled={batchBusy}
                    className="flex items-center gap-1.5 rounded-lg border border-online/30 bg-online/10 px-3 py-1.5 text-xs font-semibold text-online transition hover:bg-online/20 disabled:opacity-50"
                    title="Start all stopped servers" aria-label="Start all servers">
                    ▶ Start All
                  </button>
                  {stopAllConfirm ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2 py-1.5">
                      <span className="text-xs font-bold text-danger">Stop all?</span>
                      <button onClick={() => handleBatch("stop")} disabled={batchBusy} className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50">{batchBusy ? "…" : "Yes"}</button>
                      <button onClick={() => setStopAllConfirm(false)} className="rounded bg-edge px-1.5 py-0.5 text-[10px] text-slate-300">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setStopAllConfirm(true)} disabled={batchBusy}
                      className="flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/20 disabled:opacity-50"
                      title="Stop all running servers" aria-label="Stop all servers">
                      ■ Stop All
                    </button>
                  )}
                </div>
              )}

              {/* ── Status + Tag filter chips ── */}
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
                  {uniqueTags.length > 0 && <span className="mx-1 h-4 w-px bg-edge" />}
                  {uniqueTags.map((tag) => {
                    const active = tagFilter === tag;
                    return (
                      <button
                        key={tag}
                        onClick={() => setTagFilter(active ? null : tag)}
                        aria-pressed={active}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${active ? "border-accent/50 bg-accent/15 text-purple-200" : "border-edge text-slate-400 hover:border-accent/30 hover:text-slate-200"}`}
                      >
                        {tag}
                        <span className="tabular-nums opacity-70">{servers.filter((s) => s.tag === tag).length}</span>
                      </button>
                    );
                  })}
                  {(tagFilter !== null || statusFilter !== "all" || searchQuery) && (
                    <button onClick={() => { setTagFilter(null); setStatusFilter("all"); setSearchQuery(""); }}
                      className="text-[11px] text-muted transition hover:text-slate-300 underline-offset-2 hover:underline">
                      Reset
                    </button>
                  )}
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
      <CreateServerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={() => fetchServers()} onOpenModpack={() => { setDialogOpen(false); setModpackDialogOpen(true); }} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={() => fetchServers()} />
    </div>
  );
}
