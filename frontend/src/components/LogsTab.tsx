"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Loader2, AlertTriangle, ScrollText, Search } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

const POLL_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  serverId: string;
}

export default function LogsTab({ serverId }: Props) {
  const [logContent, setLogContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const preRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);

  // ---- fetch latest.log ----

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/logs/latest.log")}`,
      );
      if (res.status === 404) {
        setError("not_started");
        setLogContent(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLogContent(data.content);
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load logs.",
      );
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Scroll to bottom when content changes (if auto-scroll is on)
  useEffect(() => {
    if (autoScrollRef.current && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logContent]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = preRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    autoScrollRef.current = atBottom;
  }, []);

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl border
                    border-slate-800 bg-slate-900/70 px-5 py-3"
      >
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <ScrollText className="h-4 w-4" />
          <span>logs/latest.log</span>
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-1.5
                       pl-8 pr-3 text-xs text-slate-200
                       placeholder:text-slate-600
                       focus:border-sky-500/50 focus:outline-none"
          />
          {search && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              {logContent
                ? logContent.split("\n").filter((l) =>
                    l.toLowerCase().includes(search.toLowerCase())
                  ).length
                : 0} matches
            </span>
          )}
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchLogs();
          }}
          className="flex items-center gap-1.5 rounded-lg border
                     border-slate-800 px-3 py-1.5 text-xs text-slate-400
                     transition hover:border-slate-700 hover:text-slate-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Log viewer */}
      <div
        className="overflow-hidden rounded-xl border border-slate-800
                    bg-slate-950"
      >
        {loading && !logContent ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
          </div>
        ) : error && !logContent ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20">
            {error === "not_started" ? (
              <>
                <ScrollText className="h-8 w-8 text-slate-700" />
                <p className="text-sm text-slate-500">No logs yet</p>
                <p className="text-xs text-slate-600">Start the server to generate log files.</p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <p className="text-sm text-slate-500">{error}</p>
              </>
            )}
          </div>
        ) : (
          <pre
            ref={preRef}
            onScroll={handleScroll}
            className="h-56 overflow-auto p-4 font-mono text-xs
                       leading-relaxed text-slate-300 selection:bg-sky-500/30"
          >
            {search && logContent
              ? logContent
                  .split("\n")
                  .filter((line) =>
                    line.toLowerCase().includes(search.toLowerCase())
                  )
                  .join("\n")
              : logContent}
          </pre>
        )}
      </div>

      <p className="text-center text-xs text-slate-600">
        Auto-refreshes every 5 s — scroll up to pause auto-scroll
      </p>
    </div>
  );
}
