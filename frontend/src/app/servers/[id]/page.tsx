"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Terminal, FolderOpen, ScrollText, Settings2,
  Loader2, AlertTriangle, Trash2, Download, Play, Square, RefreshCw, Upload, FileText, ArrowLeft,
  Clock,
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

function formatRam(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb} MB`;
}

type Tab = "console" | "files" | "settings" | "logs";

const SUB_NAV_ITEMS: { id: Tab; label: string; icon: typeof Terminal }[] = [
  { id: "console", label: "Console", icon: Terminal },
  { id: "files", label: "File Manager", icon: FolderOpen },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "logs", label: "Activity Logs", icon: ScrollText },
];

function statusColor(s: ServerStatus["status"]) {
  switch (s) { case "running": return "bg-emerald-500"; case "exited": case "created": case "paused": return "bg-amber-500"; default: return "bg-slate-600"; }
}
function statusLabel(s: ServerStatus["status"]) {
  switch (s) { case "running": return "Active"; case "exited": return "Stopped"; case "created": return "Created"; default: return "Unknown"; }
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
  const [restartTick, setRestartTick] = useState(0);

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
      if (action === "restart") setRestartTick(t => t + 1);
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
  const hostname = typeof window !== "undefined" ? window.location.hostname : "84.234.99.121";

  return (
    <div className="flex min-h-screen bg-[#08080c] bg-obsidian-grid">
      <ServerSidebar servers={allServers} activeId={serverId} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCreateClick={() => router.push("/")} onInstallModpack={() => setModpackDialogOpen(true)} />

      <main className={`flex-1 transition-all duration-200 ${ml}`}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">

          {loading ? <DetailSkeleton /> : error || !server ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error ?? "Server not found."}</p>
              <button onClick={() => router.push("/")} className="rounded-lg border border-purple-500/20 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-purple-500/10">Back to Dashboard</button>
            </div>
          ) : (
            <>
              {/* ── Top Bar: Breadcrumb + Actions ── */}
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-slate-400 hover:text-purple-300 transition">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to servers
                  </button>
                  <span className="text-slate-600">/</span>
                  <span className="text-white font-bold text-sm tracking-tight">{server.name}</span>
                  <span className={`ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    server.status === "running" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusColor(server.status)} ${server.status === "running" ? "pulse-dot" : ""}`} />
                    {statusLabel(server.status)}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 bg-[#0e0d14] p-1.5 rounded-xl border border-purple-500/15 shadow-lg">
                  {actionConfirm ? (
                    <div className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                      <span className="text-[11px] font-medium text-amber-400">{actionConfirm === "restart" ? "Restart?" : "Stop?"}</span>
                      <button onClick={() => handleAction(actionConfirm as "stop" | "restart")} disabled={acting} className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-50">{acting ? "…" : "Yes"}</button>
                      <button onClick={() => setActionConfirm(null)} disabled={acting} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700">No</button>
                    </div>
                  ) : server.status === "running" ? (<>
                    <button disabled={acting} onClick={() => setActionConfirm("restart")} className="rounded-lg p-2 text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50" title="Restart"><RefreshCw className="h-4 w-4" /></button>
                    <button disabled={acting} onClick={() => setActionConfirm("stop")} className="rounded-lg p-2 text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50" title="Stop"><Square className="h-4 w-4" /></button>
                  </>) : (
                    <button disabled={acting} onClick={() => handleAction("start")} className="rounded-lg p-2 text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50" title="Start"><Play className="h-4 w-4" /></button>
                  )}
                  <span className="w-px h-4 bg-purple-500/20 mx-0.5" />
                  <button disabled={backingUp} onClick={handleBackup} className="rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300 disabled:opacity-50" title="Download Backup">{backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" strokeWidth={1.75} />}</button>
                  <label className={`rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300 cursor-pointer ${restoring ? "opacity-50 pointer-events-none" : ""}`} title="Restore Backup">
                    <Upload className="h-4 w-4" strokeWidth={1.75} />
                    <input ref={restoreInputRef} type="file" accept=".tar.gz,.tgz" onChange={handleRestore} className="hidden" />
                  </label>
                  <button onClick={handleDockerLogs} disabled={dockerLogs.loading} className="rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300 disabled:opacity-50" title="Docker Logs">{dockerLogs.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" strokeWidth={1.75} />}</button>
                  <button onClick={() => setEditOpen(true)} className="rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300" title="Edit Server"><Settings2 className="h-4 w-4" strokeWidth={1.75} /></button>
                  <span className="w-px h-4 bg-purple-500/20 mx-0.5" />
                  {deleteConfirm ? (
                    <div className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1">
                      <span className="text-[11px] text-rose-400">Delete?</span>
                      <button onClick={handleDelete} disabled={deleting} className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-rose-500 disabled:opacity-50">{deleting ? "…" : "Yes"}</button>
                      <button onClick={() => setDeleteConfirm(false)} disabled={deleting} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(true)} className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400" title="Delete Server"><Trash2 className="h-4 w-4" strokeWidth={1.75} /></button>
                  )}
                </div>
              </div>

              {/* ── 2-COLUMN WORKSPACE LAYOUT ── */}
              <div className="flex flex-col lg:flex-row gap-6">

                {/* ── LEFT SUB-SIDEBAR ── */}
                <div className="w-full lg:w-60 shrink-0 space-y-4">
                  {/* Server Details Card */}
                  <div className="surface p-4 space-y-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-purple-500/15 pb-2">
                      SERVER DETAILS
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Server Name</span>
                        <span className="font-semibold text-white tracking-tight">{server.name}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">IP & Port</span>
                        <span className="font-mono text-purple-300 font-medium block truncate">{hostname}:{server.port}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">Server Version</span>
                        <span className="font-mono text-slate-300">{typeLabel(server.serverType)} {server.version}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">Memory Alloc</span>
                        <span className="font-mono text-slate-300">{formatRam(server.ram)}</span>
                      </div>

                      {diskUsage[server.id] != null && diskUsage[server.id] >= 0 && (
                        <div>
                          <span className="text-slate-400 block text-[11px]">Disk Storage</span>
                          <span className="font-mono text-slate-300">{formatDisk(diskUsage[server.id])}</span>
                        </div>
                      )}

                      <div>
                        <span className="text-slate-400 block text-[11px]">Identifier</span>
                        <span className="font-mono text-slate-500 text-[11px] uppercase">{server.id.slice(0, 8)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Vertical Sub-Navigation */}
                  <div className="surface p-1.5 space-y-0.5">
                    {SUB_NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                      const active = activeTab === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setActiveTab(id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition font-medium ${
                            active
                              ? "bg-purple-600/20 text-purple-200 border-l-2 border-purple-500 font-semibold"
                              : "text-slate-400 hover:text-slate-200 hover:bg-purple-500/5 border-l-2 border-transparent"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Icon className={`h-4 w-4 ${active ? "text-purple-400" : "text-slate-500"}`} strokeWidth={1.75} />
                            <span>{label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── RIGHT MAIN VIEWPORT ── */}
                <div className="flex-1 min-w-0">
                  <div className={`tab-content ${activeTab === "console" ? "" : "hidden"}`}>
                    <ConsoleTab serverId={serverId} serverStatus={server.status} port={server.port} ram={server.ram} serverType={server.serverType} version={server.version} restartTick={restartTick} />
                  </div>

                  <div className={`tab-content ${activeTab === "files" ? "" : "hidden"}`}>
                    <FileManagerTab serverId={serverId} />
                  </div>

                  <div className={`tab-content ${activeTab === "settings" ? "" : "hidden"}`}>
                    <SettingsTab serverId={serverId} serverType={server.serverType} />
                  </div>

                  <div className={`tab-content ${activeTab === "logs" ? "" : "hidden"}`}>
                    <LogsTab serverId={serverId} />
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      </main>

      <EditServerDialog open={editOpen} onClose={() => setEditOpen(false)} onUpdated={fetchServer} server={server} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={fetchServer} />

      {/* ── Docker Logs Dialog ── */}
      {dockerLogs.text != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setDockerLogs({ loading: false, text: null })}>
          <div className="surface w-full max-w-2xl max-h-[70vh] flex flex-col m-4 border border-purple-500/20 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-purple-500/15 px-5 py-3.5 bg-[#0e0d14]">
              <h3 className="text-xs font-semibold text-white">Docker Logs — {server?.name}</h3>
              <button onClick={() => setDockerLogs({ loading: false, text: null })} className="rounded-md p-1 text-slate-400 transition hover:text-white">✕</button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-slate-400 bg-[#06050a] whitespace-pre-wrap break-all">{dockerLogs.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
