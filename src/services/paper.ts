// ---- MCPanel: PaperMC server JAR downloader ----
//
// Uses the PaperMC v2 API:
//   1. GET …/versions/{version}/builds    → find latest build
//   2. GET …/builds/{build}/downloads/…   → stream jar to disk

import path from "node:path";
import { writeFile } from "node:fs/promises";

const headers = {
  "User-Agent": "MCPanel/1.0",
  Accept: "application/json",
};

/**
 * Download the latest PaperMC server jar for the given Minecraft version.
 * Saves it to `paper.jar` inside `dataPath`.
 */
export async function downloadPaperJar(
  paperVersion: string,
  dataPath: string,
): Promise<void> {
  // 1. Fetch build list (v3 returns a plain array, not { builds: [...] }).
  console.log(`[paper] Fetching builds for PaperMC ${paperVersion} …`);
  const buildsRes = await fetch(
    `https://fill.papermc.io/v3/projects/paper/versions/${paperVersion}/builds`,
    { headers },
  );
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
  await writeFile(jarPath, buffer);

  console.log(
    `[paper] Saved paper.jar (${(buffer.length / 1e6).toFixed(1)} MB) to ${jarPath}`,
  );
}
