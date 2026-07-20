// ---- Minecraft Server Panel: JSON config store ----
// Reads/writes servers.json on disk. No database required.

import fs from "node:fs";
import path from "node:path";
import { ServerConfig } from "../types";

const STORE_PATH = path.resolve(process.cwd(), "servers.json");

/** Read all server configs from the JSON file. Returns an empty array if the
 *  file doesn't exist yet. */
export function loadServers(): ServerConfig[] {
  if (!fs.existsSync(STORE_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(STORE_PATH, "utf-8");
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
export function saveServers(servers: ServerConfig[]): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(servers, null, 2), "utf-8");
}

/** Look up a single server by its id. */
export function getServer(id: string): ServerConfig | undefined {
  const servers = loadServers();
  return servers.find((s) => s.id === id);
}

/** Append a new server config and persist. */
export function addServer(config: ServerConfig): void {
  const servers = loadServers();
  servers.push(config);
  saveServers(servers);
}

/** Remove a server config by id. Returns true if something was deleted. */
export function removeServer(id: string): boolean {
  const servers = loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  servers.splice(idx, 1);
  saveServers(servers);
  return true;
}

/** Update an existing server config by id. Returns the updated config or null. */
export function updateServer(
  id: string,
  patch: Partial<Pick<ServerConfig, "name" | "ram" | "port" | "version" | "javaArgs" | "containerId" | "schedule">>,
): ServerConfig | null {
  const servers = loadServers();
  const s = servers.find((s) => s.id === id);
  if (!s) return null;
  if (patch.name !== undefined) s.name = patch.name;
  if (patch.ram !== undefined) s.ram = patch.ram;
  if (patch.port !== undefined) s.port = patch.port;
  if (patch.version !== undefined) s.version = patch.version;
  if (patch.javaArgs !== undefined) s.javaArgs = patch.javaArgs || undefined;
  if (patch.containerId !== undefined) s.containerId = patch.containerId;
  if (patch.schedule !== undefined) s.schedule = patch.schedule;
  saveServers(servers);
  return s;
}
