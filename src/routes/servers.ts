// ---- Minecraft Server Panel: /api/servers routes ----

import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import multer from "multer";
import { CreateServerRequest, ServerConfig, ServerStatus, ServerType } from "../types";
import {
  loadServers,
  addServer,
  getServer,
  removeServer,
  updateServer,
} from "../services/config-store";
import {
  createContainer,
  startContainer,
  stopContainer,
  deleteContainer,
  listManagedContainerStatuses,
  resolveJavaImageForServer,
  resolveLaunchJar,
  inspectContainer,
  isValidJavaArgs,
} from "../services/docker";
import { runModpackInstall, createModpackServer, searchModpacks, getModpackFiles, installProgress } from "../services/modpack";
import { listBackups, deleteBackup, restoreFromArchive, startBackupJob, getBackupJob } from "../services/backups";
import { sendDiscordEmbed, editDiscordEmbed, buildStatusEmbed, startStatusEmbedUpdater, stopStatusEmbedUpdater, initLiveStats, clearLiveStats, setLiveStats } from "../services/discord";
import { downloadPaperJar } from "../services/paper";
import { downloadFabricJar } from "../services/fabric";
import { downloadVelocityJar } from "../services/velocity";
import { pingMinecraftServer } from "../services/minecraft-ping";

const router = Router();

// Where per-server data directories live on the host
const DATA_ROOT = path.resolve(process.cwd(), "data");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a human RAM string ("4G", "512M") or raw number into megabytes. */
function parseRamToMB(ram: string | number): number {
  const MAX_RAM = 262144; // 256 GB
  if (typeof ram === "number") {
    if (ram < 512 || ram > MAX_RAM) {
      throw new Error("RAM must be between 512 and " + MAX_RAM + " (MB).");
    }
    return ram;
  }
  const match = ram.trim().match(/^(\d+(?:\.\d+)?)\s*(G|M)$/i);
  if (!match) {
    throw new Error('Invalid RAM format. Use e.g. "4G" or "4096M".');
  }
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const mb = unit === "G" ? Math.round(value * 1024) : Math.round(value);
  if (mb < 512 || mb > MAX_RAM) {
    throw new Error("RAM must be between 512 and " + MAX_RAM + " (MB).");
  }
  return mb;
}

/** Validate a server name: 1-60 chars, no line breaks, no double quotes.
 *  Prevents property/toml injection via server.properties / velocity.toml. */
function isValidServerName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 60 && !/[\r\n]/.test(n) && !n.includes('"');
}

// ---------------------------------------------------------------------------
// POST /api/servers — starts an async creation job; poll /create-progress/:id
// ---------------------------------------------------------------------------

export interface CreateJob {
  jobId: string;
  step: string;
  percent: number;
  status: "running" | "done" | "error";
  message?: string;
  serverId?: string;
}

const createJobs = new Map<string, CreateJob>();

export function getCreateJob(jobId: string): CreateJob | undefined {
  return createJobs.get(jobId);
}

async function runCreateJob(body: CreateServerRequest, jobId: string): Promise<void> {
  const job = createJobs.get(jobId)!;
  const setStep = (step: string, percent: number) => {
    job.step = step;
    job.percent = percent;
  };

  let dataPath: string | null = null;
  try {
    const name = body.name.trim();
    if (!isValidServerName(name)) {
      throw new Error("Invalid server name (1-60 chars, no line breaks or double quotes).");
    }
    const ram = parseRamToMB(body.ram ?? "4G");
    const port = body.port ?? 25565;
    if (typeof port !== "number" || port < 1024 || port > 65525) {
      throw new Error("Field 'port' must be between 1024 and 65525.");
    }
    const voicePort = body.voicePort ?? undefined;
    const serverType: ServerType = body.serverType ?? "paper";
    const mcVersion = body.paperVersion ?? "1.21.1";

    const javaImage = serverType === "velocity"
      ? "eclipse-temurin:21-jre-alpine"
      : resolveJavaImageForServer(mcVersion, serverType);
    console.log(`[api] ${serverType} ${mcVersion} -> Java image ${javaImage}`);

    const id = uuid();
    dataPath = path.join(DATA_ROOT, id);

    setStep("Creating directories…", 3);
    fs.mkdirSync(dataPath, { recursive: true });

    // ---- download server JAR based on type ----
    let jarName = "paper.jar";
    let extraCmd: string[] | undefined;
    setStep(`Downloading ${serverType} ${mcVersion}…`, 8);
    try {
      if (serverType === "fabric") {
        await downloadFabricJar(mcVersion, dataPath);
        jarName = "fabric-server-launch.jar";
      } else if (serverType === "velocity") {
        await downloadVelocityJar(mcVersion, dataPath);
        jarName = "velocity.jar";
        const forwardingSecret = uuid().replace(/-/g, "");
        const velocityToml = [
          `config-version = "2.7"`,
          `bind = "0.0.0.0:${port}"`,
          `motd = "${name} | Velocity"`,
          `show-max-players = 500`,
          `online-mode = true`,
          `force-key-authentication = true`,
          `player-info-forwarding-mode = "modern"`,
          `forwarding-secret = "${forwardingSecret}"`,
          `announce-forge = false`,
        ].join("\n");
        fs.writeFileSync(path.join(dataPath, "velocity.toml"), velocityToml + "\n");
        fs.writeFileSync(path.join(dataPath, "forwarding.secret"), forwardingSecret);
      } else {
        await downloadPaperJar(mcVersion, dataPath);
      }
    } catch (err: any) {
      throw new Error(`Failed to download ${serverType} server JAR: ${err.message}`);
    }

    // ---- generate RCON credentials and server.properties (not for velocity) ----
    const rconPort = port + 10;
    const rconPassword = uuid().replace(/-/g, "").slice(0, 16);
    const maxPlayers = typeof body.maxPlayers === "number" && body.maxPlayers >= 1 && body.maxPlayers <= 1000
      ? body.maxPlayers
      : 20;

    if (serverType !== "velocity") {
      const typeLabel = serverType === "fabric" ? "Fabric" : "PaperMC";
      const difficulty = (typeof body.difficulty === "string" && ["peaceful", "easy", "normal", "hard"].includes(body.difficulty))
        ? body.difficulty : "normal";
      const hardcore = body.hardcore === true;
      const serverProps = [
        `server-port=${port}`,
        `enable-rcon=true`,
        `rcon.port=${rconPort}`,
        `rcon.password=${rconPassword}`,
        `motd=${name} | ${typeLabel}`,
        `max-players=${maxPlayers}`,
        `difficulty=${difficulty}`,
        `hardcore=${hardcore}`,
        `gamemode=${hardcore ? "hardcore" : "survival"}`,
        `online-mode=true`,
      ].join("\n");
      fs.writeFileSync(path.join(dataPath, "server.properties"), serverProps + "\n");
    }

    // ---- persist config ----
    const config: ServerConfig = {
      id,
      name,
      serverType,
      ram,
      port,
      rconPort,
      rconPassword,
      version: mcVersion,
      containerId: null,
      dataPath,
      javaArgs: body.javaArgs?.trim() || undefined,
      maxPlayers,
      voicePort,
      tag: (body as any).tag || undefined,
    };
    await addServer(config);

    // ---- create Docker container (pulls the image if needed) ----
    setStep("Pulling Java image…", 45);
    const containerId = await createContainer(config, javaImage, { jarName, extraCmd, javaArgs: config.javaArgs });

    // Update config with the real container id.
    config.containerId = containerId;
    await removeServer(id);
    await addServer(config);

    // Auto-start the container
    setStep("Starting server…", 90);
    try {
      await startContainer(containerId);
      console.log(`[api] Auto-started ${serverType} server "${config.name}"`);
    } catch (startErr: any) {
      console.error(`[api] Auto-start failed: ${startErr.message}`);
    }

    job.status = "done";
    job.serverId = config.id;
    setStep("Done", 100);
    console.log(`[api] Server "${config.name}" created (${config.id.slice(0, 8)})`);
  } catch (err: any) {
    if (dataPath) {
      try { fs.rmSync(dataPath, { recursive: true, force: true }); } catch { /* partial cleanup */ }
    }
    job.status = "error";
    job.message = err?.message ?? "Failed to create server.";
    console.error("[api] Create job failed:", err?.message);
  }
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateServerRequest;

    // ---- validation (synchronous — immediate 4xx) ----
    if (!body.name || typeof body.name !== "string" || !isValidServerName(body.name)) {
      res.status(400).json({ error: "Field 'name' must be 1-60 characters and must not contain line breaks or double quotes." });
      return;
    }

    // Parse RAM — accepts "4G", "4096M", or raw number (MB).
    let ram: number;
    try {
      ram = parseRamToMB(body.ram ?? "4G");
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    const port = body.port ?? 25565;
    // Max 65525 — the RCON port is auto-assigned as port + 10 and must stay ≤ 65535.
    if (typeof port !== "number" || port < 1024 || port > 65525) {
      res.status(400).json({ error: "Field 'port' must be between 1024 and 65525." });
      return;
    }

    // ---- javaArgs validation (prevents shell injection in the container Cmd) ----
    if (body.javaArgs !== undefined) {
      if (typeof body.javaArgs !== "string" || !isValidJavaArgs(body.javaArgs)) {
        res.status(400).json({
          error: "javaArgs contains unsupported characters. Only JVM flags (letters, digits, +-.:/=%_) are allowed.",
        });
        return;
      }
    }

    // ---- tag validation ----
    if (body.tag !== undefined && body.tag !== null) {
      if (typeof body.tag !== "string" || body.tag.length > 20 || !/^[a-zA-Z0-9 _-]+$/.test(body.tag)) {
        res.status(400).json({ error: "Invalid tag. Use letters, digits, spaces, _ or - (max 20 chars)." });
        return;
      }
    }

    // ---- port conflict check ----
    const existing = await loadServers();
    if (existing.some((s) => s.port === port)) {
      res.status(409).json({ error: `Port ${port} is already in use by another server.` });
      return;
    }

    // ---- voice port validation (optional UDP port for SimpleVoiceChat) ----
    const voicePort = body.voicePort ?? undefined;
    if (voicePort !== undefined) {
      if (typeof voicePort !== "number" || voicePort < 1024 || voicePort > 65535) {
        res.status(400).json({ error: "Field 'voicePort' must be between 1024 and 65535." });
        return;
      }
      if (existing.some((s) => s.voicePort === voicePort)) {
        res.status(409).json({ error: "Voice port " + voicePort + " is already in use by another server." });
        return;
      }
    }

    const serverType: ServerType = body.serverType ?? "paper";
    if (!["paper", "fabric", "velocity", "custom"].includes(serverType)) {
      res.status(400).json({ error: "Invalid serverType. Must be paper, fabric, velocity, or custom." });
      return;
    }

    const mcVersion = body.paperVersion ?? "1.21.1";
    if (typeof mcVersion !== "string" || !mcVersion.trim()) {
      res.status(400).json({ error: "Field 'paperVersion' (MC version) is required." });
      return;
    }

    // ---- start async creation job ----
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createJobs.set(jobId, { jobId, step: "Starting…", percent: 0, status: "running" });
    // Clean up finished jobs after 10 minutes (like modpack install progress).
    setTimeout(() => createJobs.delete(jobId), 30 * 60_000);
    runCreateJob(body, jobId);
    console.log(`[api] Create job started: ${jobId}`);
    res.status(202).json({ jobId, message: "Server creation started." });
  } catch (err: any) {
    console.error("[api] POST /api/servers error:", err);
    res.status(500).json({ error: "Failed to start server creation.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/create-progress/:jobId — poll async creation progress
// ---------------------------------------------------------------------------
router.get("/create-progress/:jobId", (req: Request, res: Response) => {
  const job = getCreateJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Create job not found (finished or expired)." });
    return;
  }
  res.json(job);
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/start
// ---------------------------------------------------------------------------
router.post("/:id/start", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    if (!server.containerId) {
      res.status(500).json({ error: "Server has no associated container." });
      return;
    }

    await startContainer(server.containerId);
    res.json({ message: `Server "${server.name}" is starting.` });
    // Discord: send initial status embed + start live updater + stats stream
    if (server.discordWebhook) {
      initLiveStats(server.id, server.ram * 1e6);
      // Start Docker stats stream to feed liveStore (independent of WebSocket)
      import("../services/docker").then(({ getStatsStream }) => {
        getStatsStream(server.containerId!).then(stream => {
          stream.on("data", (chunk: Buffer) => {
            try {
              const raw = JSON.parse(chunk.toString());
              const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
              const sysDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
              if (cpuDelta > 0 && sysDelta > 0) {
                const cpu = (cpuDelta / sysDelta) * raw.cpu_stats.online_cpus * 100;
                const memUsage = raw.memory_stats?.usage ?? 0;
                setLiveStats(server.id, { cpuPercent: Math.round(cpu * 100) / 100, memoryUsage: memUsage });
              }
            } catch {}
          });
          stream.on("error", () => stream.destroy());
          // Store stream ref so we can destroy on stop
          (server as any)._discordStatsStream = stream;
        }).catch(() => {});
      });
      // Send ONE embed — edited live every 10s
      const embed = buildStatusEmbed(server.id, server.name, server.serverType, server.version, server.port, "online");
      sendDiscordEmbed(server.discordWebhook, embed).then(async msgId => {
        if (msgId) {
          await updateServer(server.id, { discordMessageId: msgId } as any);
          startStatusEmbedUpdater(server.discordWebhook!, msgId, server.id,
            server.name, server.serverType, server.version, server.port);
        }
      });
    }
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/start error:", err);
    res
      .status(500)
      .json({ error: "Failed to start server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/stop
// ---------------------------------------------------------------------------
router.post("/:id/stop", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    if (!server.containerId) {
      res.status(500).json({ error: "Server has no associated container." });
      return;
    }

    await stopContainer(server.containerId);
    // Discord: stop updater + edit embed immediately (before HTTP response)
    if (server.discordWebhook) {
      stopStatusEmbedUpdater(server.id);
      clearLiveStats(server.id);
      if ((server as any)._discordStatsStream) { (server as any)._discordStatsStream.destroy(); }
      if (server.discordMessageId) {
        const offlineEmbed = buildStatusEmbed(server.id, server.name, server.serverType, server.version, server.port, "offline");
        await editDiscordEmbed(server.discordWebhook, server.discordMessageId, offlineEmbed);
        await updateServer(server.id, { discordMessageId: undefined as any });
      }
    }
    res.json({ message: `Server "${server.name}" is stopping.` });
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/stop error:", err);
    res
      .status(500)
      .json({ error: "Failed to stop server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/restart
// ---------------------------------------------------------------------------
router.post("/:id/restart", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }
    if (!server.containerId) { res.status(500).json({ error: "Server has no associated container." }); return; }

    // Stop with grace period, then start.
    await stopContainer(server.containerId);
    await startContainer(server.containerId);
    console.log(`[api] Restarted server "${server.name}"`);
    res.json({ message: `Server "${server.name}" restarted.` });

    // Re-init Discord after restart
    if (server.discordWebhook) {
      stopStatusEmbedUpdater(server.id);
      if ((server as any)._discordStatsStream) { (server as any)._discordStatsStream.destroy(); }
      initLiveStats(server.id, server.ram * 1e6);
      import("../services/docker").then(({ getStatsStream }) => {
        getStatsStream(server.containerId!).then(stream => {
          stream.on("data", (chunk: Buffer) => {
            try {
              const raw = JSON.parse(chunk.toString());
              const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
              const sysDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
              if (cpuDelta > 0 && sysDelta > 0) {
                const cpu = (cpuDelta / sysDelta) * raw.cpu_stats.online_cpus * 100;
                setLiveStats(server.id, { cpuPercent: Math.round(cpu * 100) / 100, memoryUsage: raw.memory_stats?.usage ?? 0 });
              }
            } catch {}
          });
          stream.on("error", () => stream.destroy());
          (server as any)._discordStatsStream = stream;
        }).catch(() => {});
      });
      const embed = buildStatusEmbed(server.id, server.name, server.serverType, server.version, server.port, "online");
      if (server.discordMessageId) {
        editDiscordEmbed(server.discordWebhook, server.discordMessageId, embed);
        startStatusEmbedUpdater(server.discordWebhook, server.discordMessageId, server.id,
          server.name, server.serverType, server.version, server.port);
      } else {
        sendDiscordEmbed(server.discordWebhook, embed).then(async msgId => {
          if (msgId) {
            await updateServer(server.id, { discordMessageId: msgId } as any);
            startStatusEmbedUpdater(server.discordWebhook!, msgId, server.id,
              server.name, server.serverType, server.version, server.port);
          }
        });
      }
    }
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/restart error:", err);
    res.status(500).json({ error: "Failed to restart server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/recreate — rebuild the container, keeping all data
// ---------------------------------------------------------------------------
// Recreates the Docker container from the current config (data dir is bind-
// mounted, so the world/plugins survive). Useful after code updates that
// change container settings (non-root user, RCON binding, TERM, images…).
router.post("/:id/recreate", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }

    // Remember whether it was running so we can restore the state afterwards.
    let wasRunning = false;
    if (server.containerId) {
      try { wasRunning = (await inspectContainer(server.containerId)).running; } catch {}
      try { await stopContainer(server.containerId); } catch {}
      try { await deleteContainer(server.containerId); } catch (err: any) {
        console.error("[api] Recreate: failed to delete old container:", err.message);
      }
    }

    const ver = server.version === "pending" ? "1.21.1" : server.version;
    const javaImage = resolveJavaImageForServer(ver, server.serverType);
    const newId = await createContainer(server, javaImage, {
      jarName: resolveLaunchJar(server),
      javaArgs: server.javaArgs,
    });

    await updateServer(server.id, { containerId: newId } as any);

    if (wasRunning) {
      try { await startContainer(newId); } catch (err: any) {
        console.error("[api] Recreate: auto-start failed:", err.message);
      }
    }

    console.log(`[api] Recreated container for "${server.name}" (${newId.slice(0, 12)}), running: ${wasRunning}`);
    res.json({ message: `Container for "${server.name}" recreated.`, containerId: newId, started: wasRunning });
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/recreate error:", err);
    res.status(500).json({ error: "Failed to recreate container.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/logs — docker logs (container stdout/stderr)
// ---------------------------------------------------------------------------
router.get("/:id/logs", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }
    if (!server.containerId) { res.status(400).json({ error: "Server has no associated container." }); return; }

    const tail = Math.min(Math.max(parseInt(req.query.tail as string) || 200, 10), 5000);
    const { execFile } = await import("node:child_process");
    const output = await new Promise<string>((resolve, reject) => {
      execFile("docker", ["logs", "--tail", String(tail), server.containerId!], {
        timeout: 10_000, encoding: "utf-8",
      }, (err: Error | null, stdout: string) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    res.json({ logs: output, serverId: server.id, tail });
  } catch (err: any) {
    console.error("[api] GET /api/servers/:id/logs error:", err);
    res.status(500).json({ error: "Failed to read container logs.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/log — log FILES (newest rotated archive + latest.log)
// ---------------------------------------------------------------------------
// latest.log only spans the current rotation period; the history (e.g. the
// startup after a restart) lives in the rotated `logs/*.log.gz` archives.
// This endpoint combines the newest archive (older) with latest.log (current)
// so the whole recent story is visible in one view.

const MAX_LOG_BYTES = 1_048_576; // 1 MB tail cap per source

/** Keep only the last `maxBytes` of decompressed text, cut at a line boundary. */
function tailBuffer(buf: Buffer, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf.toString("utf8");
  let text = buf.subarray(buf.length - maxBytes).toString("utf8");
  const nl = text.indexOf("\n");
  if (nl > 0) text = text.slice(nl + 1);
  return text;
}

/** Decompress a .log.gz archive completely (bounded by caller usage). */
function gunzipFile(filePath: string): Promise<Buffer> {
  return fs.promises.readFile(filePath).then((buf) =>
    new Promise<Buffer>((resolve, reject) => {
      zlib.gunzip(buf, (err, out) => (err ? reject(err) : resolve(out)));
    }),
  );
}

/**
 * Find the newest `*.log.gz` in a server's logs dir and return its decompressed
 * tail. Cached per file (keyed by name+mtime+size) so the 5 s LogsTab poll
 * doesn't re-decompress a static archive on every tick.
 */
const gzCache = new Map<string, { key: string; content: string; at: number }>();
const GZ_CACHE_TTL_MS = 10 * 60_000;

/** Decompressed tail of one gz archive, cached by name+mtime+size. */
async function getGzTailCached(logsDir: string, name: string): Promise<string | null> {
  const filePath = path.join(logsDir, name);
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    return null;
  }
  const key = `${name}:${st.mtimeMs}:${st.size}`;
  const cached = gzCache.get(name);
  if (cached && cached.key === key && Date.now() - cached.at < GZ_CACHE_TTL_MS) {
    return cached.content;
  }
  try {
    const buf = await gunzipFile(filePath);
    const content = tailBuffer(buf, MAX_LOG_BYTES);
    gzCache.set(name, { key, content, at: Date.now() });
    return content;
  } catch {
    return null; // corrupted archive — skip it
  }
}

async function getRotatedLogTail(
  logsDir: string,
): Promise<{ name: string; content: string } | null> {
  let newest: { name: string; mtimeMs: number } | null = null;
  try {
    const names = await fs.promises.readdir(logsDir);
    for (const name of names) {
      if (!name.endsWith(".log.gz")) continue;
      const st = await fs.promises.stat(path.join(logsDir, name));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name, mtimeMs: st.mtimeMs };
    }
  } catch {
    return null; // logs dir missing/empty — fine
  }
  if (!newest) return null;
  const content = await getGzTailCached(logsDir, newest.name);
  return content ? { name: newest.name, content } : null;
}

/** Plain-text file tail, capped to MAX_LOG_BYTES (streams the tail for big files). */
async function getPlainTail(filePath: string): Promise<string> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    return "";
  }
  if (st.size <= MAX_LOG_BYTES) {
    const buf = await fs.promises.readFile(filePath);
    return tailBuffer(buf, MAX_LOG_BYTES);
  }
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(MAX_LOG_BYTES);
    const { bytesRead } = await fh.read(buf, 0, MAX_LOG_BYTES, st.size - MAX_LOG_BYTES);
    return tailBuffer(buf.subarray(0, bytesRead), MAX_LOG_BYTES);
  } finally {
    await fh.close();
  }
}

// GET /api/servers/:id/log — combined view (newest rotated archive + latest.log),
// or a single file when ?file=<name> is given (gz archives are decompressed).
router.get("/:id/log", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }

    const logsDir = path.join(server.dataPath, "logs");

    // ---- single-file view (Logs tab file list) ----
    const wanted = req.query.file as string | undefined;
    if (wanted) {
      const safeName = path.basename(String(wanted).replace(/\\/g, "/"));
      if (!safeName || safeName === "." || safeName === "..") {
        res.status(400).json({ error: "Invalid file name." });
        return;
      }
      const filePath = path.join(logsDir, safeName);
      try {
        await fs.promises.stat(filePath);
      } catch {
        res.status(404).json({ error: "Log file not found." });
        return;
      }
      const content = safeName.endsWith(".gz")
        ? ((await getGzTailCached(logsDir, safeName)) ?? "")
        : await getPlainTail(filePath);
      res.json({
        path: `/logs/${safeName}`,
        sources: [safeName],
        size: Buffer.byteLength(content, "utf8"),
        content,
      });
      return;
    }

    // ---- combined view (older history first, then the current log) ----
    const parts: string[] = [];
    const sources: string[] = [];

    const rotated = await getRotatedLogTail(logsDir);
    if (rotated?.content) { parts.push(rotated.content); sources.push(rotated.name); }

    const latest = await getPlainTail(path.join(logsDir, "latest.log"));
    if (latest) { parts.push(latest); sources.push("latest.log"); }

    const content = parts.join("\n");
    res.json({ path: "/logs", sources, size: Buffer.byteLength(content, "utf8"), content });
  } catch (err: any) {
    console.error("[api] GET /api/servers/:id/log error:", err);
    res.status(500).json({ error: "Failed to read log files." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers
// ---------------------------------------------------------------------------
router.get("/", async (_req: Request, res: Response) => {
  try {
    const servers = await loadServers();

    // Gather container ids that are known.
    const ids = servers
      .map((s) => s.containerId)
      .filter((id): id is string => id !== null);

    const statuses = await listManagedContainerStatuses(ids);

    const result: ServerStatus[] = servers.map((s) => {
      const st = s.containerId
        ? statuses.get(s.containerId)
        : undefined;
      return {
        id: s.id,
        name: s.name,
        serverType: s.serverType ?? "paper",
        ram: s.ram,
        port: s.port,
        version: s.version,
        status: (st?.status as ServerStatus["status"]) ?? "unknown",
        containerId: s.containerId,
        javaArgs: s.javaArgs ?? null,
        maxPlayers: s.maxPlayers ?? 20,
        voicePort: s.voicePort ?? null,
        discordWebhook: s.discordWebhook ?? null,
        startedAt: st?.startedAt ?? null,
        tag: s.tag ?? null,
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error("[api] GET /api/servers error:", err);
    res
      .status(500)
      .json({ error: "Failed to list servers.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/servers/:id
// ---------------------------------------------------------------------------
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }

    // 0. (no safety snapshot — user opted out of auto-backups)

    // 1. Remove Docker container (best-effort).
    if (server.containerId) {
      try { await deleteContainer(server.containerId); } catch (err: any) {
        console.error("[api] Failed to delete container:", err.message);
      }
    }

    // 2. Remove data directory.
    try {
      fs.rmSync(server.dataPath, { recursive: true, force: true });
    } catch (err: any) {
      console.error("[api] Failed to delete data directory:", err.message);
    }

    // 3. Remove from config store.
    await removeServer(server.id);

    console.log(`[api] Deleted server "${server.name}" (${server.id.slice(0, 8)})`);
    res.json({ message: `Server "${server.name}" deleted.` });
  } catch (err: any) {
    console.error("[api] DELETE /api/servers/:id error:", err);
    res.status(500).json({ error: "Failed to delete server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Backups — stored on the server under backups/<serverId>/ and managed in the UI
//   POST   /:id/backup                     start a backup job (async, poll progress)
//   GET    /backups/progress/:jobId        poll backup job progress
//   GET    /:id/backups                    list stored backups
//   GET    /:id/backups/:name/download     download one backup
//   POST   /:id/backups/:name/restore      restore from a stored backup
//   DELETE /:id/backups/:name              delete one backup
//   POST   /:id/restore                    upload + restore a local .tar.gz
// ---------------------------------------------------------------------------

router.get("/backups/progress/:jobId", (req: Request, res: Response) => {
  const job = getBackupJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Backup job not found (it may have finished more than a minute ago)." });
    return;
  }
  res.json(job);
});

router.post("/:id/backup", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const { jobId, name } = await startBackupJob(server, "manual");
    console.log(`[api] Backup job started: ${name} (${jobId})`);
    res.status(202).json({ message: "Backup started.", jobId, name });
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/backup error:", err);
    res.status(500).json({ error: "Failed to start backup.", detail: err.message });
  }
});

router.get("/:id/backups", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const backups = await listBackups(server.id);
    res.json(backups);
  } catch (err: any) {
    console.error("[api] GET /api/servers/:id/backups error:", err);
    res.status(500).json({ error: "Failed to list backups.", detail: err.message });
  }
});

router.get("/:id/backups/:name/download", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const { backupPathFor } = await import("../services/backups");
    const filePath = backupPathFor(server.id, req.params.name);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Backup not found." });
      return;
    }
    // Explicit Content-Length lets the frontend show a real download
    // percentage (res.pipe alone would use chunked transfer → no length).
    const st = fs.statSync(filePath);
    res.set("Content-Type", "application/gzip");
    res.set("Content-Length", String(st.size));
    res.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    console.error("[api] GET backup download error:", err);
    res.status(500).json({ error: "Failed to download backup.", detail: err.message });
  }
});

router.post("/:id/backups/:name/restore", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const { backupPathFor } = await import("../services/backups");
    const filePath = backupPathFor(server.id, req.params.name);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Backup not found." });
      return;
    }

    await restoreFromArchive(server, filePath);
    console.log(`[api] Restored server "${server.name}" from backup ${req.params.name}`);
    res.json({ message: `Server "${server.name}" restored from backup.` });
  } catch (err: any) {
    console.error("[api] POST backup restore error:", err);
    res.status(500).json({ error: "Failed to restore backup.", detail: err.message });
  }
});

router.delete("/:id/backups/:name", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const ok = await deleteBackup(server.id, req.params.name);
    if (!ok) {
      res.status(404).json({ error: "Backup not found." });
      return;
    }
    res.json({ message: "Backup deleted." });
  } catch (err: any) {
    console.error("[api] DELETE backup error:", err);
    res.status(500).json({ error: "Failed to delete backup.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/restore — upload and restore a .tar.gz backup
// ---------------------------------------------------------------------------
const restoreUpload = multer({ dest: "/tmp/mcpanel-restores", limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2 GB
// Ensure restore temp dir exists
try { fs.mkdirSync("/tmp/mcpanel-restores", { recursive: true }); } catch {}

router.post("/:id/restore", restoreUpload.single("backup"), async (req: Request, res: Response) => {
  const uploadPath = req.file?.path;
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    if (!uploadPath) {
      res.status(400).json({ error: "No backup file uploaded." });
      return;
    }

    await restoreFromArchive(server, uploadPath);
    console.log(`[api] Restored server "${server.name}" from uploaded backup`);
    res.json({ message: `Server "${server.name}" restored and restarted.` });
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/restore error:", err);
    res.status(500).json({ error: "Failed to restore backup.", detail: err.message });
  } finally {
    // Never leave multer temp files behind.
    if (uploadPath) {
      try { fs.unlinkSync(uploadPath); } catch { /* already gone */ }
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/command — execute command via RCON
// ---------------------------------------------------------------------------
router.post("/:id/command", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const { command } = req.body ?? {};
    if (typeof command !== "string") {
      res.status(400).json({ error: "Field 'command' (string) is required." });
      return;
    }
    const cmd = command.trim();
    if (!cmd) {
      res.status(400).json({ error: "Field 'command' must not be empty." });
      return;
    }
    if (cmd.length > 1000) {
      res.status(400).json({ error: "Command too long (max 1000 characters)." });
      return;
    }
    if (/[\r\n]/.test(cmd)) {
      res.status(400).json({ error: "Command must not contain line breaks." });
      return;
    }

    if (!server.rconPort || !server.rconPassword) {
      res.status(400).json({ error: "RCON is not configured for this server. Only servers created after the RCON update support this feature." });
      return;
    }

    const { sendRcon } = await import("../services/rcon");
    const response = await sendRcon("127.0.0.1", server.rconPort, server.rconPassword, cmd);
    res.json({ response });
  } catch (err: any) {
    console.error("[api] RCON command error:", err);
    res.status(500).json({ error: "RCON command failed.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/players — Minecraft server ping for player count
// ---------------------------------------------------------------------------
router.get("/:id/players", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const result = await pingMinecraftServer("127.0.0.1", server.port);
    if (result === null) {
      res.json({ online: 0, max: 0, unreachable: true });
    } else {
      res.json({ ...result, unreachable: false });
    }
  } catch (err: any) {
    res.status(500).json({ error: "Failed to ping server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/disk — disk usage in bytes (fast `du -sb`)
// ---------------------------------------------------------------------------
router.get("/:id/disk", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }

    const { execFile } = await import("node:child_process");
    const dataPath = server.dataPath;
    if (!fs.existsSync(dataPath)) {
      res.json({ bytes: 0, path: dataPath });
      return;
    }
    const { stdout: output } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("du", ["-sb", dataPath], {
        timeout: 10_000,
        encoding: "utf-8",
      }, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout });
      });
    });
    const bytes = parseInt(output.trim().split(/\s+/)[0], 10) || 0;
    res.json({ bytes, path: dataPath });
  } catch (err: any) {
    if (err.killed || err.code === "ETIMEDOUT") {
      res.json({ bytes: -1, path: "", error: "Timeout" });
    } else {
      res.status(500).json({ error: "Failed to get disk usage.", detail: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// PUT /api/servers/:id — update server config (name, ram, port, version)
// ---------------------------------------------------------------------------
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }

    const { name, ram: ramStr, port, version, javaArgs, voicePort, discordWebhook, tag } = req.body ?? {};

    // Validate name if provided
    if (name !== undefined && (typeof name !== "string" || !isValidServerName(name))) {
      res.status(400).json({ error: "Field 'name' must be 1-60 characters and must not contain line breaks or double quotes." });
      return;
    }

    // Validate tag if provided (empty string clears it)
    if (tag !== undefined && tag !== null) {
      if (typeof tag !== "string" || tag.length > 20 || !/^[a-zA-Z0-9 _-]*$/.test(tag)) {
        res.status(400).json({ error: "Invalid tag. Use letters, digits, spaces, _ or - (max 20 chars)." });
        return;
      }
    }

    // Validate RAM if provided
    let ram: number | undefined;
    if (ramStr !== undefined) {
      try {
        ram = parseRamToMB(ramStr);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }
    }

    // Validate port if provided
    if (port !== undefined) {
      // Max 65525 — the RCON port is auto-assigned as port + 10 and must stay ≤ 65535.
      if (typeof port !== "number" || port < 1024 || port > 65525) {
        res.status(400).json({ error: "Field 'port' must be between 1024 and 65525." });
        return;
      }
      // Port conflict check (exclude current server)
      const existing = await loadServers();
      if (existing.some((s) => s.id !== server.id && s.port === port)) {
        res.status(409).json({ error: `Port ${port} is already in use by another server.` });
        return;
      }
    }

    // Validate version if provided
    if (version !== undefined && (typeof version !== "string" || !version.trim())) {
      res.status(400).json({ error: "Field 'version' must be a non-empty string." });
      return;
    }

    // Validate javaArgs if provided (optional, can be empty to clear)
    if (javaArgs !== undefined && (typeof javaArgs !== "string" || !isValidJavaArgs(javaArgs))) {
      res.status(400).json({ error: "javaArgs contains unsupported characters. Only JVM flags (letters, digits, +-.:/=%_) are allowed." });
      return;
    }

    // Validate voicePort if provided (optional UDP port, can be null to clear)
    if (voicePort !== undefined && voicePort !== null) {
      if (typeof voicePort !== "number" || voicePort < 1024 || voicePort > 65535) {
        res.status(400).json({ error: "Field 'voicePort' must be between 1024 and 65535." });
        return;
      }
      const existing = await loadServers();
      if (existing.some((s) => s.id !== server.id && s.voicePort === voicePort)) {
        res.status(409).json({ error: "Voice port " + voicePort + " is already in use by another server." });
        return;
      }
    }

    const updated = await updateServer(server.id, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(ram !== undefined ? { ram } : {}),
      // Port changes also update the RCON port (port + 10) so the stored
      // config stays in sync even before the container is recreated.
      ...(port !== undefined ? { port, rconPort: port + 10 } : {}),
      ...(version !== undefined ? { version: version.trim() } : {}),
      ...(javaArgs !== undefined ? { javaArgs: javaArgs?.trim() || (undefined as any) } : {}),
      ...(voicePort !== undefined ? { voicePort: voicePort ?? (undefined as any) } : {}),
      ...(discordWebhook !== undefined ? { discordWebhook: discordWebhook || undefined } : {}),
      ...(tag !== undefined ? { tag: (tag as string)?.trim() || undefined } : {}),
    });

    console.log("[api] Updated server " + (updated?.name ?? "?") + " config");

    // If RAM was changed and container exists, update Docker memory limit live
    if (ram !== undefined && server.containerId) {
      try {
        const Docker = (await import("dockerode")).default;
        const docker = new Docker();
        const c = docker.getContainer(server.containerId);
        await c.update({ Memory: ram * 1024 * 1024 });
      } catch (memErr: any) {
        // Non-fatal — config is saved, just couldn't update live container
      }
    }

    // Port changes must also be written into the server's own config files so
    // the change survives a container recreate (server.properties / velocity.toml).
    // The Docker port binding itself only changes after Recreate.
    let recreateRequired = false;
    if (port !== undefined && port !== server.port) {
      recreateRequired = true;
      try {
        if (server.serverType === "velocity") {
          const tomlPath = path.join(server.dataPath, "velocity.toml");
          if (fs.existsSync(tomlPath)) {
            const raw = fs.readFileSync(tomlPath, "utf-8").replace(/^bind\s*=\s*".*"/m, `bind = "0.0.0.0:${port}"`);
            fs.writeFileSync(tomlPath, raw);
          }
        } else {
          const propsPath = path.join(server.dataPath, "server.properties");
          if (fs.existsSync(propsPath)) {
            const raw = fs
              .readFileSync(propsPath, "utf-8")
              .replace(/^server-port=.*$/m, `server-port=${port}`)
              .replace(/^rcon.port=.*$/m, `rcon.port=${port + 10}`);
            fs.writeFileSync(propsPath, raw);
          }
        }
      } catch (fileErr: any) {
        console.error("[api] Failed to patch config file for port change:", fileErr.message);
      }
    }

    res.json({
      id: updated?.id,
      name: updated?.name,
      ram: updated?.ram,
      port: updated?.port,
      version: updated?.version,
      javaArgs: updated?.javaArgs ?? null,
      voicePort: updated?.voicePort ?? null,
      // true if the port changed — the running container still binds the old
      // port until the user recreates it.
      portChanged: port !== undefined && port !== server.port,
      recreateRequired,
    });
  } catch (err: any) {
    console.error("[api] PUT /api/servers/:id error:", err);
    res.status(500).json({ error: "Failed to update server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET  /api/servers/:id/properties — read server.properties as key=value
// PUT  /api/servers/:id/properties — write server.properties
// ---------------------------------------------------------------------------
router.get("/:id/properties", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }

    const propsPath = path.join(server.dataPath, "server.properties");
    if (!fs.existsSync(propsPath)) {
      res.json({ properties: {}, motd: server.name, motdRaw: "" });
      return;
    }

    const raw = fs.readFileSync(propsPath, "utf-8");
    const props: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      props[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }

    res.json({
      properties: props,
      motd: props.motd ?? server.name,
      motdRaw: raw.split("\n").find(l => l.startsWith("motd="))?.slice(5) ?? "",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read properties.", detail: err.message });
  }
});

router.put("/:id/properties", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }
    if (server.serverType === "velocity") {
      res.status(400).json({ error: "Velocity proxies use velocity.toml, not server.properties." });
      return;
    }

    const { properties } = req.body ?? {};
    if (!properties || typeof properties !== "object") {
      res.status(400).json({ error: "Field 'properties' (object) is required." });
      return;
    }

    // Reject security-relevant / panel-breaking keys and property injection
    // via newlines. (The panel's RCON config and port mapping must not be
    // changeable through this endpoint.)
    const BLOCKED_KEYS = [
      "server-port", "server-ip", "enable-rcon", "rcon.password", "rcon.port",
      "level-name", "enable-query", "query.port",
    ];
    for (const key of Object.keys(properties)) {
      if (key.startsWith("rcon.") || key.startsWith("query.") || BLOCKED_KEYS.includes(key)) {
        res.status(400).json({ error: `Property '${key}' cannot be changed via the panel.` });
        return;
      }
      if (key.includes("\n") || key.includes("\r")) {
        res.status(400).json({ error: "Invalid property key." });
        return;
      }
      const value = String(properties[key]);
      if (value.includes("\n") || value.includes("\r")) {
        res.status(400).json({ error: `Property '${key}' contains newlines (property injection).` });
        return;
      }
    }

    const propsPath = path.join(server.dataPath, "server.properties");
    const existing = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, "utf-8") : "";

    // Rebuild the file, replacing matching keys, keeping comments + unknown keys
    const updatedKeys = new Set(Object.keys(properties));
    const lines: string[] = [];
    for (const line of existing.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) { lines.push(line); continue; }
      const eq = trimmed.indexOf("=");
      if (eq === -1) { lines.push(line); continue; }
      const key = trimmed.slice(0, eq).trim();
      if (updatedKeys.has(key)) {
        lines.push(`${key}=${properties[key]}`);
        updatedKeys.delete(key);
      } else {
        lines.push(line);
      }
    }
    // Append any new keys that weren't in the original file
    for (const key of updatedKeys) {
      lines.push(`${key}=${properties[key]}`);
    }

    fs.writeFileSync(propsPath, lines.join("\n") + "\n");
    res.json({ message: "server.properties updated." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save properties.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/icon — upload server-icon.png
// ---------------------------------------------------------------------------
const iconUpload = multer({ dest: "/tmp/mcpanel-icons", limits: { fileSize: 1024 * 1024 } }); // 1 MB
try { fs.mkdirSync("/tmp/mcpanel-icons", { recursive: true }); } catch {}

router.post("/:id/icon", iconUpload.single("icon"), async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }
    if (!req.file) { res.status(400).json({ error: "No icon file uploaded." }); return; }

    // Must be PNG
    if (req.file.mimetype !== "image/png") {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(400).json({ error: "Icon must be a PNG image (64×64 recommended)." });
      return;
    }

    // Resize to 64×64 using sharp if available, else just copy
    const destPath = path.join(server.dataPath, "server-icon.png");
    const { copyFile, unlink } = await import("node:fs/promises");
    await copyFile(req.file.path, destPath);
    await unlink(req.file.path);

    res.json({ message: "Server icon uploaded. Restart the server to apply." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to upload icon.", detail: err.message });
  }
});




// ---------------------------------------------------------------------------
// GET  /api/servers/:id/schedule — read scheduled tasks
// PUT  /api/servers/:id/schedule — write scheduled tasks
// ---------------------------------------------------------------------------
/** Server-local timezone info so the frontend can tell the user which clock
 *  the scheduler runs on (scheduled HH:MM values are interpreted in this zone). */
function getServerTimezone(): { id: string; offsetMinutes: number } {
  let id = "UTC";
  try { id = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }
  return { id, offsetMinutes: -new Date().getTimezoneOffset() };
}

router.get("/:id/schedule", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }
    res.json({ schedule: server.schedule ?? {}, timezone: getServerTimezone() });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read schedule.", detail: err.message });
  }
});

router.put("/:id/schedule", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.id);
    if (!server) { res.status(404).json({ error: "Server not found." }); return; }
    const { restart, backup } = req.body ?? {};

    // Validate HH:MM format
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (restart !== undefined && restart !== null && restart !== "" && !timeRe.test(restart)) {
      res.status(400).json({ error: "restart must be HH:MM format or null." }); return;
    }
    if (backup !== undefined && backup !== null && backup !== "" && !timeRe.test(backup)) {
      res.status(400).json({ error: "backup must be HH:MM format or null." }); return;
    }

    const schedule: any = { ...(server.schedule ?? {}) };
    if (restart !== undefined) schedule.restart = restart || undefined;
    if (backup !== undefined) schedule.backup = backup || undefined;

    // Clean up empty schedule
    if (!schedule.restart && !schedule.backup) {
      (server as any).schedule = undefined;
    } else {
      (server as any).schedule = schedule;
    }

    await updateServer(server.id, { schedule: (server as any).schedule } as any);
    res.json({ message: "Schedule updated.", schedule: (server as any).schedule ?? {} });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save schedule.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/curseforge/search — proxy CF modpack search
// ---------------------------------------------------------------------------
router.post("/curseforge/search", async (req: Request, res: Response) => {
  try {
    const { apiKey, query } = req.body ?? {};
    if (!apiKey) { res.status(400).json({ error: "CurseForge API key required." }); return; }
    const results = await searchModpacks(apiKey, query || "");
    res.json(results);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/curseforge/files — proxy CF modpack files
// ---------------------------------------------------------------------------
router.post("/curseforge/files", async (req: Request, res: Response) => {
  try {
    const { apiKey, modpackId } = req.body ?? {};
    if (!apiKey) { res.status(400).json({ error: "CurseForge API key required." }); return; }
    if (!modpackId) { res.status(400).json({ error: "modpackId required." }); return; }
    const files = await getModpackFiles(apiKey, modpackId);
    res.json(files);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/modpack — install a CurseForge modpack
// ---------------------------------------------------------------------------
router.post("/modpack", async (req: Request, res: Response) => {
  try {
    const { apiKey, modpackId, fileId, name, ram: ramRaw, port } = req.body ?? {};
    if (!apiKey || typeof apiKey !== "string") {
      res.status(400).json({ error: "CurseForge API key is required." });
      return;
    }
    if (!modpackId || !fileId) {
      res.status(400).json({ error: "Fields 'modpackId' and 'fileId' are required." });
      return;
    }

    const serverName = name?.trim() || `Modpack-${modpackId}`;
    let ram: number;
    try { ram = ramRaw ? parseRamToMB(ramRaw) : 4096; }
    catch (err: any) { res.status(400).json({ error: err.message }); return; }

    const serverPort = port ?? 25565;
    if (typeof serverPort !== "number" || serverPort < 1024 || serverPort > 65525) {
      res.status(400).json({ error: "Port must be between 1024 and 65525." });
      return;
    }

    const existing = await loadServers();
    if (existing.some(s => s.port === serverPort)) {
      res.status(409).json({ error: `Port ${serverPort} is already in use.` });
      return;
    }

    // Create server config immediately (fast)
    const config = await createModpackServer(serverName, ram, serverPort);
    console.log(`[api] Modpack install queued: ${config.id.slice(0, 8)} (modpack ${modpackId})`);

    // Start install in background
    runModpackInstall(config, apiKey, modpackId, fileId);

    // Respond immediately with server ID
    res.status(201).json({
      id: config.id,
      name: config.name,
      ram: config.ram,
      port: config.port,
    });
  } catch (err: any) {
    console.error("[api] Modpack install error:", err.message);
    res.status(400).json({ error: err.message || "Failed to install modpack." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/modpack/progress/:id — poll install progress
// ---------------------------------------------------------------------------
router.get("/modpack/progress/:id", (req: Request, res: Response) => {
  const progress = installProgress.get(req.params.id);
  if (!progress) {
    res.json({ step: "Starting…", percent: 0 });
    return;
  }
  res.json(progress);
});


export default router;
