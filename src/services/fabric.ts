// ---- MCPanel: Fabric server JAR downloader ----
//
// Downloads the Fabric server launcher JAR from meta.fabricmc.net.

import path from "node:path";
import { writeFile } from "node:fs/promises";

const headers = {
  "User-Agent": "MCPanel/1.0",
  Accept: "application/json",
};

/**
 * Download the Fabric server launcher JAR for the given Minecraft version.
 * Saves it to `fabric-server-launch.jar` inside `dataPath`.
 */
export async function downloadFabricJar(
  mcVersion: string,
  dataPath: string,
): Promise<void> {
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
  await writeFile(jarPath, buffer);
  console.log(`[fabric] Saved fabric-server-launch.jar (${(buffer.length / 1e6).toFixed(1)} MB) to ${jarPath}`);
}
