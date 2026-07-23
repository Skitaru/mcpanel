// ---- Minecraft Server Panel: Auth service ----
// Simple JWT-based authentication. Credentials stored in panel-config.json.
// Uses scrypt (memory-hard KDF) for password hashing — auto-migrates from
// older HMAC-SHA256 format on first successful login.

import crypto from "node:crypto";
import fs from "node:fs";
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
}

function loadConfig(): PanelConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    // First run: create default config
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = hashPasswordScrypt(DEFAULT_PASSWORD, salt);
    const config: PanelConfig = { username: DEFAULT_USERNAME, salt, passwordHash: hash, hashVersion: 1 };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log("[auth] Created default credentials: admin / admin");
    return config;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config: PanelConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ---- Legacy HMAC-SHA256 (for migration only) ----

function hashPasswordLegacy(password: string, salt: string): string {
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

// ---- scrypt hashing (current) ----

/**
 * Hash a password with scrypt, returning `salt:hash` (both hex-encoded).
 * scrypt is memory-hard — resistant to GPU/ASIC brute-force.
 */
function hashPasswordScrypt(password: string, salt: string): string {
  // synchronously derive a 64-byte key; N=16384 (~100ms on modern CPU)
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
}

/** Verify a password against the stored hash, auto-upgrading legacy hashes. */
export function verifyCredentials(username: string, password: string): boolean {
  const config = loadConfig();
  if (username !== config.username) return false;

  if (config.hashVersion === 1) {
    // Current scrypt format
    return hashPasswordScrypt(password, config.salt) === config.passwordHash;
  }

  // Legacy HMAC-SHA256 — try old hash first
  if (hashPasswordLegacy(password, config.salt) === config.passwordHash) {
    // Auto-migrate to scrypt
    const newSalt = crypto.randomBytes(16).toString("hex");
    config.salt = newSalt;
    config.passwordHash = hashPasswordScrypt(password, newSalt);
    config.hashVersion = 1;
    saveConfig(config);
    console.log("[auth] Migrated credentials from HMAC-SHA256 to scrypt.");
    return true;
  }

  return false;
}

/** JWT secret — persisted so tokens survive restarts */
let _jwtSecret: string | null = null;

export function getJwtSecret(): string {
  if (!_jwtSecret) {
    const config = loadConfig();
    // Derive from password salt so it's stable
    _jwtSecret = crypto.createHmac("sha256", config.salt).update("mcpanel-jwt").digest("hex");
  }
  return _jwtSecret;
}

/** Change the password. Invalidates all existing tokens. */
export function changePassword(currentPassword: string, newPassword: string): { success: true } | { error: string } {
  const config = loadConfig();

  // Verify current password (handles both legacy and scrypt)
  if (!verifyCredentials(config.username, currentPassword)) {
    return { error: "Current password is incorrect." };
  }
  if (newPassword.length < 4) {
    return { error: "New password must be at least 4 characters." };
  }
  const newSalt = crypto.randomBytes(16).toString("hex");
  config.salt = newSalt;
  config.passwordHash = hashPasswordScrypt(newPassword, newSalt);
  config.hashVersion = 1;
  saveConfig(config);
  _jwtSecret = null; // invalidate, will be re-derived
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
  if (!auth?.startsWith("Bearer ")) {
    // No Bearer token — let API-key fallback middleware handle it
    return next();
  }

  const token = auth.slice(7);
  try {
    jwt.verify(token, getJwtSecret());
    (req as any)._authOk = true;
  } catch {
    // Invalid JWT — let API-key fallback try the token as raw API key
  }
  next();
}
