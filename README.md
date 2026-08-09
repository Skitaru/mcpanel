# Obsidian Panel — Minecraft Server Dashboard

A lightweight, modern web panel for managing Minecraft servers via Docker. Dark, clean, and fast.

**Paper · Fabric · Velocity · Forge · NeoForge · Quilt** — all in one panel.

---

## ⚡ One-Line Install (Debian 12/13)

```bash
# wget (Debian — preinstalled):
wget -qO- https://raw.githubusercontent.com/Skitaru/mcpanel/main/install.sh | sudo bash

# curl:
curl -fsSL https://raw.githubusercontent.com/Skitaru/mcpanel/main/install.sh | sudo bash
```

> Requires **Debian 12/13** or **Ubuntu 22.04/24.04** · Root access · Port 3001 open

The installer handles Docker, Node.js 22, builds frontend + backend, creates systemd services, and enables auto-start.

### Custom options

```bash
curl -fsSL https://raw.githubusercontent.com/Skitaru/mcpanel/main/install.sh | sudo bash -s -- --port 3000 --fe-port 3001 --api-key YOUR_KEY
```

---

## 🖥 Features

| Category | Details |
|----------|---------|
| **Server Types** | PaperMC · Fabric · Velocity · Forge · NeoForge · Quilt |
| **Live Console** | Real-time terminal via WebSocket · Command history (persisted) · ANSI cleaning |
| **File Manager** | Browse, edit with line numbers, upload (drag & drop), download, create, delete · Binary file detection |
| **TPS Monitor** | Live TPS polling via RCON — color-coded display (5s / 1m / 5m) |
| **Resource Monitor** | Live CPU + RAM with animated progress bars · Per-server stats on dashboard |
| **Discord Webhook** | Start/stop/crash notifications as rich embeds |
| **Modpack Installer** | One-click install from CurseForge — Forge, NeoForge, Fabric, Quilt support |
| **Backups** | Create + download · Restore from upload · Auto-backup scheduling |
| **Scheduler** | Auto-restart + auto-backup at configurable times |
| **Player Info** | Online count + player list with avatars (mc-heads.net) |
| **Security** | Isolated Docker containers · JWT auth · RCON bound to 127.0.0.1 · Non-root containers |
| **UX** | Dark violet theme · Collapsible sidebar · Skeleton loading · Mobile responsive |

---

## 📋 Access

| URL | What |
|-----|------|
| `http://YOUR-IP:3001` | Panel (frontend) |

**Default login:** `admin` / `admin` — change via sidebar → Password.

---

## 🔧 Service Management

```bash
systemctl restart mcpanel-backend mcpanel-frontend
journalctl -u mcpanel-backend -f
journalctl -u mcpanel-frontend -f
```

---

## 📁 Project Structure

```
mcpanel/
├── src/                    # Backend (Express + TypeScript)
│   ├── index.ts            # Entry point
│   ├── types.ts            # Shared types
│   ├── routes/
│   │   ├── servers.ts      # Server CRUD, backup, restore, RCON
│   │   └── files.ts        # File browser + editor + upload
│   └── services/
│       ├── docker.ts       # Docker container management
│       ├── websocket.ts    # Socket.IO (stats + console + TPS)
│       ├── rcon.ts         # RCON client
│       ├── discord.ts      # Discord webhook sender
│       ├── modpack.ts      # CurseForge modpack installer
│       ├── scheduler.ts    # Scheduled tasks
│       └── config-store.ts # servers.json CRUD
├── frontend/               # Next.js 15 + React 19 + Tailwind 4
│   └── src/
│       ├── app/            # Pages (dashboard, server detail)
│       └── components/     # Console, FileManager, Settings, Dialogs
└── install.sh              # One-line installer
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js · Express · TypeScript |
| Frontend | Next.js 15 · React 19 · Tailwind CSS 4 |
| Real-time | Socket.IO |
| Containers | Docker (dockerode) |
| Fonts | Outfit · JetBrains Mono |

---

## 🔒 Security

- All servers run in isolated Docker containers
- JWT-based authentication (7-day expiry)
- API-key fallback authentication
- RCON bound to `127.0.0.1` only — not exposed to the internet
- Containers run as non-root `mc` user
- Path-traversal protection on all file operations
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)

---

*MIT License — use it, fork it, make it yours.*
