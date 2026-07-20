// ---- Minecraft Server Panel: WebSocket service ----
// Provides two real-time channels per server:
//   1. Live stats  (CPU % + memory)   — events: stats:subscribe / stats:unsubscribe
//   2. Live console (stdout + stdin)  — events: console:attach / console:detach / console:input

import { Server as HttpServer } from "node:http";
import { Readable } from "node:stream";
import { Server as SocketIOServer, Socket } from "socket.io";
import { getServer } from "./config-store";
import {
  getStatsStream,
  attachContainer,
  ContainerStreams,
} from "./docker";

// ---------------------------------------------------------------------------
// ANSI / control-character cleaner
// ---------------------------------------------------------------------------

/** Clean console output for div-based rendering.
 *  1. Strip ESC (breaks all ANSI start markers)
 *  2. Strip orphaned ANSI parameters left after ESC removal
 *  3. Normalize newlines, filter whitespace-only lines */
function cleanAnsi(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b/g, "")                              // strip ESC
    .replace(/\[[0-9;?>]*[a-zA-Z]/g, "")                // strip orphaned CSI params
    .replace(/\][0-9;]*[^\x07]*\x07/g, "")             // strip orphaned OSC params
    .replace(/\r\n/g, "\n")                            // CRLF → LF
    .replace(/\r/g, "");                               // strip bare CR
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

      const server = getServer(serverId);
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
          const stats = parseStats(chunk);
          if (!stats) return; // skip the first zeroed tick
          socket.emit("stats:data", {
            serverId,
            cpuPercent: stats.cpuPercent,
            memoryUsage: stats.memoryUsage,
            memoryLimit: stats.memoryLimit,
            timestamp: Date.now(),
          });
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
    // CONSOLE
    // ==================================================================

    socket.on("console:attach", async (payload: { serverId: string }) => {
      const { serverId } = payload;

      if (session.consoleSubs.has(serverId)) return;

      const server = getServer(serverId);
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
          const text = cleanAnsi(chunk.toString());
          if (!text) return;
          socket.emit("console:output", {
            serverId,
            data: text,
            stream: "stdout" as const,
          });
        });

        streams.demuxed.stderr.on("data", (chunk: Buffer) => {
          const text = cleanAnsi(chunk.toString());
          if (!text) return;
          socket.emit("console:output", {
            serverId,
            data: text,
            stream: "stderr" as const,
          });
        });

        // If the attach stream closes (container dies etc.), clean up
        const cleanup = () => {
          streams.demuxed.stdout.removeAllListeners("data");
          streams.demuxed.stderr.removeAllListeners("data");
          session.consoleSubs.delete(serverId);
          streams.close();
        };

        streams.demuxed.stdout.on("close", cleanup);
        streams.demuxed.stderr.on("close", cleanup);

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
        // Remove listeners first so any buffered data flushed during close()
        // is not sent to the frontend as corrupted output
        streams.demuxed.stdout.removeAllListeners("data");
        streams.demuxed.stderr.removeAllListeners("data");
        streams.close();
        session.consoleSubs.delete(serverId);
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
      sessions.delete(socket.id);
      console.log(`[ws] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}
