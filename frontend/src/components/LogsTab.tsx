"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Loader2, AlertTriangle, ScrollText, Search, Copy, Check } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const POLL_INTERVAL_MS = 5_000;

interface Props { serverId: string; }

export default function LogsTab({ serverId }: Props) {
  const [logContent, setLogContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/logs/latest.log")}`);
      if (res.status === 404) { await res.text(); setError("not_started"); setLogContent(null); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // eslint-disable-next-line no-control-regex
      const clean = data.content
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][0-9;]*[^\x07]*\x07/g, "")
        .replace(/\x1b/g, "");
      setLogContent(clean.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load logs.");
    } finally { setLoading(false); }
  }, [serverId]);

  useEffect(() => { fetchLogs(); const i = setInterval(fetchLogs, POLL_INTERVAL_MS); return () => clearInterval(i); }, [fetchLogs]);

  useEffect(() => { if (autoScrollRef.current && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight; }, [logContent]);

  const handleScroll = useCallback(() => {
    const el = preRef.current; if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  }, []);

  const handleCopy = useCallback(() => {
    if (!logContent) return;
    navigator.clipboard.writeText(logContent);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [logContent]);

  const filteredLines = search && logContent
    ? logContent.split("\n").filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1a1f2e] bg-[#0f1119] px-3 py-2">
        <ScrollText className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="text-xs text-slate-500">logs/latest.log</span>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-600" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] py-1 pl-7 pr-3 text-[11px] text-slate-200
                       placeholder:text-slate-600 focus:border-violet-500/40 focus:outline-none" />
          {search && filteredLines && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">{filteredLines.length} matches</span>
          )}
        </div>
        <button onClick={handleCopy} className="rounded-md p-1.5 text-slate-600 transition hover:bg-white/[0.04] hover:text-slate-400" title="Copy to clipboard">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => { setLoading(true); fetchLogs(); }}
          className="flex items-center gap-1 rounded-md border border-[#1a1f2e] px-2.5 py-1 text-[11px] text-slate-500 transition hover:border-[#252b3b] hover:text-slate-300">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />Refresh
        </button>
      </div>

      {/* Log viewer */}
      <div className="overflow-hidden rounded-xl border border-[#1a1f2e] bg-[#0f1119]">
        {loading && !logContent ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-600" /></div>
        ) : error && !logContent ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20">
            {error === "not_started" ? (<>
              <ScrollText className="h-8 w-8 text-slate-700" />
              <p className="text-sm text-slate-500">No logs yet</p>
              <p className="text-xs text-slate-600">Start the server to generate log files.</p>
            </>) : (<>
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <p className="text-sm text-slate-500">{error}</p>
            </>)}
          </div>
        ) : (
          <pre ref={preRef} onScroll={handleScroll}
            className="bg-[#0a0c10] p-4 font-mono text-[12.5px] leading-[1.75] text-slate-300 overflow-auto"
            style={{ height: "22rem" }}>
            {filteredLines ? filteredLines.join("\n") : logContent}
          </pre>
        )}
      </div>

      <p className="text-center text-[10px] text-slate-700">
        Auto-refreshes every 5 s — scroll up to pause auto-scroll
      </p>
    </div>
  );
}
