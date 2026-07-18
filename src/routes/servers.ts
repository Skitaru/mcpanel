// ---- Minecraft Server Panel: /api/servers routes ----

import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
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
  resolveJavaImage,
} from "../services/docker";

const router = Router();

// Where per-server data directories live on the host
const DATA_ROOT = path.resolve(process.cwd(), "data");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a human RAM string ("4G", "512M") or raw number into megabytes. */
function parseRamToMB(ram: string | number): number {
  if (typeof ram === "number") {
    if (ram < 512 || ram > 65536) {
      throw new Error("RAM must be between 512 and 65536 (MB).");
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
  if (mb < 512 || mb > 65536) {
    throw new Error("RAM must be between 512 and 65536 (MB).");
  }
  return mb;
}

/**
 * Ping a Minecraft server using the Server List Ping protocol.
 * Returns player count + player list or null if the server is unreachable.
 */
function pingMinecraftServer(host: string, port: number, timeoutMs = 3000): Promise<{ online: number; max: number; players: { name: string; id: string }[] } | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf: Buffer = Buffer.alloc(0);
    let resolved = false;

    const done = (result: { online: number; max: number; players: { name: string; id: string }[] } | null) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => done(null));
    socket.on("error", () => done(null));

    socket.connect(port, host, () => {
      const hostBytes = Buffer.from(host, "utf8");
      const writeVarInt = (b: Buffer, val: number): Buffer => {
        do {
          let temp = val & 0x7f;
          val >>>= 7;
          if (val !== 0) temp |= 0x80;
          b = Buffer.concat([b, Buffer.from([temp])]);
        } while (val !== 0);
        return b;
      };

      let pkt: Buffer = Buffer.from([0x00]);
      pkt = writeVarInt(pkt, -1);
      pkt = writeVarInt(pkt, hostBytes.length);
      pkt = Buffer.concat([pkt, hostBytes]);
      pkt = Buffer.concat([pkt, Buffer.from([port >> 8, port & 0xff])]);
      pkt = writeVarInt(pkt, 1);

      const len = writeVarInt(Buffer.alloc(0), pkt.length);
      socket.write(Buffer.concat([len, pkt]));
      socket.write(Buffer.from([0x01, 0x00]));
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]) as Buffer;
      try {
        // Parse VarInt length prefix
        let pos = 0;
        let length = 0;
        let shift = 0;
        while (pos < buf.length) {
          const b = buf[pos++];
          length |= (b & 0x7f) << shift;
          if (!(b & 0x80)) break;
          shift += 7;
        }
        if (pos + length > buf.length) return; // incomplete

        const payload = buf.subarray(pos, pos + length);
        if (payload[0] !== 0x00) return; // not a status response
        const jsonStr = payload.subarray(1).toString("utf8");
        const data = JSON.parse(jsonStr);
        if (data.players) {
          done({
            online: data.players.online ?? 0,
            max: data.players.max ?? 0,
            players: (data.players.sample ?? []).map((p: any) => ({ name: p.name, id: p.id })),
          });
        } else {
          done(null);
        }
      } catch {
        // incomplete or invalid, wait for more data
      }
    });
  });
}

/**
 * Download the latest PaperMC server jar for the given Minecraft version.
 * Saves it to `paper.jar` inside `dataPath`.
 *
 * Uses the PaperMC v2 API:
 *   1. GET …/versions/{version}/builds    → find latest build
 *   2. GET …/builds/{build}/downloads/…   → stream jar to disk
 */
async function downloadPaperJar(
  paperVersion: string,
  dataPath: string,
): Promise<void> {
  const headers = {
    "User-Agent": "MCPanel/1.0",
    Accept: "application/json",
  };

  const buildsUrl = `https://fill.papermc.io/v3/projects/paper/versions/${paperVersion}/builds`;

  // 1. Fetch build list (v3 returns a plain array, not { builds: [...] }).
  console.log(`[paper] Fetching builds for PaperMC ${paperVersion} …`);
  const buildsRes = await fetch(buildsUrl, { headers });
  if (!buildsRes.ok) {
    throw new Error(
      `PaperMC API returned ${buildsRes.status} for version "${paperVersion}". ` +
        `Verify the version exists at https://papermc.io/downloads/paper`,
    );
  }

  const buildsData = (await buildsRes.json()) as {
    id: number;
    channel: string;
    downloads: Record<string, { name: string; url?: string }>;
  }[];

  if (!Array.isArray(buildsData) || buildsData.length === 0) {
    throw new Error(`No builds available for PaperMC version "${paperVersion}".`);
  }

  // Prefer STABLE builds, fall back to the latest available.
  const stable = buildsData.filter((b) => b.channel === "STABLE");
  const build = stable.length > 0
    ? stable[stable.length - 1]
    : buildsData[buildsData.length - 1];

  const buildId = build.id;
  const dl = build.downloads["server:default"];
  if (!dl) {
    throw new Error(`No download found for build #${buildId}.`);
  }

  // 2. Download the jar (use direct URL from v3 API if available).
  const downloadUrl = dl.url
    ?? `https://fill.papermc.io/v3/projects/paper/versions/${paperVersion}/builds/${buildId}/downloads/${dl.name}`;

  console.log(`[paper] Downloading ${dl.name} (build #${buildId}) …`);
  const downloadRes = await fetch(downloadUrl, { headers });
  if (!downloadRes.ok) {
    throw new Error(
      `Failed to download PaperMC jar (HTTP ${downloadRes.status}).`,
    );
  }

  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const jarPath = path.join(dataPath, "paper.jar");
  fs.writeFileSync(jarPath, buffer);

  console.log(
    `[paper] Saved paper.jar (${(buffer.length / 1e6).toFixed(1)} MB) to ${jarPath}`,
  );
}

/**
 * Download the Fabric server launcher JAR from meta.fabricmc.net.
 */
async function downloadFabricJar(
  mcVersion: string,
  dataPath: string,
): Promise<void> {
  const headers = {
    "User-Agent": "MCPanel/1.0",
    Accept: "application/json",
  };

  console.log(`[fabric] Fetching Fabric loader for MC ${mcVersion} …`);
  const loaderRes = await fetch("https://meta.fabricmc.net/v2/versions/loader", { headers });
  if (!loaderRes.ok) throw new Error(`Fabric API returned ${loaderRes.status}`);
  const loaderData = (await loaderRes.json()) as { version: string }[];
  const loaderVer = loaderData[0]?.version;
  if (!loaderVer) throw new Error("No Fabric loader versions available.");

  const installerRes = await fetch("https://meta.fabricmc.net/v2/versions/installer", { headers });
  if (!installerRes.ok) throw new Error(`Fabric API returned ${installerRes.status}`);
  const installerData = (await installerRes.json()) as { version: string }[];
  const installerVer = installerData[0]?.version;
  if (!installerVer) throw new Error("No Fabric installer versions available.");

  console.log(`[fabric] Loader ${loaderVer} / Installer ${installerVer}`);

  const dlUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVer}/${installerVer}/server/jar`;
  console.log(`[fabric] Downloading fabric-server-launch.jar …`);
  const res = await fetch(dlUrl, { headers });
  if (!res.ok) throw new Error(`Fabric download failed (HTTP ${res.status}). Check if version "${mcVersion}" supports Fabric.`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const jarPath = path.join(dataPath, "fabric-server-launch.jar");
  fs.writeFileSync(jarPath, buffer);
  console.log(`[fabric] Saved fabric-server-launch.jar (${(buffer.length / 1e6).toFixed(1)} MB) to ${jarPath}`);
}

/**
 * Download the Velocity proxy JAR from PaperMC API.
 */
async function downloadVelocityJar(
  version: string,
  dataPath: string,
): Promise<void> {
  const headers = {
    "User-Agent": "MCPanel/1.0",
    Accept: "application/json",
  };

  const buildsUrl = `https://fill.papermc.io/v3/projects/velocity/versions/${version}/builds`;
  console.log(`[velocity] Fetching builds for Velocity ${version} …`);
  const buildsRes = await fetch(buildsUrl, { headers });
  if (!buildsRes.ok) throw new Error(`PaperMC API returned ${buildsRes.status} for Velocity "${version}".`);

  const buildsData = (await buildsRes.json()) as {
    id: number; channel: string;
    downloads: Record<string, { name: string; url?: string }>;
  }[];
  if (!Array.isArray(buildsData) || buildsData.length === 0) {
    throw new Error(`No builds available for Velocity "${version}".`);
  }

  const stable = buildsData.filter((b) => b.channel === "STABLE");
  const build = stable.length > 0 ? stable[stable.length - 1] : buildsData[buildsData.length - 1];
  const dl = build.downloads["server:default"];
  if (!dl) throw new Error(`No download found for build #${build.id}.`);

  const downloadUrl = dl.url
    ?? `https://fill.papermc.io/v3/projects/velocity/versions/${version}/builds/${build.id}/downloads/${dl.name}`;

  console.log(`[velocity] Downloading ${dl.name} …`);
  const downloadRes = await fetch(downloadUrl, { headers });
  if (!downloadRes.ok) throw new Error(`Failed to download Velocity jar (HTTP ${downloadRes.status}).`);

  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const jarPath = path.join(dataPath, "velocity.jar");
  fs.writeFileSync(jarPath, buffer);
  console.log(`[velocity] Saved velocity.jar (${(buffer.length / 1e6).toFixed(1)} MB) to ${jarPath}`);
}

// ---------------------------------------------------------------------------
// POST /api/servers
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateServerRequest;

    // ---- validation ----
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      res.status(400).json({ error: "Field 'name' is required." });
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
    if (typeof port !== "number" || port < 1024 || port > 65535) {
      res
        .status(400)
        .json({ error: "Field 'port' must be between 1024 and 65535." });
      return;
    }

    // ---- port conflict check ----
    const existing = loadServers();
    if (existing.some((s) => s.port === port)) {
      res
        .status(409)
        .json({ error: `Port ${port} is already in use by another server.` });
      return;
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

    // ---- resolve Java image ----
    let javaImage: string;
    if (serverType === "velocity") {
      javaImage = "eclipse-temurin:21-jre-alpine";
    } else if (serverType === "fabric") {
      javaImage = resolveJavaImage(mcVersion);
      if (javaImage === "eclipse-temurin:16-jre-alpine" || javaImage === "eclipse-temurin:8-jre-alpine") {
        javaImage = "eclipse-temurin:17-jre-alpine";
      }
    } else {
      javaImage = resolveJavaImage(mcVersion);
    }
    console.log(`[api] ${serverType} ${mcVersion} -> Java image ${javaImage}`);

    const id = uuid();
    const dataPath = path.join(DATA_ROOT, id);
    fs.mkdirSync(dataPath, { recursive: true });

    // ---- download server JAR based on type ----
    let jarName = "paper.jar";
    let extraCmd: string[] | undefined;

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
          `motd = "${body.name.trim()} | Velocity"`,
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
      try { fs.rmdirSync(dataPath); } catch {}
      res.status(400).json({
        error: `Failed to download ${serverType} server JAR.`,
        detail: err.message,
      });
      return;
    }

    // ---- generate RCON credentials and server.properties (not for velocity) ----
    const rconPort = port + 10;
    const rconPassword = uuid().replace(/-/g, "").slice(0, 16);

    if (serverType !== "velocity") {
      const typeLabel = serverType === "fabric" ? "Fabric" : "PaperMC";
      const serverProps = [
        `server-port=${port}`,
        `enable-rcon=true`,
        `rcon.port=${rconPort}`,
        `rcon.password=${rconPassword}`,
        `motd=${body.name.trim()} | ${typeLabel}`,
        `max-players=20`,
        `difficulty=normal`,
        `gamemode=survival`,
        `online-mode=true`,
      ].join("\n");
      fs.writeFileSync(path.join(dataPath, "server.properties"), serverProps + "\n");
    }

    // ---- persist config ----
    const config: ServerConfig = {
      id,
      name: body.name.trim(),
      serverType,
      ram,
      port,
      rconPort,
      rconPassword,
      version: mcVersion,
      containerId: null,
      dataPath,
    };
    addServer(config);

    // ---- create Docker container ----
    const containerId = await createContainer(config, javaImage, { jarName, extraCmd });

    // Update config with the real container id.
    config.containerId = containerId;
    removeServer(id);
    addServer(config);

    // Auto-start the container
    try {
      await startContainer(containerId);
      console.log(`[api] Auto-started ${serverType} server "${config.name}"`);
    } catch (startErr: any) {
      console.error(`[api] Auto-start failed: ${startErr.message}`);
    }

    res.status(201).json({
      id: config.id,
      name: config.name,
      serverType: config.serverType,
      ram: config.ram,
      port: config.port,
      version: config.version,
      javaImage,
      containerId: config.containerId,
      dataPath: config.dataPath,
    });
  } catch (err: any) {
    console.error("[api] POST /api/servers error:", err);
    res
      .status(500)
      .json({ error: "Failed to create server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/start
// ---------------------------------------------------------------------------
router.post("/:id/start", async (req: Request, res: Response) => {
  try {
    const server = getServer(req.params.id);
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
    const server = getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    if (!server.containerId) {
      res.status(500).json({ error: "Server has no associated container." });
      return;
    }

    await stopContainer(server.containerId);
    res.json({ message: `Server "${server.name}" is stopping.` });
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/stop error:", err);
    res
      .status(500)
      .json({ error: "Failed to stop server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers
// ---------------------------------------------------------------------------
router.get("/", async (_req: Request, res: Response) => {
  try {
    const servers = loadServers();

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
    const server = getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }

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
    removeServer(server.id);

    console.log(`[api] Deleted server "${server.name}" (${server.id.slice(0, 8)})`);
    res.json({ message: `Server "${server.name}" deleted.` });
  } catch (err: any) {
    console.error("[api] DELETE /api/servers/:id error:", err);
    res.status(500).json({ error: "Failed to delete server.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/backup
// ---------------------------------------------------------------------------
router.post("/:id/backup", async (req: Request, res: Response) => {
  try {
    const server = getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `backup-${server.id.slice(0, 8)}-${timestamp}.tar.gz`;
    const backupPath = path.join(server.dataPath, "..", backupName);

    // Use system `tar` (Linux, macOS, Git Bash on Windows).
    const { execSync } = await import("node:child_process");
    try {
      execSync(`tar -czf "${backupPath}" -C "${server.dataPath}" .`, {
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch (err: any) {
      res.status(500).json({
        error: "Backup failed — is `tar` installed?",
        detail: err.message,
      });
      return;
    }

    const stat = fs.statSync(backupPath);
    console.log(`[api] Backup: ${backupName} (${(stat.size / 1e6).toFixed(1)} MB)`);

    // Read file into buffer, send, then clean up
    const buffer = fs.readFileSync(backupPath);
    res.set("Content-Type", "application/gzip");
    res.set("Content-Disposition", `attachment; filename="${backupName}"`);
    res.send(buffer);
    try { fs.unlinkSync(backupPath); } catch {}
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/backup error:", err);
    res.status(500).json({ error: "Failed to create backup.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/restore — upload and restore a .tar.gz backup
// ---------------------------------------------------------------------------
const restoreUpload = multer({ dest: "/tmp/mcpanel-restores", limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2 GB
// Ensure restore temp dir exists
try { fs.mkdirSync("/tmp/mcpanel-restores", { recursive: true }); } catch {}

router.post("/:id/restore", restoreUpload.single("backup"), async (req: Request, res: Response) => {
  try {
    const server = getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No backup file uploaded." });
      return;
    }

    const uploadPath = req.file.path;

    // Stop container if running
    if (server.containerId) {
      try {
        const { stopContainer } = await import("../services/docker");
        await stopContainer(server.containerId);
      } catch { /* container might already be stopped */ }
    }

    // Extract to a temp directory first — only clear data if extraction succeeds
    const tmpDir = path.join("/tmp/mcpanel-restore", server.id);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(tmpDir, { recursive: true });

    const { execSync } = await import("node:child_process");
    try {
      execSync(`tar -xzf "${uploadPath}" -C "${tmpDir}"`, {
        stdio: "pipe",
        timeout: 300_000,
      });
    } catch (err: any) {
      try { fs.unlinkSync(uploadPath); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      res.status(500).json({ error: "Restore failed — invalid archive?", detail: err.message });
      return;
    }

    // Extraction succeeded — now clear data directory and move files
    try {
      for (const entry of fs.readdirSync(server.dataPath)) {
        fs.rmSync(path.join(server.dataPath, entry), { recursive: true, force: true });
      }
    } catch { /* dir might be empty or nonexistent */ }

    try {
      for (const entry of fs.readdirSync(tmpDir)) {
        fs.renameSync(path.join(tmpDir, entry), path.join(server.dataPath, entry));
      }
    } catch (err: any) {
      console.error("[api] Restore move failed:", err.message);
      res.status(500).json({ error: "Restore failed — could not move files into data directory.", detail: err.message });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(uploadPath); } catch {}
      return;
    }

    // Clean up
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(uploadPath); } catch {}

    // Start container again
    if (server.containerId) {
      try {
        const { startContainer } = await import("../services/docker");
        await startContainer(server.containerId);
      } catch (err: any) {
        console.error("[api] Restore re-start failed:", err.message);
      }
    }

    console.log(`[api] Restored server "${server.name}" from backup`);
    res.json({ message: `Server "${server.name}" restored and restarted.` });
  } catch (err: any) {
    console.error("[api] POST /api/servers/:id/restore error:", err);
    res.status(500).json({ error: "Failed to restore backup.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/command — execute command via RCON
// ---------------------------------------------------------------------------
router.post("/:id/command", async (req: Request, res: Response) => {
  try {
    const server = getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }
    const { command } = req.body ?? {};
    if (!command || typeof command !== "string") {
      res.status(400).json({ error: "Field 'command' (string) is required." });
      return;
    }

    if (!server.rconPort || !server.rconPassword) {
      res.status(400).json({ error: "RCON is not configured for this server. Only servers created after the RCON update support this feature." });
      return;
    }

    const { sendRcon } = await import("../services/rcon");
    const response = await sendRcon("127.0.0.1", server.rconPort, server.rconPassword, command);
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
    const server = getServer(req.params.id);
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
// PUT /api/servers/:id — update server config (name, ram, port, version)
// ---------------------------------------------------------------------------
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const server = getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: "Server not found." });
      return;
    }

    const { name, ram: ramStr, port, version } = req.body ?? {};

    // Validate name if provided
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      res.status(400).json({ error: "Field 'name' must be a non-empty string." });
      return;
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
      if (typeof port !== "number" || port < 1024 || port > 65535) {
        res.status(400).json({ error: "Field 'port' must be between 1024 and 65535." });
        return;
      }
      // Port conflict check (exclude current server)
      const existing = loadServers();
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

    const updated = updateServer(server.id, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(ram !== undefined ? { ram } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(version !== undefined ? { version: version.trim() } : {}),
    });

    console.log(`[api] Updated server "${updated?.name}" config`);
    res.json({
      id: updated?.id,
      name: updated?.name,
      ram: updated?.ram,
      port: updated?.port,
      version: updated?.version,
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
    const server = getServer(req.params.id);
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
    const server = getServer(req.params.id);
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
    const server = getServer(req.params.id);
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
    const { rename } = await import("node:fs/promises");
    await rename(req.file.path, destPath);

    res.json({ message: "Server icon uploaded. Restart the server to apply." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to upload icon.", detail: err.message });
  }
});

export default router;
