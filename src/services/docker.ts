// ---- Minecraft Server Panel: Docker service ----
// Thin wrapper around dockerode. All container operations flow through here.

import Docker from "dockerode";
import { PassThrough, Readable, Duplex } from "node:stream";
import { ServerConfig } from "../types";

const docker = new Docker({
  /* uses DOCKER_HOST / default socket path automatically */
});

const MC_PORT = 25565;

// ---------------------------------------------------------------------------
// Java version → Docker image mapping (PaperMC compatibility)
// ---------------------------------------------------------------------------

/**
 * Return the correct `eclipse-temurin` Docker image tag for a given Minecraft
 * version string (e.g. "1.21.1", "1.16.5", "26.2").
 *
 * Normalises short-form versions like "26.2" → "1.26.2".
 *
 * | Minecraft      | Java |
 * |----------------|------|
 * | 1.26+          | 25   |
 * | 1.20.5 – 1.25  | 21   |
 * | 1.17 – 1.20.4  | 17   |
 * | 1.16.5          | 16   |
 * | 1.12 – 1.16.4   | 11   |
 * | older           |  8   |
 */
export function resolveJavaImage(mcVersion: string): string {
  let [major, minor = 0, patch = 0] = mcVersion.split(".").map(Number);

  // Normalise short-form versions ("26.2" → 1.26.2).
  if (major > 1) {
    patch = minor;
    minor = major;
    major = 1;
  }

  // 1.26+ → Java 25 (Paper bumped the requirement at 1.26)
  if (major === 1 && minor >= 26) return "eclipse-temurin:25-jre-alpine";

  // 1.21+ → Java 21
  if (major === 1 && minor >= 21) return "eclipse-temurin:21-jre-alpine";

  // 1.20.5+ → Java 21 (Paper bumped the requirement at 1.20.5)
  if (major === 1 && minor === 20 && patch >= 5)
    return "eclipse-temurin:21-jre-alpine";

  // 1.17 – 1.20.4 → Java 17
  if (major === 1 && minor >= 17) return "eclipse-temurin:17-jre-alpine";

  // 1.16.5 specifically → Java 16
  if (major === 1 && minor === 16 && patch >= 5)
    return "eclipse-temurin:16-jre-alpine";

  // 1.12 – 1.16.4 → Java 11
  if (major === 1 && minor >= 12) return "eclipse-temurin:11-jre-alpine";

  // Older → Java 8
  return "eclipse-temurin:8-jre-alpine";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull a Docker image if it's not already cached locally. */
async function ensureImage(imageName: string): Promise<void> {
  const images = await docker.listImages();
  const hasImage = images.some((img) =>
    img.RepoTags?.some((tag) => tag === imageName),
  );
  if (!hasImage) {
    console.log(`[docker] Pulling ${imageName} …`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(
        imageName,
        (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (finishErr) => {
            if (finishErr) return reject(finishErr);
            console.log(`[docker] ${imageName} pulled successfully`);
            resolve();
          });
        },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create (but do NOT start) a Docker container for a PaperMC server.
 * `imageName` should come from {@link resolveJavaImage}.
 * Returns the Docker container id so we can store it in the config.
 */
export async function createContainer(
  cfg: ServerConfig,
  imageName: string,
  opts?: { jarName?: string; extraCmd?: string[]; javaArgs?: string },
): Promise<string> {
  await ensureImage(imageName);

  const jarName = opts?.jarName ?? "paper.jar";
  const nogui = cfg.serverType === "velocity" ? "" : "nogui";

  // Java heap flags: Xms = 512M minimum, Xmx = configured RAM.
  // Aikar's optimized GC flags for Minecraft servers.
  const javaHeap = `${cfg.ram}M`;
  const aikarFlags = [
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
  ].join(" ");

  const javaArgs = opts?.javaArgs || aikarFlags;
  // Run as non-root user (mc, UID 1000) for security.
  // su forwards signals, and the inner exec makes java the child so it
  // receives SIGTERM cleanly on docker stop.
  const startCmd = `exec su mc -c "exec java -Xms512M -Xmx${javaHeap} ${javaArgs} -jar /data/${jarName} ${nogui}"`.trim();

  const cmdParts = [`echo "eula=true" > /data/eula.txt`];
  if (opts?.extraCmd) cmdParts.push(...opts.extraCmd);
  // Create non-root user + fix data ownership.  adduser -D creates a
  // system user on Alpine; 2>/dev/null silences "already exists" errors.
  cmdParts.push(`adduser -D -u 1000 mc 2>/dev/null; chown -R mc:mc /data`);
  cmdParts.push(startCmd);

  const container = await docker.createContainer({
    Image: imageName,
    // Auto-accept EULA + launch PaperMC with the configured RAM.
    Cmd: [
      "sh",
      "-c",
      cmdParts.join(" && "),
    ],
    WorkingDir: "/data",
    // Required for WebSocket console (stdin / stdout / stderr attach).
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: false,
    ExposedPorts: { [`${MC_PORT}/tcp`]: {}, [`${cfg.rconPort}/tcp`]: {} },
    HostConfig: {
      // Docker memory limit (bytes)
      Memory: cfg.ram * 1024 * 1024,
      PortBindings: {
        [`${MC_PORT}/tcp`]: [{ HostPort: String(cfg.port) }],
        // RCON only needs to be reachable from the panel backend (localhost).
        // Binding to 0.0.0.0 exposes it to the internet and attracts brute-force bots.
        [`${cfg.rconPort}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: String(cfg.rconPort) }],
      },
      // Auto-restart the container if it crashes or Docker restarts.
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
      // Mount the host folder into the container at /data
      Binds: [`${cfg.dataPath}:/data`],
    },
    name: `mc-paper-${cfg.id}`, // friendly container name for `docker ps`
  });

  console.log(
    `[docker] Created container ${container.id.slice(0, 12)} for server "${cfg.name}"`,
  );
  return container.id;
}

/** Start a previously-created container. No-op if already running. */
export async function startContainer(containerId: string): Promise<void> {
  const c = docker.getContainer(containerId);
  try {
    await c.start();
    console.log(`[docker] Started container ${containerId.slice(0, 12)}`);
  } catch (err: any) {
    // Docker returns 304 when the container is already running — that's fine.
    if (err.statusCode === 304) {
      console.log(`[docker] Container ${containerId.slice(0, 12)} already running`);
      return;
    }
    throw err;
  }
}

/** Gracefully stop a container (SIGTERM, then force-kill after timeout). */
export async function stopContainer(containerId: string): Promise<void> {
  const c = docker.getContainer(containerId);
  await c.stop({ t: 30 }); // 30 s grace period for Minecraft to save
  console.log(`[docker] Stopped container ${containerId.slice(0, 12)}`);
}

/** Stop (if running) and remove a container + its volumes. Best-effort. */
export async function deleteContainer(containerId: string): Promise<void> {
  const c = docker.getContainer(containerId);
  try { await c.stop({ t: 10 }); } catch { /* already stopped */ }
  try { await c.remove({ force: true, v: true }); } catch { /* already gone */ }
  console.log(`[docker] Deleted container ${containerId.slice(0, 12)}`);
}

/** Return the Docker status string for a single container. */
export async function inspectContainer(
  containerId: string,
): Promise<{ status: string; running: boolean }> {
  try {
    const c = docker.getContainer(containerId);
    const info = await c.inspect();
    return {
      status: info.State.Status,
      running: info.State.Running,
    };
  } catch {
    return { status: "unknown", running: false };
  }
}

/**
 * Bulk-fetch statuses for a list of container ids.  Uses Docker's
 * `listContainers` with a filter on container name prefix so we avoid
 * calling `/inspect` once per container.
 */
export async function listManagedContainerStatuses(
  ids: string[],
): Promise<Map<string, { status: string; running: boolean }>> {
  const result = new Map<string, { status: string; running: boolean }>();

  if (ids.length === 0) return result;

  // First mark everyone as "unknown" so missing containers are handled.
  for (const id of ids) result.set(id, { status: "unknown", running: false });

  try {
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      if (ids.includes(c.Id)) {
        result.set(c.Id, {
          status: c.State,
          running: c.State === "running",
        });
      }
    }
  } catch (err) {
    console.error("[docker] Failed to list containers:", err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// WebSocket / real-time helpers
// ---------------------------------------------------------------------------

/**
 * Return a readable stream of Docker stats objects (one JSON blob per chunk).
 * The stream emits every ~1 s while the container is running.  Callers are
 * responsible for destroying the stream when the client unsubscribes.
 */
export async function getStatsStream(
  containerId: string,
): Promise<Readable> {
  const c = docker.getContainer(containerId);
  // @types/dockerode (v3) types the return as a web ReadableStream, but at
  // runtime dockerode v4 returns a Node.js Readable — cast accordingly.
  return c.stats({ stream: true }) as unknown as Readable;
}

/** Bundled result of {@link attachContainer}. */
export interface ContainerStreams {
  /** De-multiplexed stdout / stderr as separate PassThrough streams. */
  demuxed: { stdout: PassThrough; stderr: PassThrough };
  /** Writable side of the attach duplex — write commands here (newline-terminated). */
  stdin: NodeJS.WritableStream;
  /** Tear down all streams.  Call on detach or socket disconnect. */
  close(): void;
}

/**
 * Attach to a running container's stdio.
 *
 * Docker multiplexes stdout + stderr on a single channel; we split them into
 * individual PassThrough streams.  The returned `stdin` writable accepts raw
 * strings — remember to append `\n` so the Minecraft server processes the
 * command.
 */
export async function attachContainer(
  containerId: string,
): Promise<ContainerStreams> {
  const c = docker.getContainer(containerId);

  // This duplex carries multiplexed stdout/stderr on the readable side and
  // accepts stdin writes on the writable side.
  const rawStream = (await c.attach({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true,
  })) as unknown as Duplex;

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  // Split the multiplexed Docker stream into the two PassThroughs.
  docker.modem.demuxStream(rawStream, stdout, stderr);

  return {
    demuxed: { stdout, stderr },
    stdin: rawStream,
    close: () => {
      rawStream.destroy();
      stdout.destroy();
      stderr.destroy();
    },
  };
}
