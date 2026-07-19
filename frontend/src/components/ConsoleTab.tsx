"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { io, Socket } from "socket.io-client";
import { Cpu, MemoryStick, TerminalSquare } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatsPayload {
  cpuPercent: number;
  memoryUsage: number; // bytes
  memoryLimit: number; // bytes
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || bytes === 0) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  serverId: string;
  serverStatus: "running" | "exited" | "created" | "paused" | "unknown";
}

export default function ConsoleTab({ serverId, serverStatus }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const hasOutputRef = useRef(false);

  // ---- initialise xterm + socket.io ----

  const initTerminal = useCallback(() => {
    const el = terminalRef.current;
    if (!el) return;

    // Clean up any previous instance (React strict mode double-mount).
    if (termRef.current) termRef.current.dispose();

    const term = new Terminal({
      theme: {
        background: "#0f172a", // slate-900
        foreground: "#cbd5e1", // slate-300
        cursor: "#38bdf8", // sky-400
        selectionBackground: "#334155", // slate-700
        black: "#1e293b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
      fontSize: 13,
      fontFamily: 'var(--font-geist-mono), "Cascadia Code", monospace',
      cursorBlink: false,
      cursorStyle: "block",
      allowProposedApi: true,
      disableStdin: true, // we use our own input, not terminal stdin
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Re-fit on resize.
    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    // Store cleanup on the fit addon.
    (fitAddon as any).__resizeHandler = onResize;

    return term;
  }, []);

  const connectSocket = useCallback(
    (term: Terminal) => {
      const socket = io(API_BASE, {
        transports: ["polling"], // no WebSocket — Next.js rewrites don't proxy WS upgrades in prod
      });

      socket.on("connect", () => {
        setConnected(true);
        setError(null);
        socket.emit("console:attach", { serverId });
        socket.emit("stats:subscribe", { serverId });
      });

      socket.on("disconnect", () => {
        setConnected(false);
      });

      socket.on("connect_error", (err: Error) => {
        setError(err.message);
      });

      // ---- console output ----
      socket.on(
        "console:output",
        (payload: { serverId: string; data: string; stream: "stdout" | "stderr" }) => {
          // xterm.js needs \r\n for a proper new line (LF alone only
          // moves down, CR alone only returns to column 0).
          const clean = payload.data
            // Strip ANSI escape codes
            // eslint-disable-next-line no-control-regex
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
            .replace(/\x1b/g, "")
            // Normalise all line endings to \r\n
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/\n/g, "\r\n");
          term.write(clean);
          hasOutputRef.current = true;
        },
      );

      // ---- stats ----
      socket.on("stats:data", (payload: StatsPayload & { serverId: string }) => {
        setStats({
          cpuPercent: payload.cpuPercent,
          memoryUsage: payload.memoryUsage,
          memoryLimit: payload.memoryLimit,
        });
      });

      socket.on("stats:error", (payload: { serverId: string; message: string }) => {
        console.warn("[stats]", payload.message);
      });

      socketRef.current = socket;
      return socket;
    },
    [serverId],
  );

  // ---- mount / unmount ----

  useEffect(() => {
    const term = initTerminal();
    if (!term) return;

    let socket: ReturnType<typeof io> | null = null;
    let cancelled = false;

    (async () => {
      // Load recent log history so the terminal "resumes where it left off".
      try {
        const res = await fetch(
          `${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/logs/latest.log")}`,
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.content) {
            const clean = data.content
              // eslint-disable-next-line no-control-regex
              .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
              .replace(/\x1b/g, "")
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n")
              .replace(/\n/g, "\r\n");
            term.write(clean);
            hasOutputRef.current = true;
          }
        }
      } catch { /* log not available yet — that's fine */ }

      if (cancelled) return;

      // Now attach the live WebSocket stream.
      socket = connectSocket(term);
      socketRef.current = socket;
    })();

    return () => {
      cancelled = true;
      if (socket) {
        socket.emit("console:detach", { serverId });
        socket.emit("stats:unsubscribe", { serverId });
        socket.disconnect();
      }
      const fit = fitRef.current as any;
      if (fit?.__resizeHandler) {
        window.removeEventListener("resize", fit.__resizeHandler);
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      socketRef.current = null;
    };
  }, [serverId, initTerminal, connectSocket]);

  // ---- re-attach console + stats when server status changes ----
  const prevStatusRef = useRef(serverStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = serverStatus;
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (serverStatus === "running" && prev !== "running") {
      // Server came online — re-attach
      socket.emit("console:attach", { serverId });
      socket.emit("stats:subscribe", { serverId });
    } else if (serverStatus !== "running" && prev === "running") {
      // Server went offline — detach
      socket.emit("console:detach", { serverId });
      socket.emit("stats:unsubscribe", { serverId });
    }
  }, [serverStatus, serverId]);

  // ---- send command ----

  const sendCommand = useCallback(() => {
    const input = inputRef.current;
    const socket = socketRef.current;
    if (!input || !socket) return;
    const cmd = input.value.trim();
    if (!cmd) return;
    socket.emit("console:input", { serverId, command: cmd });
    setCmdHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    input.value = "";
  }, [serverId]);

  const handleCmdKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendCommand();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (cmdHistory.length === 0) return;
        const newIdx = historyIdx === -1 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(newIdx);
        if (inputRef.current) inputRef.current.value = cmdHistory[newIdx];
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIdx === -1) return;
        const newIdx = historyIdx + 1;
        if (newIdx >= cmdHistory.length) {
          setHistoryIdx(-1);
          if (inputRef.current) inputRef.current.value = "";
        } else {
          setHistoryIdx(newIdx);
          if (inputRef.current) inputRef.current.value = cmdHistory[newIdx];
        }
        return;
      }
    },
    [sendCommand, cmdHistory, historyIdx],
  );

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <div className="flex flex-col gap-3">
      {/* Stats bar */}
      <div
        className="flex items-center gap-6 rounded-xl border border-slate-800
                    bg-slate-900/70 px-5 py-3 text-sm"
      >
        <div className="flex items-center gap-2 text-slate-400">
          <Cpu className="h-4 w-4" />
          <span className="font-mono tabular-nums text-white">
            {stats?.cpuPercent != null ? `${stats.cpuPercent.toFixed(1)}%` : "—"}
          </span>
          <span className="text-slate-600">CPU</span>
        </div>

        <div className="flex items-center gap-2 text-slate-400">
          <MemoryStick className="h-4 w-4" />
          <span className="font-mono tabular-nums text-white">
            {stats ? formatBytes(stats.memoryUsage) : "—"}
          </span>
          <span className="text-slate-600">
            / {stats ? formatBytes(stats.memoryLimit) : "—"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          <span className="text-xs text-slate-500">
            {connected ? "Live" : error ? "Error" : "Connecting…"}
          </span>
          {error && (
            <span className="text-xs text-amber-500 truncate max-w-[200px]">
              {error}
            </span>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div
        className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
        style={{ minHeight: "24rem" }}
      >
        {serverStatus !== "running" && !hasOutputRef.current ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
            <TerminalSquare className="h-10 w-10 text-slate-700" />
            <p className="text-sm font-medium text-slate-400">Server is offline</p>
            <p className="text-xs text-slate-600">
              Start the server to view the console.
            </p>
          </div>
        ) : (
          <div ref={terminalRef} className="h-72 w-full p-2" />
        )}
      </div>
      {/* Offline indicator — show when server stopped but terminal has content */}
      {serverStatus !== "running" && hasOutputRef.current && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <TerminalSquare className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs font-medium text-amber-400">
            Server stopped — console is read-only. Start the server to send commands.
          </p>
        </div>
      )}

      {/* Command input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendCommand();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <TerminalSquare className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command… (e.g. say Hello)"
            disabled={!connected}
            onKeyDown={handleCmdKeyDown}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2.5
                       pl-10 pr-4 font-mono text-sm text-slate-200
                       placeholder:text-slate-600
                       focus:border-sky-500/50 focus:outline-none
                       disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!connected}
          className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium
                     text-white transition hover:bg-sky-500
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
