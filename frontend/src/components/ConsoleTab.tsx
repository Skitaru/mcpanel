"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  TerminalSquare, Users, Search, X,
} from "lucide-react";
import AddressPill from "@/components/AddressPill";
import QuickCommands from "@/components/QuickCommands";
import PlayerCard from "@/components/PlayerCard";
import { formatBytes, formatRam, typeLabel } from "@/lib/format";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const MAX_LINES = 2000;

/** Common Minecraft server commands for console tab-completion. */
const MC_COMMANDS = [
  "stop", "restart", "say", "tell", "msg", "tp", "teleport", "op", "deop",
  "whitelist", "list", "save-all", "save-on", "save-off", "kick", "ban",
  "ban-ip", "pardon", "pardon-ip", "banlist", "plugins", "pl", "version",
  "ver", "seed", "difficulty", "gamemode", "gamerule", "time", "weather",
  "give", "clear", "effect", "summon", "kill", "spawnpoint", "setworldspawn",
  "worldborder", "reload", "help", "?",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConsoleLine {
  type: "stdout" | "stderr" | "system";
  text: string;
  time: number; // ms timestamp
}

interface StatsPayload {
  cpuPercent: number;
  memoryUsage: number; // bytes
  memoryLimit: number; // bytes
}

interface Props {
  serverId: string;
  serverStatus: "running" | "exited" | "created" | "paused" | "unknown";
  port: number;
  ram: number; // MB
  serverType: string;
  version: string;
  /** Docker container start timestamp (ISO) — base for real server uptime. */
  startedAt?: string | null;
  /** Incremented by parent on restart — triggers explicit detach + reattach. */
  restartTick?: number;
  /** Current disk usage in bytes (polled by the detail page). */
  diskUsage?: number;
}

// ---------------------------------------------------------------------------
// Helpers (local — component-specific signatures)
// ---------------------------------------------------------------------------

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function formatUptime(seconds: number) {
  if (seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConsoleTab({
  serverId, serverStatus, port, ram, serverType, version, startedAt, restartTick, diskUsage,
}: Props) {
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const serverStatusRef = useRef(serverStatus);
  serverStatusRef.current = serverStatus;
  /** Set by console:detached handler; cleared when we successfully re-attach. */
  const reattachPendingRef = useRef(false);

  const [lines, setLines] = useState<ConsoleLine[]>([{
    type: "system", text: "Connecting to server console…", time: Date.now(),
  }]);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [tps, setTps] = useState<{ tps5s: number; tps1m: number; tps5m: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`obsidian_cmds_${serverId}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [upSeconds, setUpSeconds] = useState(-1);
  const uptimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playerCount, setPlayerCount] = useState<{ online: number; max: number }>({ online: 0, max: 0 });
  const [playerList, setPlayerList] = useState<{ name: string; id: string }[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggIdx, setSuggIdx] = useState(-1);
  // Console filter: free text + output level
  const [filter, setFilter] = useState<{ text: string; level: "all" | "stderr" | "system" }>({ text: "", level: "all" });

  // ---- filtered view (keeps raw lines intact for re-filtering) ----
  const visibleLines = useMemo(() => {
    if (!filter.text && filter.level === "all") return lines;
    const q = filter.text.trim().toLowerCase();
    return lines.filter((l) => {
      if (filter.level !== "all" && l.type !== filter.level) return false;
      if (q && !l.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, filter.text, filter.level]);

  // ---- auto-scroll ----
  const autoScrollRef = useRef(true);
  const handleOutputScroll = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    // If user scrolled up, stop auto-scrolling.  Resume when they scroll
    // back to the bottom (within 40 px).
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [visibleLines]);

  // ---- add a line (capped) ----
  const addLine = useCallback((type: ConsoleLine["type"], text: string) => {
    setLines((prev) => {
      const next = [...prev, { type, text, time: Date.now() }];
      if (next.length > MAX_LINES) return next.slice(next.length - MAX_LINES);
      return next;
    });
  }, []);

  // ---- uptime tracking (real container uptime from docker startedAt) ----
  useEffect(() => {
    const startMs = startedAt ? new Date(startedAt).getTime() : null;
    if (serverStatus === "running" && startMs != null && !Number.isNaN(startMs)) {
      setUpSeconds(Math.floor((Date.now() - startMs) / 1000));
      uptimeIntervalRef.current = setInterval(() => {
        setUpSeconds(Math.floor((Date.now() - startMs) / 1000));
      }, 1000);
    } else {
      setUpSeconds(-1);
      if (uptimeIntervalRef.current) {
        clearInterval(uptimeIntervalRef.current);
        uptimeIntervalRef.current = null;
      }
    }
    return () => {
      if (uptimeIntervalRef.current) clearInterval(uptimeIntervalRef.current);
    };
  }, [serverStatus, startedAt]);

  // ---- persist command history to localStorage (capped at 100) ----
  const MAX_CMD_HISTORY = 100;
  useEffect(() => {
    if (cmdHistory.length === 0) return;
    const capped = cmdHistory.slice(-MAX_CMD_HISTORY);
    try { localStorage.setItem(`obsidian_cmds_${serverId}`, JSON.stringify(capped)); } catch {}
  }, [cmdHistory, serverId]);

  // ---- player polling (15 s) ----
  useEffect(() => {
    if (serverStatus !== "running") {
      setPlayerCount({ online: 0, max: 0 });
      setPlayerList([]);
      return;
    }
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
    const i = setInterval(poll, 15_000);
    return () => clearInterval(i);
  }, [serverId, serverStatus]);

  // ---- socket connection ----
  useEffect(() => {
    let cancelled = false;

    const token = typeof window !== "undefined" ? localStorage.getItem("obsidian-token") : null;
    const socket = io(API_BASE, { transports: ["polling"], auth: { token } });
    socketRef.current = socket;

    socket.on("connect", () => {
      if (cancelled) return;
      setConnected(true);
      setError(null);
      setLines((prev) => {
        const filtered = prev.filter((l) => l.type !== "system" || !l.text.includes("Connecting"));
        return [...filtered, { type: "system", text: "Connected to server console.", time: Date.now() }];
      });
      socket.emit("console:attach", { serverId });
      socket.emit("stats:subscribe", { serverId });
      socket.emit("tps:subscribe", { serverId });
      socket.emit("players:subscribe", { serverId });
    });

    socket.on("disconnect", () => {
      if (cancelled) return;
      setConnected(false);
      addLine("system", "Disconnected from server.");
    });

    socket.on("console:detached", (payload: { serverId: string }) => {
      if (cancelled || payload.serverId !== serverId) return;
      addLine("system", "Console connection lost — will reconnect when server is ready.");
      reattachPendingRef.current = true;
    });

    socket.on("connect_error", (err: Error) => {
      if (cancelled) return;
      setError(err.message);
      addLine("system", `Connection error: ${err.message}`);
    });

    // ---- console output ----
    socket.on(
      "console:output",
      (payload: { serverId: string; data: string; stream: "stdout" | "stderr" }) => {
        if (payload.serverId !== serverId) return;
        // Strip ESC, normalize newlines, split (matches Modpack_Server approach)
        // eslint-disable-next-line no-control-regex
        const text = payload.data.replace(/\x1b/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "");
        const lines = text.split("\n")
          .filter((l: string) => l.trim() && !l.includes("Thread RCON Client"));
        for (const line of lines) {
          addLine(payload.stream, line);
        }
      },
    );

    // ---- stats ----
    socket.on("stats:data", (payload: StatsPayload & { serverId: string }) => {
      if (payload.serverId !== serverId) return;
      setStats({
        cpuPercent: payload.cpuPercent,
        memoryUsage: payload.memoryUsage,
        memoryLimit: payload.memoryLimit,
      });
    });

    socket.on("stats:error", (payload: { serverId: string; message: string }) => {
      if (payload.serverId !== serverId) return;
      // Stats stream error — will retry on next status transition
      addLine("system", `Stats stream error: ${payload.message}`);
    });

    // ---- tps ----
    socket.on("tps:data", (payload: { serverId: string; tps5s: number; tps1m: number; tps5m: number }) => {
      if (payload.serverId !== serverId) return;
      setTps({ tps5s: payload.tps5s, tps1m: payload.tps1m, tps5m: payload.tps5m });
    });

    // ---- players (live join/leave via RCON poll) ----
    socket.on("players:data", (payload: { serverId: string; online: number; max: number; players: { name: string; id: string }[] }) => {
      if (payload.serverId !== serverId) return;
      setPlayerCount({ online: payload.online, max: payload.max });
      setPlayerList(payload.players ?? []);
    });

    socket.on("players:error", (payload: { serverId: string; message: string }) => {
      if (payload.serverId !== serverId) return;
      console.warn(`[panel] players error: ${payload.message}`);
    });

    // ---- load log history ----
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/logs/latest.log")}&raw=true`,
        );
        if (res.ok && res.status !== 204 && !cancelled) {
          const text = await res.text();
          if (text) {
            // eslint-disable-next-line no-control-regex
            const cleaned = text.replace(/\x1b/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "");
            const lines = cleaned.split("\n")
              .filter((l: string) => l.trim() && !l.includes("Thread RCON Client"));
            setLines(lines.map((text: string) => ({
              type: "stdout" as const,
              text,
              time: Date.now(),
            })));
          }
        }
      } catch { /* log not available — that's fine */ }
    })();

    return () => {
      cancelled = true;
      socket.emit("console:detach", { serverId });
      socket.emit("stats:unsubscribe", { serverId });
      socket.emit("tps:unsubscribe", { serverId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- explicit restart trigger (from parent) — force detach + flag reattach ----
  useEffect(() => {
    if (restartTick === undefined || restartTick === 0) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;
    addLine("system", "Server is restarting…");
    socket.emit("console:detach", { serverId });
    socket.emit("stats:unsubscribe", { serverId });
    socket.emit("tps:unsubscribe", { serverId });
    setStats(null);
    setTps(null);
    reattachPendingRef.current = true;
  }, [restartTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- re-attach on status change ----
  const prevStatusRef = useRef(serverStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = serverStatus;
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (serverStatus === "running") {
      const shouldAttach = prev !== "running" || reattachPendingRef.current;
      reattachPendingRef.current = false;
      if (shouldAttach) {
        addLine("system", "Server started.");
        socket.emit("console:attach", { serverId });
        socket.emit("stats:subscribe", { serverId });
        socket.emit("tps:subscribe", { serverId });
      }
    } else if (prev === "running") {
      addLine("system", "Server stopped.");
      socket.emit("console:detach", { serverId });
      socket.emit("stats:unsubscribe", { serverId });
      socket.emit("tps:unsubscribe", { serverId });
      setStats(null);
      setTps(null);
    }
  }, [serverStatus, serverId, addLine, restartTick]);

  // ---- send command ----
  const sendCommand = useCallback(() => {
    const input = inputRef.current;
    const socket = socketRef.current;
    if (!input || !socket?.connected) return;
    const cmd = input.value.trim();
    if (!cmd) return;
    socket.emit("console:input", { serverId, command: cmd });
    setCmdHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setSuggestions([]);
    setSuggIdx(-1);
    input.value = "";
  }, [serverId]);

  // ---- tab-completion (MC commands + online player names) ----
  const updateSuggestions = useCallback((value: string) => {
    const parts = value.split(/\s+/);
    const last = parts[parts.length - 1] ?? "";
    let list: string[] = [];
    if (last.startsWith("/") && parts.length === 1) {
      list = MC_COMMANDS.filter((c) => c.startsWith(last.slice(1))).slice(0, 8);
    } else if (last && parts.length > 1) {
      const names = playerList.map((p) => p.name);
      if (names.length) {
        list = names.filter((n) => n.toLowerCase().startsWith(last.toLowerCase())).slice(0, 8);
      }
    }
    setSuggestions(list);
    setSuggIdx(list.length ? 0 : -1);
  }, [playerList]);

  const completeSuggestion = useCallback((sug: string) => {
    const el = inputRef.current;
    if (!el) return;
    const parts = el.value.split(/\s+/);
    const isCmd = (parts[parts.length - 1] ?? "").startsWith("/");
    parts[parts.length - 1] = isCmd ? `/${sug}` : sug;
    el.value = `${parts.join(" ")} `;
    setSuggestions([]);
    setSuggIdx(-1);
    el.focus();
  }, []);

  const handleCmdKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); sendCommand(); return; }
      if (e.key === "Tab") {
        if (suggestions.length) {
          e.preventDefault();
          completeSuggestion(suggestions[suggIdx >= 0 ? suggIdx : 0]);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (suggestions.length) { setSuggIdx((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
        if (cmdHistory.length === 0) return;
        const newIdx = historyIdx === -1 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(newIdx);
        if (inputRef.current) inputRef.current.value = cmdHistory[newIdx];
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (suggestions.length) { setSuggIdx((i) => (i + 1) % suggestions.length); return; }
        if (historyIdx === -1) return;
        const newIdx = historyIdx + 1;
        if (newIdx >= cmdHistory.length) {
          setHistoryIdx(-1);
          if (inputRef.current) inputRef.current.value = "";
        } else {
          setHistoryIdx(newIdx);
          if (inputRef.current) inputRef.current.value = cmdHistory[newIdx];
        }
      }
    },
    [sendCommand, cmdHistory, historyIdx, suggestions, suggIdx, completeSuggestion],
  );

  const isOnline = serverStatus === "running";
  const hasOutput = lines.length > 1 || (lines.length === 1 && lines[0].type !== "system");

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ════ Left: Quick commands + Console ════ */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {isOnline && (
          <div className="hidden lg:block">
            <QuickCommands serverId={serverId} />
          </div>
        )}

        {/* Console panel */}
        <div className="flex h-[540px] max-h-[calc(100vh-200px)] min-w-0 flex-col overflow-hidden rounded-xl border border-edge bg-surface">
        {/* Console header + filter */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-edge bg-surface px-4 py-2">
          <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${isOnline ? "text-online" : "text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-online pulse-dot" : "bg-edge"}`} />
            {isOnline ? "Live" : "Offline"}
          </span>
          <span className="text-xs text-muted">{typeLabel(serverType)} {version}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-void px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-muted" />
            <input
              value={filter.text}
              onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
              placeholder="Filter console…"
              aria-label="Filter console output"
              className="w-24 min-w-0 bg-transparent text-[11px] text-slate-300 placeholder:text-slate-600 focus:outline-none sm:w-32"
            />
            <select
              value={filter.level}
              onChange={(e) => setFilter((f) => ({ ...f, level: e.target.value as "all" | "stderr" | "system" }))}
              aria-label="Filter by output level"
              className="shrink-0 rounded border border-edge bg-void px-1 py-0.5 text-[10px] text-slate-400 focus:border-accent/40 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="stderr">Errors</option>
              <option value="system">System</option>
            </select>
            {(filter.text || filter.level !== "all") && (
              <>
                <span className="shrink-0 text-[10px] tabular-nums text-muted">{visibleLines.length}/{lines.length}</span>
                <button
                  onClick={() => setFilter({ text: "", level: "all" })}
                  className="shrink-0 rounded p-0.5 text-slate-600 transition hover:text-slate-300"
                  title="Clear filter" aria-label="Clear filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
          {connected && isOnline && <span className="text-[11px] text-muted">verbunden</span>}
        </div>

        {/* Output */}
        <div
          ref={outputRef}
          onScroll={handleOutputScroll}
          className="min-h-0 flex-1 overflow-y-auto bg-[#000] p-4 font-mono text-[12.5px] leading-[1.75]"
        >
          {!hasOutput && !isOnline ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <TerminalSquare className="h-12 w-12 empty-ghost" />
              <p className="text-sm font-medium text-slate-500">Server is offline</p>
              <p className="text-xs text-muted">Start the server to view the live console.</p>
            </div>
          ) : visibleLines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Search className="h-6 w-6 text-muted" />
              <p className="text-xs text-slate-500">No lines match the filter</p>
              <button onClick={() => setFilter({ text: "", level: "all" })} className="text-[11px] text-violet-400 transition hover:underline">
                Clear filter
              </button>
            </div>
          ) : (
            visibleLines.map((line, i) => {
              // Content-based highlighting for errors/warnings (modern panel look)
              const upper = line.text.toUpperCase();
              const contentCls =
                line.type === "stderr"
                  ? "text-red-400"
                  : line.type === "system"
                    ? "text-slate-600 italic"
                    : upper.includes("ERROR") || upper.includes("EXCEPTION")
                      ? "text-red-300 bg-danger/10 font-semibold"
                      : upper.includes("WARN")
                        ? "text-amber-300 bg-warn/5"
                        : "text-slate-300";
              return (
                <div
                  key={i}
                  className={`console-line whitespace-pre-wrap break-all ${contentCls}`}
                >
                <span className="select-none text-muted mr-3">
                  [{formatTime(line.time)}]
                </span>
                {line.text}
              </div>
              );
            })
          )}
        </div>

        {/* Offline banner */}
        {!isOnline && hasOutput && (
          <div className="flex items-center gap-2 border-t border-warn/20 bg-warn/5 px-4 py-2">
            <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-400/80">
              Server stopped — console is read-only. Start the server to send commands.
            </p>
          </div>
        )}

        {/* Command input */}
        <form
          onSubmit={(e) => { e.preventDefault(); sendCommand(); }}
          className="relative flex items-center gap-2 border-t border-edge bg-surface px-3 py-2"
        >
          {/* Tab-completion dropdown */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-edge bg-surface shadow-2xl">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => completeSuggestion(s)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] transition ${
                    i === suggIdx ? "bg-accent/20 text-purple-200" : "text-slate-300 hover:bg-accent/10"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <span className="select-none font-mono text-[13px] text-violet-400 shrink-0">❯</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command…"
            disabled={!connected}
            onKeyDown={handleCmdKeyDown}
            onChange={(e) => updateSuggestions(e.target.value)}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
            aria-label="Console command input"
            className="flex-1 bg-transparent py-0 font-mono text-[12px] text-slate-200
                       placeholder:text-slate-600 focus:outline-none
                       disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!connected}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium
                       text-white transition hover:bg-accent-strong
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
      </div>{/* /left wrapper */}

      {/* ════ Right stats column (desktop) ════ */}
      <div className="hidden lg:flex lg:w-[300px] shrink-0 flex-col gap-4">
        {/* ── Auslastung (thick bars) ── */}
        <div className="rounded-xl border border-edge bg-surface p-4">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Auslastung</h4>

          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs text-muted">CPU</span>
              <span className={`text-lg font-extrabold tabular-nums ${isOnline && (stats?.cpuPercent ?? 0) >= 90 ? "text-danger" : isOnline && (stats?.cpuPercent ?? 0) >= 70 ? "text-warn" : isOnline ? "text-online" : "text-slate-600"}`}>
                {isOnline && stats?.cpuPercent != null ? `${Math.min(100, stats.cpuPercent).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-edge">
              <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out ${(stats?.cpuPercent ?? 0) >= 90 ? "from-pink-600 to-danger" : (stats?.cpuPercent ?? 0) >= 70 ? "from-yellow-500 to-warn" : "from-teal-700 to-online"}`}
                style={{ width: `${Math.min(100, stats?.cpuPercent ?? 0)}%` }} />
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs text-muted">RAM</span>
              <span className={`text-lg font-extrabold tabular-nums ${stats && stats.memoryUsage / stats.memoryLimit > 0.9 ? "text-danger" : stats && stats.memoryUsage / stats.memoryLimit > 0.75 ? "text-warn" : "text-white"}`}>
                {stats ? `${formatBytes(stats.memoryUsage)}` : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-edge">
              <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out ${stats && stats.memoryUsage / stats.memoryLimit > 0.9 ? "from-pink-600 to-danger" : stats && stats.memoryUsage / stats.memoryLimit > 0.75 ? "from-yellow-500 to-warn" : "from-purple-800 to-accent"}`}
                style={{ width: `${stats ? Math.min(100, (stats.memoryUsage / stats.memoryLimit) * 100) : 0}%` }} />
            </div>
            <div className="mt-1 text-right text-[10px] text-muted">von {formatRam(ram)}</div>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs text-muted">TPS</span>
              <span className={`text-lg font-extrabold tabular-nums ${tps ? (tps.tps5s >= 19 ? "text-online" : tps.tps5s >= 15 ? "text-warn" : "text-danger") : "text-slate-600"}`}>
                {tps ? tps.tps5s.toFixed(1) : "—"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-edge">
              <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out ${tps && tps.tps5s >= 19 ? "from-teal-700 to-online" : tps && tps.tps5s >= 15 ? "from-yellow-500 to-warn" : "from-pink-600 to-danger"}`}
                style={{ width: `${tps ? Math.min(100, (tps.tps5s / 20) * 100) : 0}%` }} />
            </div>
            {tps && <div className="mt-1 text-right text-[10px] text-muted">1m {tps.tps1m.toFixed(1)} · 5m {tps.tps5m.toFixed(1)}</div>}
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs text-muted">Disk</span>
              <span className="text-lg font-extrabold tabular-nums text-white">{isOnline && diskUsage ? formatBytes(diskUsage) : "—"}</span>
            </div>
          </div>
        </div>

        {/* ── Server ── */}
        <div className="rounded-xl border border-edge bg-surface p-4">
          <h4 className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Server</h4>
          <div className="group">
            <AddressPill
              hostname={typeof window !== "undefined" ? window.location.hostname : "—"}
              port={port}
              hoverReveal
            />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-xs text-muted">Uptime</span>
            <span className="text-sm font-bold tabular-nums text-white">{formatUptime(upSeconds)}</span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xs text-muted">Typ</span>
            <span className="text-sm font-semibold text-slate-200">{typeLabel(serverType)}</span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xs text-muted">Version</span>
            <span className="font-mono text-xs text-slate-300">{version}</span>
          </div>
        </div>

        {/* ── Spieler (management: OP/Kick/Ban + Whitelist) ── */}
        <PlayerCard serverId={serverId} isOnline={isOnline} playerCount={playerCount} playerList={playerList} />
      </div>
    </div>
  );
}
