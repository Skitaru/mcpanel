// ---- Minecraft Server Panel: WebSocket service ----
// Provides two real-time channels per server:
//   1. Live stats  (CPU % + memory)   — events: stats:subscribe / stats:unsubscribe
//   2. Live console (stdout + stdin)  — events: console:attach / console:detach / console:input

import { Server as HttpServer } from "node:http";
import { Readable } from "node:stream";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { getServer } from "./config-store";
import { getJwtSecret } from "./auth";
import { sendRcon } from "./rcon";
import { setLiveStats as updateLiveStats } from "./discord";
import {
  getStatsStream,
  attachContainer,
  ContainerStreams,
} from "./docker";

// ---------------------------------------------------------------------------
// ANSI / control-character cleaner (stateful — handles split chunks)
// ---------------------------------------------------------------------------

const chunkBuffers = new Map<string, string>();

function cleanAnsi(serverId: string, raw: string): string {
  const prev = chunkBuffers.get(serverId) ?? "";
  let text = prev + raw;

  // eslint-disable-next-line no-control-regex
  text = text
    .replace(/\x1b\[[0-9;>?]*[a-zA-Z]/g, "")              // CSI
    .replace(/\x1b\][^\x07]*\x07/g, "")                     // OSC
    .replace(/\x1b[PX^_].*?(\x1b\\)?/g, "")                 // DCS/SOS/PM/APC
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")      // control chars (keep \r \n \t)
    .replace(/\r\n/g, "\n");                                // CRLF → LF

  // Handle \r overwrites: for each line, keep only text after the last \r
  text = text.split("\n").map(line => {
    const lastCR = line.lastIndexOf("\r");
    return lastCR >= 0 ? line.slice(lastCR + 1) : line;
  }).join("\n");

  // Strip JLine prompt and leading spaces, RCON noise
  text = text
    .replace(/\n> /g, "\n")
    .replace(/^> /, "")
    .replace(/\n  +/g, "\n")                               // collapse leading spaces
    .replace(/\n?.*Thread RCON Client.*\n?/g, "\n")            // filter RCON connect/disconnect noise
    .replace(/\n?(?:\[.*WARN\]:|WARN).*AsyncCatcher[\s\S]*?(?=\n\[\d|$)/g, "\n")  // filter AsyncCatcher stack traces
    .replace(/\n?.*Advanced terminal features are not available.*\n?/g, "\n") // filter TERM=dumb warning
    .replace(/\n{2,}/g, "\n");                             // collapse blank lines

  // Buffer dangling ESC for the next chunk
  const escIdx = text.lastIndexOf("\x1b");
  if (escIdx >= 0) {
    chunkBuffers.set(serverId, text.slice(escIdx));
    text = text.slice(0, escIdx);
  } else {
    chunkBuffers.delete(serverId);
  }
  return text;
}

function flushBuffer(serverId: string): void {
  chunkBuffers.delete(serverId);
}

// ---------------------------------------------------------------------------
// Per-socket session bookkeeping
// ---------------------------------------------------------------------------

interface SocketSession {
  /** serverId → stats stream (active subscription) */
  statsSubs: Map<string, Readable>;
  /** serverId → console streams */
  consoleSubs: Map<string, ContainerStreams>;
}

const sessions = new Map<string, SocketSession>();

// ---------------------------------------------------------------------------
// Shared RCON pollers — ONE poller per server, fanning out to every socket
// subscribed to it (so N browser tabs don't fire N RCON requests per tick).
// ---------------------------------------------------------------------------

/** serverId → set of subscribed socket ids */
const tpsSubs = new Map<string, Set<string>>();
const playersSubs = new Map<string, Set<string>>();
/** serverId → the single running poller interval */
const tpsIntervals = new Map<string, ReturnType<typeof setInterval>>();
const playersIntervals = new Map<string, ReturnType<typeof setInterval>>();
/** serverId → last known player names (join/leave detection) */
const playerLastNames = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

interface ParsedStats {
  cpuPercent: number;
  memoryUsage: number; // bytes
  memoryLimit: number; // bytes
}

/**
 * Parse a single Docker stats JSON blob into our friendlier shape.
 * Returns null on the very first tick (when precpu_stats is zeroed out).
 */
function parseStats(chunk: Buffer): ParsedStats | null {
  const raw = JSON.parse(chunk.toString());

  const cpu = raw.cpu_stats;
  const precpu = raw.precpu_stats;
  const mem = raw.memory_stats;

  if (!cpu || !precpu || !mem) return null;

  const cpuDelta =
    cpu.cpu_usage.total_usage - precpu.cpu_usage.total_usage;
  const systemDelta =
    cpu.system_cpu_usage - precpu.system_cpu_usage;

  // First reading — precpu_stats is all zeros; skip.
  if (cpuDelta <= 0 || systemDelta <= 0) return null;

  const cpuPercent = (cpuDelta / systemDelta) * cpu.online_cpus * 100;

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsage: mem.usage ?? 0,
    memoryLimit: mem.limit ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Socket.IO setup
// ---------------------------------------------------------------------------

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    // Don't spam pings for a local-panel scenario; keep it relaxed.
    pingInterval: 10_000,
    pingTimeout: 15_000,
  });

  // ---- Auth middleware ----
  const API_KEY = process.env.PANEL_API_KEY;
  io.use((socket, next) => {
    // Check auth.token first, then Authorization header (fetch interceptor).
    let token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      const authHeader = socket.handshake.headers?.authorization;
      if (authHeader?.startsWith("Bearer ")) token = authHeader.slice(7);
    }
    if (!token) return next(new Error("Authentication required."));
    try {
      jwt.verify(token, getJwtSecret());
      return next();
    } catch {
      if (API_KEY && token === API_KEY) return next();
      return next(new Error("Invalid authentication token."));
    }
  });

  io.on("connection", (socket: Socket) => {
    const session: SocketSession = {
      statsSubs: new Map(),
      consoleSubs: new Map(),
    };
    sessions.set(socket.id, session);
    console.log(`[ws] Client connected: ${socket.id}`);

    // ==================================================================
    // STATS
    // ==================================================================

    socket.on("stats:subscribe", async (payload: { serverId: string }) => {
      const { serverId } = payload;

      // Deduplicate — one stats stream per server per socket is enough.
      if (session.statsSubs.has(serverId)) return;

      const server = await getServer(serverId);
      if (!server?.containerId) {
        socket.emit("stats:error", {
          serverId,
          message: "Server or container not found.",
        });
        return;
      }

      try {
        const stream = await getStatsStream(server.containerId);
        session.statsSubs.set(serverId, stream);

        stream.on("data", (chunk: Buffer) => {
          let stats: ParsedStats | null = null;
          try { stats = parseStats(chunk); } catch (err: any) {
            console.error(`[ws] Stats parse error (${serverId}):`, err.message);
            return;
          }
          if (!stats) return; // skip the first zeroed tick
          socket.emit("stats:data", {
            serverId,
            cpuPercent: stats.cpuPercent,
            memoryUsage: stats.memoryUsage,
            memoryLimit: stats.memoryLimit,
            timestamp: Date.now(),
          });
          // Update shared live-stats store for Discord embed
          updateLiveStats(serverId, { cpuPercent: stats.cpuPercent, memoryUsage: stats.memoryUsage, memoryLimit: stats.memoryLimit });
        });

        stream.on("error", (err: Error) => {
          console.error(`[ws] Stats stream error (${serverId}):`, err.message);
          socket.emit("stats:error", { serverId, message: err.message });
          session.statsSubs.delete(serverId);
        });

        stream.on("end", () => {
          session.statsSubs.delete(serverId);
        });

        console.log(`[ws] Stats subscription: ${socket.id} → ${serverId}`);
      } catch (err: any) {
        socket.emit("stats:error", {
          serverId,
          message: err.message ?? "Failed to open stats stream.",
        });
      }
    });

    socket.on("stats:unsubscribe", (payload: { serverId: string }) => {
      const { serverId } = payload;
      const stream = session.statsSubs.get(serverId);
      if (stream) {
        stream.destroy();
        session.statsSubs.delete(serverId);
        console.log(`[ws] Stats unsubscription: ${socket.id} → ${serverId}`);
      }
    });

    // ==================================================================
    // TPS (via RCON polling)
    // ==================================================================

    socket.on("tps:subscribe", async (payload: { serverId: string }) => {
      const { serverId } = payload;
      const set = tpsSubs.get(serverId) ?? new Set<string>();
      set.add(socket.id);
      tpsSubs.set(serverId, set);
      if (tpsIntervals.has(serverId)) return; // one shared poller is already running

      const server = await getServer(serverId);
      if (!server?.containerId) {
        socket.emit("tps:error", { serverId, message: "Server not found." });
        return;
      }

      const emitTps = (data: unknown) => {
        for (const sid of tpsSubs.get(serverId) ?? []) io.to(sid).emit("tps:data", data);
      };
      const pollTps = () => {
        sendRcon("127.0.0.1", server.rconPort, server.rconPassword, "tps", 3000)
          .then((raw) => {
            // Parse Minecraft TPS output:
            // "TPS from last 5s, 1m, 5m, 15m: §a20.0§r, §a19.8§r, §a19.5§r"
            // Strip color codes and extract numbers
            // eslint-disable-next-line no-control-regex
            const clean = raw.replace(/§[0-9a-fk-or]/gi, "");
            const match = clean.match(/:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
            if (match) {
              emitTps({
                serverId,
                tps5s: parseFloat(match[1]),
                tps1m: parseFloat(match[2]),
                tps5m: parseFloat(match[3]),
                timestamp: Date.now(),
              });
              // Update shared live-stats for Discord embed
              updateLiveStats(serverId, { tps5s: parseFloat(match[1]) });
            }
          })
          .catch(() => {
            // RCON not reachable or server not ready — silent fail
          });
      };

      pollTps(); // immediate first poll
      const interval = setInterval(pollTps, 5000);
      tpsIntervals.set(serverId, interval);
      console.log(`[ws] TPS subscription: ${socket.id} → ${serverId}`);
    });

    socket.on("tps:unsubscribe", (payload: { serverId: string }) => {
      const { serverId } = payload;
      const set = tpsSubs.get(serverId);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) {
        tpsSubs.delete(serverId);
        const interval = tpsIntervals.get(serverId);
        if (interval) clearInterval(interval);
        tpsIntervals.delete(serverId);
      }
    });

    // ==================================================================
    // PLAYERS (via RCON polling — live join/leave detection)
    // ==================================================================

    socket.on("players:subscribe", async (payload: { serverId: string }) => {
      const { serverId } = payload;
      const set = playersSubs.get(serverId) ?? new Set<string>();
      set.add(socket.id);
      playersSubs.set(serverId, set);
      if (playersIntervals.has(serverId)) return; // one shared poller is already running

      const server = await getServer(serverId);
      if (!server?.containerId) {
        socket.emit("players:error", { serverId, message: "Server not found." });
        return;
      }

      const emitPlayers = (data: unknown) => {
        for (const sid of playersSubs.get(serverId) ?? []) io.to(sid).emit("players:data", data);
      };
      const pollPlayers = () => {
        sendRcon("127.0.0.1", server.rconPort, server.rconPassword, "list", 3000)
          .then((raw) => {
            // "There are 3 of a max of 20 players online: Steve, Alex, Notch"
            // eslint-disable-next-line no-control-regex
            const clean = raw.replace(/§[0-9a-fk-or]/gi, "");
            const m = clean.match(/There are (\d+) of a max of (\d+) players online:\s*(.*)/);
            if (!m) return;
            const online = parseInt(m[1], 10);
            const max = parseInt(m[2], 10);
            const names = m[3]
              ? [...new Set(m[3].split(",").map((s) => s.trim()).filter(Boolean))]
              : [];

            const first = !playerLastNames.has(serverId);
            const prev = playerLastNames.get(serverId) ?? [];
            playerLastNames.set(serverId, names);

            // Emit on the first poll and whenever the player set changed
            // (i.e. a player joined or left) — so the UI updates live.
            if (first || prev.join(",") !== names.join(",")) {
              emitPlayers({
                serverId,
                online,
                max,
                players: names.map((name) => ({ name, id: name })),
              });
            }
          })
          .catch(() => {
            // RCON not reachable or server not ready — silent fail
          });
      };

      pollPlayers(); // immediate first poll
      const interval = setInterval(pollPlayers, 5000);
      playersIntervals.set(serverId, interval);
      console.log(`[ws] Players subscription: ${socket.id} → ${serverId}`);
    });

    socket.on("players:unsubscribe", (payload: { serverId: string }) => {
      const { serverId } = payload;
      const set = playersSubs.get(serverId);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) {
        playersSubs.delete(serverId);
        playerLastNames.delete(serverId);
        const interval = playersIntervals.get(serverId);
        if (interval) clearInterval(interval);
        playersIntervals.delete(serverId);
      }
    });

    // ==================================================================
    // CONSOLE
    // ==================================================================

    socket.on("console:attach", async (payload: { serverId: string }) => {
      const { serverId } = payload;

      if (session.consoleSubs.has(serverId)) return;

      const server = await getServer(serverId);
      if (!server?.containerId) {
        socket.emit("console:error", {
          serverId,
          message: "Server or container not found.",
        });
        return;
      }

      try {
        const streams = await attachContainer(server.containerId);
        session.consoleSubs.set(serverId, streams);

        // Pipe demuxed stdout / stderr → socket (cleaned)
        streams.demuxed.stdout.on("data", (chunk: Buffer) => {
          const text = cleanAnsi(`${socket.id}:${serverId}`, chunk.toString());
          if (!text) return;
          socket.emit("console:output", {
            serverId,
            data: text,
            stream: "stdout" as const,
          });
        });

        streams.demuxed.stderr.on("data", (chunk: Buffer) => {
          const text = cleanAnsi(`${socket.id}:${serverId}`, chunk.toString());
          if (!text) return;
          socket.emit("console:output", {
            serverId,
            data: text,
            stream: "stderr" as const,
          });
        });

        // If the attach stream closes (container stops etc.), clean up
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          streams.demuxed.stdout.removeAllListeners();
          streams.demuxed.stderr.removeAllListeners();
          flushBuffer(`${socket.id}:${serverId}`);
          const hadSub = session.consoleSubs.has(serverId);
          session.consoleSubs.delete(serverId);
          streams.close();
          if (hadSub) {
            socket.emit("console:detached", { serverId });
          }
        };

        streams.demuxed.stdout.on("close", cleanup);
        streams.demuxed.stderr.on("close", cleanup);
        // PassThrough streams fire 'end' (not always 'close') when the source
        // ends cleanly (e.g. Docker stop). Listen for both.
        streams.demuxed.stdout.on("end", () => cleanup());
        streams.demuxed.stderr.on("end", () => cleanup());

        socket.emit("console:attached", { serverId });
        console.log(`[ws] Console attached: ${socket.id} → ${serverId}`);
      } catch (err: any) {
        socket.emit("console:error", {
          serverId,
          message: err.message ?? "Failed to attach console.",
        });
      }
    });

    socket.on("console:detach", (payload: { serverId: string }) => {
      const { serverId } = payload;
      const streams = session.consoleSubs.get(serverId);
      if (streams) {
        // Remove all listeners (including 'close') so cleanup won't fire
        // again when streams are destroyed below.
        streams.demuxed.stdout.removeAllListeners();
        streams.demuxed.stderr.removeAllListeners();
        flushBuffer(`${socket.id}:${serverId}`);
        session.consoleSubs.delete(serverId);
        streams.close();
        socket.emit("console:detached", { serverId });
        console.log(`[ws] Console detached: ${socket.id} → ${serverId}`);
      }
    });

    socket.on(
      "console:input",
      (payload: { serverId: string; command: string }) => {
        const { serverId, command } = payload;
        const streams = session.consoleSubs.get(serverId);
        if (!streams) {
          socket.emit("console:error", {
            serverId,
            message: "Console not attached. Use console:attach first.",
          });
          return;
        }

        // Minecraft expects a newline to process the command.
        streams.stdin.write(command + "\n");
      },
    );

    // ==================================================================
    // DISCONNECT — tear down every active subscription for this socket
    // ==================================================================

    socket.on("disconnect", () => {
      for (const stream of session.statsSubs.values()) stream.destroy();
      for (const streams of session.consoleSubs.values()) streams.close();

      // Remove this socket from the shared poller subscriptions; stop the
      // poller once the last subscriber for a server goes away.
      for (const [serverId, set] of tpsSubs) {
        if (set.delete(socket.id) && set.size === 0) {
          tpsSubs.delete(serverId);
          const iv = tpsIntervals.get(serverId);
          if (iv) clearInterval(iv);
          tpsIntervals.delete(serverId);
        }
      }
      for (const [serverId, set] of playersSubs) {
        if (set.delete(socket.id) && set.size === 0) {
          playersSubs.delete(serverId);
          playerLastNames.delete(serverId);
          const iv = playersIntervals.get(serverId);
          if (iv) clearInterval(iv);
          playersIntervals.delete(serverId);
        }
      }

      sessions.delete(socket.id);
      console.log(`[ws] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}
