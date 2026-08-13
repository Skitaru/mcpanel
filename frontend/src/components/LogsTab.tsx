"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw, Loader2, AlertTriangle, ScrollText, Search, Copy, Check,
  Download, Trash2, FileText, FileArchive,
} from "lucide-react";
import toast from "react-hot-toast";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const LIST_POLL_MS = 10_000;   // file list (rotations are rare)
const CONTENT_POLL_MS = 5_000; // live content (latest.log only)

interface LogFile { name: string; size: number; isDirectory: boolean; }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props { serverId: string; }

export default function LogsTab({ serverId }: Props) {
  const [files, setFiles] = useState<LogFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const preRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // ---- file list ----
  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/files?path=${encodeURIComponent("/logs")}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LogFile[] = await res.json();
      const logFiles = data.filter((f) => !f.isDirectory);
      setFiles(logFiles);
      setError((prev) => (prev === "not_started" ? null : prev));
      // Auto-select the live log on first load.
      setSelected((prev) => {
        if (prev && logFiles.some((f) => f.name === prev)) return prev;
        return logFiles.some((f) => f.name === "latest.log") ? "latest.log" : null;
      });
    } catch {
      // keep last list; if we have nothing at all, show the empty state
      setFiles((prev) => {
        if (prev === null) setError("not_started");
        return prev;
      });
    }
  }, [serverId]);

  // ---- log content (per file; archives are decompressed by the backend) ----
  const fetchContent = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/log?file=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // eslint-disable-next-line no-control-regex
      setContent((data.content ?? "")
        .replace(/\x1b/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "")
        .split("\n")
        .filter((line: string) => !/(Thread RCON|RCON IO|RconClient)/.test(line))
        .join("\n"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load log.");
    } finally { setLoading(false); }
  }, [serverId]);

  // ---- effects ----
  useEffect(() => {
    fetchFiles();
    const i = setInterval(fetchFiles, LIST_POLL_MS);
    return () => clearInterval(i);
  }, [fetchFiles]);

  useEffect(() => {
    if (!selected) { setContent(null); setLoading(false); return; }
    fetchContent(selected);
    if (selected !== "latest.log") return; // archives are static — load once
    const i = setInterval(() => fetchContent(selected), CONTENT_POLL_MS);
    return () => clearInterval(i);
  }, [selected, fetchContent]);

  useEffect(() => {
    if (autoScrollRef.current && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [content]);

  const handleScroll = useCallback(() => {
    const el = preRef.current; if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  }, []);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const downloadFile = useCallback(async (name: string) => {
    setDownloading(name);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/logs/" + name)}&raw=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${name} heruntergeladen`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download fehlgeschlagen");
    } finally { setDownloading(null); }
  }, [serverId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/logs/" + deleteTarget)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setSelected((prev) => (prev === deleteTarget ? null : prev));
      await fetchFiles();
      toast.success(`${deleteTarget} gelöscht`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, serverId, fetchFiles]);

  const filteredLines = search && content
    ? content.split("\n").filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : null;

  const isLive = selected === "latest.log";

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
        <ScrollText className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="text-xs text-slate-500">logs/ ({files?.length ?? 0} Dateien)</span>
        <div className="relative flex-1 min-w-[120px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-600" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            className="w-full rounded-md border border-edge bg-void py-1 pl-7 pr-3 text-[11px] text-slate-200
                       placeholder:text-slate-600 focus:border-accent/40 focus:outline-none" />
          {search && filteredLines && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">{filteredLines.length} matches</span>
          )}
        </div>
        <button onClick={handleCopy} disabled={!content}
          className="rounded-md p-1.5 text-slate-600 transition hover:bg-accent/5 hover:text-slate-400 disabled:opacity-30"
          title="Copy to clipboard" aria-label="Copy to clipboard">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => { setLoading(true); fetchFiles(); if (selected) fetchContent(selected); }}
          className="flex items-center gap-1 rounded-md border border-edge px-2.5 py-1 text-[11px] text-slate-500 transition hover:border-accent/40 hover:text-slate-300">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />Refresh
        </button>
      </div>

      {/* File list — overview like the File Manager */}
      <div className="overflow-hidden rounded-xl border border-edge bg-surface">
        {files === null ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-600" /></div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8">
            <ScrollText className="h-7 w-7 text-muted" />
            <p className="text-sm text-slate-500">Noch keine Log-Dateien</p>
            <p className="text-xs text-slate-600">Start the server to generate log files.</p>
          </div>
        ) : (
          <div className="max-h-44 overflow-auto">
            {files.map((f) => {
              const isArchive = f.name.endsWith(".gz");
              const isActive = f.name === "latest.log";
              return (
                <div
                  key={f.name}
                  onClick={() => setSelected(f.name)}
                  className={`group flex cursor-pointer items-center gap-2 border-b border-edge/50 px-3 py-1.5 transition hover:bg-accent/5 ${
                    selected === f.name ? "bg-accent/10" : ""
                  }`}
                >
                  {isArchive
                    ? <FileArchive className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
                    : <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />}
                  <span className={`truncate font-mono text-[11.5px] ${selected === f.name ? "text-purple-200" : "text-slate-300"}`}>
                    {f.name}
                  </span>
                  {isActive && (
                    <span className="shrink-0 rounded bg-emerald-400/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-emerald-400/90">active</span>
                  )}
                  {isArchive && (
                    <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-400/80">archive</span>
                  )}
                  <span className="ml-auto shrink-0 text-[10px] text-muted">{formatSize(f.size)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadFile(f.name); }}
                    disabled={downloading !== null}
                    className="shrink-0 rounded p-1 text-muted transition hover:bg-accent/10 hover:text-slate-200 disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Download" aria-label={`Download ${f.name}`}
                  >
                    {downloading === f.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  </button>
                  {deleteTarget === f.name ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] text-red-400">Löschen?</span>
                      <button onClick={(e) => { e.stopPropagation(); confirmDelete(); }} disabled={deleting}
                        className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-danger/80">Ja</button>
                      <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(null); }}
                        className="rounded bg-edge px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-accent-deep">Nein</button>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(f.name); }}
                      disabled={isActive}
                      className="shrink-0 rounded p-1 text-muted transition hover:bg-danger/20 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-25 sm:opacity-0 sm:group-hover:opacity-100"
                      title={isActive ? "Active log — cannot be deleted" : "Delete"}
                      aria-label={`Delete ${f.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Log viewer for the selected file */}
      <div className="overflow-hidden rounded-xl border border-edge bg-surface">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
          {selected ? (
            <>
              <span className="truncate font-mono text-[11px] text-slate-400">{selected}</span>
              {isLive && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />live
                </span>
              )}
              {!isLive && <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-400/80">archive</span>}
            </>
          ) : (
            <span className="text-[11px] text-slate-600">Keine Datei ausgewählt</span>
          )}
        </div>
        {loading && !content ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-600" /></div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <AlertTriangle className="h-7 w-7 text-amber-500" />
            <p className="text-sm text-slate-500">{error}</p>
          </div>
        ) : content === null ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-16">
            <ScrollText className="h-7 w-7 text-muted" />
            <p className="text-sm text-slate-500">Wähle eine Log-Datei zum Anzeigen.</p>
          </div>
        ) : (
          <div ref={preRef} onScroll={handleScroll}
            className="overflow-auto bg-void p-4 font-mono text-[12.5px] leading-[1.75] text-slate-300 whitespace-pre-wrap"
            style={{ height: "calc(100vh - 24rem)", minHeight: "180px" }}>
            {(filteredLines ? filteredLines : content.split("\n")).map((line, i) => {
              const up = line.toUpperCase();
              const cls = up.includes("ERROR") || up.includes("EXCEPTION")
                ? "text-red-300 bg-danger/10 font-semibold"
                : up.includes("WARN")
                  ? "text-amber-300 bg-warn/5"
                  : "";
              return <div key={i} className={cls}>{line || " "}</div>;
            })}
          </div>
        )}
      </div>

      <p className="text-center text-[10px] text-muted">
        {isLive
          ? "Auto-refreshes every 5 s — scroll up to pause auto-scroll"
          : "latest.log wird live aktualisiert · Archive (gz) werden dekomprimiert angezeigt"}
      </p>
    </div>
  );
}
