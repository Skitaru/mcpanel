# MCPanel — Project Context & Session Log

> **Auto-loaded by Deep Code.** Every new session reads this file first.
> Keep it updated at the end of each session.

---

## Project Identity

| Key | Value |
|-----|-------|
| **Name** | MCPanel — Minecraft Server Panel |
| **GitHub** | `https://github.com/Skitaru/mcpanel` |
| **Stack** | Backend: Node.js / Express / TypeScript · Frontend: Next.js 15 / React 19 / Tailwind 4 |
| **Server IP** | `84.234.99.121` (SSH: `root@84.234.99.121`) |
| **Server OS** | Debian 13 ("agonizing-grocery") |
| **Local Dev** | Windows 11, Git Bash at `C:\Users\bross\Desktop\Claude\deepseek` |

---

## Server Layout (`/opt/mcpanel`)

```
/opt/mcpanel/
├── .env                  # PANEL_PORT=3000, PANEL_API_KEY=..., BACKEND_URL=http://127.0.0.1:3000
├── panel-config.json     # Username/password hash (default: admin/admin)
├── servers.json          # Server definitions
├── data/                 # Server data directories
├── src/                  # Backend source
├── dist/                 # Backend compiled JS
├── frontend/             # Next.js frontend (source + built .next)
│   └── .next/            # Production build output
├── package.json          # Backend dependencies
└── node_modules/
```

### Systemd Services

| Service | Port | Command | EnvFile |
|---------|------|---------|---------|
| `mcpanel-backend` | 3000 | `node /opt/mcpanel/dist/index.js` | `/opt/mcpanel/.env` |
| `mcpanel-frontend` | 3001 | `npx next start -p 3001` | `/opt/mcpanel/.env` |

---

## Core Working Principles

1. **Changes go to GitHub AND the server.** After editing local files, deploy to the server via SCP + rebuild, then push to GitHub. Never leave server and GitHub out of sync.

2. **Deploy workflow:**
   ```bash
   # Copy changed files to server
   scp local-file.ts root@84.234.99.121:/opt/mcpanel/path/file.ts
   # Rebuild + restart on server
   ssh root@84.234.99.121 "cd /opt/mcpanel && npx tsc && systemctl restart mcpanel-backend"
   # or for frontend:
   ssh root@84.234.99.121 "cd /opt/mcpanel/frontend && npx next build && systemctl restart mcpanel-frontend"
   # Then commit + push
   git add -A && git commit -m "..." && git push origin main
   ```

3. **Frontend uses relative API URLs.** `NEXT_PUBLIC_API_URL` must NOT be set during build. The `next.config.ts` rewrites proxy `/api/*` and `/socket.io/*` to the backend internally. This avoids the `127.0.0.1` hardcoding bug where remote browsers couldn't reach the backend.

4. **Auth flow:** JWT-based. `authMiddleware` validates tokens AND sets `_authOk = true` so the API-key fallback middleware doesn't reject the request. Default credentials: `admin / admin`.

5. **No speculative changes.** Touch only what's needed. Don't refactor unrelated code. Match existing code style.

---

## Session Log

### 2026-07-18 — Bug fixes + UI improvements

**Fixes:**
- **`ERR_CONNECTION_REFUSED` on login:** `install.sh` was baking `NEXT_PUBLIC_API_URL=http://127.0.0.1:3000` into the frontend build. Remote browsers resolved `127.0.0.1` to their own machine. Removed the env var from the build command — frontend now uses relative URLs + Next.js rewrites.
- **`401 Unauthorized` after login:** `authMiddleware` validated JWT but didn't set `_authOk`. The API-key fallback middleware then rejected the request. Added `(req as any)._authOk = true` in `auth.ts`.
- **Frontend systemd service** now has `EnvironmentFile=/opt/mcpanel/.env` so `BACKEND_URL` is available.
- **`resolveJavaImage`:** Short-form versions ("26.2" → 1.26.2) now normalised. Added Java 25 for MC 1.26+. Commits `33c977c`, `296ea56`.
- **`startContainer` 500 on already-running:** Docker returns 304 when container is already started, now caught and treated as no-op. Commit `33c977c`.
- **WebSocket → Polling:** Next.js production rewrites don't proxy WebSocket upgrades. Changed Socket.IO to polling-only transport. Commit `e0724bb`.

**Added:**
- **Logout button** in dashboard header (page.tsx) — clears token, reloads to login screen. (Logout also exists in sidebar footer.)
- **Dark `<option>` styling** in CreateServerDialog — all `<select>` dropdowns now use `bg-[#0a0a0a] text-white` instead of browser default blue.

**Git:** Frontend was incorrectly tracked as a gitlink/submodule without a remote. Converted to regular tracked directory in commit `7fddf80`.

**Cleanup:** Removed 10 orphaned data directories + 7 stale backup tarballs from `/opt/mcpanel/data/`.

---

### 2026-07-19 — UX Polish, 120% Zoom, JVM Args, Disk Usage, Bugfixes

**Bugfixes (continued from 07-18):**
- **Socket.IO 404 after 401 fix:** Next.js strips trailing slashes (`/socket.io/` → `/socket.io`), but Socket.IO only matches `/socket.io/`. Fix: `httpServer.prependListener` (placed AFTER `setupWebSocket` so it runs BEFORE Socket.IO's own prependListener) rewrites `/socket.io` → `/socket.io/` internally. Commit `0bc7529`.
- **ConsoleTab freeze after stop/start:** Console only attached on mount, never re-attached when server came back online. Added `useEffect` watching `serverStatus` — re-emits `console:attach`/`stats:subscribe` when status transitions to "running", detaches when leaving "running". Commit `b268460`.
- **FileManagerTab download corrupted binary files:** Same root cause as server icon — fetched JSON instead of raw binary. Fixed to `?raw=true` + `res.blob()`. Commit `bc7da45`.

**Features:**
- **JVM Start Arguments:** Custom `javaArgs` field in `ServerConfig`/`CreateServerRequest`. Stored in `servers.json`. When creating a container, `javaArgs` replaces the Aikar GC flags (but `-Xms`/`-Xmx` always auto-derived from RAM). Frontend: expandable "Advanced: JVM Arguments" textarea in CreateServerDialog + EditServerDialog. Commit `7840d76`.
- **Disk Usage:** `GET /api/servers/:id/disk` returns `du -sb` output in bytes. Frontend polls every 60s, shows on dashboard cards + server detail header. Commit `c1b6ec0`.
- **Backup Progress:** Backup button now shows loading spinner + "Backing up…" while tar is being created. Commit `7840d76`.

**UX Polish — Dashboard Cards (commit `c1b6ec0`):**
- Color-coded server type badges (Paper=blue, Fabric=amber, Velocity=purple)
- Pulsing green dot animation for running servers
- Specs row with icons + dot separators (instead of text blob)
- Live stats in bordered stat bar with vertical dividers
- Hover-revealed icon-only action buttons
- Disk usage display on cards

**UX Polish — Server Detail Header (commit `89ecb1b`):**
- Action buttons grouped: Power (Start/Stop/Restart) | Management (Backup/Restore/Edit) | Delete
- Type badge + pulsing status dot matching dashboard style
- Disk usage in header info row
- Removed duplicate logout button (already in sidebar)
- Tab switching with fade-in animation (`tab-content` class)

**UX Polish — ConsoleTab Redesign (commits `f6d357d`, `536a84a`):**
- Single unified card instead of 3 separate elements
- Stats as compact header bar inside the card (CPU | RAM | ● LIVE)
- Terminal fills container via `absolute inset-0`
- Command input attached to bottom (no gap)
- xterm background matches card (`slate-950`) for seamless blend
- xterm font size 13→14px for 120% zoom
- Better offline empty state

**Global — 120% Zoom (commit `51d7462`):**
- `html { font-size: 120% }` scales all rem-based units
- Container heights converted from px to rem: terminal/editor `h-72`, logs `h-80`, file list `max-h-72`
- Tab navigation: larger padding, stronger active state, hover on inactive tabs

**CSS additions (globals.css):**
- `pulse-dot` animation for running server indicators
- `slide-up` animation for card entry
- `tab-content` fade-in for tab switching
- `card-actions` hover-reveal utility
- Improved `.glass` and `.glass-hover` styles

### 2026-07-19 — Security: RCON port hardening + JWT improvements

**RCON Port Hardening (commit `a2e520f`):**
- **Problem:** Docker containers bound RCON port to `0.0.0.0` (default), exposing it to the internet. Bots from `194.195.210.47`, `172.236.228.193` were brute-forcing RCON, flooding the Minecraft console with connect/disconnect spam.
- **Fix:** `HostIp: "127.0.0.1"` in `PortBindings` so RCON is only reachable from the panel backend on localhost.
- **⚠ Existing containers** were created with the old binding. Recreate them (delete + re-create) for the fix to take effect.

**JWT Improvements (commit `a2e520f`):**
- Token expiry extended from 12h → 7 days (self-hosted panel, convenience over strict security).
- `AuthGuard` fetch interceptor now detects `401` responses, clears the token, and reloads the page so the user sees the login screen instead of silently failing API calls.

---

## Open / Pending

- [ ] Existing Docker containers need recreation to apply the RCON `127.0.0.1` binding.

---

## File Structure Quick Reference

```
deepseek/                      # Local clone root
├── AGENTS.md                  # ← THIS FILE (project context + session log)
├── README.md                  # Public README
├── install.sh                 # One-line installer for Debian/Ubuntu
├── update.ps1                 # Windows PowerShell update script
├── deploy.sh / deploy.ps1     # Manual deploy scripts
├── src/                       # Backend
│   ├── index.ts               # Express entry point, routes, CORS
│   ├── types.ts               # Shared TypeScript types
│   ├── routes/
│   │   ├── servers.ts         # CRUD, start/stop, backup/restore
│   │   └── files.ts           # File browser, editor, upload
│   └── services/
│       ├── auth.ts            # JWT auth, password management
│       ├── config-store.ts    # servers.json persistence
│       ├── docker.ts          # Dockerode wrapper
│       ├── rcon.ts            # RCON client
│       └── websocket.ts       # Socket.IO for live stats + console
├── dist/                      # Compiled backend JS
├── frontend/                  # Next.js App Router
│   ├── next.config.ts         # Rewrites: /api/* → backend proxy
│   ├── src/app/
│   │   ├── layout.tsx         # Root layout + AuthGuard wrapper
│   │   ├── page.tsx           # Dashboard (server cards)
│   │   ├── globals.css        # Tailwind + dark theme
│   │   └── servers/[id]/page.tsx  # Server detail (console/files/logs)
│   ├── src/components/
│   │   ├── AuthGuard.tsx      # JWT check + fetch interceptor
│   │   ├── LoginScreen.tsx    # Login form
│   │   ├── ServerSidebar.tsx  # Collapsible sidebar (server list + logout)
│   │   ├── CreateServerDialog.tsx  # New server modal
│   │   ├── EditServerDialog.tsx
│   │   ├── ConsoleTab.tsx     # xterm.js WebSocket console
│   │   ├── FileManagerTab.tsx # File browser/editor/upload
│   │   ├── LogsTab.tsx
│   │   └── Skeleton.tsx       # Loading skeletons
│   └── src/lib/types.ts       # Frontend TypeScript types
└── .deepcode/
    └── settings.json          # Deep Code config (model, API key)
```

---

> **Last updated:** 2026-07-19 · Session: RCON security hardening + JWT improvements
