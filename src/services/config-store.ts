// ---- Obsidian Panel: JSON config store ----
// Reads/writes servers.json on disk. Fully async I/O.
//
// All writes are serialized through a promise queue (no lost updates) and
// written atomically (tmp file + rename) so a crash can't leave a truncated
// servers.json behind.

import { readFile, writeFile, access, rename } from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../types";

const STORE_PATH = path.resolve(process.cwd(), "servers.json");

// ---- write serialization ----
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function atomicWrite(data: string): Promise<void> {
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, data, "utf-8");
  await rename(tmp, STORE_PATH);
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

/**
 * Atomically apply a mutator to the server list and persist the result.
 * Serialized against all other writes — no lost updates.
 */
export async function mutateServers<T = unknown>(
  mutator: (servers: ServerConfig[]) => T | Promise<T>,
): Promise<T> {
  return enqueue(async () => {
    const servers = await loadServers();
    const result = await mutator(servers);
    await atomicWrite(JSON.stringify(servers, null, 2));
    return result;
  });
}

/** Overwrite the entire store with a new array of configs (serialized + atomic). */
export async function saveServers(servers: ServerConfig[]): Promise<void> {
  await enqueue(async () => {
    await atomicWrite(JSON.stringify(servers, null, 2));
  });
}

/** Look up a single server by its id. */
export async function getServer(id: string): Promise<ServerConfig | undefined> {
  const servers = await loadServers();
  return servers.find((s) => s.id === id);
}

/** Append a new server config and persist. */
export async function addServer(config: ServerConfig): Promise<void> {
  await mutateServers((servers) => {
    servers.push(config);
  });
}

/** Remove a server config by id. Returns true if something was deleted. */
export async function removeServer(id: string): Promise<boolean> {
  return mutateServers((servers) => {
    const idx = servers.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    servers.splice(idx, 1);
    return true;
  });
}

/** Update an existing server config by id. Returns the updated config or null. */
export async function updateServer(
  id: string,
  patch: Partial<Pick<ServerConfig, "name" | "ram" | "port" | "version" | "javaArgs" | "containerId" | "schedule" | "maxPlayers" | "voicePort" | "discordWebhook" | "discordMessageId" | "tag">>,
): Promise<ServerConfig | null> {
  return mutateServers((servers) => {
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
    if ("tag" in patch) s.tag = patch.tag || undefined;
    return s;
  });
}
