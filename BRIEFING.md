# MCPanel — Project Briefing

## What is this?

A lightweight, modern Minecraft Server Panel. Backend daemon in Node.js/TypeScript, frontend in Next.js 15. Manages PaperMC, Fabric, and Velocity servers via Docker containers.

## Project Structure

```
mcpanel/
├── src/                          # Backend (Express + TypeScript)
│   ├── index.ts                  # Entry point, CORS, API-key middleware, PaperMC proxy
│   ├── types.ts                  # ServerConfig, ServerType, CreateServerRequest, ServerStatus
│   ├── routes/
│   │   ├── servers.ts            # CRUD, start/stop, backup/restore, RCON, player ping
│   │   └── files.ts              # File browser, editor, upload (drag & drop), create, delete
│   └── services/
│       ├── docker.ts             # Dockerode wrapper (Paper/Fabric/Velocity, Aikar flags)
│       ├── config-store.ts       # servers.json CRUD (no database)
│       ├── websocket.ts          # Socket.IO: live stats (CPU/RAM) + live console
│       └── rcon.ts               # Source RCON protocol client
├── frontend/                     # Next.js 15 App Router + Tailwind CSS 4
│   └── src/
│       ├── app/
│       │   ├── page.tsx          # Dashboard with sidebar, server cards, live stats
│       │   ├── layout.tsx        # Root layout, Toaster, dark theme
│       │   ├── globals.css       # Glass-morphism, animations, scrollbar
│       │   └── servers/[id]/page.tsx  # Detail page — 3 tabs, actions, sidebar
│       ├── components/
│       │   ├── ServerSidebar.tsx     # Collapsible server navigation
│       │   ├── CreateServerDialog.tsx # Modal: name, type, RAM, version
│       │   ├── EditServerDialog.tsx  # Modal: edit config
│       │   ├── ConsoleTab.tsx    # xterm.js terminal + live stats + command history
│       │   ├── FileManagerTab.tsx # File browser + line-number editor + drag & drop
│       │   ├── LogsTab.tsx       # latest.log viewer with search + auto-refresh
│       │   └── Skeleton.tsx      # Loading placeholders
│       └── lib/
│           └── types.ts          # Frontend type mirror
├── install.sh                     # One-line installer (curl | bash)
├── update.ps1                     # PowerShell: fast update to server
├── deploy.sh                      # Manual deploy script
├── deploy.ps1                     # PowerShell: full deploy
├── package.json                   # Backend dependencies
└── tsconfig.json
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/servers` | Create server (supports paper/fabric/velocity) |
| GET | `/api/servers` | List all servers with Docker status + type |
| GET | `/api/servers/:id/files?path=/` | List directory contents |
| GET | `/api/servers/:id/file?path=...` | Read file content (max 10 MB) |
| PUT | `/api/servers/:id/file` | Write/update file |
| POST | `/api/servers/:id/file` | Create file or directory |
| POST | `/api/servers/:id/upload` | Upload files (multipart, drag & drop) |
| DELETE | `/api/servers/:id/file?path=...` | Delete file or directory |
| POST | `/api/servers/:id/start` | Start container |
| POST | `/api/servers/:id/stop` | Stop container (30s grace) |
| DELETE | `/api/servers/:id` | Delete server |
| POST | `/api/servers/:id/backup` | Create and download .tar.gz backup |
| POST | `/api/servers/:id/restore` | Upload and restore .tar.gz backup |
| POST | `/api/servers/:id/command` | Execute command via RCON |
| GET | `/api/servers/:id/players` | Minecraft server ping for player count |
| PUT | `/api/servers/:id` | Update server config |
| GET | `/api/paper/versions` | Proxy to PaperMC v3 API |
| GET | `/api/health` | Health check |

## Key Architecture

- **Paper/Fabric/Velocity** — Server type selected at creation, auto-downloads correct JAR
- **Aikar's JVM Flags** — Optimized GC flags pre-configured per server
- **RCON** — Full RCON client for command execution with response
- **Glass-morphism UI** — Dark modern design with subtle glow effects
- **Collapsible Sidebar** — Server navigation without page reloads
- **Drag & Drop Upload** — File upload via drop zone in File Manager
- **One-Line Installer** — Full setup via `curl | bash`

## Deployment

### One-liner (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/mcpanel/main/install.sh | sudo bash
```

### Updates:

```powershell
.\update.ps1 -Server "root@YOUR_IP"
```

### Services:

- Backend: `systemctl status mcpanel-backend` (port 3000)
- Frontend: `systemctl status mcpanel-frontend` (port 3001)
- Data: `/opt/mcpanel/data/<server-id>/`
- Config: `/opt/mcpanel/servers.json`
