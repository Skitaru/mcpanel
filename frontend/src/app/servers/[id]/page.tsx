"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Terminal, FolderOpen, ScrollText, Settings2, Archive, CalendarClock,
  Loader2, AlertTriangle, Trash2, Play, Square, Upload, ArrowLeft, RefreshCw,
} from "lucide-react";
import ConsoleTab from "@/components/ConsoleTab";
import FileManagerTab from "@/components/FileManagerTab";
import LogsTab from "@/components/LogsTab";
import BackupsTab from "@/components/BackupsTab";
import ScheduleCard from "@/components/ScheduleCard";
import EditServerDialog from "@/components/EditServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
import TopBar from "@/components/TopBar";
import AddressPill from "@/components/AddressPill";
import { DetailSkeleton } from "@/components/Skeleton";
import { statusColor, statusLabel, tagStyle, typeLabel, formatRam, formatUptime, formatBytes } from "@/lib/format";
import { waitForBackupJob } from "@/lib/backup";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type Tab = "console" | "files" | "logs" | "backups" | "schedule";

const SUB_NAV_ITEMS: { id: Tab; label: string; icon: typeof Terminal }[] = [
  { id: "console", label: "Console", icon: Terminal },
  { id: "files", label: "File Manager", icon: FolderOpen },
  { id: "logs", label: "Server Logs", icon: ScrollText },
  { id: "backups", label: "Backups", icon: Archive },
  { id: "schedule", label: "Schedule", icon: CalendarClock },
];

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const [server, setServer] = useState<ServerStatus | null>(null);
  const [allServers, setAllServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("console");
  // URL sync: ?tab=files|logs|backups|schedule survives refresh & deep-linking (after mount to avoid SSR hydration mismatch)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "files" || t === "logs" || t === "backups" || t === "schedule") setActiveTab(t);
  }, []);
  const setTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (tab === "console") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);
  const [acting, setActing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionConfirm, setActionConfirm] = useState<string | null>(null);
  const [recreateConfirm, setRecreateConfirm] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [modpackDialogOpen, setModpackDialogOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupPercent, setBackupPercent] = useState<number | null>(null);
  const [backupsRefreshTick, setBackupsRefreshTick] = useState(0);
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

  const handleRecreate = useCallback(async () => {
    setRecreateConfirm(false); setRecreating(true);
    try {
      const r = await fetch(`${API_BASE}/api/servers/${serverId}/recreate`, { method: "POST" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "recreate failed"); }
      // Container is brand new → force console detach/reattach like a restart
      setRestartTick(t => t + 1);
      await fetchServer();
      toast.success("Container recreated — data kept");
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Recreate failed"); }
    finally { setRecreating(false); }
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
    setBackupPercent(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/backup`, { method: "POST" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      const { jobId } = await res.json();
      if (jobId) {
        const job = await waitForBackupJob(jobId, (j) => {
          if (j.percent >= 0) setBackupPercent(j.percent);
        });
        if (job.status === "error") throw new Error(job.message ?? "Backup failed");
      }
      toast.success("Backup created");
      // Let the Backups tab refresh its list.
      setBackupsRefreshTick(t => t + 1);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Backup failed"); }
    finally { setBackingUp(false); setBackupPercent(null); }
  }, [serverId]);

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<File | null>(null);
  const handleRestoreSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setRestoreConfirm(file);
  }, []);
  const handleRestore = useCallback(async () => {
    const file = restoreConfirm;
    setRestoreConfirm(null);
    if (!file) return;
    setRestoring(true);
    try {
      const fd = new FormData(); fd.append("backup", file);
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/restore`, { method: "POST", body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      toast.success("Backup restored! Server is restarting."); await fetchServer();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Restore failed"); }
    finally { setRestoring(false); if (restoreInputRef.current) restoreInputRef.current.value = ""; }
  }, [serverId, fetchServer, restoreConfirm]);

  // ---- keyboard shortcuts: 1-3 switch tabs (skip when typing) ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.key === "1") setTab("console");
      else if (e.key === "2") setTab("files");
      else if (e.key === "3") setTab("logs");
      else if (e.key === "4") setTab("backups");
      else if (e.key === "5") setTab("schedule");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setTab]);

  return (
    <div className="min-h-screen">
      <TopBar servers={allServers} activeId={serverId} onInstallModpack={() => setModpackDialogOpen(true)} />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">

          {loading ? <DetailSkeleton /> : error || !server ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error ?? "Server not found."}</p>
              <button onClick={() => router.push("/")} className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-accent/10">Back to Dashboard</button>
            </div>
          ) : (
            <>
              {/* ── Breadcrumb ── */}
              <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-muted transition hover:text-purple-300 text-xs">
                  <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
                </button>
                <span className="text-edge">/</span>
                <h1 className="font-display font-bold text-xl text-white tracking-tight">{server.name}</h1>
                <span key={server.status} className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider animate-in ${
                  server.status === "running" ? "bg-online/10 text-emerald-400 border border-online/20" : "bg-warn/10 text-amber-400 border border-warn/20"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusColor(server.status)} ${server.status === "running" ? "pulse-dot" : ""}`} />
                  {statusLabel(server.status)}
                </span>
              </div>

              {/* ── Key info chips ── */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] text-muted">
                  Adresse
                  <AddressPill hostname={typeof window !== "undefined" ? window.location.hostname : "188.214.30.159"} port={server.port} />
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] text-muted">
                  Typ <b className="text-slate-200">{typeLabel(server.serverType)}</b>
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] text-muted">
                  Version <b className="font-mono text-slate-200">{server.version}</b>
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] text-muted">
                  RAM <b className="text-slate-200">{formatRam(server.ram)}</b>
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] text-muted">
                  Uptime <b className="text-slate-200">{formatUptime(server.startedAt) ?? "—"}</b>
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[11px] text-muted">
                  Disk <b className="text-slate-200">{diskUsage[server.id] ? formatBytes(diskUsage[server.id]) : "—"}</b>
                </span>
                {server.tag && (
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tagStyle(server.tag)}`}>
                    {server.tag}
                  </span>
                )}
              </div>

              {/* ── Power buttons (large, Pterodactyl-style) ── */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                {server.status === "running" ? (
                  <>
                    {actionConfirm === "stop" ? (
                      <div className="flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
                        <span className="text-xs font-bold text-danger">Stop?</span>
                        <button onClick={() => handleAction("stop")} disabled={acting} className="rounded bg-danger px-2 py-0.5 text-xs font-bold text-white disabled:opacity-50">{acting ? "…" : "Yes"}</button>
                        <button onClick={() => setActionConfirm(null)} disabled={acting} className="rounded bg-edge px-2 py-0.5 text-xs text-slate-300">No</button>
                      </div>
                    ) : (
                      <button disabled={acting} onClick={() => setActionConfirm("stop")}
                        className="rounded-xl border border-danger/30 bg-danger/10 px-5 py-2.5 text-[13px] font-bold text-danger transition hover:bg-danger/20 disabled:opacity-50">■ Stop</button>
                    )}
                    {actionConfirm === "restart" ? (
                      <div className="flex items-center gap-1.5 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
                        <span className="text-xs font-bold text-warn">Restart?</span>
                        <button onClick={() => handleAction("restart")} disabled={acting} className="rounded bg-warn px-2 py-0.5 text-xs font-bold text-black disabled:opacity-50">{acting ? "…" : "Yes"}</button>
                        <button onClick={() => setActionConfirm(null)} disabled={acting} className="rounded bg-edge px-2 py-0.5 text-xs text-slate-300">No</button>
                      </div>
                    ) : (
                      <button disabled={acting} onClick={() => setActionConfirm("restart")}
                        className="rounded-xl border border-warn/30 bg-warn/10 px-5 py-2.5 text-[13px] font-bold text-warn transition hover:bg-warn/20 disabled:opacity-50">↻ Restart</button>
                    )}
                  </>
                ) : (
                  <button disabled={acting} onClick={() => handleAction("start")}
                    className="rounded-xl border border-online/30 bg-online/10 px-6 py-2.5 text-[13px] font-bold text-online transition hover:bg-online/20 disabled:opacity-50">▶ Start</button>
                )}

                <button disabled={backingUp} onClick={handleBackup} title="Create a backup (see Backups tab)"
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-accent-strong disabled:opacity-50">
                  {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" strokeWidth={2} />}
                  {backingUp ? (backupPercent != null ? `Backup ${backupPercent}%` : "Backing up…") : "Backup"}
                </button>
                <label className={`flex items-center gap-1.5 rounded-xl border border-edge bg-surface px-4 py-2.5 text-[13px] font-bold text-muted transition hover:border-accent/40 hover:text-purple-200 cursor-pointer ${restoring ? "opacity-50 pointer-events-none" : ""}`} title="Restore Backup" aria-label="Restore Backup">
                  <Upload className="h-4 w-4" strokeWidth={1.75} /> Restore
                  <input ref={restoreInputRef} type="file" accept=".tar.gz,.tgz" onChange={handleRestoreSelect} className="hidden" />
                </label>

                {recreateConfirm ? (
                  <div className="flex items-center gap-1.5 rounded-xl border border-edge bg-surface px-3 py-2.5">
                    <span className="text-xs font-bold text-muted">Recreate?</span>
                    <button onClick={handleRecreate} disabled={recreating} className="rounded bg-accent px-2 py-0.5 text-xs font-bold text-white disabled:opacity-50">{recreating ? "…" : "Yes"}</button>
                    <button onClick={() => setRecreateConfirm(false)} disabled={recreating} className="rounded bg-edge px-2 py-0.5 text-xs text-slate-300">No</button>
                  </div>
                ) : (
                  <button onClick={() => setRecreateConfirm(true)} disabled={recreating}
                    title="Rebuild container, keep data (applies non-root user, RCON binding, TERM fixes)"
                    aria-label="Recreate container"
                    className="flex items-center gap-1.5 rounded-xl border border-edge bg-surface px-4 py-2.5 text-[13px] font-bold text-muted transition hover:border-accent/40 hover:text-purple-200 disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${recreating ? "animate-spin" : ""}`} strokeWidth={1.75} /> Recreate
                  </button>
                )}

                <div className="flex-1" />

                <button onClick={handleDockerLogs} disabled={dockerLogs.loading}
                  className="flex items-center gap-1.5 rounded-xl border border-edge bg-surface px-4 py-2.5 text-[13px] font-bold text-muted transition hover:border-accent/40 hover:text-purple-200 disabled:opacity-50">
                  {dockerLogs.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" strokeWidth={1.75} />} Logs
                </button>
                <button onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-edge bg-surface px-4 py-2.5 text-[13px] font-bold text-muted transition hover:border-accent/40 hover:text-purple-200">
                  <Settings2 className="h-4 w-4" strokeWidth={1.75} /> Edit
                </button>
                {deleteConfirm ? (
                  deleting ? (
                    <div className="flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-danger" />
                      <span className="text-xs font-semibold text-danger">Löschen…</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
                      <span className="text-xs font-bold text-danger">Delete?</span>
                      <button onClick={handleDelete} disabled={deleting} className="rounded bg-danger px-2 py-0.5 text-xs font-bold text-white disabled:opacity-50">{deleting ? "…" : "Yes"}</button>
                      <button onClick={() => setDeleteConfirm(false)} disabled={deleting} className="rounded bg-edge px-2 py-0.5 text-xs text-slate-300">No</button>
                    </div>
                  )
                ) : (
                  <button onClick={() => setDeleteConfirm(true)}
                    className="rounded-xl border border-edge bg-surface px-4 py-2.5 text-[13px] font-bold text-muted transition hover:border-danger/40 hover:text-danger">
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                )}
              </div>

              {/* ── Tabs (horizontal, one navigation level) ── */}
              <div className="mb-5 flex gap-1 overflow-x-auto border-b border-edge">
                {SUB_NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[13px] font-semibold transition ${
                        active ? "border-accent text-purple-200" : "border-transparent text-muted hover:text-slate-200"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${active ? "text-purple-400" : "text-slate-500"}`} strokeWidth={1.75} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* ── Viewport (ConsoleTab renders its own 2-column layout) ── */}
              <div className={`tab-content ${activeTab === "console" ? "" : "hidden"}`}>
                <ConsoleTab serverId={serverId} serverStatus={server.status} port={server.port} ram={server.ram} serverType={server.serverType} version={server.version} startedAt={server.startedAt} restartTick={restartTick} diskUsage={diskUsage[server.id]} />
              </div>

              <div className={`tab-content ${activeTab === "files" ? "" : "hidden"}`}>
                <FileManagerTab serverId={serverId} />
              </div>

              <div className={`tab-content ${activeTab === "logs" ? "" : "hidden"}`}>
                <LogsTab serverId={serverId} />
              </div>

              <div className={`tab-content ${activeTab === "backups" ? "" : "hidden"}`}>
                <BackupsTab serverId={serverId} serverName={server.name} refreshTick={backupsRefreshTick} />
              </div>

              <div className={`tab-content ${activeTab === "schedule" ? "" : "hidden"}`}>
                <ScheduleCard serverId={serverId} />
              </div>
            </>
          )}
      </main>

      <EditServerDialog open={editOpen} onClose={() => setEditOpen(false)} onUpdated={fetchServer} server={server} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={fetchServer} />

      {/* ── Restore confirmation ── */}
      {restoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setRestoreConfirm(null)}>
          <div className="surface w-full max-w-sm m-4 border border-edge p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1.5">Restore backup?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              The current world data of <span className="text-white">{server?.name}</span> will be
              <span className="text-amber-400 font-medium"> overwritten</span> by the backup and the server restarts.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setRestoreConfirm(null)} disabled={restoring}
                className="rounded-md bg-edge px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-accent-deep disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleRestore} disabled={restoring}
                className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:bg-danger/80 disabled:opacity-50">
                {restoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {restoring ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Docker Logs Dialog ── */}
      {dockerLogs.text != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setDockerLogs({ loading: false, text: null })}>
          <div className="surface w-full max-w-2xl max-h-[70vh] flex flex-col m-4 border border-edge shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-edge px-5 py-3.5 bg-surface">
              <h3 className="text-xs font-semibold text-white">Docker Logs — {server?.name}</h3>
              <button onClick={() => setDockerLogs({ loading: false, text: null })} className="rounded-md p-1 text-slate-400 transition hover:text-white">✕</button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-slate-400 bg-[#000000] whitespace-pre-wrap break-all">{dockerLogs.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
