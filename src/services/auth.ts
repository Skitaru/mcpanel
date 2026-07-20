// ---- Minecraft Server Panel: Auth service ----
// Simple JWT-based authentication. Credentials stored in panel-config.json.

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
}

function loadConfig(): PanelConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    // First run: create default config
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = hashPassword(DEFAULT_PASSWORD, salt);
    const config: PanelConfig = { username: DEFAULT_USERNAME, salt, passwordHash: hash };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log("[auth] Created default credentials: admin / admin");
    return config;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config: PanelConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function hashPassword(password: string, salt: string): string {
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
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

/** Verify credentials. Returns true if valid. */
export function verifyCredentials(username: string, password: string): boolean {
  const config = loadConfig();
  if (username !== config.username) return false;
  return hashPassword(password, config.salt) === config.passwordHash;
}

/** Change the password. Invalidates all existing tokens. */
export function changePassword(currentPassword: string, newPassword: string): { success: true } | { error: string } {
  const config = loadConfig();
  if (hashPassword(currentPassword, config.salt) !== config.passwordHash) {
    return { error: "Current password is incorrect." };
  }
  if (newPassword.length < 4) {
    return { error: "New password must be at least 4 characters." };
  }
  const newSalt = crypto.randomBytes(16).toString("hex");
  config.salt = newSalt;
  config.passwordHash = hashPassword(newPassword, newSalt);
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
