"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, AlertTriangle, Plus, Trash2, Play, Square, Cpu, MemoryStick, Users, LogOut, HardDrive } from "lucide-react";
import { io, Socket } from "socket.io-client";
import CreateServerDialog from "@/components/CreateServerDialog";
import ServerSidebar from "@/components/ServerSidebar";
import { CardSkeleton } from "@/components/Skeleton";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const POLL_INTERVAL_MS = 5_000;

function statusColor(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "bg-emerald-500";
    case "exited": case "created": case "paused": return "bg-amber-500";
    default: return "bg-slate-600";
  }
}

function statusLabel(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "Online";
    case "exited": return "Stopped";
    case "created": return "Created";
    case "paused": return "Paused";
    default: return "Unknown";
  }
}

function formatRam(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function typeLabel(t: string) {
  switch (t) {
    case "fabric": return "Fabric";
    case "velocity": return "Velocity";
    default: return "Paper";
  }
}

function typeBadgeColor(t: string) {
  switch (t) {
    case "fabric": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "velocity": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    default: return "bg-sky-500/10 text-sky-400 border-sky-500/20";
  }
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<Record<string, { cpu: number; mem: number; memLimit: number }>>({});
  const [playerCounts, setPlayerCounts] = useState<Record<string, { online: number; max: number; players: { name: string; id: string }[] }>>({});
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // ---- Socket.IO for live stats ----
  useEffect(() => {
    const socket = io(API_BASE, { transports: ["polling"] }); // no WebSocket — Next.js rewrites don't proxy WS upgrades in prod
    socketRef.current = socket;

    socket.on("connect", () => {
      servers.forEach((s) => {
        if (s.status === "running") {
          socket.emit("stats:subscribe", { serverId: s.id });
        }
      });
    });

    socket.on("stats:data", (payload: { serverId: string; cpuPercent: number; memoryUsage: number; memoryLimit: number }) => {
      if (payload.cpuPercent == null) return;
      setLiveStats((prev) => ({
        ...prev,
        [payload.serverId]: { cpu: payload.cpuPercent, mem: payload.memoryUsage, memLimit: payload.memoryLimit },
      }));
    });

    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    servers.forEach((s) => {
      if (s.status === "running") {
        socket.emit("stats:subscribe", { serverId: s.id });
      } else {
        socket.emit("stats:unsubscribe", { serverId: s.id });
      }
    });
  }, [servers]);

  useEffect(() => {
    const pollPlayers = async () => {
      const running = servers.filter((s) => s.status === "running");
      for (const s of running) {
        try {
          const res = await fetch(`${API_BASE}/api/servers/${s.id}/players`);
          if (res.ok) {
            const data = await res.json();
            if (!data.unreachable) {
              setPlayerCounts((prev) => ({ ...prev, [s.id]: { online: data.online, max: data.max, players: data.players ?? [] } }));
            }
          }
        } catch { /* ignore */ }
      }
    };
    pollPlayers();
    const i = setInterval(pollPlayers, 15_000);
    return () => clearInterval(i);
  }, [servers]);

  // ---- disk usage poll (every 60s, only for non-empty server list) ----
  useEffect(() => {
    const pollDisk = async () => {
      for (const s of servers) {
        try {
          const res = await fetch(`${API_BASE}/api/servers/${s.id}/disk`);
          if (res.ok) {
            const data = await res.json();
            if (data.bytes >= 0) setDiskUsage((prev) => ({ ...prev, [s.id]: data.bytes }));
          }
        } catch { /* ignore */ }
      }
    };
    if (servers.length > 0) { pollDisk(); }
    const i = setInterval(pollDisk, 60_000);
    return () => clearInterval(i);
  }, [servers]);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setServers(await res.json());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reach backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchServers]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleteConfirmId(null);
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchServers();
    } catch (err: unknown) {
      console.error("[panel] delete failed:", err);
    } finally {
      setDeletingId(null);
    }
  }, [fetchServers]);

  const handleCreated = useCallback(() => { fetchServers(); }, [fetchServers]);

  const handleServerAction = useCallback(async (id: string, action: "start" | "stop") => {
    setActingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchServers();
    } catch (err: unknown) {
      console.error(`[panel] ${action} failed:`, err);
    } finally {
      setActingId(null);
    }
  }, [fetchServers]);

  return (
    <div className="flex min-h-screen">
      <ServerSidebar
        servers={servers}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onCreateClick={() => setDialogOpen(true)}
      />
      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-14" : "lg:ml-56"}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-400">{error}</p>
              <button onClick={() => { setLoading(true); setError(null); fetchServers(); }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700">
                Retry
              </button>
            </div>
          ) : (
            <>
              <header className="mb-8 sm:mb-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white">Servers</h1>
                  <p className="mt-1 text-sm text-slate-400">{servers.length} server{servers.length !== 1 ? "s" : ""} configured</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={fetchServers} className="rounded-lg border border-white/[0.04] p-2 text-neutral-500 transition hover:border-white/[0.08] hover:text-neutral-300" title="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { localStorage.removeItem("mcpanel-token"); window.location.reload(); }}
                    className="rounded-lg border border-white/[0.04] p-2 text-neutral-600 transition hover:border-red-500/20 hover:text-red-400"
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 py-20">
                  <p className="text-sm font-medium text-slate-500">No servers yet</p>
                  <button onClick={() => setDialogOpen(true)} className="mt-4 flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500">
                    <Plus className="h-4 w-4" /> Create your first server
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {servers.map((s) => (
                    <Link key={s.id} href={`/servers/${s.id}`}
                      className="group glass glass-hover animate-slide-up relative rounded-2xl p-5 transition-all duration-200 flex flex-col">
                      {/* Top: Status + Name + Type Badge */}
                      <div className="flex items-center gap-3 mb-4">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${s.status === "running" ? "pulse-dot" : ""} ${statusColor(s.status)}`} />
                        <h2 className="truncate text-base font-semibold text-white group-hover:text-sky-400 transition flex-1">{s.name}</h2>
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadgeColor(s.serverType)}`}>
                          {typeLabel(s.serverType)}
                        </span>
                      </div>

                      {/* Specs row */}
                      <div className="flex items-center gap-4 text-xs text-slate-500 mb-3 flex-wrap">
                        <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3 text-slate-600" />{formatRam(s.ram)}</span>
                        <span className="text-slate-700">·</span>
                        <span>{s.version}</span>
                        <span className="text-slate-700">·</span>
                        <span>:{s.port}</span>
                        {diskUsage[s.id] != null && diskUsage[s.id] >= 0 && (
                          <><span className="text-slate-700">·</span>
                          <span className="flex items-center gap-1"><HardDrive className="h-3 w-3 text-slate-600" />{formatDisk(diskUsage[s.id])}</span></>
                        )}
                      </div>
                      {/* Live stats (only for running servers) */}
                      {s.status === "running" && (
                        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.03]">
                          <div className="flex items-center gap-1.5 text-slate-400 flex-1">
                            <Cpu className="h-3.5 w-3.5" />
                            <span className="font-mono text-xs tabular-nums text-white font-medium">
                              {liveStats[s.id]?.cpu?.toFixed(1) ?? "—"}%
                            </span>
                          </div>
                          <div className="w-px h-4 bg-white/[0.04]" />
                          <div className="flex items-center gap-1.5 text-slate-400 flex-1">
                            <MemoryStick className="h-3.5 w-3.5" />
                            <span className="font-mono text-xs tabular-nums text-white font-medium">
                              {liveStats[s.id] ? (liveStats[s.id].mem >= 1e9 ? `${(liveStats[s.id].mem / 1e9).toFixed(1)}G` : `${(liveStats[s.id].mem / 1e6).toFixed(0)}M`) : "—"}
                            </span>
                          </div>
                          {playerCounts[s.id] && (
                            <>
                              <div className="w-px h-4 bg-white/[0.04]" />
                              <div className="flex items-center gap-1.5 text-slate-400 relative group/players">
                                <Users className="h-3.5 w-3.5" />
                                <span className="font-mono text-xs tabular-nums text-white font-medium">
                                  {playerCounts[s.id].online}/{playerCounts[s.id].max}
                                </span>
                                {playerCounts[s.id].players.length > 0 && (
                                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover/players:block z-20
                                                  rounded-xl border border-white/[0.08] bg-[#0d0d0d] px-4 py-3 shadow-2xl min-w-[140px]">
                                    <div className="text-[10px] font-semibold text-neutral-500 mb-2 uppercase tracking-wider">Players</div>
                                    {playerCounts[s.id].players.slice(0, 8).map((p) => (
                                      <div key={p.id} className="flex items-center gap-2 py-0.5">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                        <span className="text-xs text-neutral-300 truncate">{p.name}</span>
                                      </div>
                                    ))}
                                    {playerCounts[s.id].players.length > 8 && (
                                      <div className="text-[10px] text-neutral-600 mt-1.5">+{playerCounts[s.id].players.length - 8} more</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Status label (non-running) */}
                      {s.status !== "running" && (
                        <p className="text-xs text-slate-600 mb-4">{statusLabel(s.status)}</p>
                      )}

                      {/* Actions — hover-revealed, icon-only */}
                      <div className="mt-auto flex items-center justify-end gap-1 card-actions" onClick={(e) => e.preventDefault()}>
                        {s.status === "running" ? (
                          <button disabled={actingId === s.id}
                            onClick={(e) => { e.stopPropagation(); handleServerAction(s.id, "stop"); }}
                            className="rounded-lg p-1.5 text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50" title="Stop"
                          ><Square className="h-3.5 w-3.5" /></button>
                        ) : (
                          <button disabled={actingId === s.id}
                            onClick={(e) => { e.stopPropagation(); handleServerAction(s.id, "start"); }}
                            className="rounded-lg p-1.5 text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50" title="Start"
                          ><Play className="h-3.5 w-3.5" /></button>
                        )}
                        {deleteConfirmId === s.id ? (
                          <div className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1">
                            <span className="text-xs text-red-400">Sure?</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                              disabled={deletingId === s.id}
                              className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-500 disabled:opacity-50">Yes</button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                              className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-600">No</button>
                          </div>
                        ) : (
                          <button disabled={deletingId === s.id}
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(s.id); }}
                            className="rounded-lg p-1.5 text-slate-700 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50" title="Delete"
                          ><Trash2 className="h-3.5 w-3.5" /></button>
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
      <CreateServerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
