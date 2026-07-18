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

**Added:**
- **Logout button** in dashboard header (page.tsx) — clears token, reloads to login screen. (Logout also exists in sidebar footer.)
- **Dark `<option>` styling** in CreateServerDialog — all `<select>` dropdowns now use `bg-[#0a0a0a] text-white` instead of browser default blue.

**Git:** Frontend was incorrectly tracked as a gitlink/submodule without a remote. Converted to regular tracked directory in commit `7fddf80`.

---

## Open / Pending

- [ ] No known open issues at this time.

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

> **Last updated:** 2026-07-18 · Session: bug fixes + UI polish
