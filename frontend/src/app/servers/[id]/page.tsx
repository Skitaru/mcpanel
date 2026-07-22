"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Terminal, FolderOpen, ScrollText, Settings2,
  Loader2, AlertTriangle, Trash2, Download, Play, Square, RefreshCw, Upload, HardDrive, MemoryStick, FileText,
} from "lucide-react";
import ConsoleTab from "@/components/ConsoleTab";
import FileManagerTab from "@/components/FileManagerTab";
import LogsTab from "@/components/LogsTab";
import EditServerDialog from "@/components/EditServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
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
  switch (s) { case "running": return "Online"; case "exited": return "Stopped"; case "created": return "Created"; default: return "Unknown"; }
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
  const [actionConfirm, setActionConfirm] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [modpackDialogOpen, setModpackDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});
  const [dockerLogs, setDockerLogs] = useState<{ loading: boolean; text: string | null }>({ loading: false, text: null });

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

  // Disk usage poll
  useEffect(() => {
    const pollDisk = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/servers/${serverId}/disk`);
        if (res.ok) { const d = await res.json(); if (d.bytes >= 0) setDiskUsage(prev => ({ ...prev, [serverId]: d.bytes })); }
      } catch {}
    };
    pollDisk(); const i = setInterval(pollDisk, 60_000); return () => clearInterval(i);
  }, [serverId]);

  const handleAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setActionConfirm(null); setActing(true);
    try {
      const r = await fetch(`${API_BASE}/api/servers/${serverId}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`${action} failed`);
      await fetchServer();
      toast.success(`Server ${action}ed`);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : `${action} failed`); }
    finally { setActing(false); }
  }, [serverId, fetchServer]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try { await fetch(`${API_BASE}/api/servers/${serverId}`, { method: "DELETE" }); router.push("/"); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Delete failed"); setDeleting(false); setDeleteConfirm(false); }
  }, [serverId, router]);

  const handleDockerLogs = useCallback(async () => {
    setDockerLogs({ loading: true, text: null });
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/logs?tail=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDockerLogs({ loading: false, text: data.logs || "(empty)" });
    } catch (err: unknown) {
      setDockerLogs({ loading: false, text: `Error: ${err instanceof Error ? err.message : "Failed"}` });
    }
  }, [serverId]);



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
    const file = e.target.files?.[0]; if (!file) return;
    setRestoring(true);
    try {
      const fd = new FormData(); fd.append("backup", file);
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/restore`, { method: "POST", body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      toast.success("Backup restored! Server is restarting."); await fetchServer();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Restore failed"); }
    finally { setRestoring(false); if (restoreInputRef.current) restoreInputRef.current.value = ""; }
  }, [serverId, fetchServer]);

  const ml = sidebarCollapsed ? "lg:ml-13" : "lg:ml-52";

  return (
    <div className="flex min-h-screen">
      <ServerSidebar servers={allServers} activeId={serverId} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCreateClick={() => router.push("/")} onInstallModpack={() => setModpackDialogOpen(true)} />
      <main className={`flex-1 transition-all duration-200 ${ml}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">

          {loading ? <DetailSkeleton /> : error || !server ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error ?? "Server not found."}</p>
              <button onClick={() => router.push("/")} className="rounded-lg border border-[#1a1f2e] px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.04]">Back to Dashboard</button>
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <h1 className="text-lg font-bold tracking-tight text-white truncate">{server.name}</h1>
                  <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusColor(server.status)} ${server.status === "running" ? "pulse-dot" : ""}`} />
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{statusLabel(server.status)}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    server.serverType === "fabric" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                    server.serverType === "velocity" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                    "bg-violet-500/10 text-violet-400 border-violet-500/20"
                  }`}>{typeLabel(server.serverType)}</span>
                  <span className="text-xs text-slate-600">{server.version}</span>
                  <span className="text-xs text-slate-600">:{server.port}</span>
                  {diskUsage[server.id] != null && diskUsage[server.id] >= 0 && (
                    <span className="flex items-center gap-1 text-xs text-slate-600"><HardDrive className="h-3 w-3" />{formatDisk(diskUsage[server.id])}</span>
                  )}
                </div>

                {/* Actions — single icon row */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {actionConfirm ? (
                    <div className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                      <span className="text-[11px] text-amber-400">{actionConfirm === "restart" ? "Restart?" : "Stop?"}</span>
                      <button onClick={() => handleAction(actionConfirm as "stop" | "restart")} disabled={acting} className="rounded bg-amber-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-50">{acting ? "…" : "Yes"}</button>
                      <button onClick={() => setActionConfirm(null)} disabled={acting} className="rounded bg-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-500">No</button>
                    </div>
                  ) : server.status === "running" ? (<>
                    <button disabled={acting} onClick={() => setActionConfirm("restart")} className="rounded-md p-1.5 text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50" title="Restart"><RefreshCw className="h-4 w-4" /></button>
                    <button disabled={acting} onClick={() => setActionConfirm("stop")} className="rounded-md p-1.5 text-red-400 transition hover:bg-red-500/10 disabled:opacity-50" title="Stop"><Square className="h-4 w-4" /></button>
                  </>) : (
                    <button disabled={acting} onClick={() => handleAction("start")} className="rounded-md p-1.5 text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50" title="Start"><Play className="h-4 w-4" /></button>
                  )}
                  <span className="w-px h-5 bg-[#1a1f2e] mx-1" />
                  <button disabled={backingUp} onClick={handleBackup} className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300 disabled:opacity-50" title="Download Backup">{backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}</button>
                  <label className={`rounded-md p-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300 cursor-pointer ${restoring ? "opacity-50 pointer-events-none" : ""}`} title="Restore Backup">
                    <Upload className="h-4 w-4" />
                    <input ref={restoreInputRef} type="file" accept=".tar.gz,.tgz" onChange={handleRestore} className="hidden" />
                  </label>
                  <button onClick={handleDockerLogs} disabled={dockerLogs.loading} className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-violet-400 disabled:opacity-50" title="Docker Logs">{dockerLogs.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}</button>
                  <span className="w-px h-5 bg-[#1a1f2e] mx-1" />
                  {deleteConfirm ? (
                    <div className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1">
                      <span className="text-[11px] text-red-400">Delete?</span>
                      <button onClick={handleDelete} disabled={deleting} className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-red-500 disabled:opacity-50">{deleting ? "…" : "Yes"}</button>
                      <button onClick={() => setDeleteConfirm(false)} disabled={deleting} className="rounded bg-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-500">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(true)} className="rounded-md p-1.5 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400" title="Delete Server"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>

              {/* ── Tabs ── */}
              <nav className="mb-6 flex gap-0 border-b border-[#1a1f2e]">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap ${
                      activeTab === id
                        ? "border-violet-500 text-violet-300"
                        : "border-transparent text-slate-600 hover:text-slate-400"
                    }`}>
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </nav>

              {/* ── Tab content ── */}
              <section>
                <div className={`tab-content ${activeTab === "console" ? "" : "hidden"}`}>
                  <ConsoleTab serverId={serverId} serverStatus={server.status} port={server.port} ram={server.ram} serverType={server.serverType} version={server.version} />
                </div>
                <div className={`tab-content ${activeTab === "files" ? "" : "hidden"}`}><FileManagerTab serverId={serverId} /></div>
                <div className={`tab-content ${activeTab === "logs" ? "" : "hidden"}`}><LogsTab serverId={serverId} /></div>
                <div className={`tab-content ${activeTab === "settings" ? "" : "hidden"}`}><SettingsTab serverId={serverId} serverType={server.serverType} /></div>
              </section>
            </>
          )}
        </div>
      </main>
      <EditServerDialog open={editOpen} onClose={() => setEditOpen(false)} onUpdated={fetchServer} server={server} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={fetchServer} />

      {/* ── Docker Logs Dialog ── */}
      {dockerLogs.text != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDockerLogs({ loading: false, text: null })}>
          <div className="surface w-full max-w-2xl max-h-[70vh] flex flex-col m-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#1a1f2e] px-5 py-3">
              <h3 className="text-sm font-semibold text-white">Docker Logs — {server?.name}</h3>
              <button onClick={() => setDockerLogs({ loading: false, text: null })} className="rounded-md p-1 text-slate-500 transition hover:text-slate-300">✕</button>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-xs font-mono leading-relaxed text-slate-400 bg-[#0a0c10] whitespace-pre-wrap break-all">{dockerLogs.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
