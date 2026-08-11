# Obsidian Panel — Project Context & Session Log

> **Auto-loaded by Deep Code.** Every new session reads this file first.
> Keep it updated at the end of each session.

---

## Project Identity

| Key | Value |
|-----|-------|
| **Name** | Obsidian Panel — Minecraft Server Panel |
| **GitHub** | `https://github.com/Skitaru/mcpanel` |
| **Stack** | Backend: Node.js / Express / TypeScript · Frontend: Next.js 15 / React 19 / Tailwind 4 |
| **Server IP** | `188.214.30.159` (SSH: `root@188.214.30.159`, **Key-Auth** via `~/.ssh/id_ed25519`) |
| **Server OS** | Debian 13 (trixie) — Hostname `dreary-connection` |
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
   scp local-file.ts root@188.214.30.159:/opt/mcpanel/path/file.ts
   # Rebuild + restart on server
   ssh root@188.214.30.159 "cd /opt/mcpanel && npx tsc && systemctl restart mcpanel-backend"
   # or for frontend:
   ssh root@188.214.30.159 "cd /opt/mcpanel/frontend && npx next build && systemctl restart mcpanel-frontend"
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

- [ ] Existing Docker containers need recreation to apply non-root user + RCON `127.0.0.1` + TERM=dumb fixes.
- [ ] Modpack_Server folder in the repo is reference-only (alternative panel design), not part of MCPanel itself.

---

### 2026-07-22 — Modpack Installer, UX Improvements, Review Fixes

**Schedule Fix:**
- **Schedule clearing bug:** `updateServer({ schedule: undefined })` was ignored because `patch.schedule !== undefined` was false. Changed to `"schedule" in patch` so explicit undefined values are persisted. Commit `c2ccb72`.

**UX Improvements:**
- **Delete button removed from dashboard cards** — delete only available from server detail page. Commit `24758c0`.
- **Stop/Restart confirm dialogs** — dashboard Stop and server-detail Stop/Restart now show "Stop? Yes/No" before executing. Start remains direct. Commits `97699d2`.
- **Console command history** persists in `localStorage` (keyed by server ID, max 100 entries). Arrow key navigation unchanged. Commit `97699d2`.
- **Server search/filter** on dashboard — text input filters server cards case-insensitively with match count. Commit `97699d2`.
- **CPU display capped at 100%** — Docker reports per-core CPU (can exceed 100% on multi-core). `Math.min(100, ...)` in ConsoleTab + dashboard cards. Commit `0929fef`.

**CurseForge Modpack Installer:**
- **Replaced Modrinth with CurseForge** — Modrinth had too few modpacks. CurseForge supports Forge, NeoForge, Fabric, Quilt. Commit `0a62ae8`.
- **New files:** `src/services/modpack.ts` (319 lines) — `searchModpacks()`, `getModpackFiles()`, `createModpackServer()` (fast), `runModpackInstall()` (async).
- **New endpoints:**
  - `POST /api/servers/curseforge/search` — proxy CF search (apiKey in body, not stored server-side)
  - `POST /api/servers/curseforge/files` — proxy CF version list
  - `POST /api/servers/modpack` — responds immediately with server ID, installs async
  - `GET /api/servers/modpack/progress/:id` — poll install progress (step + percent)
- **Frontend:** `InstallModpackDialog.tsx` — CF API key input (saved in localStorage), search field, 2-column results grid, version selector, RAM/Port/Name config, progress bar with polling.
- **Loader support:**
  - **Forge:** Downloads `forge-<mc>-<ver>-installer.jar` from Maven, runs `--installServer` in Docker. Copies universal JAR → `server.jar` (1.12-1.16) or sets `jarName = "run.sh"` (1.17+).
  - **NeoForge:** Downloads from neoforged Maven, runs `--installServer` in Docker. Uses `run.sh`.
  - **Fabric:** Downloads fabric-installer from Maven, runs `server -mcversion <ver> -downloadMinecraft` in Docker. Creates `fabric-server-launch.jar`.
  - **Quilt:** Downloads quilt-installer from Quilt Maven, runs `install server <ver> --download-server` in Docker.
  - **Java 8 for old Forge:** MC < 1.13 Forge/NeoForge uses `eclipse-temurin:8-jre-alpine` (URLClassLoader removed in Java 9+).

**Bugfixes during modpack development:**
- **Missing `User-Agent` header** caused CF to return 403. Added to all CF API calls. Commit `31ed440`.
- **Forge/NeoForge run.sh containers failed:** `java -jar run.sh` tried to run a shell script as JAR. Fixed in `docker.ts`: when `jarName === "run.sh"`, executes `sh run.sh --nogui` instead. Commit `0ec7fc6`.
- **ENOBUFS on large modpacks:** `execSync` default maxBuffer 1MB too small for Forge installer output (SkyFactory 5 had ~290 mods). Increased to 100MB for `docker run` and 10MB for `unzip`. Commit `54d2035`.
- **Auto-start after modpack install:** Added `startContainer()` call after container creation. Commit `0929fef`.
- **run.sh ignored panel RAM:** `user_jvm_args.txt` now overridden with `-Xms`/`-Xmx` from panel config. Commit `ef8f9ae`.
- **Double CF API calls per mod:** Merged into single `getModFileInfo()` returning `{url, fileName}`. Commit `ef8f9ae`.
- **Memory leak:** `installProgress` Map entries now auto-deleted after 60s. Commit `ef8f9ae`.
- **Streaming downloads:** `downloadFile()` now streams to disk via `ReadableStream` reader instead of buffering in RAM. 5-min timeout on downloads. Commit `bc8835f`.
- **Docker image inconsistency:** `getJavaDockerImage()` now returns `-alpine` suffix matching `resolveJavaImage()` — prevents duplicate image pulls. Commit `bc8835f`.
- **Missing CF timeouts:** All `fetch()` calls to CF API now have `AbortSignal.timeout(15_000)`. Commit `bc8835f`.

**Deleted files:**
- `src/services/modrinth.ts` — replaced by `modpack.ts`
- `/opt/mcpanel/frontend/page.tsx` — stale duplicate of server detail page causing build errors

---

### 2026-07-23 — Responsive Review & Fixes

**Review:** Vollständiges Mobile-Responsive-Audit aller Frontend-Komponenten. 7 Fixes (commit `67e7765`):
- **Server-Detail-Header Overflow:** `flex` → `flex flex-wrap` + `gap-x-3 gap-y-1` — verhindert horizontalen Overflow bei vielen Status-Badges auf schmalen Screens.
- **Tab-Navigation Overflow:** `overflow-x-auto` — 4 Tabs (Console/Files/Logs/Settings) scrollen jetzt horizontal auf <400px Screens.
- **Dashboard Search:** `w-48` → `w-36 sm:w-48` — schmaleres Suchfeld auf kleinen Handys.
- **LogsTab Toolbar:** `min-w-[160px]` → `min-w-[120px]` — verhindert Overflow auf <380px.
- **ConsoleTab/FileManagerTab Höhe:** `h-[calc(100vh-12rem)]` → `h-[calc(100vh-16rem)] lg:h-[calc(100vh-12rem)]` — mehr Platz für Console/Editor auf Mobile.
- **CardSkeleton Tokens:** Alte `slate-800/slate-900/rounded-2xl` → `[#1a1f2e]/[#0f1119]/rounded-xl`.
- **ChangePasswordDialog Tokens:** `sky` → `violet` Accent, `border-white/[0.06]` → `border-[#1a1f2e]`.

---

### 2026-07-23 — Audit Fixes + Console Restart Reconnect

**Critical audit fixes (commit `e6ef6b4`):**
- `execFileSync` → `execFile` (async) in backup, disk-usage, scheduler — no more event-loop blocking.
- WebSocket auth: JWT/API-key required for Socket.IO connections + `Authorization` header fallback.
- `rmdirSync` → `rmSync`.
- AuthGuard spinner: old `#030303`/sky → `#0a0c10`/violet.

**Console restart reconnect (commits `ab036fa`–`0c9e1e2`):**
- **Problem:** Fast restarts (<3s) completed between status polls → `running→running`, no transition.
- **Fix:** `restartTick` prop from parent → explicit detach + `reattachPendingRef` → effect re-triggered via deps → re-attach on running. Also: `end` event listener on Docker PassThroughs, `cleaned` guard, `Authorization` header WS auth fallback.

**File Manager (commits `23a5a85`, `ccb5e5f`):**
- Binary files (.jar, .png, .dat, .mca, etc.) blocked from text editor — grayed out.
- File size `mr-5` to prevent delete button overlap.

**Mobile nav buttons (commit `684dd19`):**
- ☰ hamburger on dashboard + server detail, ← back arrow on server detail.

---

---

### 2026-08-09 — Complete Redesign: MCPanel → Obsidian Panel

**Design System — "Deep Violet" (based on Emergent preview):**
- **Colors:** Background `#0B0914`, Cards `#151221`, Borders `#28223D`, Accent `#9D4EDD`, Cyan `#00F5D4`, Pink `#F15BB5`
- **Fonts:** Outfit (headings) + JetBrains Mono (code) replacing Geist
- **Effects:** Grid background with radial fade mask, cyan glow pulse for online status, purple glow shadows on hover
- **Scrollbar:** Custom dark scrollbar matching the palette
- **Selection:** `#9D4EDD` highlight
- **Console:** Black background with subtle purple scanlines

**Token Strategy:** Used `@theme inline` in globals.css to override Tailwind color stops (`violet-*`, `slate-*`, `emerald-*`, `amber-*`, `red-*`, `rose-*`). This means existing `bg-violet-600`, `text-slate-500` etc. automatically use the new palette. Hardcoded hex values were batch-replaced with sed across all 15 component files.

**Renaming:**
- All `localStorage` keys: `mcpanel-token` → `obsidian-token`, `mcp_cmds_` → `obsidian_cmds_`, `mcp_cf_key` → `obsidian_cf_key`
- Fetch interceptor guard: `__mcpanelPatched` → `__obsidianPatched`
- All UI labels: "MCPanel" → "Obsidian Panel"
- Backend comment updated

**Files changed:** 18 files, 416 insertions, 334 deletions. Commit `651c54b`.

> **Last updated:** 2026-08-10 · Session: Complete redesign, Emergent palette, MCPanel → Obsidian Panel

---

### 2026-08-09/10 — Feature-Upgrades & Redesign

**Server changed to `5.231.108.226` (GA1TznLQBZCG, Debian 13).** Old server `84.234.99.121` decommissioned.

**Complete frontend redesign — Emergent "Deep Violet" palette:**
- Colors: `#0B0914` bg, `#151221` cards, `#28223D` borders, `#9D4EDD` accent
- Cyan `#00F5D4` for online/success, Yellow `#FEE440` for warning, Pink `#F15BB5` for destructive
- Fonts: Outfit (display) + JetBrains Mono (code)
- Dashboard: 4-column overview stats with live progress bars, redesigned server cards
- Server Detail: Cleaner breadcrumb, 4-column live stats bar (CPU/RAM/TPS/Players)
- Sidebar: Left purple accent line with glow on active items
- All 16 components batch-migrated via Tailwind theme overrides + sed

**Repo cleanup:** 10 sensitive/internal files removed from public GitHub (deploy scripts, session logs, passwords). Git history purged with `filter-branch`.

**TPS Monitor:** RCON polling every 5s via WebSocket, color-coded display (≥19 cyan, ≥15 yellow, <15 pink). Filters RCON connect/disconnect noise + AsyncCatcher stack traces.

**Discord Webhook — Live Status Embed:**
- Single persistent embed that self-edits every 10s
- Shows CPU, RAM, TPS, Uptime, Players with emoji indicators
- Instant on stop (await + generation-based race condition fix)
- `?wait=true` required for Discord to return message ID
- Stats stream starts independently of WebSocket (no browser tab needed)
- Stored in `discord.ts` as shared liveStore between WebSocket and poller

**Bugfixes:**
- Form inputs being overwritten: EditServerDialog `useEffect` had `server` in deps (re-ran every 3s poll). Changed to `[open]` only.
- CreateServerDialog: `paperVersion` now reset on open, not overridden on type change
- Dashboard RAM card: `32768 GB` → `32.0 GB` (wrong GB threshold `1e9` → `1024`)

**Deploy flow now uses ssh2** (password auth, no key needed). Helper script pattern: SFTP upload + remote build.

**README.md** updated with all current features.

**Commits:** `651c54b` through `a0aab23` (12 commits).

> **Last updated:** 2026-08-10 · Session: TPS, Discord live embed, redesign polish, bugfixes

---

### 2026-08-10 — Architecture Audit: Async I/O Migration, Scheduler Fix, Service Extraction

**Audit review:** In-depth analysis of backend architecture, UI/UX, and security. Four critical issues identified and resolved:

**Scheduler double-fire bug (scheduler.ts):**
- **Problem:** `CHECK_INTERVAL_MS = 30_000` caused each `HH:MM` to match twice (e.g. 03:00:00 and 03:00:30), executing scheduled restarts/backups twice.
- **Fix:** Added `lastFired` Map tracking the last executed minute per server+task key. Task only fires if `lastFired.get(key) !== currentTime`.

**Modpack installer blocked event loop (modpack.ts):**
- **Problem:** `execSync(docker run ...)` with 600s timeout and `execFileSync("unzip"...)` were synchronous, freezing the entire panel for minutes during modpack installs.
- **Fix:** Complete async rewrite — `execSync` → promisified `exec`, `execFileSync` → promisified `execFile`, all `fs.*Sync` → `fs/promises` (`readFile`, `writeFile`, `unlink`, `readdir`, `copyFile`, `mkdir`). `isClientOnlyMod()` now async. `runJavaInDocker()` now async.

**Sync I/O migration (scheduler.ts, servers.ts, config-store.ts):**
- `scheduler.ts`: `statSync`/`readdirSync`/`unlinkSync` → async `fs/promises` variants.
- `servers.ts` backup route: `readFileSync` + `res.send(buffer)` → `fs.createReadStream` + `stream.pipe(res)` — no longer buffers entire backup in RAM.
- `config-store.ts`: All 6 functions (`loadServers`, `saveServers`, `getServer`, `addServer`, `removeServer`, `updateServer`) migrated from `fs.*Sync` to `fs/promises`. All 5 callers updated with `await`.
- Two `.then(msgId => { await updateServer(...) })` callbacks fixed to `async msgId`.

**Service extraction (Single Responsibility):**
- `downloadPaperJar()` → `src/services/paper.ts`
- `downloadFabricJar()` → `src/services/fabric.ts`
- `downloadVelocityJar()` → `src/services/velocity.ts`
- `pingMinecraftServer()` → `src/services/minecraft-ping.ts`
- `servers.ts` reduced from 1360 to ~1100 lines. Removed `net` import (no longer needed).

**install.sh fixes:**
- **Debian 13 compatibility:** Removed `lsb-release` dependency (not available in trixie). Replaced `$(lsb_release -cs)` with `${VERSION_CODENAME:-bookworm}` from `/etc/os-release`.
- **Rebrand:** All "MCPanel" → "Obsidian Panel" in installer UI (step headers, systemd descriptions, final screen). Systemd service names (`mcpanel-backend` etc.) preserved for backwards compatibility.

**Commits:** `42c8c12`, `2c7139b`, `76c58f0`.

**Files changed:** 11 files (10 backend, 1 installer). +478/-401 lines net. Zero TypeScript errors.

> **Last updated:** 2026-08-10 · Session: Architecture audit fixes, async I/O migration, scheduler dedup, service extraction, backup streaming, install.sh compatibility

---

### 2026-08-10 — Server Migration: 5.231.108.226 → 188.214.30.159

**New server is now the only one in use:**
- **Server IP:** `188.214.30.159` (SSH: `root@188.214.30.159`, **Key-Auth** via `~/.ssh/id_ed25519` — no password needed)
- Hostname `dreary-connection`, Debian 13 (trixie)
- Old servers `5.231.108.226` and `84.234.99.121` decommissioned / no longer used.
- Panel already deployed & running on the new server (`/opt/mcpanel`, backend + frontend active, hostname `dreary-connection`). The single running Paper container (temurin:25-jre-alpine) already has the RCON hardening (`127.0.0.1:25575`).
- Plain `ssh`/`scp` work directly — no paramiko/ssh2 password helper needed anymore.

**Local updates:**
- `AGENTS.md` identity table + deploy workflow → new IP.
- `deploy.py` (gitignored helper): HOST → `188.214.30.159`, password auth removed → key-based (paramiko `key_filename=~/.ssh/id_ed25519`).
- Legacy `deploy.ps1` / `update.ps1` / `deploy_second_server.py` (zeigten auf abgeschaltete Server; update.ps1 nutzte das kaputte `NEXT_PUBLIC_API_URL`-Build-Muster) — **gelöscht**. `deploy.sh` bleibt (IP-agnostisch).

> **Last updated:** 2026-08-10 · Session: Server migration to 188.214.30.159, key-based SSH

---

### 2026-08-10 — Server-Detailseite: Uptime-Fix, Settings raus, Mobile-Redesign

**Uptime-Fix (ConsoleTab):**
- **Problem:** Sidebar-"Uptime" zählte die Seiten-Öffnungszeit (`Date.now()` beim Mount) — resettete bei jedem Reload auf 0s.
- **Fix:** ConsoleTab bekommt jetzt `startedAt` (Docker `State.StartedAt`, bereits im ServerStatus-Payload) als Prop und berechnet die Uptime daraus (1s-Intervall). Reset nach Restart automatisch durch 3s-Polling.

**Entrümpelung:**
- **Settings-Tab entfernt** (server.properties wird direkt über den File Manager editiert). `SettingsTab.tsx` gelöscht.
- **Scheduler** (Auto-Restart/Auto-Backup) als neue kompakte `ScheduleCard.tsx` in die linke Spalte der Detailseite (Desktop) verschoben.
- **Doppelte Stats entfernt:** Sidebar-CPU/Memory/RAM-Limit-Blöcke raus (stehen in der Top-Bar). Sidebar zeigt nur noch Status, Address (Copy), Uptime, Players-Liste, Typ/Version.
- **Server-Details-Card:** "IP & Port"-Zeile entfernt (Duplikat zur Sidebar-Adresse mit Copy-Button).

**Mobile-Redesign:**
- Linke Spalte (Details + Nav) nur noch Desktop (`hidden lg:block`). Mobile: horizontale Tab-Leiste oben, Console in voller Breite.
- ConsoleTab-Sidebar auf Mobile versteckt (`hidden lg:flex`), Top-Bar 2×2 (`grid-cols-2 lg:grid-cols-4`).
- Stale-Hostname-Fallback `5.231.108.226` → `188.214.30.159` entfernt (Variable war nach Dedup ungenutzt).

**Sonstiges:** `screenshots/` in .gitignore (UI-Review-Bilder, nicht fürs Repo). Backend unverändert (`/properties`, `/icon`, `/schedule`-Endpoints bleiben).

**Deploy:** Server-Build OK, Service active, Panel 200, API liefert `startedAt` korrekt.

> **Last updated:** 2026-08-10 · Session: Server detail cleanup — real uptime, Settings tab removed, mobile overhaul

---

### 2026-08-10 — Design-Review umgesetzt: Tokens, RAM-Semantik, Helper-Dedup, Feinschliff

**1. Semantische Design-Tokens (globals.css):**
- Neue `@theme`-Tokens als Single Source of Truth: `void` (#0B0914), `surface` (#151221), `edge` (#28223D), `accent` (#9D4EDD), `accent-strong` (#B100E8), `accent-deep` (#3C096C), `muted` (#6b6480), `ink` (#F8F7FF), `online` (#00F5D4), `warn` (#FEE440), `danger` (#F15BB5).
- **~430 hardcoded Hex-Werte per sed in allen 15 tsx-Dateien → Tokens migriert.** `globals.css` bleibt Kanon (definiert die Hex-Werte). Im generierten CSS verifiziert (`.bg-void{background-color:#0b0914}` etc.).
- **Konsistenz-Bug gefixt:** `--color-violet-400` war `#E0AAFF` (Lavendel), aber `--color-purple-400` `#9D4EDD` (Violett) — gleiche "Stufe", verschiedene Farben. Violet-400 jetzt `#9D4EDD`; Lavendel bleibt über violet-300/purple-300 für Text-Akzente.
- Tote CSS-Klassen entfernt: `value-flash`, `card-accent`, `hover-scale`, `glow-online`/`glow-pulse` (0 Nutzungen).

**2. RAM-Semantik (Dashboard):**
- Overview-Karte: zeigt jetzt **Verbrauch** (summierte Live-Stats) groß + Fortschrittsbalken + "X total" — vorher zeigte sie den totalen Alloc als große Zahl.
- Server-Cards: RAM-Tile zeigt Live-Verbrauch (`liveStats[id].mem`, Daten lagen ungenutzt im State); Alloc nur noch als Fallback bei gestoppten Servern.

**3. Helper-Dedup (`lib/format.ts` neu):**
- `statusColor`, `statusLabel`, `statusBadgeColor`, `typeLabel`, `typeBadgeColor`, `formatRam`, `formatBytes`, `formatDisk`, `formatUptime` — vorher 3× dupliziert (Dashboard/Detail/ConsoleTab) mit abweichenden Labels ("Online" vs. "Active"). Jetzt eine Quelle; Status heißt überall einheitlich "Online/Stopped/…".
- `ServerSidebar.statusColor` ebenfalls dedupliziert.

**4. Feinschliff:**
- `text-[9px]` → `text-[10px]` überall (6+ Stellen; Mindest-Labelgröße).
- Touch-Targets: Dashboard-Card-Actions h-8→h-9 (36px), Detail-Header-Buttons p-2→p-2.5 (40px).
- Login-Branding: Gradient-Logo-Quadrat (accent→accent-strong, Glow) + Server-Icon.
- Header-Redundanz raus: Dashboard-Subtitle zeigt nicht mehr "· N running" (steht in der Servers-Karte).
- Tab umbenannt: "Activity Logs" → "Server Logs".

**Bewusst nicht gemacht:** `#000000`-Log-Terminal bleibt (echtes Schwarz). Sidebar-Spieler-Badge war nur Ausblick, nicht Teil des Reviews. `formatUptime(seconds)` in ConsoleTab bleibt lokal (andere Signatur als `formatUptime(startedAt)`).

**Deploy:** Server-Build OK, Service active, Panel 200, Health OK.

> **Last updated:** 2026-08-10 · Session: Design review implemented — semantic tokens, RAM semantics, helper dedup, polish

---

### 2026-08-10 — UX-Review umgesetzt: URL-Tabs, Autocomplete, Mobile-Adresse, Shortcuts, A11y

**1. URL-Tab-Sync (Detailseite):** Aktiver Tab jetzt in `?tab=files|logs` (Query-Param). Refresh/Deep-Link funktionieren. Via `useEffect` nach Mount gelesen (SSR-Hydration-sicher), `history.replaceState` beim Wechsel.

**2. Mobile-Adresse:** Neue `AddressPill.tsx` (Copy-IP mit Clipboard-Fallback, dedupliziert). Auf Mobile kompakte Adress-Leiste über der Tab-Leiste (`lg:hidden`), Console-Sidebar nutzt dieselbe Komponente (Hover-Reveal bleibt).

**3. Console-Autocomplete:** Tab-Komplettierung für ~40 gängige MC-Befehle (bei `/`-Präfix) + Online-Spielernamen (ab 2. Token, aus gepollter Player-Liste). Dropdown über dem Input, ArrowUp/Down navigieren, Tab vervollständigt, Klick wählt. Pfeiltasten fallen bei offenem Dropdown auf Vorschläge statt History zurück.

**4. Shortcuts:** Detailseite `1-3` = Tabs wechseln (ignoriert Eingabefelder), Dashboard `/` fokussiert Suche, Esc in allen 4 Dialogen (InstallModpackDialog bekam den fehlenden Handler).

**5. Status-Filter:** Chips "All/Online/Stopped" mit Counts über den Server-Cards (Dashboard), kombiniert mit der Textsuche, `aria-pressed` gesetzt.

**6. Restore-Warnung:** Dateiauswahl öffnet jetzt Confirm-Modal ("overwrites the current world data") — Restore läuft erst nach Bestätigung (pink/danger).

**7. aria-labels:** Alle Icon-Buttons mit `title=` bekamen `aria-label=` (per sed): Dashboard, Detail-Header, FileManager (Upload/Download/Delete/Search/…), LogsTab (Copy), Sidebar (collapsed-Links), Console-Input.

**8. Spieler-Badge:** Sidebar "Quick Access" zeigt zusätzlich zum Running-Count die Summe aller Online-Spieler (🪖 N, Prop `onlinePlayers` vom Dashboard; Detailseite ohne — dort nicht verfügbar).

**Deploy:** Server-Build OK, Service active, Panel 200, Health OK.

> **Last updated:** 2026-08-10 · Session: UX review implemented — URL tabs, console autocomplete, mobile address, shortcuts, a11y

---

### 2026-08-10 — Lebendigkeit: Ambient-Glows, Breathing-Glow, Value-Flash, Console-Fade

**Diagnose:** Das Panel war nach der Redesign-Runde zu flach — kein Hintergrund-Glow, Farben nur als Mini-Akzente, keinerlei Bewegung. Design „clean", aber „leblos".

**A — Tiefe & Glow:**
- `body::before`: Ambient-Radial-Glows (Violett oben-links, Cyan unten-rechts, dezentes Violett oben-rechts, Opacity 0.06–0.10, `z-index:-1`, `pointer-events:none`).
- Root-Divs von Dashboard + Detailseite transparent gemacht (`bg-void` raus) — Glow ist hinter dem Content sichtbar (Body-Bg bleibt #0B0914).
- **`card-glow-online`**: Breathing-Glow (4s) für laufende Server-Cards — animierter Cyan-Inset-Ring + weicher Außen-Glow. Plus `border-online/20`-Tint.
- Login: eigener Ambient-Glow-Layer hinter dem Formular (fixed Overlay deckt body::before ab).

**B — Bewegung & Feedback:**
- ~~`value-flash`~~ — **wieder entfernt auf Nutzerwunsch** (wirkte zu blinky). Nur `console-line` + Status-Badge-Animation blieben.
- **`console-line`**: Neue Console-Zeilen faden sanft ein (0.18s, translateY).
- Status-Badge im Detail-Header: `key={server.status}` + `animate-in` → animiert bei Statuswechsel (offline→online).

**Bewusst dezent:** Alle Effekte Opacity/Glow-schwach, `prefers-reduced-motion` greift weiterhin (globale Animation-Suppression). Kein Backend-Change.

**Deploy:** Server-Build OK, Service active, Panel 200.

> **Last updated:** 2026-08-10 · Session: Liveliness — ambient glows, breathing card glow, value flash, console line fade

---

### 2026-08-10 — Security Review: alle kritischen/hohen Findings gefixt

**🔴 Kritisch:**
- **Upload-Pfad-Traversal** (`files.ts`): `file.originalname` wird jetzt per `path.basename` saniert (strip `\\`→`/`, dann basename) + finale Containment-Prüfung + Temp-Cleanup in `finally`. Vorher: `../../etc/crontab` als Dateiname → beliebige Datei als root überschreibbar.
- **Auth-Bypass ohne `PANEL_API_KEY`** (`auth.ts`): `authMiddleware` reicht Requests ohne gültiges JWT nur noch durch, wenn der API-Key-Fallback registriert ist — sonst **401**. Vorher: komplett offene API bei fehlender Env-Var.
- **JWT-Secret** (`auth.ts`): unabhängiger 32-Byte-Zufallswert in `panel-config.json` (Feld `jwtSecret`), nicht mehr aus dem Passwort-Salt abgeleitet. Bestands-Configs migrieren automatisch (einmaliges Re-Login). Passwortwechsel rotiert das Secret (Sessions invalidiert). Zusätzlich: `timingSafeEqual`-Hash-Vergleich, Passwort-Minimum 8 Zeichen.

**🟠 Hoch:**
- **Tar-Slip beim Restore** (`servers.ts`): `tar -tzf`-Pre-Scan vor dem Extrahieren — Archive mit `/`- oder `..`-Einträgen werden abgelehnt (`--no-absolute-filenames` allein schützt nicht gegen `..`).
- **Config-Store Lost-Update-Race** (`config-store.ts`): alle Writes über eine Promise-Queue serialisiert + atomarer Write (tmp + rename). Neues `mutateServers()`; Modpack-Install & Scheduler nutzen es.
- **Scheduler-Restart bricht Modpack-Server** (`scheduler.ts`): `jarName` wird für `custom`-Server aus dem Data-Dir geprobt (run.sh → server.jar → quilt/fabric-launch); vorher wurde immer `paper.jar` erstellt → Forge-Server starteten nach Auto-Restart nicht.
- **javaArgs-Shell-Injection** (`docker.ts` + `servers.ts`): Allowlist-Regex `^[A-Za-z0-9_+\-.:/=% ]*$` + Längenlimit — API-Level (POST/PUT) und defensiv in `createContainer`. Shell-Metazeichen werden abgelehnt.

**🟡 Mittel:**
- **MIME-Map** (`files.ts`): `.svg/.html/.js/.css/.xml` aus der Raw-Serving-Map entfernt (Stored-XSS-Vektor vom Panel-Origin) → fallen auf `application/octet-stream` zurück.
- **Backend-Bind** (`index.ts`): `httpServer.listen(PORT, "127.0.0.1")` — API ist nicht mehr extern erreichbar (Override via `PANEL_BIND`). Frontend-Proxy funktioniert weiter.
- **Properties-Blocklist** (`servers.ts`): `rcon.*`, `query.*`, `server-port`, `server-ip`, `level-name`, `enable-rcon`, `enable-query` + Newline-Injection-Check.
- **Modpack-Zip-Slip** (`modpack.ts`): `unzip -Z1`-Pre-Scan, `..`/absolute Einträge → Abbruch.
- **Port-Cap**: Max 65525 (RCON = port+10 muss ≤ 65535 bleiben) — POST /, Modpack-Route, `createModpackServer`.

**🟢 Klein:** ANSI-Buffer in WebSocket jetzt pro Socket (`socket.id:serverId`) statt global; `resolveJavaImageForServer` als gemeinsamer Resolver (dedupliziert Fabric-Fallback aus Scheduler + Create-Route).

**Verifiziert auf Server:** Backend lokal 200/401/200 (ohne/mit Token), Login liefert JWT, Panel extern 200, API-Proxy funktioniert. Backend von außen nicht mehr erreichbar.

> **Last updated:** 2026-08-10 · Session: Security review — upload traversal, auth bypass, JWT secret, tar/zip slip, write races, scheduler restart, javaArgs injection, bind 127.0.0.1

---

### 2026-08-10 — Strukturelles Redesign: Pterodactyl-Stil (Banner-Karten, Topbar, Console-first)

**Ausgangslage:** User war mit dem generischen Admin-Dashboard-Layout unzufrieden. Nach Analyse der etablierten MC-Panels (Pterodactyl/Panelify/AMP/MCSManager) wurde ein statisches HTML-Mockup im Pterodactyl-Stil erstellt (`screenshots/mockup-pterodactyl.html`, gitignored) → vom User abgenickt ("Sieht sehr sehr gut aus").

**Umbau (alles in einem Commit, 5 Dateien):**

1. **`TopBar.tsx` (neu) ersetzt `ServerSidebar.tsx` (gelöscht):**
   - Schlanke sticky Topbar: Brand-Punkt + Name, Dashboard-Link, **Server-Switch-Dropdown** (Quick Access mit Status-Dots, Ports, Players-Badge), rechts Modpack/Password/Logout-Icons
   - Mobile: Brand-Text versteckt, Rest kompakt
   - `ServerSidebar.tsx` war durch die Änderungen Orphan → gelöscht

2. **Dashboard (`page.tsx` + neue `ServerCard.tsx`):**
   - **Banner-Karten**: 112px-Banner (Gradient nach Typ: Paper=Violett `#2a1a4d→`, Fabric=Amber `#4d3310→`, Velocity=Cyan `#0d3d3a→`, offline=Grau) + Block-Textur (`.banner-texture*` in globals.css) + Name im Banner + Status-Badge (pulsierender Online-Dot) + Typ·Version-Badge
   - **Große Power-Buttons**: ▸ Open (violett) · ↻ (amber) · ■ (pink) · offline ▶ Start (grün) — mit Inline-Yes/No-Confirm
   - **Dicke 6px-Balken** für CPU (farbcodiert) + RAM mit Prozent
   - Metadaten-Zeile: Spieler · Uptime · Port; Online-Cards `card-glow-online border-online/20`, Offline gedimmt (opacity-75)
   - Entfernt: serverIcons-Fetch (kein Icon mehr nötig), STAGGER, tick-State, sidebarCollapsed

3. **Detailseite (`[id]/page.tsx`):**
   - **Doppel-Sidebar komplett raus**: keine linke Spalte mehr (Server-Details-Card, ScheduleCard, Vertikal-Nav)
   - Breadcrumb: ← Dashboard / Name / Status-Badge / **Adresse mono** (auch mobile)
   - **Große Power-Buttons**: ■ Stop / ↻ Restart / ▶ Start + ⬇ Backup (violett) + Restore + Logs + Edit + 🗑 Delete
   - **Tabs horizontal** (Console / File Manager / Server Logs) — eine Navigationsebene, mit Border-Active
   - ConsoleTab rendert sein eigenes 2-Spalten-Layout

4. **`ConsoleTab.tsx` — Console-first:**
   - Console-Card links (volle Breite): Header (LIVE/Offline-Badge + Typ·Version + "verbunden"), Output schwarz `bg-[#000]` mit `h-[420px] lg:h-[calc(100vh-22rem)]`, Input unten
   - Rechte Spalte `lg:w-[290px]` (Desktop): **"Auslastung"-Card mit dicken 10px-Balken** (CPU, RAM mit "von X", TPS 5s/1m/5m, Disk-Wert) + "Server"-Card (AddressPill mit Copy, Uptime, Typ, Version) + "Spieler"-Card (Avatare, max 8 + "weitere…")
   - Top-Stats-Bar (CPU/RAM/TPS/Players oben) entfernt — Werte wandern in die rechte Spalte
   - Neues Prop `diskUsage` (vom Detail-Page gepollt)

5. **`FileManagerTab.tsx`**: `ScheduleCard` unten eingefügt (war in der linken Detail-Spalte)

**Ergebnis:** Eine Navigationsebene (Topbar), Server mit visueller Identität (Banner), Power-Aktionen prominent, Console als Herzstück. Verifiziert: Build 0 Fehler, Deployed, Panel 200, CSS-Klassen (`banner-texture*`, `card-glow-online`) im Build-Bundle.

> **Last updated:** 2026-08-10 · Session: Pterodactyl-style redesign — banner cards, TopBar, console-first detail page, thick bars

---

### 2026-08-10 — Topbar-Fixes & Discord-Ideen (Session-Abschluss)

**Modpack-Button sichtbar (Commit `221fdb6`):**
- Der Modpack-Installer war nach dem Sidebar-Removal nur noch ein unscheinbares Icon in der Topbar (User fand ihn nicht).
- Fix: Icon + Label-Button `⬇ Modpack` in der Topbar (Desktop mit Text, Mobile nur Icon), rechts zwischen Server-Switch und Passwort.

**Mockups (gitignored, `screenshots/`):**
- `mockup-dashboard.html` — Ops-Console-Tabelle (vom User ABGELEHNT, nur als Referenz)
- `mockup-pterodactyl.html` — Pterodactyl-Stil (vom User abgenickt → als `33ac140` umgesetzt)

**Offen — Discord-Webhook-Features (Frage wurde gestellt, Auswahl steht aus!):**
Aktuell existiert NUR der Live-Status-Embed (`discord.ts`: send/edit/buildStatusEmbed, liveStore, Updater alle 10s, online/offline bei Start/Stop). Vorgeschlagen + vom User noch nicht ausgewählt:

1. **Crash-Alert** (empfohlen): unerwarteter Container-Stop (nicht via /stop) → Embed "💥 crashed" + Exit-Code + letzte Log-Zeilen. Erkennung: Poller running→exited + Flag ob explizit gestoppt.
2. **Spieler Join/Leave**: server-seitiger RCON-"list"-Poller (wie TPS) + Diff → Embed mit Minecraft-Avatar (mc-heads.net). Cooldown gegen Spam (max 1×/5s, Reset bei Restart).
3. **Ressourcen-Warnungen**: CPU >90% / RAM >90% / TPS <15 → Embed, Cooldown max 1×/30min pro Server.
4. **Backup/Modpack-Benachrichtigungen** (empfohlen): "✅ Backup fertig (2.4 GB)" nach manuellem + geplantem Backup; "✅ Modpack installiert" nach `runModpackInstall`.
5. **Tägliche Zusammenfassung**: um 23:59 Embed mit Uptime/Peak-Spieler/Backups des Tages.

Hinweis: Slash-Commands (z.B. `/status`) sind mit Webhooks NICHT möglich — dafür bräuchte es einen echten Bot (Gateway). Webhook = nur reine Benachrichtigungen.

> **Last updated:** 2026-08-10 · Session-Ende: Modpack-Button-Fix, Discord-Ideen vorgeschlagen (Auswahl offen), Mockups in screenshots/

---

### 2026-08-11 — Recreate-Button, Console-Filter, Verlaufskurven

**Bestandsaufnahme 188-Server:** `servers.json` ist leer, keine Docker-Container — der frühere Paper-Container existiert nicht mehr. Einziger Überrest: 226-MB-Orphan-Backup `backup-e0450b75-...tar.gz` im `data/`-Ordner (Frage ans User gestellt, Antwort steht aus). Alle Hardening-Fixes (Non-Root `mc`-User, RCON 127.0.0.1, TERM=dumb) greifen automatisch bei jedem neu erstellten Server.

**A1 — Recreate-Button (Commit `4ac2eb1`):**
- **Backend:** `POST /api/servers/:id/recreate` — stoppt+löscht den alten Container, baut neu aus der aktuellen Config (Daten bleiben, Bind-Mount), stellt den Laufzustand wieder her (war er an → startet wieder). Löst das "Delete + neu erstellen"-Problem bei Container-Code-Fixes dauerhaft.
- **Helper-Dedup:** JAR-Probe-Logik aus `scheduler.ts` → `resolveLaunchJar()` in `docker.ts` extrahiert (paper.jar / fabric / velocity / custom-Probe run.sh→server.jar→quilt→fabric). Scheduler + Recreate-Route nutzen denselben Resolver. Unbenutzter `fs`-Import im Scheduler entfernt.
- **Frontend:** Recreate-Button mit Inline-Yes/No-Confirm in der Detail-Aktionsleiste (zwischen Restore und Spacer), setzt `restartTick` → Console detach/reattach.

**C8 — Console-Filter (Commit `4ac2eb1`):**
- Filterleiste zwischen Console-Header und Output: Freitext + Level-Dropdown (All/Errors/System), Match-Zähler `N/M`, Clear-Button, "No lines match"-Empty-State.
- `visibleLines` via `useMemo` — Roh-Lines bleiben fürs Umfiltern intakt, Auto-Scroll folgt den gefilterten Zeilen.

**D12 — Verlaufskurven (Commit `4ac2eb1`):**
- Client-seitige History: 1 Sample/5s (Throttle via `lastSampleRef`), 360 Samples = 30 Min, Reset bei Stop/Restart.
- Dependency-freie `Sparkline`-Komponente (SVG-Polyline, `vectorEffect="non-scaling-stroke"`) in der Auslastung-Card unter CPU- (cyan) und RAM-Balken (violett), Label "letzte 30 Min".

**C10 — Drag&Drop-Upload:** War bereits vollständig implementiert (Backend `POST /:id/upload` in `files.ts` + Drop-Handler/Overlay in `FileManagerTab`) — nur verifiziert, nichts geändert.

**A3 — HTTPS:** Vom User auf später verschoben (Caddy/Let's Encrypt braucht eine Domain; keine vorhanden).

**Deploy:** Server-Build OK (Backend tsc 0 Fehler, Frontend next build OK), beide Services active, Backend-Health 200, Frontend 200, API-Proxy 200.

> **Last updated:** 2026-08-11 · Session: Recreate-Button, Console-Filter, Sparklines, C10 verifiziert, HTTPS vertagt

---

### 2026-08-11 — Backup/Restore/Auto-Restart neu geplant + Mobile-Delete-Fix

**Auslöser:** Auf dem Handy waren Ordner/Dateien nicht löschbar (hover-only Buttons). Plus: Backup/Restore/Auto-Restart-Logik sollte neu geplant werden.

**Mobile-Fix:** FileManager-Delete-Button `opacity-0 group-hover:opacity-100` → `sm:opacity-0 sm:group-hover:opacity-100` — auf Touch-Geräten (<sm) immer sichtbar, Desktop behält Hover-Reveal. Einziges weiteres hover-only Element war AddressPill `hoverReveal`, aber das wird nur in der Console-Sidebar genutzt (`hidden lg:flex`) → kein Mobile-Problem.

**Neuplanung (User-Entscheidungen):** Backups im Panel verwaltbar + Auto-Backup vor Risiko-Aktionen + Auto-Restart = stop+start + Backups ohne Server-Stop.

**Backend (Commit `fd6c819`):**
- **Neu `src/services/backups.ts`:** `createBackup` (ohne Stop, kein Download), `listBackups`, `pruneBackups` (behält N neueste pro Kind), `deleteBackup`, `restoreFromArchive` (tar-Slip-Pre-Scan + Temp-Extract + atomarer Swap + Restart falls vorher lief).
- **Speicherort:** `backups/<serverId>/` statt data-Root. Präfixe: `backup-` (manual), `scheduled-backup-` (scheduled), `auto-` (pre-delete/recreate/restore).
- **Routen:** `GET /:id/backups`, `GET /:id/backups/:name/download`, `POST /:id/backups/:name/restore`, `DELETE /:id/backups/:name`. `POST /:id/backup` erstellt jetzt nur noch (kein Download-Stream). `POST /:id/restore` (Upload) nutzt den Service.
- **Auto-Backup** (kind=auto, keep 5) vor Delete, Recreate und Restore (beide Varianten) — best-effort, Fehler blockieren nicht.
- **Scheduler:** Auto-Restart = stop+start auf demselben Container (kein delete+recreate mehr — das bleibt manueller Recreate-Button). Scheduled-Backup nutzt createBackup + pruneBackups(5).

**Frontend (Commit `fd6c819`):**
- **Neu `BackupsTab.tsx`** (4. Tab "Backups"): Liste mit Typ-Badges (Manual violett / Scheduled cyan / Auto amber), Datum, Größe, Download / Restore (Confirm-Modal mit "overwrites + Auto-Safety-Backup"-Hinweis) / Delete (Confirm-Modal). Eigener "New Backup"-Button, Poll alle 30s.
- **Detailseite:** Backup-Button erstellt (kein Download mehr, Icon Archive), URL-Sync `?tab=backups`, Shortcut-Taste 4, `backupsRefreshTick` refresht die Liste nach Erstellen.

**Verifiziert auf Server:** tsc 0 Fehler, next build OK, Services active, Health 200, alle 5 neuen Routen mit Token → 404 auf nonexistent (Routen registriert, Auth ok).

> **Last updated:** 2026-08-11 · Session: Backup-Overhaul (BackupsTab, Auto-Backups, stop+start Auto-Restart), Mobile-Delete-Fix

### 2026-08-11 — Backup/Download Progress-Bars (Commit `3fa4cc7`)

**Problem:** Backup/Download zeigten nur einen Spinner, kein Fortschritt.

**Backend:**
- `backups.ts`: Backup-Erstellung jetzt als Stream-Pipeline `tar → counter → gzip → file` (statt `tar -czf`), der Counter zählt die verarbeiteten (unkomprimierten) Bytes gegen die Gesamtgröße (`du -sb`) → ehrlicher Prozentwert (0–99 während des Laufs, 100 am Ende).
- `startBackupJob()`: asynchroner Job-Store mit `getBackupJob()`, Job-Einträge werden nach 60 s aufgeräumt (wie Modpack-Progress). `POST /:id/backup` antwortet sofort `202 { jobId }`.
- Neu: `GET /api/servers/backups/progress/:jobId` zum Pollen (kein Konflikt mit `/:id/...`-Routen, da andere Segmentzahl).

**Frontend:**
- Neu `lib/backup.ts`: `waitForBackupJob(jobId, onProgress)` — pollt alle 1 s bis done/error (Cap 10 min).
- `BackupsTab`: violette Progress-Bar mit % beim Erstellen (unter dem Header), grüne Bar beim Download — Download streamt den Body via `ReadableStream` und vergleicht gegen `Content-Length` (Fallback: plain Blob, falls kein Body-Stream).
- Detailseite: Backup-Button zeigt `Backup X%` während der Job läuft.

**Technischer Hinweis:** Fortschritt basiert auf verarbeiteten Bytes vs. Gesamtgröße — springt am Ende auf 100, wenn die Kompression fertig ist (bei gut komprimierbaren Daten bleibt der Wert länger niedrig, da der Counter auf der unkomprimierten Seite zählt — das ist gewollt: er zeigt echten Arbeitsfortschritt).

> **Last updated:** 2026-08-11 · Session: Backup/Download-Progress-Bars

### 2026-08-11 — Download-% Fix + Schedule als eigener Tab (Commit `0d37a46`)

**Bugfix Download-Prozent:** Beim Backup-Download fehlte die %-Anzeige (nur Spinner). Ursache: Die Download-Route nutzte `createReadStream().pipe(res)` → Node/Express sendet dabei **keinen `Content-Length`-Header** (Chunked Transfer) → Frontend bekam `total = 0` und konnte keinen Prozentsatz berechnen. Fix: `res.set("Content-Length", stat.size)` in `GET /:id/backups/:name/download`.

**Schedule als eigener Tab:** ScheduleCard war unten im File Manager versteckt → jetzt 5. Tab "Schedule" auf der Detailseite (`?tab=schedule`, Shortcut-Taste 5). Aus FileManagerTab entfernt.

**ScheduleCard überarbeitet:** Zwei separate Cards (Auto-Restart amber/RotateCcw, Auto-Backup cyan/Save) mit `type="time"`-Inputs (nativer Time-Picker, mobile-freundlich statt Text HH:MM), Active/Off-Badge im Header, per-Karte Disable-Button (Trash), Save mit Toast statt Inline-Message.

> **Last updated:** 2026-08-11 · Session: Download-Prozent-Fix, Schedule-Tab + Redesign

### 2026-08-11 — Console-Redesign nach modernen Panels (Commit `47e6c44`)

**Auslöser:** Ressourcen-Graphen (dünne Sparklines) sahen schlecht aus; die Console zog sich mit der Eingabezeile bis zum Viewport-Boden.

**Recherche:** MCSManager 10 / Hatch / Bloom / Pelican — moderne Panels machen die Console zu einer **Karte mit fester Höhe** (Input am Kartenrand, nicht Seitenende) und nutzen **Area-Charts mit Verlauf** statt dünner Linien. Mockup in `screenshots/mockup-modern.html` (gitignored) → vom User abgenickt.

**Umsetzung (ConsoleTab.tsx):**
- Console-Card: `h-[540px] max-h-[calc(100vh-200px)]`, Output `flex-1 min-h-0` — die Eingabezeile klebt am Karten-Unterrand, kein Boden-Stretch mehr.
- Filter in den Console-Header integriert (Search + Level + Match-Count + Clear), bricht auf Mobile via `flex-wrap` um.
- `Sparkline` → `AreaChart`: SVG mit Gradient-Fill (CPU cyan `#00F5D4`, RAM violett `#9D4EDD`), Fläche + Linie, `h-10`.
- Bars `h-2.5` → `h-1.5` mit `bg-gradient-to-r` (teal→cyan, purple→accent; Warn/Danger-Stufen behalten).
- Werte `text-base` → `text-lg` (größere Zahlen wie im Mockup), Sidebar `w-[290px]` → `w-[300px]`.

**Nachtrag (Commit `b73510e`):** Area-Charts auf Nutzerwunsch wieder entfernt — "Graphen raus, nur Balken". Auslastung-Card zeigt nur noch große Zahlen (text-lg) + dicke Verlaufs-Balken (h-1.5 gradient). AreaChart-Komponente, History-Sampling und Resets komplett entfernt (toter Code). Console-Höhe + Filter-im-Header aus `47e6c44` bleiben.

> **Last updated:** 2026-08-11 · Session: Console-Redesign moderner Panel-Stil, Area-Charts, feste Console-Höhe

---

### 2026-08-11 — Feature-Mockup umgesetzt: Tags, Host-Metriken, Templates, Quick-Commands, Player-Management, File-Batch

Alle 9 Features aus dem abgenommenen Mockup (`screenshots/mockup-features.html`) implementiert:

**1. Server-Gruppen/Tags (Backend + Frontend):**
- `tag?: string` in `ServerConfig`, `CreateServerRequest`, `ServerStatus` (Backend + Frontend-Typen).
- Create/PUT validieren: max 20 Zeichen, nur `[a-zA-Z0-9 _-]`. Empty string löscht den Tag.
- Dashboard: dynamische Tag-Chips (mit Count, kombinierbar mit Status-Filter + Suche + Reset-Button), Tag-Badge auf den Server-Cards.
- EditServerDialog: Tag-Feld. `tagStyle()` Helper in `lib/format.ts` (deterministische Farbpalette + spezifische Styles für survival/modded/proxy/creative/test).

**2. Host-Metriken (Dashboard):**
- Neu `GET /api/system/stats`: CPU % (2×`os.cpus()`-Delta, 300 ms), RAM (used/total), Disk (`df -k /`). Poll alle 5 s.
- Die 4 Overview-Karten ersetzt: **Host CPU / Host RAM / Host Disk / Servers** (alle mit dicken 6px-Balken, farbcodiert). `stats`-Objekt (Server-Aggregate) entfernt.

**3. Echter Create-Fortschritt:**
- `POST /api/servers` validiert synchron (4xx sofort), startet dann einen **async Job** → `202 { jobId }`. `GET /api/servers/create-progress/:jobId` pollt `{ step, percent, status }` (Cleanup nach 10 min).
- `runCreateJob()` macht Directory → JAR-Download (8%) → Image-Pull (45%) → Container (75%) → Start (90%) → Done (100%). Fehler → `status: "error"` + Data-Dir-Cleanup.
- CreateServerDialog: 4-Step-Leiste (Download/Pull/Container/Start) + Gradient-Bar + % + Step-Text statt der alten Zeit-Schätzung.

**4. Templates (CreateServerDialog):**
- 3 Cards: **Paper Vanilla** (4G), **Modpack** (öffnet InstallModpackDialog via neuem `onOpenModpack`-Prop), **Velocity Proxy** (2G/25577/tag=proxy). Vorbefüllen das Formular, alles bleibt editierbar.

**5. Header-Kerninfo-Chips (Detailseite):**
- Unter dem Breadcrumb: Adresse (AddressPill mit Copy), Typ, Version, RAM, Uptime (echt, aus `startedAt`), Disk, Tag-Badge.

**6. Quick-Commands (neu, ConsoleTab Desktop):**
- `QuickCommands.tsx`: 11 Buttons (Say/Op/Deop/Gamemode/Whitelist±/save-all/list/Kick/Ban/Restart 60s) via `POST /:id/command` (RCON). Parameter-Commands öffnen ein Mini-Modal, Antworten als Toast. "Restart 60s" sagt Countdown + startet Restart per `setTimeout(60 s)`.

**7. Player-Management (neu, ConsoleTab-Sidebar):**
- `PlayerCard.tsx` ersetzt die reine Spielerliste: OP/Kick/Ban-Buttons pro Online-Spieler (RCON) + **Whitelist** (Liste via `whitelist list`-Parsing, Add per Input, Remove per Klick, Auto-Reload bei Statuswechsel).

**8. File Manager: Ordner-Suche + Batch:**
- Suchfeld in der Toolbar (filtert Einträge clientseitig), Checkboxen pro Zeile + Batch-Leiste ("N ausgewählt → Löschen/Abbruch", Löscht sequenziell via DELETE /file).

**9. Fehler-Highlighting (Console + Logs):**
- Console: Zeilen mit ERROR/EXCEPTION → rot + `bg-danger/10` + semibold, WARN → amber + `bg-warn/5`. stderr/system-Logik bleibt.
- LogsTab: von `<pre>`-Join auf Zeilen-Divs umgebaut (gleiches Highlighting, `preRef` → `HTMLDivElement`).

**Deploy + Verifikation (188.214.30.159):**
- Beide Builds OK (Backend `tsc`, Frontend `next build`), Services active, Panel 200.
- Smoke-Tests: `/api/system/stats` liefert Werte, `/create-progress` 404 sauber, **End-to-End-Create-Job** (202 → 45% Pull → 100% Done mit serverId), Tag-Persistenz, Delete mit Auto-Backup. Testserver + Backup-Artefakt wieder entfernt.
- ⚠ Beim SCP-Sammelbefehl landeten `servers.ts`/`config-store.ts` fälschlich als Strays unter `/src/` — auf dem Server gelöscht (Build-Fehler TS2307/TS7006 behoben).

> **Last updated:** 2026-08-11 · Session: Feature-Mockup umgesetzt — Tags, Host-Metriken, Create-Job-Progress, Templates, Quick-Commands, Player-Management, File-Suche/Batch, Log-Highlighting

---

### 2026-08-11 — Design-Relift: Graphite (Grau/Schwarz + Stahlblau), Neon raus

**Auslöser:** User wollte keine Neon-Farben mehr, nichts Knalliges, „vielleicht modern Grau/Schwarz einbauen".

**Mockup-Runde:** `screenshots/mockup-colors.html` (6 knallige Varianten — Cyan/Blau/Smaragd/Orange/Rot, alle mit Neon-Glows) **verworfen** auf Nutzerwunsch. `screenshots/mockup-colors-2.html` (5 gedämpfte Varianten: Graphite/Obsidian-Gold/Slate/Stone + aktuelle Referenz, ohne Glows) → **User wählte Graphite**.

**Neue Graphite-Palette (globals.css):**

| Token | Alt (Violett) | Neu (Graphite) |
|-------|---------------|----------------|
| void | `#0B0914` | `#0C0D0F` |
| surface | `#151221` | `#15161A` |
| edge | `#28223D` | `#26292F` |
| accent | `#9D4EDD` | `#6A86B8` (Stahlblau) |
| accent-strong | `#B100E8` | `#54709E` |
| accent-deep | `#3C096C` | `#20293A` |
| muted | `#6b6480` | `#878C95` |
| ink | `#F8F7FF` | `#EDEEF1` |
| online | `#00F5D4` (Neon-Cyan) | `#4E9B7A` (mattes Grün) |
| warn | `#FEE440` (Neon-Gelb) | `#C9A227` (mattes Gold) |
| danger | `#F15BB5` (Neon-Pink) | `#C2605C` (gedecktes Rot) |
| violet/purple-300+ | `#E0AAFF` | `#9FB4D8` (helles Stahlblau) |
| slate-400/500 | `#A9A2C2` | `#9AA2AC` |

**Entschärfte Effekte (kein Neon mehr):**
- `body::before`-Ambient-Glows: Violett/Cyan → dezentere Stahlblau- (#6A86B8) + matt-grüne (#4E9B7A) Glows, Opacity gesenkt.
- `pulse-dot`, `card-glow-online` (Breathing-Glow): Cyan → mattes Grün, weichere Opacity.
- `banner-texture*`: violet/amber/cyan → Stahlblau/Gold/Grün, dunkler.
- `.surface-hover` Box-Shadow, `.subnav-item-active`, `::selection`, `:focus-visible`: → Stahlblau.
- `text-glow-purple/cyan` deutlich schwächer.
- ServerCard-Banner-Gradienten: `#2a1a4d`→`#1c2433` (Paper/Blau), `#4d3310`→`#3a2f12` (Fabric/Gold), `#0d3d3a`→`#12312a` (Velocity/Grün), offline `#1d1a2a`→`#17181b` (Grau).
- Toaster-Theme (layout.tsx), FileManager-Checkbox-Accent, TopBar-Brand-Glow: auf Graphite-Werte.

**Verifiziert auf Server:** Build OK, Service active, Tokens im generierten CSS bestätigt (`.bg-void:#0c0d0f`, `.bg-accent:#6a86b8`, `.text-online:#4e9b7a`).

> **Last updated:** 2026-08-11 · Session: Graphite-Design — Neon raus, gedämpfte Grau/Stahlblau-Palette

---

### 2026-08-11 — Dashboard & New-Server Redesign (V5 Gruppen-Ansicht)

**Auslöser:** User wollte Dashboard + "New Server" überarbeiten (Design + Button-Ausrichtung), mit rotem Faden im Graphite-Design — "Jede Seite soll nicht willkürlich anders aussehen".

**Mockup-Runde:** `screenshots/mockup-dashboard-create.html` — 6 Varianten (je Dashboard + passender Create-Flow), alle im identischen Graphite-Design-System: V1 Klar & Konsistent (Bloom), V2 Ops-Console (AMP/MCSM-Tabelle), V3 Split Ops, V4 Bloom-Cards, V5 Gruppen-Ansicht, V6 Klassisch Pterodactyl. **User wählte V5 — Gruppen-Ansicht.**

**Dashboard → Gruppen-Ansicht:**
- **ServerCard.tsx komplett neu:** kompakte Zeilen-Karte statt Banner-Karte — Icon-Tile (Typ-Emoji, farbige Bg), Name + Tag-Badge + Typ-Badge, Meta-Zeile (Port · Spieler · Uptime · MOTD), Status-Dot, Aktionen (Open/Start + ↻/■ mit Inline-Confirm). Kein Banner, keine dicken Bars mehr. `banner-texture*`/`card-glow-online` bleibt für den Online-Glow.
- **page.tsx:** Status-Filter + Tag-Filter + Sortierung ersetzt durch **Gruppen-Chips** ("Alle Gruppen" + je Tag + "Ohne Tag", mit Counts). Server werden in **Sektionen nach Tag** gruppiert (Header: Name + Count-Badge + Trennlinie + "N online"). Toolbar: Suche + Start All/Stop All + New Server. Such-/Reset-Logik bleibt.

**CreateServerDialog → 2-Schritt-Wizard:**
- Progress-Bar (2 Segmente) oben.
- **Schritt 1:** 3 große Kacheln (Paper Vanilla / CurseForge Modpack / Velocity Proxy) mit Beschreibung + Check auf Auswahl. Modpack-Kachel öffnet direkt den Installer (onOpenModpack).
- **Schritt 2:** Konfiguration (Name, Tag, Type-Select, Version, Port, MaxPlayers, Voice, Difficulty/Hardcore, RAM, JVM) + "← Zurück" + "Create Server" + der echte Job-Progress.
- `step`-State (Reset auf 1 bei open).

**Verifiziert auf Server:** Build OK, Service active, Panel 200. Laufendem Testserver per API Tag "survival" gesetzt (PUT ok).

> **Last updated:** 2026-08-11 · Session: Dashboard-Gruppen-Ansicht (V5) + Create-Wizard, kompakte ServerCard-Zeilen

---

### 2026-08-11 — Live-Spieler-Updates (WebSocket) + einklappbare Quick Commands

**1. Spielerliste jetzt live (Join/Leave ohne Reload):**
- **Problem:** PlayerCard in der Console-Sidebar aktualisierte nur über den 15s-REST-Poll — zu langsam, fühlte sich an wie "erst bei Reload/Tab-Wechsel".
- **Fix (Backend `websocket.ts`):** Neuer `players:subscribe`/`players:unsubscribe`-Handler wie beim TPS-Poller. RCON-`list` alle 5 s pro Server; Parser `There are X of a max of Y players online: Namen` (mit `§`-Farbcode-Stripping, Dedupe). Join/Leave-Erkennung via `playerLastNames`-Map (`first || join-Diff` → emit). Kein Spam bei 0 Spielern (has-Check statt length-Check). Cleanup im Disconnect-Handler.
- **Frontend (`ConsoleTab.tsx`):** Emittet `players:subscribe` beim Connect, lauscht auf `players:data` → `setPlayerCount` + `setPlayerList`. Der 15s-REST-Poll bleibt als Fallback.

**2. Quick Commands einklappbar:**
- `QuickCommands.tsx`: Card mit Toggle-Header ("⚡ Quick Commands" + ChevronDown, rotiert bei zugeklappt, `aria-expanded`). Default ausgeklappt. Passt optisch zu den Sidebar-Cards (surface + border-edge).

**Verifiziert auf Server:** Beide Builds OK, Services active, Panel 200. RCON `list` liefert exakt das Parse-Format ("There are 0 of a max of 20 players online:").

> **Last updated:** 2026-08-11 · Session: Live-Player-Updates via WS-RCON-Poll, collapsible Quick Commands

---

### 2026-08-11 — Console-Höhe fluid (schließt mit PlayerCard ab)

**Problem:** Die Console hatte eine feste Höhe (`h-[540px] max-h-[calc(100vh-200px)]`). Wenn Quick Commands ein-/ausgeklappt wurden, blieb die Console gleich hoch — unten entstand eine Lücke bzw. die Console ragte über die Sidebar hinaus.

**Fix (ConsoleTab.tsx + PlayerCard.tsx):**
- Console-Card: `h-[540px] max-h-...` → `h-[420px] min-h-0 lg:h-auto lg:min-h-[320px] lg:flex-1`. Desktop: Höhe ist fluid — sie füllt in der linken Spalte (`flex-1` + `align-items:stretch` der Row) den verbleibenden Platz unter den Quick Commands auf. Zugeklappte Quick Commands → Console wächst automatisch. Mobile behält feste 420px (keine Sidebar).
- PlayerCard: neues optionales `className`-Prop; in ConsoleTab mit `mt-auto` gepinnt → klebt am Boden der Sidebar. Damit schließt die Console links exakt mit der Spieler-Card rechts ab (auch wenn die Sidebar gedehnt wird).

**Verifiziert:** Build OK, Service active, Panel 200.

> **Last updated:** 2026-08-11 · Session: Fluid console height aligned to PlayerCard, collapsible quick commands resize console

---

### 2026-08-11 — Console-Höhe: Fix (ResizeObserver statt flex-stretch)

**Problem nach 51a5f4d:** Die Console war "viel zu groß" + große Lücke zwischen Server-Card und PlayerCard. Ursache: `lg:h-auto lg:flex-1` auf der Console ohne definierte Höhe in der Flex-Kette — ohne Höhen-Begrenzung nahm die linke Spalte die **max-content-Höhe** des Console-Outputs an (Log-History explodierte die Spalte auf Tausende Pixel). Die Row wurde riesig, die Sidebar per stretch mitgedehnt → Lücke (mt-auto klebte die PlayerCard unten, die Server-Card oben).

**Fix (ConsoleTab.tsx):**
- **Sidebar-Höhe wird live gemessen** (`sidebarRef` + `ResizeObserver` → `sidebarH`).
- Linke Spalte bekommt exakt diese Höhe inline (`style={{ height: sidebarH }}`, nur wenn > 0 → Mobile unverändert fest `h-[420px]`).
- Console wieder `flex-1 min-h-0` **innerhalb der Spalte mit definierter Höhe** → sie füllt den Platz unter den Quick Commands, der Output scrollt wieder (Logs explodieren nicht mehr), und die Unterkante ist exakt bündig mit der PlayerCard.
- Row: `lg:items-start` (kein stretch mehr, keine Lücke). PlayerCard `mt-auto` + className-Prop wieder entfernt.

**Verifiziert:** Beide Builds OK, Service active, Panel 200.

> **Last updated:** 2026-08-11 · Session: Console height fix — ResizeObserver-driven sidebar match

---

### 2026-08-11 — Forge-Modpack-Fix: Java-8-TLS (ECDHE fehlt im Alpine-Image)

**Symptom:** SkyFactory 3 (Forge 1.10.2, MC 1.10.2) Installation scheiterte mit `javax.net.ssl.SSLHandshakeException: Received fatal alert: handshake_failure` im Forge-Installer (MirrorData + Vanilla-Manifest-Download).

**Diagnose (per SSL-Debug im Container):** Das ClientHello von `eclipse-temurin:8-jre-alpine` (8u492) enthielt **nur DHE/RSA-Cipher-Suites — keine ECDHE**. `SSLContext.getSupportedCipherSuites()` listete 0 ECDHE-Suites, obwohl der SunEC-Provider vorhanden war. Moderne Server (Cloudflare/Mojang/Forge-Maven) akzeptieren nur ECDHE → handshake_failure. Der Java-8-Alpine-Build von Temurin hat diesen Defekt; das Debian-Image hat 13 ECDHE-Suites.

**Fix:**
- `eclipse-temurin:8-jre-alpine` → **`eclipse-temurin:8-jre` (Debian)** an allen 4 Stellen: `docker.ts resolveJavaImage`, `resolveJavaImageForServer` (Vergleich angepasst), `modpack.ts getJavaDockerImage`, `modpack.ts needsLegacyJava`.
- Zusätzlich TLS-1.2-Erzwingung: `runJavaInDocker` (modpack.ts) und `createContainer` (docker.ts) setzen für Java-8-Images `-Dhttps.protocols=TLSv1.2` (sicherheitshalber, auch für Mojang-Auth des laufenden Servers).
- Alte Alpine-Images auf dem Server gelöscht (8-jre-alpine + Test-JDK), Debian-8-jre gepullt.

**Verifiziert:** Forge-1.10.2-Installer (exakt der SF3-Flow) läuft mit dem Debian-Image komplett durch: "The server installed successfully". Backend TSC sauber, Service active.

> **Last updated:** 2026-08-11 · Session: Forge-TLS-Fix — Java-8-Alpine ohne ECDHE → Debian-Image + TLSv1.2

---

### 2026-08-11 — Modpack-Matrix-Check: alle Java-Images getestet, Java 16 → 11

**Frage:** Werden andere Modpacks auch Fehler machen? → Systematischer Test aller Java-Images auf TLS-Cipher-Suites (C.java, per Container):

| Java | Image | ECDHE | Status |
|------|-------|-------|--------|
| 8 | `eclipse-temurin:8-jre` (Debian, der Fix von 852d156) | 12/33 | ✅ |
| 11 | `eclipse-temurin:11-jre-alpine` | 14/31 | ✅ |
| 16 | alpine **und** Debian | — | ❌ **Tag von Docker Hub entfernt (EOL)** |
| 17 | `eclipse-temurin:17-jre-alpine` | 14/31 | ✅ |
| 21 | `eclipse-temurin:21-jre-alpine` | 14/31 | ✅ |
| 25 | `eclipse-temurin:25-jre-alpine` | 14/31 | ✅ |

**Neuer Fix (docker.ts):** `resolveJavaImage` für MC 1.16.5: Java 16 → **Java 11** (`11-jre-alpine`), da die 16-Images von Docker Hub entfernt wurden und 1.16.5 Java 11 offiziell unterstützt. Betraf jeden 1.16.5-Server (nicht nur Modpacks): Container-Erstellung wäre mit "image not found" gescheitert.

**Fazit Modpack-Support:** Forge <1.13 (Java 8, Debian) ✅ verifiziert; Forge/NeoForge/Fabric/Quilt 1.13+ (Java 11/17/21) ✅ ECDHE ok; 1.16.5 ✅ jetzt Java 11. Einziges Restrisiko: einzelne uralte Modpacks mit toten Download-URLs (nicht vorhersehbar, Einzelfälle).

**Cleanup:** /tmp/ciphertest + JDK-17-Testimage gelöscht. Backend TSC sauber, Service active.

> **Last updated:** 2026-08-11 · Session: Modpack-Matrix-Test — alle Java-Images ECDHE-geprüft, Java 16→11
