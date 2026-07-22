// ---- MCPanel: Modrinth Modpack Installer ----
//
// Downloads and installs Modrinth modpacks (.mrpack) as MCPanel servers.
// Supported loaders: fabric, quilt. Forge/NeoForge are not yet supported
// because they require running an installer JAR.

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { v4 as uuid } from "uuid";
import { CreateServerRequest, ServerConfig, ServerType } from "../types";
import { addServer, loadServers } from "./config-store";
import { createContainer, resolveJavaImage } from "./docker";

const MODRINTH_API = "https://api.modrinth.com/v2";
const DATA_ROOT = path.resolve(process.cwd(), "data");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  project_type: string;
}

interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary?: boolean;
}

interface ModrinthDependency {
  project_id?: string | null;
  version_id?: string | null;
  dependency_type: string;
  file_name?: string | null;
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
  dependencies: ModrinthDependency[];
}

interface MrPackIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  dependencies: Record<string, string>;
  files: { path: string; hashes: Record<string, string>; downloads: string[]; fileSize: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FETCH_HEADERS = { "User-Agent": "MCPanel/1.0 (mcpanel@example.com)", Accept: "application/json" };

/** Extract a project slug from a Modrinth URL or return the raw slug. */
export function parseModrinthSlug(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/modrinth\.com\/(?:modpack|mod|plugin|datapack|shader|resourcepack)\/([^/?#]+)/i);
  if (urlMatch) return urlMatch[1];
  // Direct slug
  return trimmed.replace(/^\/+/, "").split("/")[0];
}

/** Fetch project info from Modrinth API. */
async function fetchProject(slug: string): Promise<ModrinthProject> {
  const res = await fetch(`${MODRINTH_API}/project/${encodeURIComponent(slug)}`, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`Modrinth API returned ${res.status} for project "${slug}". Check the slug.`);
  return (await res.json()) as ModrinthProject;
}

/** Fetch all versions for a project, sorted newest first. */
async function fetchVersions(slug: string): Promise<ModrinthVersion[]> {
  const res = await fetch(
    `${MODRINTH_API}/project/${encodeURIComponent(slug)}/version?loaders=["fabric","quilt","forge","neoforge"]`,
    { headers: FETCH_HEADERS },
  );
  if (!res.ok) throw new Error(`Failed to fetch versions (HTTP ${res.status}).`);
  return (await res.json()) as ModrinthVersion[];
}

/** Download a file from URL to a local path. */
async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": FETCH_HEADERS["User-Agent"] } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

// ---------------------------------------------------------------------------
// Main installation
// ---------------------------------------------------------------------------

export async function installModrinthModpack(
  slug: string,
  serverName: string,
  ram: number,
  port: number,
): Promise<ServerConfig> {
  // 1. Fetch project and validate it's a modpack
  const project = await fetchProject(slug);
  if (project.project_type !== "modpack") {
    throw new Error(`"${project.title}" is a ${project.project_type}, not a modpack.`);
  }
  console.log(`[modrinth] Project: ${project.title} (${project.id})`);

  // 2. Get versions
  const versions = await fetchVersions(slug);
  if (versions.length === 0) throw new Error("No versions found for this modpack.");

  // 3. Pick the latest version
  const version = versions[0];
  console.log(`[modrinth] Latest version: ${version.name} (MC ${version.game_versions.join(", ")}, loaders: ${version.loaders.join(", ")})`);

  // 4. Find the mrpack file
  const mrpackFile = version.files.find(f => f.filename.endsWith(".mrpack"));
  if (!mrpackFile) throw new Error("No .mrpack file found in version.");

  // 5. Determine mod loader and MC version
  const mcVersion = version.game_versions[0];
  if (!mcVersion) throw new Error("No Minecraft version found.");

  const supportedLoaders = version.loaders.filter(l => l === "fabric" || l === "quilt");
  if (supportedLoaders.length === 0) {
    const loaderList = version.loaders.join(", ");
    throw new Error(
      `Modpack uses ${loaderList}. Only Fabric/Quilt are supported for automatic setup. ` +
      `Download the server pack manually from Modrinth and use the zip upload instead.`,
    );
  }
  const loader = supportedLoaders[0]; // prefer fabric
  console.log(`[modrinth] Loader: ${loader}, MC: ${mcVersion}`);

  // 6. Create server directory
  const id = uuid();
  const dataPath = path.join(DATA_ROOT, id);
  fs.mkdirSync(dataPath, { recursive: true });

  // 7. Download and extract mrpack
  const mrpackPath = path.join(dataPath, "pack.mrpack");
  console.log(`[modrinth] Downloading mrpack (${mrpackFile.url})...`);
  await downloadFile(mrpackFile.url, mrpackPath);

  // Extract the mrpack (it's a zip)
  const extractDir = path.join(dataPath, "_extract");
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    execSync(`unzip -o "${mrpackPath}" -d "${extractDir}"`, { stdio: "pipe", timeout: 60_000 });
  } catch (err: any) {
    throw new Error(`Failed to extract mrpack: ${err.message}. Is 'unzip' installed?`);
  }
  fs.unlinkSync(mrpackPath); // clean up

  // 8. Parse modrinth.index.json
  const indexPath = path.join(extractDir, "modrinth.index.json");
  if (!fs.existsSync(indexPath)) {
    throw new Error("modrinth.index.json not found in mrpack.");
  }
  const index: MrPackIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  console.log(`[modrinth] Modpack contains ${index.files.length} files.`);

  // 9. Copy overrides to data dir
  const overridesDir = path.join(extractDir, "overrides");
  if (fs.existsSync(overridesDir)) {
    console.log("[modrinth] Copying overrides...");
    // Copy all files from overrides into dataPath
    for (const entry of fs.readdirSync(overridesDir, { withFileTypes: true })) {
      const src = path.join(overridesDir, entry.name);
      const dst = path.join(dataPath, entry.name);
      if (entry.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true });
      } else {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // 10. Download mod loader JAR (Fabric/Quilt)
  console.log(`[modrinth] Downloading ${loader} server launcher...`);
  const loaderVersion = index.dependencies["fabric-loader"] || index.dependencies["quilt-loader"] || "0.16.0";
  const jarName = "fabric-server-launch.jar";

  if (loader === "fabric" || loader === "quilt") {
    // Use Fabric meta API (Quilt uses Fabric-compatible loader)
    const loaderRes = await fetch("https://meta.fabricmc.net/v2/versions/loader", { headers: FETCH_HEADERS });
    if (!loaderRes.ok) throw new Error(`Fabric API returned ${loaderRes.status}`);
    const loaderData = (await loaderRes.json()) as { version: string }[];
    const loaderVer = loaderData[0]?.version;
    if (!loaderVer) throw new Error("No Fabric loader versions available.");

    const installerRes = await fetch("https://meta.fabricmc.net/v2/versions/installer", { headers: FETCH_HEADERS });
    if (!installerRes.ok) throw new Error(`Fabric API returned ${installerRes.status}`);
    const installerData = (await installerRes.json()) as { version: string }[];
    const installerVer = installerData[0]?.version;
    if (!installerVer) throw new Error("No Fabric installer versions available.");

    const dlUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVer}/${installerVer}/server/jar`;
    console.log(`[modrinth] Fabric server JAR: ${dlUrl}`);
    await downloadFile(dlUrl, path.join(dataPath, jarName));
  }

  // 11. Download each mod file
  const modsDir = path.join(dataPath, "mods");
  fs.mkdirSync(modsDir, { recursive: true });

  let downloaded = 0;
  let failed = 0;
  for (const file of index.files) {
    const destPath = path.join(dataPath, file.path);
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // Try each download URL
    let ok = false;
    for (const url of file.downloads) {
      try {
        console.log(`[modrinth] Downloading ${file.path.split("/").pop()}...`);
        await downloadFile(url, destPath);
        ok = true;
        downloaded++;
        break;
      } catch (err: any) {
        console.log(`[modrinth]   Failed: ${err.message}`);
      }
    }
    if (!ok) {
      console.log(`[modrinth]   SKIPPED: ${file.path} (all downloads failed)`);
      failed++;
    }
  }
  console.log(`[modrinth] Downloaded ${downloaded} mods${failed > 0 ? `, ${failed} failed` : ""}.`);

  // 12. Clean up extract dir
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}

  // 13. Generate RCON credentials and server.properties
  const rconPort = port + 10;
  const rconPassword = uuid().replace(/-/g, "").slice(0, 16);
  const serverType: ServerType = (loader === "fabric" || loader === "quilt") ? "fabric" : "custom";

  const serverProps = [
    `server-port=${port}`,
    `enable-rcon=true`,
    `rcon.port=${rconPort}`,
    `rcon.password=${rconPassword}`,
    `motd=${serverName} | ${project.title}`,
    `max-players=20`,
    `difficulty=normal`,
    `gamemode=survival`,
    `online-mode=true`,
    `eula=true`,
  ].join("\n");
  fs.writeFileSync(path.join(dataPath, "server.properties"), serverProps + "\n");
  fs.writeFileSync(path.join(dataPath, "eula.txt"), "eula=true\n");

  // 14. Resolve Java image
  let javaImage: string;
  if (serverType === "fabric") {
    javaImage = resolveJavaImage(mcVersion);
    if (javaImage === "eclipse-temurin:16-jre-alpine" || javaImage === "eclipse-temurin:8-jre-alpine") {
      javaImage = "eclipse-temurin:17-jre-alpine";
    }
  } else {
    javaImage = resolveJavaImage(mcVersion);
  }

  // 15. Create server config and persist
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

  // 16. Create Docker container
  console.log(`[modrinth] Creating Docker container...`);
  const containerId = await createContainer(config, javaImage, { jarName });
  config.containerId = containerId;

  // Update config with container ID
  const servers = loadServers();
  const idx = servers.findIndex(s => s.id === id);
  if (idx !== -1) {
    servers[idx].containerId = containerId;
    fs.writeFileSync(path.resolve(process.cwd(), "servers.json"), JSON.stringify(servers, null, 2));
  }

  console.log(`[modrinth] Done! Server "${config.name}" (${id.slice(0, 8)})`);
  return config;
}
