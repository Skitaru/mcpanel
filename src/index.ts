// ---- Obsidian Panel: Express entry point ----

import http from "node:http";
import express from "express";
import serversRouter from "./routes/servers";
import filesRouter from "./routes/files";
import { setupWebSocket } from "./services/websocket";
import {
  authMiddleware,
  verifyCredentials,
  generateToken,
  changePassword,
  getJwtSecret,
} from "./services/auth";
import { startScheduler } from "./services/scheduler";
import { startSftpServer, getSftpPort, sftpUsernameFor } from "./services/sftp";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";

const PORT = process.env.PANEL_PORT ? parseInt(process.env.PANEL_PORT, 10) : 3000;

const app = express();

// ---- middleware ----
app.use(express.json({ limit: "100mb" })); // generous limit for modpack manifests etc.

// ---- security headers (defence-in-depth) ----
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// CORS — allow frontend (any port on the same machine, or your reverse proxy).
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// JWT auth on all /api routes (except login + health)
app.use("/api", authMiddleware);

// Optional API-key fallback (PANEL_API_KEY env var)
const API_KEY = process.env.PANEL_API_KEY;
if (API_KEY) {
  app.use((req, res, next) => {
    if (req.path === "/api/health" || req.path === "/api/auth/login" || req.path.startsWith("/socket.io") || req.method === "OPTIONS")
      return next();
    // If already authenticated via JWT, skip
    if ((req as any)._authOk) return next();
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ") && auth.slice(7) === API_KEY) {
      (req as any)._authOk = true;
      return next();
    }
    // If no valid token yet, let authMiddleware handle it
    if (!(req as any)._authOk) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    next();
  });
  console.log("[panel] API-key authentication enabled as fallback.");
}

// ---- Auth routes ----
// Rate-limit login attempts: max 10 per minute per IP
app.use("/api/auth/login", rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: "Too many login attempts. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false,
}));

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required." });
    return;
  }
  if (await verifyCredentials(username, password)) {
    const token = generateToken(username);
    res.json({ token, username });
  } else {
    res.status(401).json({ error: "Invalid credentials." });
  }
});

app.get("/api/auth/me", (req, res) => {
  // authMiddleware already verified the token
  res.json({ authenticated: true });
});

app.post("/api/auth/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password required." });
    return;
  }
  const result = await changePassword(currentPassword, newPassword);
  if ("error" in result) {
    res.status(400).json(result);
  } else {
    res.json({ message: "Password changed. All sessions invalidated." });
  }
});

// ---- REST routes (rate-limited) ----
// 200 req/min per IP — generous for normal use, blocks brute-force / DoS
app.use("/api/servers", rateLimit({
  windowMs: 60_000,
  max: 200,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use("/api/servers", serversRouter);
app.use("/api/servers", filesRouter);

// ---- PaperMC proxy (avoids browser CORS / 410 issues) ----
app.get("/api/paper/versions", async (_req, res) => {
  try {
    const r = await fetch("https://fill.papermc.io/v3/projects/paper", {
      headers: { "User-Agent": "MCPanel/1.0", Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`PaperMC API returned ${r.status}`);
    const data = await r.json() as { versions?: Record<string, string[]> };
    const flat: string[] = [];
    if (data.versions) {
      for (const group of Object.values(data.versions)) flat.push(...group);
    }
    const stable = flat.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v));
    stable.sort((a, b) => {
      const ap = a.split(".").map(Number);
      const bp = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if ((ap[i] || 0) !== (bp[i] || 0)) return (bp[i] || 0) - (ap[i] || 0);
      }
      return 0;
    });
    res.json({ versions: stable });
  } catch (err: any) {
    res.status(502).json({ error: "Failed to fetch PaperMC versions.", detail: err.message });
  }
});

// ---- Velocity versions proxy ----
app.get("/api/velocity/versions", async (_req, res) => {
  try {
    const r = await fetch("https://fill.papermc.io/v3/projects/velocity", {
      headers: { "User-Agent": "MCPanel/1.0", Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`PaperMC API returned ${r.status}`);
    const data = await r.json() as { versions?: Record<string, string[]> };
    const flat: string[] = [];
    if (data.versions) {
      for (const group of Object.values(data.versions)) flat.push(...group);
    }
    const stable = flat.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v));
    stable.sort((a, b) => {
      const ap = a.split(".").map(Number);
      const bp = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if ((ap[i] || 0) !== (bp[i] || 0)) return (bp[i] || 0) - (ap[i] || 0);
      }
      return 0;
    });
    res.json({ versions: stable });
  } catch (err: any) {
    res.status(502).json({ error: "Failed to fetch Velocity versions.", detail: err.message });
  }
});

// ---- health-check ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ---- SFTP info (port + base username for the frontend access card) ----
app.get("/api/sftp/info", (req, res) => {
  // authMiddleware already validated the JWT — decode it for the username.
  let username = "admin";
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(auth.slice(7), getJwtSecret()) as { username?: string };
      if (payload.username) username = payload.username;
    } catch { /* fall back to default */ }
  }
  res.json({
    enabled: true,
    port: getSftpPort(),
    username,
    // helper the frontend can use to build per-server logins
    usernameFor: (serverName: string) => sftpUsernameFor(username, serverName),
  });
});

// ---- system info (max RAM, etc.) ----
import os from "node:os";
app.get("/api/system/info", (_req, res) => {
  res.json({ totalMemoryMB: Math.floor(os.totalmem() / (1024 * 1024)) });
});

// ---- host metrics (CPU / RAM / Disk of the machine) ----
app.get("/api/system/stats", async (_req, res) => {
  try {
    // CPU % via two samples of os.cpus() deltas (300 ms apart)
    const sample = () => {
      const cpus = os.cpus();
      let idle = 0, total = 0;
      for (const c of cpus) {
        idle += c.times.idle;
        total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
      }
      return { idle, total };
    };
    const a = sample();
    await new Promise((r) => setTimeout(r, 300));
    const b = sample();
    const dIdle = b.idle - a.idle;
    const dTotal = b.total - a.total;
    const cpu = dTotal > 0 ? Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10) : 0;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Disk usage of the root filesystem (df -k → kilobytes)
    let disk = { used: 0, total: 0 };
    const { execFile } = await import("node:child_process");
    try {
      const out = await new Promise<string>((resolve, reject) => {
        execFile("df", ["-k", "/"], { timeout: 5000, encoding: "utf-8" }, (err, stdout) =>
          err ? reject(err) : resolve(stdout),
        );
      });
      const line = out.split("\n").filter(Boolean)[1];
      const parts = line?.split(/\s+/);
      if (parts && parts.length >= 4) {
        disk = { used: parseInt(parts[2], 10) * 1024, total: parseInt(parts[1], 10) * 1024 };
      }
    } catch { /* df unavailable — leave 0 */ }

    res.json({
      cpuPercent: cpu,
      memory: { used: usedMem, total: totalMem },
      disk: { used: disk.used, total: disk.total },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read host stats.", detail: err.message });
  }
});

// ---- Fabric versions proxy ----
app.get("/api/fabric/versions", async (_req, res) => {
  try {
    const r = await fetch("https://meta.fabricmc.net/v2/versions/game", {
      headers: { "User-Agent": "MCPanel/1.0", Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Fabric API returned ${r.status}`);
    const data = await r.json() as { version: string; stable: boolean }[];
    const stable = data
      .filter((v) => v.stable)
      .map((v) => v.version)
      .filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v));
    stable.sort((a, b) => {
      const ap = a.split(".").map(Number);
      const bp = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if ((ap[i] || 0) !== (bp[i] || 0)) return (bp[i] || 0) - (ap[i] || 0);
      }
      return 0;
    });
    res.json({ versions: stable });
  } catch (err: any) {
    res.status(502).json({ error: "Failed to fetch Fabric versions.", detail: err.message });
  }
});

// ---- Global error handler (multer file-size errors etc.) ----
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File too large. Max 500 MB per file." });
    return;
  }
  if (err.code === "LIMIT_FILE_COUNT") {
    res.status(413).json({ error: "Too many files." });
    return;
  }
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large." });
    return;
  }
  console.error("[panel] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ---- HTTP server (needed so we can attach socket.io) ----
const httpServer = http.createServer(app);

// ---- WebSocket (socket.io) ----
setupWebSocket(httpServer);

// Next.js strips trailing slashes, but Socket.IO requires /socket.io/
// (with trailing slash). Must run AFTER setupWebSocket so our prependListener
// fires BEFORE Socket.IO's own prependListener.
httpServer.prependListener("request", (req) => {
  if (req.url?.startsWith("/socket.io") && !req.url!.startsWith("/socket.io/")) {
    req.url = req.url!.replace("/socket.io", "/socket.io/");
  }
});

// ---- start ----
const BIND_ADDR = process.env.PANEL_BIND || "127.0.0.1"; // never expose the API publicly by default
httpServer.listen(PORT, BIND_ADDR, () => {
  console.log(`[panel] Daemon listening on http://${BIND_ADDR}:${PORT}`);
  console.log(
    `[panel] Store: ${process.cwd()}/servers.json  |  Data root: ${process.cwd()}/data`,
  );
  startScheduler();
  startSftpServer();
});
