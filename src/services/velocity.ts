// ---- MCPanel: Velocity proxy JAR downloader ----
//
// Downloads the Velocity proxy JAR from PaperMC API.

import path from "node:path";
import { writeFile } from "node:fs/promises";

const headers = {
  "User-Agent": "MCPanel/1.0",
  Accept: "application/json",
};

/**
 * Download the Velocity proxy JAR for the given version.
 * Saves it to `velocity.jar` inside `dataPath`.
 */
export async function downloadVelocityJar(
  version: string,
  dataPath: string,
): Promise<void> {
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
  await writeFile(jarPath, buffer);
  console.log(`[velocity] Saved velocity.jar (${(buffer.length / 1e6).toFixed(1)} MB) to ${jarPath}`);
}
