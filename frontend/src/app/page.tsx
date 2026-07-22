"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, AlertTriangle, Plus, Play, Square, Cpu, MemoryStick, Users, HardDrive, Search } from "lucide-react";
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
  const [liveStats, setLiveStats] = useState<Record<string, { cpu: number; mem: number; memLimit: number }>>({});
  const [playerCounts, setPlayerCounts] = useState<Record<string, { online: number; max: number; players: { name: string; id: string }[] }>>({});
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const socketRef = useRef<Socket | null>(null);

  const filteredServers = servers.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ---- Socket.IO ----
  useEffect(() => {
    const socket = io(API_BASE, { transports: ["polling"] });
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

  const handleServerAction = useCallback(async (id: string, action: "start" | "stop") => {
    setStopConfirmId(null); setActingId(id);
    try { await fetch(`${API_BASE}/api/servers/${id}/${action}`, { method: "POST" }); await fetchServers(); }
    catch (err) { console.error(`[panel] ${action} failed:`, err); }
    finally { setActingId(null); }
  }, [fetchServers]);

  // ==============================================================
  // Render
  // ==============================================================

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
              {/* Header */}
              <header className="mb-8 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-white">Servers</h1>
                  <p className="mt-0.5 text-sm text-slate-600">{servers.length} server{servers.length !== 1 ? "s" : ""}{searchQuery ? ` · ${filteredServers.length} match${filteredServers.length !== 1 ? "es" : ""}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600 pointer-events-none" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Filter servers…"
                      className="w-48 rounded-lg border border-[#1a1f2e] bg-[#0a0c10] pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
                  </div>
                  <button onClick={fetchServers} className="rounded-lg border border-[#1a1f2e] p-2 text-slate-600 transition hover:border-[#252b3b] hover:text-slate-400" title="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1a1f2e] py-20">
                  <p className="text-sm font-medium text-slate-600">No servers yet</p>
                  <button onClick={() => setDialogOpen(true)} className="mt-4 flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500">
                    <Plus className="h-4 w-4" /> Create your first server
                  </button>
                </div>
              ) : filteredServers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1a1f2e] py-20">
                  <Search className="h-8 w-8 text-slate-700 mb-3" />
                  <p className="text-sm font-medium text-slate-500">No servers match &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredServers.map((s) => (
                    <Link key={s.id} href={`/servers/${s.id}`}
                      className="group surface surface-hover animate-slide-up relative p-4 flex flex-col">

                      {/* Top row: icon + name + type badge */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${statusColor(s.status)} ${s.status === "running" ? "pulse-dot" : ""}`} />
                        <h2 className="truncate text-sm font-semibold text-white group-hover:text-violet-400 transition flex-1">{s.name}</h2>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadgeColor(s.serverType)}`}>
                          {typeLabel(s.serverType)}
                        </span>
                      </div>

                      {/* Specs */}
                      <div className="flex items-center gap-3 text-[11px] text-slate-600 mb-3 flex-wrap">
                        <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3" />{formatRam(s.ram)}</span>
                        <span className="text-slate-800">·</span>
                        <span>{s.version}</span>
                        <span className="text-slate-800">·</span>
                        <span>:{s.port}</span>
                        {diskUsage[s.id] != null && diskUsage[s.id] >= 0 && (
                          <><span className="text-slate-800">·</span><span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{formatDisk(diskUsage[s.id])}</span></>
                        )}
                      </div>

                      {/* Live stats (running only) */}
                      {s.status === "running" && (
                        <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-white/[0.02] border border-[#1a1f2e]">
                          <div className="flex items-center gap-1.5 text-slate-400 flex-1">
                            <Cpu className="h-3.5 w-3.5" />
                            <span className="font-mono text-xs tabular-nums text-white font-medium">{liveStats[s.id]?.cpu?.toFixed(1) ?? "—"}%</span>
                          </div>
                          <div className="w-px h-4 bg-[#1a1f2e]" />
                          <div className="flex items-center gap-1.5 text-slate-400 flex-1">
                            <MemoryStick className="h-3.5 w-3.5" />
                            <span className="font-mono text-xs tabular-nums text-white font-medium">
                              {liveStats[s.id] ? (liveStats[s.id].mem >= 1e9 ? `${(liveStats[s.id].mem / 1e9).toFixed(1)}G` : `${(liveStats[s.id].mem / 1e6).toFixed(0)}M`) : "—"}
                            </span>
                          </div>
                          {playerCounts[s.id] && (
                            <>
                              <div className="w-px h-4 bg-[#1a1f2e]" />
                              <div className="flex items-center gap-1.5 text-slate-400 relative group/players">
                                <Users className="h-3.5 w-3.5" />
                                <span className="font-mono text-xs tabular-nums text-white font-medium">{playerCounts[s.id].online}/{playerCounts[s.id].max}</span>
                                {playerCounts[s.id].players.length > 0 && (
                                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover/players:block z-20 rounded-lg border border-[#1a1f2e] bg-[#0f1119] px-4 py-3 shadow-2xl min-w-[140px]">
                                    <div className="text-[10px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">Players</div>
                                    {playerCounts[s.id].players.slice(0, 8).map(p => (
                                      <div key={p.id} className="flex items-center gap-2 py-0.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" /><span className="text-xs text-slate-400 truncate">{p.name}</span></div>
                                    ))}
                                    {playerCounts[s.id].players.length > 8 && <div className="text-[10px] text-slate-600 mt-1.5">+{playerCounts[s.id].players.length - 8} more</div>}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Non-running status */}
                      {s.status !== "running" && <p className="text-xs text-slate-600 mb-3">{statusLabel(s.status)}</p>}

                      {/* Actions — hover reveal */}
                      <div className="mt-auto flex items-center justify-end gap-1 card-actions" onClick={e => e.preventDefault()}>
                        {s.status === "running" ? (
                          stopConfirmId === s.id ? (
                            <div className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                              <span className="text-xs text-amber-400">Stop?</span>
                              <button onClick={e => { e.stopPropagation(); handleServerAction(s.id, "stop"); }} disabled={actingId === s.id} className="rounded bg-amber-600 px-2 py-0.5 text-xs text-white hover:bg-amber-500 disabled:opacity-50">Yes</button>
                              <button onClick={e => { e.stopPropagation(); setStopConfirmId(null); }} className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600">No</button>
                            </div>
                          ) : (
                            <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); setStopConfirmId(s.id); }}
                              className="rounded-md p-1.5 text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50" title="Stop">
                              <Square className="h-3.5 w-3.5" />
                            </button>
                          )
                        ) : (
                          <button disabled={actingId === s.id} onClick={e => { e.stopPropagation(); handleServerAction(s.id, "start"); }}
                            className="rounded-md p-1.5 text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50" title="Start">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </Link>
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
