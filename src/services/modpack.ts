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
import { createContainer, resolveJavaImage } from "./docker";

const CF_BASE = "https://api.curseforge.com/v1";
const DATA_ROOT = path.resolve(process.cwd(), "data");

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
  const res = await fetch(url, { headers: cfHeaders(apiKey) });
  if (!res.ok) {
    let detail = "";
    try { const body = await res.text(); detail = ` — ${body.slice(0, 200)}`; } catch {}
    if (res.status === 403 || res.status === 401) throw new Error(`Invalid CurseForge API key (HTTP ${res.status}${detail})`);
    throw new Error(`CurseForge API returned ${res.status}${detail}`);
  }
  const data = (await res.json()) as { data: any[] };
  return (data.data || []).map((m: any) => ({
    id: m.id,
    name: m.name,
    summary: m.summary || "",
    logo: m.logo,
    downloadCount: m.downloadCount || 0,
  }));
}

export async function getModpackFiles(apiKey: string, modId: number): Promise<CfFile[]> {
  const url = `${CF_BASE}/mods/${modId}/files?pageSize=30&sortField=1&sortOrder=desc`;
  const res = await fetch(url, { headers: cfHeaders(apiKey) });
  if (!res.ok) throw new Error(`CurseForge API returned ${res.status}`);
  const data = (await res.json()) as { data: any[] };
  return (data.data || []).map((f: any) => ({
    id: f.id,
    displayName: f.displayName,
    fileName: f.fileName,
    fileDate: f.fileDate,
    downloadUrl: f.downloadUrl || "",
    gameVersions: f.gameVersions || [],
    fileLength: f.fileLength || 0,
  }));
}

async function getModDownloadUrl(apiKey: string, projectId: number, fileId: number): Promise<string> {
  const url = `${CF_BASE}/mods/${projectId}/files/${fileId}`;
  const res = await fetch(url, { headers: cfHeaders(apiKey) });
  if (!res.ok) return "";
  const data = (await res.json()) as { data: { downloadUrl?: string; fileName?: string } };
  return data.data?.downloadUrl || "";
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "MCPanel/1.0" } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/** Get the Docker Java image for a given Minecraft version. */
function getJavaDockerImage(mcVersion: string): string {
  const minor = parseInt(mcVersion.split(".")[1] || "0") || 0;
  if (minor >= 21) return "eclipse-temurin:21-jre";
  if (minor >= 17) return "eclipse-temurin:17-jre";
  if (minor >= 13) return "eclipse-temurin:11-jre";
  return "eclipse-temurin:8-jre";
}

/** Run a Java JAR inside a temporary Docker container (no host Java needed). */
function runJavaInDocker(jarPath: string, args: string[], dataDir: string, mcVersion: string): void {
  const javaImage = getJavaDockerImage(mcVersion);
  const jarName = path.basename(jarPath);
  console.log(`[modpack] Running ${jarName} in Docker (${javaImage})...`);
  execSync(
    `docker run --rm -v "${dataDir}:/data" -w /data ${javaImage} java -jar "${jarName}" ${args.map(a => `"${a}"`).join(" ")}`,
    { stdio: "pipe", timeout: 600_000 },
  );
}

// ---------------------------------------------------------------------------
// Main installation
// ---------------------------------------------------------------------------

export async function installCfModpack(
  apiKey: string,
  modpackId: number,
  fileId: number,
  serverName: string,
  ram: number,
  port: number,
): Promise<ServerConfig> {
  // 1. Get download URL for the selected file
  console.log(`[modpack] Getting download URL for modpack ${modpackId}, file ${fileId}...`);
  const fileInfo = await fetch(`${CF_BASE}/mods/${modpackId}/files/${fileId}`, { headers: cfHeaders(apiKey) });
  if (!fileInfo.ok) throw new Error(`Failed to get file info (HTTP ${fileInfo.status})`);
  const fileData = (await fileInfo.json()) as { data: { downloadUrl: string; displayName: string; fileName: string; fileLength: number } };
  const downloadUrl = fileData.data.downloadUrl;
  if (!downloadUrl) throw new Error("No download URL available for this modpack file.");

  console.log(`[modpack] Downloading ${fileData.data.displayName} (${(fileData.data.fileLength / 1e6).toFixed(0)} MB)...`);

  // 2. Create server directory
  const id = uuid();
  const dataPath = path.join(DATA_ROOT, id);
  fs.mkdirSync(dataPath, { recursive: true });

  // 3. Download and extract modpack zip
  const zipPath = path.join(dataPath, "_modpack.zip");
  await downloadFile(downloadUrl, zipPath);
  execSync(`unzip -o "${zipPath}" -d "${dataPath}"`, { stdio: "pipe", timeout: 120_000 });
  fs.unlinkSync(zipPath);

  // 4. Parse manifest.json
  const manifestPath = path.join(dataPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json not found in modpack. Ensure this is a valid CurseForge modpack.");
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  console.log(`[modpack] ${manifest.name} ${manifest.version} - MC ${manifest.minecraft.version}`);

  // 5. Detect mod loader
  const primaryLoader = manifest.minecraft.modLoaders?.find(l => l.primary);
  const loaderId = primaryLoader?.id || "";
  const mcVersion = manifest.minecraft.version;

  let serverType: ServerType = "custom";
  let jarName = "server.jar";

  if (loaderId.startsWith("fabric-")) {
    console.log(`[modpack] Fabric loader detected. Installing Fabric server...`);
    serverType = "fabric";

    const loaderRes = await fetch("https://meta.fabricmc.net/v2/versions/loader", { headers: { "User-Agent": "MCPanel/1.0" } });
    const loaderData = (await loaderRes.json()) as { version: string }[];
    const loaderVer = loaderData[0]?.version || "0.16.0";

    const instRes = await fetch("https://meta.fabricmc.net/v2/versions/installer", { headers: { "User-Agent": "MCPanel/1.0" } });
    const instData = (await instRes.json()) as { version: string }[];
    const instVer = instData[0]?.version || "1.0.0";

    const instUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
    const instPath = path.join(dataPath, "fabric-installer.jar");
    await downloadFile(instUrl, instPath);
    runJavaInDocker(instPath, ["server", "-mcversion", mcVersion, "-downloadMinecraft"], dataPath, mcVersion);
    try { fs.unlinkSync(instPath); } catch {}
    jarName = "fabric-server-launch.jar";

  } else if (loaderId.startsWith("forge-")) {
    const forgeVer = loaderId.replace("forge-", "");
    console.log(`[modpack] Forge ${forgeVer} detected. Installing Forge server...`);
    serverType = "custom";

    const instUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVer}/forge-${mcVersion}-${forgeVer}-installer.jar`;
    const instPath = path.join(dataPath, "forge-installer.jar");
    await downloadFile(instUrl, instPath);
    console.log(`[modpack] Running Forge installer (this may take a few minutes)...`);
    runJavaInDocker(instPath, ["--installServer"], dataPath, mcVersion);
    try { fs.unlinkSync(instPath); } catch {}

    // Find forge universal jar or use run.sh
    const forgeJar = fs.readdirSync(dataPath).find(f => /^forge-.+\.jar$/.test(f) && !f.includes("installer"));
    if (forgeJar) {
      fs.copyFileSync(path.join(dataPath, forgeJar), path.join(dataPath, "server.jar"));
    } else if (fs.existsSync(path.join(dataPath, "run.sh"))) {
      // Forge 1.17+ uses run.sh - no server.jar needed
      jarName = "run.sh";
    }

  } else if (loaderId.startsWith("neoforge-")) {
    const neoVer = loaderId.replace("neoforge-", "");
    console.log(`[modpack] NeoForge ${neoVer} detected. Installing NeoForge server...`);
    serverType = "custom";

    const instUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVer}/neoforge-${neoVer}-installer.jar`;
    const instPath = path.join(dataPath, "neoforge-installer.jar");
    await downloadFile(instUrl, instPath);
    runJavaInDocker(instPath, ["--installServer"], dataPath, mcVersion);
    try { fs.unlinkSync(instPath); } catch {}

    // NeoForge 1.20.5+ uses run.sh style
    if (fs.existsSync(path.join(dataPath, "run.sh"))) {
      jarName = "run.sh";
    }

  } else if (loaderId.startsWith("quilt-")) {
    console.log(`[modpack] Quilt loader detected. Installing Quilt server...`);
    serverType = "fabric"; // Quilt is Fabric-compatible

    const instRes = await fetch("https://meta.quiltmc.org/v3/versions/installer", { headers: { "User-Agent": "MCPanel/1.0" } });
    const instData = (await instRes.json()) as { version: string }[];
    const instVer = instData[0]?.version || "1.0.0";

    const instUrl = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/quilt-installer-${instVer}.jar`;
    const instPath = path.join(dataPath, "quilt-installer.jar");
    await downloadFile(instUrl, instPath);
    runJavaInDocker(instPath, ["install", "server", mcVersion, "--download-server"], dataPath, mcVersion);
    try { fs.unlinkSync(instPath); } catch {}
    jarName = "quilt-server-launch.jar";

  } else {
    console.log(`[modpack] No recognized mod loader (${loaderId}). Assuming vanilla server.`);
    serverType = "custom";
  }

  // 6. Download mods
  const modsDir = path.join(dataPath, "mods");
  if (manifest.files?.length > 0) {
    fs.mkdirSync(modsDir, { recursive: true });
    console.log(`[modpack] Downloading ${manifest.files.length} mods...`);

    let downloaded = 0;
    let failed = 0;
    const batchSize = 5;

    for (let i = 0; i < manifest.files.length; i += batchSize) {
      const batch = manifest.files.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async ({ projectID, fileID }) => {
        try {
          const url = await getModDownloadUrl(apiKey, projectID, fileID);
          if (!url) return false;
          const modInfo = await fetch(`${CF_BASE}/mods/${projectID}/files/${fileID}`, { headers: cfHeaders(apiKey) });
          const modData = (await modInfo.json()) as { data: { fileName: string } };
          const fileName = modData.data.fileName || `${projectID}-${fileID}.jar`;
          await downloadFile(url, path.join(modsDir, fileName));
          return true;
        } catch { return false; }
      }));
      downloaded += results.filter(Boolean).length;
      failed += results.filter(r => !r).length;
      const progress = Math.min(i + batchSize, manifest.files.length);
      console.log(`[modpack] Mods: ${progress}/${manifest.files.length} (${downloaded} ok, ${failed} failed)`);
    }
    console.log(`[modpack] Mod download complete: ${downloaded}/${manifest.files.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}`);
  }

  // 7. Generate server.properties + eula
  const rconPort = port + 10;
  const rconPassword = uuid().replace(/-/g, "").slice(0, 16);

  const serverProps = [
    `server-port=${port}`,
    `enable-rcon=true`,
    `rcon.port=${rconPort}`,
    `rcon.password=${rconPassword}`,
    `motd=${serverName} | ${manifest.name}`,
    `max-players=20`,
    `difficulty=normal`,
    `gamemode=survival`,
    `online-mode=true`,
  ].join("\n");
  fs.writeFileSync(path.join(dataPath, "server.properties"), serverProps + "\n");
  fs.writeFileSync(path.join(dataPath, "eula.txt"), "eula=true\n");

  // 8. Java image
  const javaImage = resolveJavaImage(mcVersion);

  // 9. Create server config
  const config: ServerConfig = {
    id,
    name: serverName,
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

  // 10. Create Docker container
  console.log(`[modpack] Creating Docker container...`);
  const containerId = await createContainer(config, javaImage, { jarName });
  config.containerId = containerId;

  // Update config with container ID
  const servers = loadServers();
  const idx = servers.findIndex(s => s.id === id);
  if (idx !== -1) {
    servers[idx].containerId = containerId;
    fs.writeFileSync(path.resolve(process.cwd(), "servers.json"), JSON.stringify(servers, null, 2));
  }

  console.log(`[modpack] Done! Server "${config.name}" (${id.slice(0, 8)}) with ${manifest.files?.length || 0} mods`);
  return config;
}
