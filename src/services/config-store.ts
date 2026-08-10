// ---- Obsidian Panel: JSON config store ----
// Reads/writes servers.json on disk. Fully async I/O.

import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../types";

const STORE_PATH = path.resolve(process.cwd(), "servers.json");

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Read all server configs from the JSON file. Returns an empty array if the
 *  file doesn't exist yet. */
export async function loadServers(): Promise<ServerConfig[]> {
  if (!(await fileExists(STORE_PATH))) {
    return [];
  }
  const raw = await readFile(STORE_PATH, "utf-8");
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      return [];
    }
    return data as ServerConfig[];
  } catch {
    return [];
  }
}

/** Overwrite the entire store with a new array of configs. */
export async function saveServers(servers: ServerConfig[]): Promise<void> {
  await writeFile(STORE_PATH, JSON.stringify(servers, null, 2), "utf-8");
}

/** Look up a single server by its id. */
export async function getServer(id: string): Promise<ServerConfig | undefined> {
  const servers = await loadServers();
  return servers.find((s) => s.id === id);
}

/** Append a new server config and persist. */
export async function addServer(config: ServerConfig): Promise<void> {
  const servers = await loadServers();
  servers.push(config);
  await saveServers(servers);
}

/** Remove a server config by id. Returns true if something was deleted. */
export async function removeServer(id: string): Promise<boolean> {
  const servers = await loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  servers.splice(idx, 1);
  await saveServers(servers);
  return true;
}

/** Update an existing server config by id. Returns the updated config or null. */
export async function updateServer(
  id: string,
  patch: Partial<Pick<ServerConfig, "name" | "ram" | "port" | "version" | "javaArgs" | "containerId" | "schedule" | "maxPlayers" | "voicePort" | "discordWebhook" | "discordMessageId">>,
): Promise<ServerConfig | null> {
  const servers = await loadServers();
  const s = servers.find((s) => s.id === id);
  if (!s) return null;
  if (patch.name !== undefined) s.name = patch.name;
  if (patch.ram !== undefined) s.ram = patch.ram;
  if (patch.port !== undefined) s.port = patch.port;
  if (patch.version !== undefined) s.version = patch.version;
  if (patch.javaArgs !== undefined) s.javaArgs = patch.javaArgs || undefined;
  if (patch.containerId !== undefined) s.containerId = patch.containerId;
  if ("schedule" in patch) s.schedule = patch.schedule;
  if (patch.maxPlayers !== undefined) s.maxPlayers = patch.maxPlayers;
  if ("voicePort" in patch) s.voicePort = patch.voicePort;
  if ("discordWebhook" in patch) s.discordWebhook = patch.discordWebhook;
  if ("discordMessageId" in patch) (s as any).discordMessageId = patch.discordMessageId;
  await saveServers(servers);
  return s;
}
