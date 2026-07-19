"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Terminal, FolderOpen, ScrollText, Settings2,
  Loader2, AlertTriangle, Trash2, Download, Play, Square, RefreshCw, Settings, Upload, Users, HardDrive, MemoryStick,
} from "lucide-react";
import ConsoleTab from "@/components/ConsoleTab";
import FileManagerTab from "@/components/FileManagerTab";
import LogsTab from "@/components/LogsTab";
import EditServerDialog from "@/components/EditServerDialog";
import SettingsTab from "@/components/SettingsTab";
import ServerSidebar from "@/components/ServerSidebar";
import { DetailSkeleton } from "@/components/Skeleton";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type Tab = "console" | "files" | "logs" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Terminal }[] = [
  { id: "console", label: "Console", icon: Terminal },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function statusColor(s: ServerStatus["status"]) {
  switch (s) { case "running": return "bg-emerald-500"; case "exited": case "created": case "paused": return "bg-amber-500"; default: return "bg-slate-600"; }
}
function statusLabel(s: ServerStatus["status"]) {
  switch (s) { case "running": return "Online"; case "exited": return "Stopped"; case "created": return "Created"; case "paused": return "Paused"; default: return "Unknown"; }
}
function typeLabel(t: string) {
  switch (t) { case "fabric": return "Fabric"; case "velocity": return "Velocity"; default: return "Paper"; }
}

function formatDisk(bytes: number | undefined) {
  if (bytes == null || bytes < 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const [server, setServer] = useState<ServerStatus | null>(null);
  const [allServers, setAllServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("console");
  const [acting, setActing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [playerList, setPlayerList] = useState<{ name: string; id: string }[]>([]);
  const [playerCount, setPlayerCount] = useState<{ online: number; max: number }>({ online: 0, max: 0 });
  const [backingUp, setBackingUp] = useState(false);
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});

  const fetchServer = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ServerStatus[] = await res.json();
      setAllServers(data);
      const found = data.find((s) => s.id === serverId);
      if (!found) throw new Error("Server not found.");
      setServer(found);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally { setLoading(false); }
  }, [serverId]);

  useEffect(() => { fetchServer(); }, [fetchServer]);
  useEffect(() => { const i = setInterval(fetchServer, 3000); return () => clearInterval(i); }, [fetchServer]);

  // Player list poll
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/servers/${serverId}/players`);
        if (res.ok) {
          const data = await res.json();
          if (!data.unreachable) {
            setPlayerCount({ online: data.online, max: data.max });
            setPlayerList(data.players ?? []);
          }
        }
      } catch {}
    };
    poll();
    const i = setInterval(poll, 15000);
    return () => clearInterval(i);
  }, [serverId]);

  // Disk usage poll
  useEffect(() => {
    const pollDisk = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/servers/${serverId}/disk`);
        if (res.ok) {
          const data = await res.json();
          if (data.bytes >= 0) setDiskUsage((prev) => ({ ...prev, [serverId]: data.bytes }));
        }
      } catch {}
    };
    pollDisk();
    const i = setInterval(pollDisk, 60_000);
    return () => clearInterval(i);
  }, [serverId]);

  const handleAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setActing(true);
    try {
      if (action === "restart") {
        if (server?.status === "running") {
          const stopRes = await fetch(`${API_BASE}/api/servers/${serverId}/stop`, { method: "POST" });
          if (!stopRes.ok) throw new Error("Stop failed");
          await new Promise(r => setTimeout(r, 2000));
        }
        const startRes = await fetch(`${API_BASE}/api/servers/${serverId}/start`, { method: "POST" });
        if (!startRes.ok) throw new Error("Start failed");
      } else {
        const res = await fetch(`${API_BASE}/api/servers/${serverId}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error(`${action} failed`);
      }
      await fetchServer();
      toast.success(`Server ${action === "restart" ? "restarted" : action + "ed"} successfully`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    }
    finally { setActing(false); }
  }, [serverId, server, fetchServer]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try { await fetch(`${API_BASE}/api/servers/${serverId}`, { method: "DELETE" }); router.push("/"); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Delete failed"); setDeleting(false); setDeleteConfirm(false); }
  }, [serverId, router]);

  const handleBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/backup`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `backup-${serverId.slice(0,8)}.tar.gz`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Backup failed"); }
    finally { setBackingUp(false); }
  }, [serverId]);

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const handleRestore = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !serverId) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append("backup", file);
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/restore`, { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Backup restored! Server is restarting.");
      await fetchServer();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  }, [serverId, fetchServer]);

  return (
    <div className="flex min-h-screen">
      <ServerSidebar
        servers={allServers}
        activeId={serverId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onCreateClick={() => router.push("/")}
      />
      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-14" : "lg:ml-56"}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
          {loading ? (
            <DetailSkeleton />
          ) : error || !server ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-400">{error ?? "Server not found."}</p>
              <button onClick={() => router.push("/")} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700">
                Back to Dashboard
              </button>
            </div>
          ) : (
            <>
              <header className="mb-8">
                {/* Top row: name + actions */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3">
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white">{server.name}</h1>
                    <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${server.status === "running" ? "pulse-dot" : ""} ${statusColor(server.status)}`} />
                        {statusLabel(server.status)}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${server.serverType === "fabric" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : server.serverType === "velocity" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" : "bg-sky-500/10 text-sky-400 border-sky-500/20"}`}>
                        {typeLabel(server.serverType)}
                      </span>
                      <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3 text-slate-600" />{server.ram >= 1024 ? `${(server.ram / 1024).toFixed(1)} GB` : `${server.ram} MB`}</span>
                      <span>:{server.port}</span>
                      {diskUsage[server.id] != null && diskUsage[server.id] >= 0 && (
                        <span className="flex items-center gap-1"><HardDrive className="h-3 w-3 text-slate-600" />{formatDisk(diskUsage[server.id])}</span>
                      )}
                      {playerCount.online > 0 && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Users className="h-3 w-3" />
                          {playerCount.online}/{playerCount.max} online
                        </span>
                      )}
                    </div>
                    {server.status === "running" && playerList.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {playerList.slice(0, 8).map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[11px] text-emerald-400">
                            <span className="h-1 w-1 rounded-full bg-emerald-500" />{p.name}
                          </span>
                        ))}
                        {playerList.length > 8 && (
                          <span className="text-[11px] text-neutral-600 py-0.5">+{playerList.length - 8} more</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action buttons — grouped */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Power group */}
                    <div className="flex items-center rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
                      {server.status === "running" ? (
                        <>
                          <button disabled={acting} onClick={() => handleAction("restart")}
                            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50">
                            <RefreshCw className="h-3.5 w-3.5" />Restart
                          </button>
                          <span className="w-px h-4 bg-white/[0.06]" />
                          <button disabled={acting} onClick={() => handleAction("stop")}
                            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10 disabled:opacity-50">
                            <Square className="h-3.5 w-3.5" />Stop
                          </button>
                        </>
                      ) : (
                        <button disabled={acting} onClick={() => handleAction("start")}
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50">
                          <Play className="h-3.5 w-3.5" />Start
                        </button>
                      )}
                    </div>

                    {/* Management group */}
                    <div className="flex items-center rounded-lg border border-white/[0.04] p-0.5">
                      <button disabled={backingUp} onClick={handleBackup}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.03] hover:text-neutral-200 disabled:opacity-50">
                        {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {backingUp ? "Backup…" : "Backup"}
                      </button>
                      <label className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.03] hover:text-neutral-200 cursor-pointer ${restoring ? "opacity-50 pointer-events-none" : ""}`}>
                        <Upload className="h-3.5 w-3.5" />
                        {restoring ? "Restore…" : "Restore"}
                        <input ref={restoreInputRef} type="file" accept=".tar.gz,.tgz" onChange={handleRestore} className="hidden" />
                      </label>
                      <span className="w-px h-4 bg-white/[0.04]" />
                      <button onClick={() => setEditOpen(true)}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-neutral-400 transition hover:bg-white/[0.03] hover:text-neutral-200">
                        <Settings className="h-3.5 w-3.5" />Edit
                      </button>
                    </div>

                    {/* Delete */}
                    {deleteConfirm ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5">
                        <span className="text-xs text-red-400">Delete?</span>
                        <button onClick={handleDelete} disabled={deleting}
                          className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">{deleting?"…":"Yes"}</button>
                        <button onClick={()=>setDeleteConfirm(false)} disabled={deleting}
                          className="rounded bg-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-600">No</button>
                      </div>
                    ) : (
                      <button onClick={()=>setDeleteConfirm(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] px-2.5 py-1.5 text-xs text-neutral-600 transition hover:border-red-500/20 hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </header>

              <nav className="mb-6 flex gap-0.5 overflow-x-auto rounded-xl bg-white/[0.03] p-1 w-fit max-w-full border border-white/[0.04]">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={()=>setActiveTab(id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${activeTab===id?"bg-white/[0.08] text-white shadow-sm":"text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.02]"}`}><Icon className="h-4 w-4"/>{label}</button>
                ))}
              </nav>

              <section>
                <div className={`tab-content ${activeTab === "console" ? "" : "hidden"}`}><ConsoleTab serverId={serverId} serverStatus={server.status} /></div>
                <div className={`tab-content ${activeTab === "files" ? "" : "hidden"}`}><FileManagerTab serverId={serverId} /></div>
                <div className={`tab-content ${activeTab === "logs" ? "" : "hidden"}`}><LogsTab serverId={serverId} /></div>
                <div className={`tab-content ${activeTab === "settings" ? "" : "hidden"}`}><SettingsTab serverId={serverId} serverType={server.serverType} /></div>
              </section>
            </>
          )}
        </div>
      </main>
      <EditServerDialog open={editOpen} onClose={() => setEditOpen(false)} onUpdated={fetchServer} server={server} />
    </div>
  );
}
