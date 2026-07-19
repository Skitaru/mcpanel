// Shared types mirroring the backend API responses.

export type ServerType = "paper" | "fabric" | "velocity" | "custom";

export interface ServerStatus {
  id: string;
  name: string;
  serverType: ServerType;
  ram: number; // MB
  port: number;
  version: string;
  status: "running" | "exited" | "created" | "paused" | "unknown";
  containerId: string | null;
  javaArgs?: string | null;
}
