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

### 2026-07-20 — Major UX Overhaul, Security Hardening, Scheduler, Bugfixes

**Installation UX:**
- README + install.sh now show both `curl` and `wget` commands since Debian 13 doesn't ship curl by default. Commit `1ccea5b`.

**Password Change Fix:**
- **Problem:** "Change Password" was on the login screen but required a valid JWT token — impossible since the user is on the login screen because they have no token.
- **Fix:** Removed from LoginScreen, added `ChangePasswordDialog.tsx` component accessible from the sidebar footer (KeyRound icon between "New Server" and "Logout"). After successful change, auto-logs out after 2s. Commit `b4d8e12`.

**Docker Root-User Hardening:**
- **Problem:** Containers ran Java as root. If Minecraft process was exploited, attacker had root in the container and potentially on the host via volume mounts.
- **Fix:** `docker.ts` Cmd now creates `mc` user (UID 1000) via `adduser -D`, chowns `/data`, and runs Java via `exec su mc -c "exec java ..."`. Also sets `TERM=dumb` env to suppress JLine "Advanced terminal features not available" warning. Commits `cb9c22d`, `3891874`.
- **⚠ Existing containers** need to be deleted + re-created for these fixes to apply.

**Console Rewrite — xterm.js → Div-based:**
- Removed `@xterm/xterm` + `@xterm/addon-fit` dependencies (~150KB saved).
- New `ConsoleTab.tsx`: div-based output (`font-mono text-[12.5px] leading-[1.75]`), color-coded lines (stdout=`text-slate-300`, stderr=`text-red-400`, system=`text-slate-600 italic`), `❯` prompt, compact command input bar.
- Stats sidebar on the right (matching Modpack_Server design): Status, Address (with copy button), Players, Uptime, CPU (with bar), Memory (with bar), RAM Limit, Server Type.
- Player list polled every 15s from `/api/servers/:id/players`.
- ANSI cleaning: handles CSI sequences with `?` (JLine), OSC sequences, and proper `\r\n`/`\r` normalization.
- Commit `cb9c22d`.

**Recreate Container (added then removed):**
- Added `POST /api/servers/:id/recreate` endpoint + frontend button, but removed in commit `c31393a` — user preferred the existing Restart button.

**Rate-Limit Cleanup:**
- `express-rate-limit` was imported via `try/require` in `index.ts` despite being in `package.json`. Cleaned up to proper ES import. Commit `439c0b2`.

**Scheduled Tasks (Scheduler):**
- **Backend:** `src/services/scheduler.ts` — checks every 30s for due tasks. `startScheduler()` called from `index.ts` on startup.
- **API:** `GET/PUT /api/servers/:id/schedule` — stores `{ restart?: "HH:MM", backup?: "HH:MM" }` per-server in `servers.json`.
- **Frontend:** SettingsTab "Scheduled Tasks" card with Auto-Restart and Auto-Backup time inputs.
- Scheduled backups keep the 5 most recent; older are auto-deleted.
- Commit `439c0b2` (with critical follow-up fix in `a3a9a30`).

**UX Overhaul — Design System Unification (commits `ca4d663`, `98d5094`, `5f9e49f`, `4c9b1b5`, `f354cc4`, `1c8ccad`):**

| Token | Old | New |
|-------|-----|-----|
| Background | `#030303` + radial glow | `#0a0c10` flat |
| Card/surface | `border-white/[0.06] bg-white/[0.02]` | `border-[#1a1f2e] bg-[#0f1119]` |
| Input background | `bg-white/[0.02]` | `bg-[#0a0c10]` |
| Accent | `sky-500/600` | `violet-500/600` |
| Sidebar width | `w-56` | `w-52` |
| Card border-radius | `rounded-2xl` | `rounded-xl` |
| Tab style | Pill buttons in box | Underline tabs (`border-b-2`) |

- **globals.css:** Removed body::before glow, added `.surface` + `.surface-hover` utilities.
- **LoginScreen:** Minimal — no glow, violet accent, compact `surface` card.
- **ServerSidebar:** Slimmer (w-52), no PanelLeft toggle icon, brand dot + name, consistent footer with violet "New Server" button.
- **Dashboard (page.tsx):** Cards use `surface surface-hover`, cleaner stats bar, icon-only actions on hover.
- **Server Detail (servers/[id]/page.tsx):** Compact header with inline info (name · status · type · version · port · disk), icon-only action row (Start/Stop/Restart | Backup/Restore | Delete), underline tabs.
- **ConsoleTab:** Matched to new palette (`border-[#1a1f2e] bg-[#0f1119]`), console output `bg-[#0a0c10]`, stats sidebar `bg-white/[0.02]`.
- **LogsTab:** Complete restyle matching Console design — same font, colors, borders. Added Copy-log button and ANSI cleaning.
- **CreateServerDialog + EditServerDialog:** `surface` style, violet accents, `bg-[#0a0c10]` inputs.
- **ChangePasswordDialog:** `surface` style, violet KeyRound icon.

**Critical Bugfixes:**
- **`updateServer` didn't save `containerId` or `schedule`** — the `Partial<Pick<...>>` type only included `name|ram|port|version|javaArgs`. Recreate endpoint silently failed to update the container ID, causing cascading 500s. Added `containerId` + `schedule` to the patch type. Commit `a3a9a30`.
- **`authMiddleware` blocked API-key fallback** — returned 401 immediately on missing/invalid JWT instead of calling `next()`. The API-key middleware never got a chance to validate the token as an API key. Fixed: authMiddleware now always calls `next()`, letting the fallback middleware decide. Commit `2d2ef35`.
- **404 console noise on missing server-icon:** `files.ts` now returns `204 No Content` instead of 404 when `raw=true` and file doesn't exist. Commit `4f111d7`.

**UX Polish (commit `b32d314`):**
- Header actions simplified from 3 bordered groups to one clean icon row.
- Sidebar mobile: redundant `lg:w-52` removed, collapsed sidebar hides completely on mobile via `-translate-x-full`.

---

## Open / Pending

- [ ] Existing Docker containers need recreation to apply non-root user + RCON `127.0.0.1` + TERM=dumb fixes. Use Restart button (which does a full stop/recreate/start cycle).
- [ ] Scheduled tasks rely on container recreation — verify scheduler correctly updates containerId after recreate.
- [ ] Modpack_Server folder in the repo is reference-only (alternative panel design), not part of MCPanel itself.

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
│   ├── index.ts               # Express entry point, routes, CORS, rate-limit, scheduler start
│   ├── types.ts               # Shared TypeScript types (+ schedule field)
│   ├── routes/
│   │   ├── servers.ts         # CRUD, start/stop, backup/restore, schedule get/put
│   │   └── files.ts           # File browser, editor, upload (204 for missing raw files)
│   └── services/
│       ├── auth.ts            # JWT auth, password management (passes through to API-key fallback)
│       ├── config-store.ts    # servers.json persistence (containerId + schedule patchable)
│       ├── docker.ts          # Dockerode wrapper (non-root mc user, TERM=dumb)
│       ├── scheduler.ts       # Task scheduler — checks every 30s for restart/backup
│       ├── rcon.ts            # RCON client
│       └── websocket.ts       # Socket.IO for live stats + console
├── dist/                      # Compiled backend JS
├── frontend/                  # Next.js App Router
│   ├── next.config.ts         # Rewrites: /api/* → backend proxy
│   ├── package.json           # No more @xterm/xterm or @xterm/addon-fit
│   ├── src/app/
│   │   ├── layout.tsx         # Root layout + AuthGuard wrapper, #0a0c10 bg
│   │   ├── page.tsx           # Dashboard (surface cards, violet accent)
│   │   ├── globals.css        # Design tokens, .surface utility, animations
│   │   └── servers/[id]/page.tsx  # Server detail (underline tabs, icon actions)
│   ├── src/components/
│   │   ├── AuthGuard.tsx      # JWT check + fetch interceptor
│   │   ├── LoginScreen.tsx    # Minimal login, violet accent
│   │   ├── ServerSidebar.tsx  # w-52 sidebar, violet brand dot
│   │   ├── CreateServerDialog.tsx  # surface style, violet accents
│   │   ├── EditServerDialog.tsx    # surface style
│   │   ├── ChangePasswordDialog.tsx # surface style
│   │   ├── ConsoleTab.tsx     # Div-based console + stats sidebar + IP copy
│   │   ├── FileManagerTab.tsx # File browser/editor/upload
│   │   ├── LogsTab.tsx        # Restyled to match console
│   │   ├── SettingsTab.tsx    # Server properties + scheduled tasks card
│   │   └── Skeleton.tsx       # Loading skeletons
│   └── src/lib/types.ts       # Frontend TypeScript types
├── Modpack_Server/            # Reference design (not part of MCPanel)
└── .deepcode/
    └── settings.json          # Deep Code config (model, API key)
```

---

> **Last updated:** 2026-07-20 · Session: Major UX overhaul, scheduler, security hardening, bugfixes
