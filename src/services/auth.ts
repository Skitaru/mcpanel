// ---- Minecraft Server Panel: Auth service ----
// Simple JWT-based authentication. Credentials stored in panel-config.json.
// Uses scrypt (memory-hard KDF) for password hashing — auto-migrates from
// older HMAC-SHA256 format on first successful login.

import crypto from "node:crypto";
import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const CONFIG_PATH = path.resolve(process.cwd(), "panel-config.json");
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

interface PanelConfig {
  username: string;
  salt: string;
  passwordHash: string;
  /** 0 = legacy HMAC-SHA256, 1 = scrypt. Missing = legacy. */
  hashVersion?: number;
  /** Independent random JWT secret — NOT derived from the password salt. */
  jwtSecret?: string;
}

async function loadConfig(): Promise<PanelConfig> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as PanelConfig;
  } catch {
    // First run: create default config
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = await hashPasswordScrypt(DEFAULT_PASSWORD, salt);
    const config: PanelConfig = {
      username: DEFAULT_USERNAME, salt, passwordHash: hash, hashVersion: 1,
      jwtSecret: crypto.randomBytes(32).toString("hex"),
    };
    await saveConfig(config);
    console.log("[auth] Created default credentials: admin / admin — CHANGE THE PASSWORD!");
    return config;
  }
}

async function saveConfig(config: PanelConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/** Constant-time hex comparison (scrypt verify). */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---- Legacy HMAC-SHA256 (for migration only) ----

function hashPasswordLegacy(password: string, salt: string): string {
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

// ---- scrypt hashing (current) ----

/**
 * Hash a password with scrypt, returning `salt:hash` (both hex-encoded).
 * scrypt is memory-hard — resistant to GPU/ASIC brute-force. Async so the
 * ~100 ms derivation never blocks the event loop.
 */
function hashPasswordScrypt(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key.toString("hex")),
    );
  });
}

/** Verify a password against the stored hash, auto-upgrading legacy hashes. */
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const config = await loadConfig();
  if (username !== config.username) return false;

  if (config.hashVersion === 1) {
    // Current scrypt format — constant-time compare
    const hash = await hashPasswordScrypt(password, config.salt);
    return safeEqualHex(hash, config.passwordHash);
  }

  // Legacy HMAC-SHA256 — try old hash first
  if (hashPasswordLegacy(password, config.salt) === config.passwordHash) {
    // Auto-migrate to scrypt
    const newSalt = crypto.randomBytes(16).toString("hex");
    config.salt = newSalt;
    config.passwordHash = await hashPasswordScrypt(password, newSalt);
    config.hashVersion = 1;
    await saveConfig(config);
    console.log("[auth] Migrated credentials from HMAC-SHA256 to scrypt.");
    return true;
  }

  return false;
}

/** JWT secret — independent random value, persisted so tokens survive restarts. */
let _jwtSecret: string | null = null;

/** Load the JWT secret synchronously — runs ONCE per process and caches the
 *  result, so the sync file read never sits in a hot request path. */
function loadJwtSecretSync(): string {
  if (_jwtSecret) return _jwtSecret;
  let config: PanelConfig;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as PanelConfig;
  } catch {
    // Config doesn't exist yet — create it synchronously (first-run only).
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(DEFAULT_PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    config = {
      username: DEFAULT_USERNAME, salt, passwordHash: hash, hashVersion: 1,
      jwtSecret: crypto.randomBytes(32).toString("hex"),
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log("[auth] Created default credentials: admin / admin — CHANGE THE PASSWORD!");
  }
  // Migrate configs created before the independent secret existed.
  if (!config.jwtSecret) {
    config.jwtSecret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }
  _jwtSecret = config.jwtSecret;
  return _jwtSecret;
}

export function getJwtSecret(): string {
  return loadJwtSecretSync();
}

/** The configured panel username (e.g. "admin"). Used by the SFTP server to
 *  split per-server logins ("admin.<server>"). */
export async function getConfigUsername(): Promise<string | null> {
  try {
    const config = await loadConfig();
    return config.username;
  } catch {
    return null;
  }
}

/** Change the password. Rotates the JWT secret → invalidates all existing tokens. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ success: true } | { error: string }> {
  const config = await loadConfig();

  // Verify current password (handles both legacy and scrypt)
  if (!(await verifyCredentials(config.username, currentPassword))) {
    return { error: "Current password is incorrect." };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  const newSalt = crypto.randomBytes(16).toString("hex");
  config.salt = newSalt;
  config.passwordHash = await hashPasswordScrypt(newPassword, newSalt);
  config.hashVersion = 1;
  config.jwtSecret = crypto.randomBytes(32).toString("hex"); // invalidate all sessions
  await saveConfig(config);
  _jwtSecret = null;
  return { success: true };
}

/** Generate a JWT token valid for 7 days. */
export function generateToken(username: string): string {
  return jwt.sign({ username }, getJwtSecret(), { expiresIn: "7d" });
}

/** Express middleware — checks for valid Bearer token. */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Public routes — use originalUrl because Express strips mount-path prefix
  const path = req.originalUrl.split("?")[0];
  if (path === "/api/health" || path === "/api/auth/login" || req.method === "OPTIONS") {
    return next();
  }

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      jwt.verify(token, getJwtSecret());
      (req as any)._authOk = true;
      return next();
    } catch {
      // Invalid JWT — fall through to the API-key check below.
    }
  }

  // No valid JWT. Only pass through if an API-key fallback middleware is
  // registered (i.e. PANEL_API_KEY is set) — otherwise REJECT here so a
  // misconfigured deployment never runs with an open API.
  if (process.env.PANEL_API_KEY) {
    return next(); // the fallback middleware makes the final call
  }
  res.status(401).json({ error: "Unauthorized." });
}
