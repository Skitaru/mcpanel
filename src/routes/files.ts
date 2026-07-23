// ---- Minecraft Server Panel: File Manager routes ----
//
// All paths are resolved relative to the server's `dataPath` volume directory.
// Two layers of path-traversal protection are applied:
//   1. Prefix check  — the resolved absolute path MUST start with the server's
//      data directory.
//   2. Realpath check — if the path already exists on disk, resolve symlinks
//      via fs.realpath and verify the result is still within bounds.

import { Router, Request, Response } from "express";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import multer from "multer";
import { getServer } from "../services/config-store";

/** Map file extensions to MIME types for raw file serving. */
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".json": "application/json",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".toml": "text/plain",
  ".properties": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
};

const router = Router();

const upload = multer({
  dest: "/tmp/mcpanel-uploads",
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// Ensure upload temp directory exists
fsSync.mkdirSync("/tmp/mcpanel-uploads", { recursive: true });

/** 10 MB — refuse to read files larger than this in one request. */
const MAX_READ_SIZE = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Security helper
// ---------------------------------------------------------------------------

/**
 * Resolve a user-supplied relative path against a server's data directory.
 * Returns the resolved absolute path together with the data root, or `null`
 * if the path attempts to escape (path traversal) or the server is unknown.
 */
async function resolveSafe(
  serverId: string,
  subPath: string,
): Promise<{ absolutePath: string; dataRoot: string } | null> {
  const server = getServer(serverId);
  if (!server) return null;

  // Normalise and resolve `..` segments. Strip leading `/` so
  // path.resolve doesn't treat the subPath as absolute.
  const dataRoot = path.resolve(server.dataPath);
  const normalized = subPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(dataRoot, normalized);

  // Layer 1 — simple prefix guard.
  if (
    absolutePath !== dataRoot &&
    !absolutePath.startsWith(dataRoot + path.sep)
  ) {
    return null;
  }

  // Layer 2 — if the path exists, resolve symlinks and verify again.
  try {
    const real = await fs.realpath(absolutePath);
    if (real !== dataRoot && !real.startsWith(dataRoot + path.sep)) {
      return null;
    }
  } catch {
    // Path doesn't exist yet (e.g. PUT creating a new file) — the prefix
    // check above is sufficient.
  }

  return { absolutePath, dataRoot };
}

// ---------------------------------------------------------------------------
// GET /api/servers/:id/files?path=/
// ---------------------------------------------------------------------------
router.get("/:id/files", async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSafe(
      req.params.id,
      (req.query.path as string) || "/",
    );
    if (!resolved) {
      res
        .status(404)
        .json({ error: "Server not found or path traversal denied." });
      return;
    }

    const entries = await fs.readdir(resolved.absolutePath, {
      withFileTypes: true,
    });

    const result = await Promise.all(
      entries.map(async (entry) => {
        let size = 0;
        const isDirectory = entry.isDirectory();
        if (!isDirectory) {
          try {
            const stat = await fs.stat(
              path.join(resolved.absolutePath, entry.name),
            );
            size = stat.size;
          } catch {
            // File disappeared between readdir and stat — leave size as 0.
          }
        }
        return { name: entry.name, size, isDirectory };
      }),
    );

    // Sort: directories first, then alphabetically.
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json(result);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "Directory not found." });
    } else {
      console.error("[files] list error:", err);
      res.status(500).json({ error: "Failed to list directory." });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/file?path=/server.properties
// ---------------------------------------------------------------------------
router.get("/:id/file", async (req: Request, res: Response) => {
  try {
    const subPath = (req.query.path as string) || "";
    if (!subPath) {
      res.status(400).json({ error: "Query param 'path' is required." });
      return;
    }

    const resolved = await resolveSafe(req.params.id, subPath);
    if (!resolved) {
      res
        .status(404)
        .json({ error: "Server not found or path traversal denied." });
      return;
    }

    // ?raw=true — return binary file with proper Content-Type (for images etc.)
    const isRaw = req.query.raw === "true" || req.query.raw === "1";

    let stat;
    try {
      stat = await fs.stat(resolved.absolutePath);
    } catch {
      // File doesn't exist. For raw binary requests (icons, etc.), return 204
      // instead of 404 to suppress browser console noise.
      if (isRaw) { res.status(204).end(); return; }
      res.status(404).json({ error: "File not found." });
      return;
    }

    if (stat.isDirectory()) {
      res.status(400).json({ error: "Path is a directory, not a file." });
      return;
    }
    if (stat.size > MAX_READ_SIZE) {
      res.status(413).json({ error: "File too large (max 10 MB)." });
      return;
    }

    if (isRaw) {
      const ext = path.extname(resolved.absolutePath).toLowerCase();
      const mime = MIME_MAP[ext] ?? "application/octet-stream";
      const buf = await fs.readFile(resolved.absolutePath);
      res.set("Content-Type", mime);
      res.set("Cache-Control", "public, max-age=3600");
      res.send(buf);
      return;
    }

    const content = await fs.readFile(resolved.absolutePath, "utf-8");
    res.json({ path: subPath, size: stat.size, content });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "File not found." });
    } else {
      console.error("[files] read error:", err);
      res.status(500).json({ error: "Failed to read file." });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/file  — create a file or directory
// ---------------------------------------------------------------------------
router.post("/:id/file", async (req: Request, res: Response) => {
  try {
    const { path: subPath, type } = req.body;

    if (!subPath || typeof subPath !== "string") {
      res.status(400).json({ error: "Field 'path' (string) is required." });
      return;
    }

    const resolved = await resolveSafe(req.params.id, subPath);
    if (!resolved) {
      res
        .status(404)
        .json({ error: "Server not found or path traversal denied." });
      return;
    }

    const isDirectory = type === "directory";

    if (isDirectory) {
      await fs.mkdir(resolved.absolutePath, { recursive: true });
      res.status(201).json({ path: subPath, type: "directory", message: "Directory created." });
    } else {
      // Create parent dirs and an empty file
      await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      // Only create if it doesn't exist (avoid overwriting)
      try {
        await fs.writeFile(resolved.absolutePath, "", { flag: "wx" });
      } catch (err: any) {
        if (err.code === "EEXIST") {
          res.status(409).json({ error: "File already exists." });
          return;
        }
        throw err;
      }
      res.status(201).json({ path: subPath, type: "file", message: "File created." });
    }
  } catch (err: any) {
    console.error("[files] create error:", err);
    res.status(500).json({ error: "Failed to create.", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/servers/:id/file
// ---------------------------------------------------------------------------
router.put("/:id/file", async (req: Request, res: Response) => {
  try {
    const { path: subPath, content } = req.body;

    if (!subPath || typeof subPath !== "string") {
      res.status(400).json({ error: "Field 'path' (string) is required." });
      return;
    }
    if (typeof content !== "string") {
      res.status(400).json({ error: "Field 'content' (string) is required." });
      return;
    }

    const resolved = await resolveSafe(req.params.id, subPath);
    if (!resolved) {
      res
        .status(404)
        .json({ error: "Server not found or path traversal denied." });
      return;
    }

    // Auto-create parent directories so the frontend doesn't have to.
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.writeFile(resolved.absolutePath, content, "utf-8");

    res.json({ path: subPath, message: "File saved." });
  } catch (err: any) {
    console.error("[files] write error:", err);
    res.status(500).json({ error: "Failed to write file." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/upload — drag & drop file upload
// ---------------------------------------------------------------------------
router.post("/:id/upload", upload.array("files"), async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSafe(
      req.params.id,
      (req.body.path as string) || "/",
    );
    if (!resolved) {
      res.status(404).json({ error: "Server not found or path traversal denied." });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded." });
      return;
    }

    const { copyFile, unlink } = await import("node:fs/promises");
    for (const file of files) {
      const dest = path.join(resolved.absolutePath, file.originalname);
      await copyFile(file.path, dest);
      await unlink(file.path);
    }

    res.json({ message: `${files.length} file(s) uploaded.` });
  } catch (err: any) {
    console.error("[files] upload error:", err);
    res.status(500).json({ error: "Failed to upload files." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/servers/:id/file?path=/old_stuff
// ---------------------------------------------------------------------------
router.delete("/:id/file", async (req: Request, res: Response) => {
  try {
    const subPath = (req.query.path as string) || "";
    if (!subPath) {
      res.status(400).json({ error: "Query param 'path' is required." });
      return;
    }

    const resolved = await resolveSafe(req.params.id, subPath);
    if (!resolved) {
      res
        .status(404)
        .json({ error: "Server not found or path traversal denied." });
      return;
    }

    // Refuse to delete the server's data root itself.
    if (resolved.absolutePath === resolved.dataRoot) {
      res
        .status(403)
        .json({ error: "Cannot delete the server data root directory." });
      return;
    }

    await fs.rm(resolved.absolutePath, { recursive: true, force: true });
    res.json({ path: subPath, message: "Deleted." });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "Path not found." });
    } else {
      console.error("[files] delete error:", err);
      res.status(500).json({ error: "Failed to delete." });
    }
  }
});

export default router;
