// ---- Minecraft Server Panel: shared types ----

export type ServerType = "paper" | "fabric" | "velocity" | "custom";

/** Stored on disk inside servers.json */
export interface ServerConfig {
  /** Auto-generated unique id */
  id: string;
  /** Human-readable label */
  name: string;
  /** Server type */
  serverType: ServerType;
  /** RAM limit in megabytes (e.g. 4096 = 4 GB) */
  ram: number;
  /** Host port mapped to the container's 25565 */
  port: number;
  /** RCON port (auto-assigned as port + 10) */
  rconPort: number;
  /** RCON password (auto-generated) */
  rconPassword: string;
  /** MC version string (e.g. "1.21.4") */
  version: string;
  /** Docker container id assigned after creation */
  containerId: string | null;
  /** Absolute path on the host that holds this server's world / config / plugins */
  dataPath: string;
}

/** Request body for POST /api/servers */
export interface CreateServerRequest {
  name: string;
  /** Server type — defaults to "paper" */
  serverType?: ServerType;
  /** RAM as a human string ("4G", "512M") or raw MB — defaults to "4G" */
  ram?: string | number;
  /** Host port — defaults to 25565 */
  port?: number;
  /** MC version (e.g. "1.21.1") — defaults to "1.21.1" */
  paperVersion?: string;
  /** Velocity-only: backend servers (one per line, "name=host:port") */
  backendServers?: string;
}

/** Returned by GET /api/servers */
export interface ServerStatus {
  id: string;
  name: string;
  serverType: ServerType;
  ram: number;
  port: number;
  version: string;
  status: "running" | "exited" | "created" | "paused" | "unknown";
  containerId: string | null;
}
