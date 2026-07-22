// ---- MCPanel: CurseForge Modpack Installer ----
//
// Downloads and installs CurseForge modpacks as MCPanel servers.
// Supports Forge, NeoForge, Fabric, and Quilt mod loaders.

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { v4 as uuid } from "uuid";
import { ServerConfig, ServerType } from "../types";
import { addServer, loadServers } from "./config-store";
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

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "MCPanel/1.0" } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function getJavaDockerImage(mcVersion: string): string {
  const minor = parseInt(mcVersion.split(".")[1] || "0") || 0;
  if (minor >= 21) return "eclipse-temurin:21-jre";
  if (minor >= 17) return "eclipse-temurin:17-jre";
  if (minor >= 13) return "eclipse-temurin:11-jre";
  return "eclipse-temurin:8-jre";
}

function runJavaInDocker(jarPath: string, args: string[], dataDir: string, mcVersion: string): void {
  const javaImage = getJavaDockerImage(mcVersion);
  const jarName = path.basename(jarPath);
  execSync(
    `docker run --rm -v "${dataDir}:/data" -w /data ${javaImage} java -jar "${jarName}" ${args.map(a => `"${a}"`).join(" ")}`,
    { stdio: "pipe", timeout: 600_000, maxBuffer: 100 * 1024 * 1024 },
  );
}

// ---------------------------------------------------------------------------
// Phase 1: create server config (fast, responds immediately)
// ---------------------------------------------------------------------------

export async function createModpackServer(name: string, ram: number, port: number): Promise<ServerConfig> {
  const id = uuid();
  const dataPath = path.join(DATA_ROOT, id);
  fs.mkdirSync(dataPath, { recursive: true });

  const config: ServerConfig = {
    id, name, serverType: "custom", ram, port,
    rconPort: port + 10,
    rconPassword: uuid().replace(/-/g, "").slice(0, 16),
    version: "pending", containerId: null, dataPath,
  };
  addServer(config);
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
    const fileInfo = await fetch(`${CF_BASE}/mods/${modpackId}/files/${fileId}`, { headers: cfHeaders(apiKey) });
    if (!fileInfo.ok) throw new Error(`Failed to get file info (HTTP ${fileInfo.status})`);
    const fileData = (await fileInfo.json()) as { data: { downloadUrl: string; displayName: string } };
    if (!fileData.data.downloadUrl) throw new Error("No download URL available.");

    // 2. Download zip
    emitProgress(serverId, "Downloading modpack…", 10);
    const zipPath = path.join(dataPath, "_modpack.zip");
    await downloadFile(fileData.data.downloadUrl, zipPath);

    // 3. Extract
    emitProgress(serverId, "Extracting modpack…", 20);
    execSync(`unzip -o "${zipPath}" -d "${dataPath}"`, { stdio: "pipe", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    fs.unlinkSync(zipPath);

    // 4. Parse manifest
    const manifestPath = path.join(dataPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("manifest.json not found in modpack.");
    const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const primaryLoader = manifest.minecraft.modLoaders?.find(l => l.primary);
    const loaderId = primaryLoader?.id || "";
    const mcVersion = manifest.minecraft.version;

    emitProgress(serverId, `Installing ${manifest.name}…`, 25);

    // 5. Install mod loader
    let jarName = "server.jar";
    let serverType: ServerType = "custom";

    if (loaderId.startsWith("fabric-")) {
      emitProgress(serverId, "Installing Fabric server…", 30);
      serverType = "fabric";

      const lr = await fetch("https://meta.fabricmc.net/v2/versions/loader", { headers: { "User-Agent": "MCPanel/1.0" } });
      const iv = (await fetch("https://meta.fabricmc.net/v2/versions/installer", { headers: { "User-Agent": "MCPanel/1.0" } }));
      const loaderVer = ((await lr.json()) as { version: string }[])[0]?.version || "0.16.0";
      const instVer = ((await iv.json()) as { version: string }[])[0]?.version || "1.0.0";

      const instUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
      const instPath = path.join(dataPath, "fabric-installer.jar");
      await downloadFile(instUrl, instPath);
      runJavaInDocker(instPath, ["server", "-mcversion", mcVersion, "-downloadMinecraft"], dataPath, mcVersion);
      try { fs.unlinkSync(instPath); } catch {}
      jarName = "fabric-server-launch.jar";

    } else if (loaderId.startsWith("forge-")) {
      const forgeVer = loaderId.replace("forge-", "");
      emitProgress(serverId, `Installing Forge ${forgeVer}…`, 30);
      serverType = "custom";

      const instUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVer}/forge-${mcVersion}-${forgeVer}-installer.jar`;
      const instPath = path.join(dataPath, "forge-installer.jar");
      await downloadFile(instUrl, instPath);
      runJavaInDocker(instPath, ["--installServer"], dataPath, mcVersion);
      try { fs.unlinkSync(instPath); } catch {}

      const forgeJar = fs.readdirSync(dataPath).find(f => /^forge-.+\.jar$/.test(f) && !f.includes("installer"));
      if (forgeJar) fs.copyFileSync(path.join(dataPath, forgeJar), path.join(dataPath, "server.jar"));
      else if (fs.existsSync(path.join(dataPath, "run.sh"))) jarName = "run.sh";

    } else if (loaderId.startsWith("neoforge-")) {
      const neoVer = loaderId.replace("neoforge-", "");
      emitProgress(serverId, `Installing NeoForge ${neoVer}…`, 30);
      serverType = "custom";

      const instUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVer}/neoforge-${neoVer}-installer.jar`;
      const instPath = path.join(dataPath, "neoforge-installer.jar");
      await downloadFile(instUrl, instPath);
      runJavaInDocker(instPath, ["--installServer"], dataPath, mcVersion);
      try { fs.unlinkSync(instPath); } catch {}
      if (fs.existsSync(path.join(dataPath, "run.sh"))) jarName = "run.sh";

    } else if (loaderId.startsWith("quilt-")) {
      emitProgress(serverId, "Installing Quilt server…", 30);
      serverType = "fabric";

      const iv = await fetch("https://meta.quiltmc.org/v3/versions/installer", { headers: { "User-Agent": "MCPanel/1.0" } });
      const instVer = ((await iv.json()) as { version: string }[])[0]?.version || "1.0.0";
      const instUrl = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/quilt-installer-${instVer}.jar`;
      const instPath = path.join(dataPath, "quilt-installer.jar");
      await downloadFile(instUrl, instPath);
      runJavaInDocker(instPath, ["install", "server", mcVersion, "--download-server"], dataPath, mcVersion);
      try { fs.unlinkSync(instPath); } catch {}
      jarName = "quilt-server-launch.jar";
    }

    // Override user_jvm_args.txt with panel RAM for run.sh-based loaders
    if (jarName === "run.sh") {
      const heapMin = Math.floor(config.ram / 2);
      const javaArgsPath = path.join(dataPath, "user_jvm_args.txt");
      const existing = fs.existsSync(javaArgsPath) ? fs.readFileSync(javaArgsPath, "utf-8") : "";
      // Replace existing -Xms/-Xmx or append
      let lines = existing.split("\n").filter(l => !l.trimStart().startsWith("-Xms") && !l.trimStart().startsWith("-Xmx"));
      lines.push(`-Xms${heapMin}M`, `-Xmx${config.ram}M`);
      fs.writeFileSync(javaArgsPath, lines.filter(Boolean).join("\n") + "\n");
    }

    emitProgress(serverId, "Mod loader installed.", 40);

    // Fix Java version for old Forge (MC < 1.13 needs Java 8)
    const mcMinor = parseInt(mcVersion.split(".")[1] || "0") || 0;
    const needsLegacyJava = (loaderId.startsWith("forge-") || loaderId.startsWith("neoforge-")) && mcMinor < 13;
    const javaImage = needsLegacyJava
      ? "eclipse-temurin:8-jre-alpine"
      : resolveJavaImage(mcVersion);

    // 6. Download mods
    const modsDir = path.join(dataPath, "mods");
    if (manifest.files?.length > 0) {
      fs.mkdirSync(modsDir, { recursive: true });
      const total = manifest.files.length;
      const batchSize = 5;
      let downloaded = 0;

      for (let i = 0; i < total; i += batchSize) {
        const batch = manifest.files.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async ({ projectID, fileID }) => {
          try {
            const info = await getModFileInfo(apiKey, projectID, fileID);
            if (!info) return false;
            await downloadFile(info.url, path.join(modsDir, info.fileName));
            return true;
          } catch { return false; }
        }));
        downloaded += results.filter(Boolean).length;
        const done = Math.min(i + batchSize, total);
        const pct = 40 + Math.floor((done / total) * 50); // 40%→90%
        emitProgress(serverId, `Downloading mods (${downloaded}/${done})…`, pct);
      }
    }

    // 7. Server config
    emitProgress(serverId, "Writing server config…", 92);
    const props = [
      `server-port=${config.port}`, `enable-rcon=true`,
      `rcon.port=${config.rconPort}`, `rcon.password=${config.rconPassword}`,
      `motd=${config.name} | ${manifest.name}`, `max-players=20`,
      `difficulty=normal`, `gamemode=survival`, `online-mode=true`,
    ].join("\n");
    fs.writeFileSync(path.join(dataPath, "server.properties"), props + "\n");
    fs.writeFileSync(path.join(dataPath, "eula.txt"), "eula=true\n");

    // 8. Docker container
    emitProgress(serverId, "Creating Docker container…", 95);
    const containerId = await createContainer(config, javaImage, { jarName });

    // 9. Update config
    const servers = loadServers();
    const idx = servers.findIndex(s => s.id === serverId);
    if (idx !== -1) {
      servers[idx].containerId = containerId;
      servers[idx].version = mcVersion;
      servers[idx].serverType = serverType;
      fs.writeFileSync(path.resolve(process.cwd(), "servers.json"), JSON.stringify(servers, null, 2));
    }

    // 10. Auto-start the container
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
