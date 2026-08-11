// ---- MCPanel: CurseForge Modpack Installer ----
//
// Downloads and installs CurseForge modpacks as MCPanel servers.
// Supports Forge, NeoForge, Fabric, and Quilt mod loaders.
//
// All I/O is async — nothing blocks the event loop.

import path from "node:path";
import fs from "node:fs";
import { exec, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, unlink, readdir, copyFile } from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { ServerConfig, ServerType } from "../types";
import { addServer, mutateServers } from "./config-store";
import { createContainer, startContainer, resolveJavaImage } from "./docker";

const CF_BASE = "https://api.curseforge.com/v1";
const DATA_ROOT = path.resolve(process.cwd(), "data");

// ---------------------------------------------------------------------------
// Progress Tracking
// ---------------------------------------------------------------------------

export interface ModpackProgress {
  step: string;
  percent: number;
  error?: string;
}

export const installProgress = new Map<string, ModpackProgress>();

function emitProgress(id: string, step: string, percent: number) {
  installProgress.set(id, { step, percent });
  console.log(`[modpack:${id.slice(0, 8)}] ${percent}% — ${step}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CfModpack {
  id: number;
  name: string;
  summary: string;
  logo?: { thumbnailUrl: string };
  downloadCount: number;
}

interface CfFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  downloadUrl: string;
  gameVersions: string[];
  fileLength: number;
}

interface ManifestFile {
  projectID: number;
  fileID: number;
  required: boolean;
}

interface Manifest {
  name: string;
  version: string;
  minecraft: {
    version: string;
    modLoaders: { id: string; primary: boolean }[];
  };
  files: ManifestFile[];
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

/** fs/promises doesn't expose exists(). Use access() wrapped in try/catch. */
async function exists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

/** Promisified exec — runs a shell command, returns stdout. */
function execAsync(cmd: string, opts?: { timeout?: number; maxBuffer?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf-8", ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Promisified execFile — runs a command with args, returns stdout. */
function execFileAsync(cmd: string, args: string[], opts?: { encoding?: BufferEncoding; timeout?: number; maxBuffer?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf-8", ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// ---------------------------------------------------------------------------
// CurseForge API helpers
// ---------------------------------------------------------------------------

function cfHeaders(apiKey: string) {
  return { "x-api-key": apiKey, Accept: "application/json", "User-Agent": "MCPanel/1.0" };
}

export async function searchModpacks(apiKey: string, query: string): Promise<CfModpack[]> {
  const url = `${CF_BASE}/mods/search?gameId=432&classId=4471&searchFilter=${encodeURIComponent(query)}&pageSize=20&sortField=2&sortOrder=desc`;
  const res = await fetch(url, { headers: cfHeaders(apiKey), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    let detail = "";
    try { const body = await res.text(); detail = ` — ${body.slice(0, 200)}`; } catch {}
    if (res.status === 403 || res.status === 401) throw new Error(`Invalid CurseForge API key (HTTP ${res.status}${detail})`);
    throw new Error(`CurseForge API returned ${res.status}${detail}`);
  }
  const data = (await res.json()) as { data: any[] };
  return (data.data || []).map((m: any) => ({
    id: m.id, name: m.name, summary: m.summary || "",
    logo: m.logo, downloadCount: m.downloadCount || 0,
  }));
}

export async function getModpackFiles(apiKey: string, modId: number): Promise<CfFile[]> {
  const url = `${CF_BASE}/mods/${modId}/files?pageSize=30&sortField=1&sortOrder=desc`;
  const res = await fetch(url, { headers: cfHeaders(apiKey), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`CurseForge API returned ${res.status}`);
  const data = (await res.json()) as { data: any[] };
  return (data.data || []).map((f: any) => ({
    id: f.id, displayName: f.displayName, fileName: f.fileName,
    fileDate: f.fileDate, downloadUrl: f.downloadUrl || "",
    gameVersions: f.gameVersions || [], fileLength: f.fileLength || 0,
  }));
}

async function getModFileInfo(apiKey: string, projectId: number, fileId: number): Promise<{ url: string; fileName: string } | null> {
  const res = await fetch(`${CF_BASE}/mods/${projectId}/files/${fileId}`, {
    headers: cfHeaders(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data: { downloadUrl?: string; fileName?: string } };
  if (!data.data?.downloadUrl) return null;
  return { url: data.data.downloadUrl, fileName: data.data.fileName || `${projectId}-${fileId}.jar` };
}

/** Check if a JAR is client-only by inspecting its mod metadata. */
async function isClientOnlyMod(jarPath: string): Promise<boolean> {
  // ---- Check mods.toml / neoforge.mods.toml for side = "CLIENT" ----
  try {
    let tomlData = (await execFileAsync("unzip", ["-p", jarPath, "META-INF/mods.toml"], {
      maxBuffer: 2 * 1024 * 1024, timeout: 5000,
    })).trim();
    if (!tomlData) {
      tomlData = (await execFileAsync("unzip", ["-p", jarPath, "META-INF/neoforge.mods.toml"], {
        maxBuffer: 2 * 1024 * 1024, timeout: 5000,
      })).trim();
    }
    if (tomlData) {
      // Find all side declarations in [[mods]] sections
      const sides = [...tomlData.matchAll(/^side\s*=\s*"(\w+)"/gm)].map(m => m[1]);
      if (sides.length > 0 && sides.every(s => s === "CLIENT")) return true;

      // ---- Heuristic: no side declared (defaults to BOTH) but JAR only references client classes ----
      if (sides.length === 0) {
        try {
          const raw = await execFileAsync("unzip", ["-p", jarPath], {
            maxBuffer: 16 * 1024 * 1024, timeout: 8000,
          });
          const text = Buffer.from(raw, "latin1").toString("latin1"); // fast byte scan
          const hasClient = text.includes("net/minecraft/client/");
          const hasServer = text.includes("net/minecraft/server/") || text.includes("net/minecraft/world/");
          if (hasClient && !hasServer) return true;
        } catch { /* can't scan — keep the mod */ }
      }

      if (sides.length > 0) return false; // At least one BOTH/SERVER entry
    }
  } catch { /* not a Forge mod or no mods.toml */ }

  // ---- Check fabric.mod.json for environment = "client" ----
  try {
    const jsonData = (await execFileAsync("unzip", ["-p", jarPath, "fabric.mod.json"], {
      maxBuffer: 2 * 1024 * 1024, timeout: 5000,
    })).trim();
    if (jsonData) {
      const meta = JSON.parse(jsonData);
      if (meta?.environment === "client") return true;
    }
  } catch { /* not a Fabric mod or no fabric.mod.json */ }
  return false;
}

async function downloadFile(url: string, dest: string, expectedBytes?: number, apiKey?: string): Promise<void> {
  const headers: Record<string, string> = {
    "User-Agent": "MCPanel/1.0",
    Accept: "application/octet-stream, */*;q=0.8",
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(300_000), // 5 min for large downloads
  });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const cl = res.headers.get("content-length");
  console.log(`[download] ${url.slice(0, 80)}… → ${res.status} ${ct || "(no content-type)"} ${cl ? `len=${cl}` : ""}`);

  // Reject HTML/JSON responses (CDN errors, captchas, etc.)
  if (ct.includes("text/html") || ct.includes("application/json")) {
    const preview = (await res.text()).slice(0, 500);
    throw new Error(`Download returned ${ct} (expected binary): ${preview}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedBytes && buf.length < expectedBytes * 0.95) {
    throw new Error(`Download truncated: got ${buf.length} bytes, expected ~${expectedBytes}`);
  }
  await writeFile(dest, buf);
}

function getJavaDockerImage(mcVersion: string): string {
  const minor = parseInt(mcVersion.split(".")[1] || "0") || 0;
  if (minor >= 21) return "eclipse-temurin:21-jre-alpine";
  if (minor >= 17) return "eclipse-temurin:17-jre-alpine";
  if (minor >= 13) return "eclipse-temurin:11-jre-alpine";
  // Older → Java 8 (Debian image — the alpine Java-8 build lacks ECDHE cipher
  // suites, causing TLS handshake_failure against Mojang/Forge HTTPS endpoints).
  return "eclipse-temurin:8-jre";
}

async function runJavaInDocker(jarPath: string, args: string[], dataDir: string, mcVersion: string): Promise<void> {
  const javaImage = getJavaDockerImage(mcVersion);
  const jarName = path.basename(jarPath);
  // Java 8 fails the TLS 1.3 handshake against Forge/Mojang/Cloudflare HTTPS
  // endpoints with "Received fatal alert: handshake_failure". Force TLS 1.2
  // for Java-8 installer runs so the download steps succeed.
  const tlsFlag = javaImage.includes(":8-") ? "-Dhttps.protocols=TLSv1.2 " : "";
  // Run as root — this is a one-shot installer container that needs to write
  // files (installer logs, libraries, etc.) to the bind-mounted data directory.
  await execAsync(
    `docker run --rm -v "${dataDir}:/data" -w /data ${javaImage} java ${tlsFlag}-jar "${jarName}" ${args.map(a => `"${a}"`).join(" ")}`,
    { timeout: 600_000, maxBuffer: 100 * 1024 * 1024 },
  );
}

// ---------------------------------------------------------------------------
// Phase 1: create server config (fast, responds immediately)
// ---------------------------------------------------------------------------

export async function createModpackServer(name: string, ram: number, port: number): Promise<ServerConfig> {
  if (port < 1024 || port > 65525) {
    throw new Error("Port must be between 1024 and 65525 (RCON port is +10).");
  }
  const id = uuid();
  const dataPath = path.join(DATA_ROOT, id);
  await mkdir(dataPath, { recursive: true });

  const config: ServerConfig = {
    id, name, serverType: "custom", ram, port,
    rconPort: port + 10,
    rconPassword: uuid().replace(/-/g, "").slice(0, 16),
    version: "pending", containerId: null, dataPath,
  };
  await addServer(config);
  return config;
}

// ---------------------------------------------------------------------------
// Phase 2: install content (async, reports progress)
// ---------------------------------------------------------------------------

export async function runModpackInstall(
  config: ServerConfig,
  apiKey: string,
  modpackId: number,
  fileId: number,
): Promise<void> {
  const { id: serverId, dataPath } = config;

  try {
    // 1. Get download URL
    emitProgress(serverId, "Fetching modpack info…", 5);
    const fileInfo = await fetch(`${CF_BASE}/mods/${modpackId}/files/${fileId}`, {
      headers: cfHeaders(apiKey), signal: AbortSignal.timeout(15_000),
    });
    if (!fileInfo.ok) throw new Error(`Failed to get file info (HTTP ${fileInfo.status})`);
    const fileData = (await fileInfo.json()) as { data: { downloadUrl: string; displayName: string; fileLength?: number } };
    if (!fileData.data.downloadUrl) throw new Error("No download URL available.");

    // 2. Download zip (with CF API key — some CDN URLs require it)
    emitProgress(serverId, "Downloading modpack…", 10);
    const zipPath = path.join(dataPath, "_modpack.zip");
    const downloadUrl = fileData.data.downloadUrl;
    console.log(`[modpack:${serverId.slice(0, 8)}] Downloading from ${downloadUrl.slice(0, 100)}… (${fileData.data.fileLength ?? "?"} bytes)`);
    await downloadFile(downloadUrl, zipPath, fileData.data.fileLength, apiKey);

    // 3. Validate ZIP integrity before unzipping
    {
      const buf = await readFile(zipPath);
      if (buf.length < 22) throw new Error(`Downloaded file too small (${buf.length} bytes)`);
      const magic = buf[0] === 0x50 && buf[1] === 0x4b; // PK
      if (!magic) {
        const preview = buf.slice(0, 200).toString("utf-8").replace(/[^\x20-\x7e]/g, ".");
        throw new Error(`Download is not a ZIP file (starts with 0x${buf[0]?.toString(16)}${buf[1]?.toString(16)}): ${preview}`);
      }
      // Check for EOCD (end of central directory) record
      const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
      let found = false;
      for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
          found = true; break;
        }
      }
      if (!found) throw new Error(`Downloaded ${buf.length} bytes but ZIP is incomplete (missing end-of-central-directory). The download may have been interrupted by the CDN.`);
    }

    // 4. Extract (async via execFile) — with zip-slip protection
    emitProgress(serverId, "Extracting modpack…", 20);
    {
      // Pre-scan archive entries; reject `..`/absolute paths so a malicious
      // modpack can't write outside the server's data directory.
      const listing = await execFileAsync("unzip", ["-Z1", zipPath], {
        timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
      });
      for (const entry of listing.split("\n")) {
        const e = entry.trim();
        if (!e) continue;
        if (e.startsWith("/") || e.split("/").includes("..")) {
          await unlink(zipPath);
          throw new Error("Modpack archive contains unsafe paths (path traversal) and was rejected.");
        }
      }
    }
    await execFileAsync("unzip", ["-o", zipPath, "-d", dataPath], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    await unlink(zipPath);

    // 5. Parse manifest
    const manifestPath = path.join(dataPath, "manifest.json");
    if (!(await exists(manifestPath))) throw new Error("manifest.json not found in modpack.");
    const manifest: Manifest = JSON.parse((await readFile(manifestPath, "utf-8")));
    const primaryLoader = manifest.minecraft.modLoaders?.find(l => l.primary);
    const loaderId = primaryLoader?.id || "";
    const mcVersion = manifest.minecraft.version;

    emitProgress(serverId, `Installing ${manifest.name}…`, 25);

    // 6. Install mod loader
    let jarName = "server.jar";
    let serverType: ServerType = "custom";

    if (loaderId.startsWith("fabric-")) {
      emitProgress(serverId, "Installing Fabric server…", 30);
      serverType = "fabric";

      const lr = await fetch("https://meta.fabricmc.net/v2/versions/loader", { headers: { "User-Agent": "MCPanel/1.0" } });
      const iv = await fetch("https://meta.fabricmc.net/v2/versions/installer", { headers: { "User-Agent": "MCPanel/1.0" } });
      const loaderVer = ((await lr.json()) as { version: string }[])[0]?.version || "0.16.0";
      const instVer = ((await iv.json()) as { version: string }[])[0]?.version || "1.0.0";

      const instUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
      const instPath = path.join(dataPath, "fabric-installer.jar");
      await downloadFile(instUrl, instPath);
      await runJavaInDocker(instPath, ["server", "-mcversion", mcVersion, "-downloadMinecraft"], dataPath, mcVersion);
      try { await unlink(instPath); } catch {}
      jarName = "fabric-server-launch.jar";

    } else if (loaderId.startsWith("forge-")) {
      const forgeVer = loaderId.replace("forge-", "");
      emitProgress(serverId, `Installing Forge ${forgeVer}…`, 30);
      serverType = "custom";

      const instUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVer}/forge-${mcVersion}-${forgeVer}-installer.jar`;
      const instPath = path.join(dataPath, "forge-installer.jar");
      await downloadFile(instUrl, instPath);
      await runJavaInDocker(instPath, ["--installServer"], dataPath, mcVersion);
      try { await unlink(instPath); } catch {}

      const entries = await readdir(dataPath);
      const forgeJar = entries.find(f => /^forge-.+\.jar$/.test(f) && !f.includes("installer"));
      if (forgeJar) await copyFile(path.join(dataPath, forgeJar), path.join(dataPath, "server.jar"));
      else if (await exists(path.join(dataPath, "run.sh"))) jarName = "run.sh";

    } else if (loaderId.startsWith("neoforge-")) {
      const neoVer = loaderId.replace("neoforge-", "");
      emitProgress(serverId, `Installing NeoForge ${neoVer}…`, 30);
      serverType = "custom";

      const instUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVer}/neoforge-${neoVer}-installer.jar`;
      const instPath = path.join(dataPath, "neoforge-installer.jar");
      await downloadFile(instUrl, instPath);
      await runJavaInDocker(instPath, ["--installServer"], dataPath, mcVersion);
      try { await unlink(instPath); } catch {}
      if (await exists(path.join(dataPath, "run.sh"))) jarName = "run.sh";

    } else if (loaderId.startsWith("quilt-")) {
      emitProgress(serverId, "Installing Quilt server…", 30);
      serverType = "fabric";

      const iv = await fetch("https://meta.quiltmc.org/v3/versions/installer", { headers: { "User-Agent": "MCPanel/1.0" } });
      const instVer = ((await iv.json()) as { version: string }[])[0]?.version || "1.0.0";
      const instUrl = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/quilt-installer-${instVer}.jar`;
      const instPath = path.join(dataPath, "quilt-installer.jar");
      await downloadFile(instUrl, instPath);
      await runJavaInDocker(instPath, ["install", "server", mcVersion, "--download-server"], dataPath, mcVersion);
      try { await unlink(instPath); } catch {}
      jarName = "quilt-server-launch.jar";
    }

    // Override user_jvm_args.txt with panel RAM for run.sh-based loaders
    if (jarName === "run.sh") {
      const heapMin = Math.floor(config.ram / 2);
      const javaArgsPath = path.join(dataPath, "user_jvm_args.txt");
      const existing = (await exists(javaArgsPath)) ? await readFile(javaArgsPath, "utf-8") : "";
      let lines = existing.split("\n").filter(l => !l.trimStart().startsWith("-Xms") && !l.trimStart().startsWith("-Xmx"));
      lines.push(`-Xms${heapMin}M`, `-Xmx${config.ram}M`);
      await writeFile(javaArgsPath, lines.filter(Boolean).join("\n") + "\n");

      // Ensure run.sh uses `exec java` so SIGTERM reaches the JVM on stop.
      const runShPath = path.join(dataPath, "run.sh");
      let content = await readFile(runShPath, "utf-8");
      const runLines = content.split("\n");
      let patched = false;
      for (let i = runLines.length - 1; i >= 0; i--) {
        const trimmed = runLines[i].trim();
        if (trimmed === "") continue;
        if (trimmed.startsWith("#")) continue;
        if (trimmed.startsWith("exec java ")) { patched = true; break; }
        if (trimmed.startsWith("java ")) {
          const indent = runLines[i].match(/^(\s*)/)?.[1] ?? "";
          runLines[i] = `${indent}exec ${trimmed}`;
          patched = true;
          break;
        }
        break;
      }
      if (patched) {
        await writeFile(runShPath, runLines.join("\n"));
        console.log(`[modpack:${serverId.slice(0, 8)}] Patched run.sh exec java for signal forwarding`);
      }
    }

    emitProgress(serverId, "Mod loader installed.", 40);

    // Fix Java version for old Forge (MC < 1.13 needs Java 8)
    const mcMinor = parseInt(mcVersion.split(".")[1] || "0") || 0;
    const needsLegacyJava = (loaderId.startsWith("forge-") || loaderId.startsWith("neoforge-")) && mcMinor < 13;
    const javaImage = needsLegacyJava
      ? "eclipse-temurin:8-jre"
      : resolveJavaImage(mcVersion);

    // 7. Download mods
    const modsDir = path.join(dataPath, "mods");
    if (manifest.files?.length > 0) {
      await mkdir(modsDir, { recursive: true });
      const total = manifest.files.length;
      const batchSize = 5;
      let downloaded = 0;
      const skippedMods: string[] = [];

      for (let i = 0; i < total; i += batchSize) {
        const batch = manifest.files.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async ({ projectID, fileID }) => {
          try {
            const info = await getModFileInfo(apiKey, projectID, fileID);
            if (!info) return false;
            const dest = path.join(modsDir, info.fileName);
            await downloadFile(info.url, dest);
            // Skip client-only mods (e.g. Zume, inventory HUD mods, etc.)
            if (await isClientOnlyMod(dest)) {
              await unlink(dest);
              skippedMods.push(info.fileName);
              return false;
            }
            return true;
          } catch { return false; }
        }));
        downloaded += results.filter(Boolean).length;
        const done = Math.min(i + batchSize, total);
        const pct = 40 + Math.floor((done / total) * 50); // 40%→90%
        emitProgress(serverId, `Downloading mods (${downloaded}/${done})…`, pct);
      }
      if (skippedMods.length > 0) {
        console.log(`[modpack:${serverId.slice(0, 8)}] Skipped ${skippedMods.length} client-only mod(s): ${skippedMods.join(", ")}`);
      }
    }

    // 8. Server config
    emitProgress(serverId, "Writing server config…", 92);
    const props = [
      `server-port=${config.port}`, `enable-rcon=true`,
      `rcon.port=${config.rconPort}`, `rcon.password=${config.rconPassword}`,
      `motd=${config.name} | ${manifest.name}`, `max-players=20`,
      `difficulty=normal`, `gamemode=survival`, `online-mode=true`,
    ].join("\n");
    await writeFile(path.join(dataPath, "server.properties"), props + "\n");
    await writeFile(path.join(dataPath, "eula.txt"), "eula=true\n");

    // 9. Docker container
    emitProgress(serverId, "Creating Docker container…", 95);
    const containerId = await createContainer(config, javaImage, { jarName });

    // 10. Update config (serialized — no lost updates)
    await mutateServers((servers) => {
      const idx = servers.findIndex(s => s.id === serverId);
      if (idx !== -1) {
        servers[idx].containerId = containerId;
        servers[idx].version = mcVersion;
        servers[idx].serverType = serverType;
      }
    });

    // 11. Auto-start the container
    emitProgress(serverId, "Starting server…", 98);
    try {
      await startContainer(containerId);
      emitProgress(serverId, "Done!", 100);
    } catch (startErr: any) {
      emitProgress(serverId, "Installed (manual start required)", 100);
      console.error(`[modpack:${serverId.slice(0, 8)}] Auto-start failed: ${startErr.message}`);
    } finally {
      setTimeout(() => installProgress.delete(serverId), 60_000); // cleanup
    }

  } catch (err: any) {
    installProgress.set(serverId, { step: "Error", percent: 0, error: err.message });
    setTimeout(() => installProgress.delete(serverId), 60_000);
    console.error(`[modpack:${serverId.slice(0, 8)}] Failed:`, err.message);
  }
}
