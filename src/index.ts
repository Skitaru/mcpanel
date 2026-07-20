// ---- Minecraft Server Panel: Express entry point ----

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
} from "./services/auth";
import { startScheduler } from "./services/scheduler";

const PORT = process.env.PANEL_PORT ? parseInt(process.env.PANEL_PORT, 10) : 3000;

const app = express();

// ---- middleware ----
app.use(express.json());

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
import rateLimit from "express-rate-limit";
app.use("/api/auth/login", rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: "Too many login attempts. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false,
}));

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required." });
    return;
  }
  if (verifyCredentials(username, password)) {
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

app.post("/api/auth/change-password", (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password required." });
    return;
  }
  const result = changePassword(currentPassword, newPassword);
  if ("error" in result) {
    res.status(400).json(result);
  } else {
    res.json({ message: "Password changed. All sessions invalidated." });
  }
});

// ---- REST routes ----
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
httpServer.listen(PORT, () => {
  console.log(`[panel] Daemon listening on http://localhost:${PORT}`);
  console.log(
    `[panel] Store: ${process.cwd()}/servers.json  |  Data root: ${process.cwd()}/data`,
  );
  startScheduler();
});
