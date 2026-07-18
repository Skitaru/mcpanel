"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, AlertTriangle, Plus, Trash2, Play, Square, Cpu, MemoryStick, Users, LogOut } from "lucide-react";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // ---- Socket.IO for live stats ----
  useEffect(() => {
    const socket = io(API_BASE, { transports: ["websocket", "polling"] });
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
        <div className="mx-auto max-w-6xl px-6 py-12">
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
              <header className="mb-10 flex items-center justify-between">
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
                      className="group glass glass-hover animate-in relative rounded-2xl p-5 transition-all duration-200">
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor(s.status)}`} />
                        <span className="text-xs font-medium text-slate-400">{statusLabel(s.status)}</span>
                      </div>
                      <h2 className="truncate text-base font-semibold text-white group-hover:text-sky-400 transition">{s.name}</h2>
                      <div className="mt-3 flex gap-4 text-xs text-slate-500">
                        <span>{formatRam(s.ram)}</span>
                        <span>Port {s.port}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">{typeLabel(s.serverType)}</span>
                        <span>{s.version}</span>
                      </div>
                      {liveStats[s.id] && liveStats[s.id].cpu != null && s.status === "running" && (
                        <div className="mt-3 flex items-center gap-3 text-xs">
                          <div className="flex items-center gap-1 text-slate-400">
                            <Cpu className="h-3 w-3" />
                            <span className="font-mono tabular-nums text-slate-300">
                              {liveStats[s.id].cpu.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-slate-400">
                            <MemoryStick className="h-3 w-3" />
                            <span className="font-mono tabular-nums text-slate-300">
                              {liveStats[s.id].mem >= 1e9
                                ? `${(liveStats[s.id].mem / 1e9).toFixed(1)}G`
                                : `${(liveStats[s.id].mem / 1e6).toFixed(0)}M`}
                            </span>
                          </div>
                          {playerCounts[s.id] && (
                            <div className="flex items-center gap-1 text-slate-400 group relative">
                              <Users className="h-3 w-3" />
                              <span className="font-mono tabular-nums text-slate-300">
                                {playerCounts[s.id].online}/{playerCounts[s.id].max}
                              </span>
                              {playerCounts[s.id].players.length > 0 && (
                                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-20
                                                rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-3 py-2 shadow-xl min-w-[120px]">
                                  <div className="text-[10px] font-medium text-neutral-500 mb-1 uppercase tracking-wider">Online</div>
                                  {playerCounts[s.id].players.slice(0, 10).map((p) => (
                                    <div key={p.id} className="flex items-center gap-1.5 py-0.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                      <span className="text-xs text-neutral-300 truncate">{p.name}</span>
                                    </div>
                                  ))}
                                  {playerCounts[s.id].players.length > 10 && (
                                    <div className="text-[10px] text-neutral-600 mt-1">
                                      +{playerCounts[s.id].players.length - 10} more
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-end gap-1" onClick={(e) => e.preventDefault()}>
                        {s.status === "running" ? (
                          <button
                            disabled={actingId === s.id}
                            onClick={(e) => { e.stopPropagation(); handleServerAction(s.id, "stop"); }}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50"
                          >
                            <Square className="h-3 w-3" />
                            {actingId === s.id ? "…" : "Stop"}
                          </button>
                        ) : (
                          <button
                            disabled={actingId === s.id}
                            onClick={(e) => { e.stopPropagation(); handleServerAction(s.id, "start"); }}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" />
                            {actingId === s.id ? "…" : "Start"}
                          </button>
                        )}
                        {deleteConfirmId === s.id ? (
                          <div className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1">
                            <span className="text-xs text-red-400">Delete?</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                              disabled={deletingId === s.id}
                              className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-500 disabled:opacity-50">
                              {deletingId === s.id ? "…" : "Yes"}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                              className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-600">
                              No
                            </button>
                          </div>
                        ) : (
                        <button
                          disabled={deletingId === s.id}
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(s.id); }}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-600 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          {deletingId === s.id ? "Deleting…" : "Delete"}
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
      <CreateServerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
