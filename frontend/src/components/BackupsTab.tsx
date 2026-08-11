"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive, Download, Loader2, Plus, RotateCcw, Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { waitForBackupJob, type BackupJobProgress } from "@/lib/backup";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  kind: "manual" | "scheduled" | "auto";
}

function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const KIND_STYLES: Record<BackupInfo["kind"], { label: string; cls: string }> = {
  manual: { label: "Manual", cls: "bg-accent/10 text-violet-300 border-accent/20" },
  scheduled: { label: "Scheduled", cls: "bg-online/10 text-emerald-300 border-online/20" },
  auto: { label: "Auto", cls: "bg-warn/10 text-amber-300 border-warn/20" },
};

interface Props {
  serverId: string;
  serverName: string;
  /** Bumped by the detail page after creating a backup from the header button. */
  refreshTick: number;
}

export default function BackupsTab({ serverId, serverName, refreshTick }: Props) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<BackupJobProgress | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ name: string; percent: number } | null>(null);

  const fetchBackups = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/backups`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBackups(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backups.");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups, refreshTick]);

  useEffect(() => {
    const i = setInterval(fetchBackups, 30_000);
    return () => clearInterval(i);
  }, [fetchBackups]);

  const createBackup = useCallback(async () => {
    setCreating(true);
    setActiveJob(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/backup`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Backup failed");
      }
      const { jobId } = await res.json();
      const job = await waitForBackupJob(jobId, setActiveJob);
      if (job.status === "error") throw new Error(job.message ?? "Backup failed");
      toast.success("Backup created");
      await fetchBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setCreating(false);
      setActiveJob(null);
    }
  }, [serverId, fetchBackups]);

  const downloadBackup = useCallback(async (name: string) => {
    setDownloading(name);
    setDownloadProgress(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverId}/backups/${encodeURIComponent(name)}/download`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length") ?? 0);
      const reader = res.body?.getReader();

      if (!reader) {
        // No streaming body available — fall back to plain blob download.
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      // Stream the body so we can show a real download percentage.
      const chunks: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (total > 0) {
            setDownloadProgress({ name, percent: Math.round((received / total) * 100) });
          }
        }
      }
      const blob = new Blob(chunks, { type: "application/gzip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(null);
      setDownloadProgress(null);
    }
  }, [serverId]);

  const doRestore = useCallback(async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverId}/backups/${encodeURIComponent(restoreTarget.name)}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Restore failed");
      }
      toast.success("Backup restored — server restarted");
      setRestoreTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }, [serverId, restoreTarget]);

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverId}/backups/${encodeURIComponent(deleteTarget.name)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Backup deleted");
      setDeleteTarget(null);
      await fetchBackups();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [serverId, deleteTarget, fetchBackups]);

  return (
    <div className="rounded-xl border border-edge bg-surface">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
        <Archive className="h-4 w-4 text-violet-400" strokeWidth={1.75} />
        <h3 className="text-xs font-semibold text-white">Backups</h3>
        <span className="text-[10px] text-muted">{backups.length} gespeichert</span>
        <div className="flex-1" />
        <button
          onClick={createBackup}
          disabled={creating}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {creating ? "Backing up…" : "New Backup"}
        </button>
      </div>

      {/* Progress: active backup job */}
      {activeJob && activeJob.status === "running" && (
        <div className="border-b border-edge px-4 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-slate-400">Backing up… <span className="font-mono text-slate-500">{activeJob.name}</span></span>
            <span className="shrink-0 font-bold tabular-nums text-violet-300">{Math.max(0, activeJob.percent)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${Math.max(2, Math.min(100, activeJob.percent))}%` }}
            />
          </div>
        </div>
      )}

      {/* Progress: download */}
      {downloadProgress && (
        <div className="border-b border-edge px-4 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-slate-400">Downloading… <span className="font-mono text-slate-500">{downloadProgress.name}</span></span>
            <span className="shrink-0 font-bold tabular-nums text-emerald-300">{downloadProgress.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-online transition-all duration-300 ease-out"
              style={{ width: `${Math.max(2, Math.min(100, downloadProgress.percent))}%` }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={fetchBackups} className="text-[11px] text-violet-400 hover:underline">Retry</button>
        </div>
      ) : backups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Archive className="h-10 w-10 text-muted" />
          <p className="text-xs text-slate-500">No backups yet</p>
          <p className="text-[11px] text-muted">Create one to protect this server&apos;s world data.</p>
        </div>
      ) : (
        <ul className="divide-y divide-edge/60">
          {backups.map((b) => {
            const style = KIND_STYLES[b.kind];
            return (
              <li key={b.name} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${style.cls}`}>
                  {style.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-slate-300" title={b.name}>{b.name}</p>
                  <p className="text-[10px] text-muted">{formatDate(b.createdAt)} · {formatSize(b.size)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => downloadBackup(b.name)}
                    disabled={downloading === b.name}
                    className="rounded p-1.5 text-slate-500 transition hover:bg-accent/10 hover:text-violet-300 disabled:opacity-40"
                    title="Download" aria-label="Download backup"
                  >
                    {downloading === b.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => setRestoreTarget(b)}
                    className="rounded p-1.5 text-slate-500 transition hover:bg-online/10 hover:text-emerald-300"
                    title="Restore" aria-label="Restore backup"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(b)}
                    className="rounded p-1.5 text-slate-500 transition hover:bg-danger/10 hover:text-danger"
                    title="Delete" aria-label="Delete backup"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Restore confirm modal ── */}
      {restoreTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => !restoring && setRestoreTarget(null)}
        >
          <div className="surface m-4 w-full max-w-sm border border-edge p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1.5 text-sm font-semibold text-white">Restore backup?</h3>
            <p className="text-xs leading-relaxed text-slate-400">
              The current world data of <span className="text-white">{serverName}</span> will be{" "}
              <span className="font-medium text-amber-400">overwritten</span> by
              <span className="font-mono text-slate-300"> {restoreTarget.name}</span> and the server restarts.
              A safety backup of the current state is created automatically first.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setRestoreTarget(null)}
                disabled={restoring}
                className="rounded-md bg-edge px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-accent-deep disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doRestore}
                disabled={restoring}
                className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:bg-danger/80 disabled:opacity-50"
              >
                {restoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                {restoring ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div className="surface m-4 w-full max-w-sm border border-edge p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1.5 text-sm font-semibold text-white">Delete backup?</h3>
            <p className="text-xs leading-relaxed text-slate-400">
              <span className="font-mono text-slate-300">{deleteTarget.name}</span> will be permanently removed.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-md bg-edge px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-accent-deep disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:bg-danger/80 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
