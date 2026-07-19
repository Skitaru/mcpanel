# MCPanel — Minecraft Server Panel

A lightweight, modern web panel for managing Minecraft servers via Docker.

**Paper · Fabric · Velocity** — all in one panel. No bloat, no monthly fees.

---

## ⚡ One-Line Install (Debian 12/13)

```bash
curl -fsSL https://raw.githubusercontent.com/Skitaru/mcpanel/main/install.sh | sudo bash
```

> Requires **Debian 11/12/13** or **Ubuntu 22.04/24.04** · Root access · Port 3001 open

The installer handles everything:
- Docker
- Node.js 22
- Builds frontend + backend
- Creates systemd services
- Auto-starts on boot

### Custom options

```bash
curl -fsSL https://raw.githubusercontent.com/Skitaru/mcpanel/main/install.sh | sudo bash -s -- --port 3000 --fe-port 3001 --api-key YOUR_KEY
```

---

## 🖥 What you get

| Category | Features |
|----------|----------|
| **Server Types** | PaperMC · Fabric (modded) · Velocity (proxy) |
| **Live Console** | Real-time terminal via WebSocket · Command history · Offline persistence |
| **File Manager** | Browse · Edit with line numbers · Upload (drag & drop) · Download · Create · Delete |
| **Backups** | One-click create + download · Restore from upload |
| **Resource Monitor** | Live CPU + RAM on dashboard · Per-server stats |
| **Player Info** | Online player count on dashboard cards |
| **Container** | Docker isolation · Auto Java version · Aikar's JVM flags · RCON |
| **UX** | Collapsible sidebar · Skeleton loading · Dark modern UI · Mobile responsive |

---

## 📋 Access

After installation:

| URL | What |
|-----|------|
| `http://YOUR-IP:3001` | Panel (frontend) |

**Default login:** `admin` / `admin` — change the password via the login screen.

The panel uses JWT-based authentication. An API-key fallback is available via `PANEL_API_KEY` in `/opt/mcpanel/.env`.

---

## 🔧 Service Management

```bash
# Restart
systemctl restart mcpanel-backend mcpanel-frontend

# View logs
journalctl -u mcpanel-backend -f
journalctl -u mcpanel-frontend -f

# Stop
systemctl stop mcpanel-backend mcpanel-frontend
```

---

## 🚀 Quick Update

From your local dev machine:

```powershell
# Full update (rebuilds everything)
.\update.ps1 -Server "root@YOUR_IP"

# Quick update (skip npm install)
.\update.ps1 -Server "root@YOUR_IP" -Quick
```

---

## 📁 Project Structure

```
mcpanel/
├── src/                  # Backend (Express + TypeScript)
│   ├── index.ts          # Entry point
│   ├── types.ts          # Shared types
│   ├── routes/
│   │   ├── servers.ts    # Server CRUD, backup, restore, RCON
│   │   └── files.ts      # File browser + editor + upload
│   └── services/
│       ├── docker.ts     # Dockerode wrapper
│       ├── websocket.ts  # Socket.IO (stats + console)
│       ├── rcon.ts       # RCON client
│       └── config-store.ts  # servers.json CRUD
├── frontend/             # Next.js App Router + Tailwind CSS
│   └── src/
│       ├── app/          # Pages (dashboard, server detail)
│       └── components/   # UI components
├── install.sh            # One-line installer
├── update.ps1            # Fast update script
├── deploy.sh             # Manual deploy script
└── deploy.ps1            # First-time deploy script
```

---

## 🔒 Security

- All servers run in isolated Docker containers
- JWT-based authentication (change default password on first login)
- API-key fallback authentication
- RCON bound to localhost only — not exposed to the internet
- Path-traversal protection on all file operations
- 10 MB file read limit, 500 MB upload limit

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js · Express · TypeScript |
| Frontend | Next.js 15 · React 19 · Tailwind CSS 4 |
| Real-time | Socket.IO |
| Containers | Docker (dockerode) |
| Terminal | xterm.js |

---

*MIT License — use it, fork it, make it yours.*
