# MCPanel — Session Briefing (Stand: 2026-08-04)

> ⚠️ **KRITISCH — PRODUKTIONSSERVER MIT AKTIVEN SPIELERN**
>
> Auf dem Panel läuft **"Zentrum"** (Paper 1.21, Port 25565, 32 GB RAM) — ein LIVE-Server.
> **Niemals destruktiv handeln ohne explizite Bestätigung. Vor jedem Eingriff Backup!**

---

## Server-Zugang

| Key | Value |
|-----|-------|
| **IP** | `5.231.108.226` |
| **SSH** | `root` / `Alabalanica28!` |
| **Panel** | `http://5.231.108.226:3001` |
| **Login** | `admin` / `admin` (bitte ändern!) |
| **SSH-Helper** | `python deploy.py "cmd"` (paramiko-basiert, encoding-fixed) |
| **SCP** | `python deploy.py scp ./local //opt/mcpanel/path` (// verhindert MSYS2-Konvertierung) |

---

## Architektur

```
/opt/mcpanel/
├── .env              # PANEL_PORT=3000, PANEL_API_KEY=..., BACKEND_URL=http://127.0.0.1:3000
├── panel-config.json # scrypt-hashed credentials
├── servers.json      # Server-Definitionen
├── src/ → dist/      # Backend (Express/TypeScript)
├── frontend/         # Next.js 15 (React 19, Tailwind 4)
│   └── .next/        # Production build
├── package.json
└── data/             # Server-Data (World, Configs)
```

- **Backend**: Port 3000 (`mcpanel-backend` systemd)
- **Frontend**: Port 3001 (`mcpanel-frontend` systemd), rewritten `API → Backend` via `next.config.ts`
- **Frontend nutzt relative URLs** — `NEXT_PUBLIC_API_URL` darf NICHT gesetzt sein

---

## Design System (Obsidian Dark + Purple)

| Token | Wert |
|-------|------|
| Hintergrund | `#08080c` + `.bg-obsidian-grid` (violettes Raster) |
| Surface | `#0e0d14` + `border-purple-500/15` |
| Input-BG | `bg-[#0a0c10]` |
| Accent | `violet-500` / `purple-500` |
| Sidebar | `w-52`, `border-purple-500/12` |

Alle Komponenten verwenden jetzt `.surface`, `border-purple-500/15`, `bg-purple-500/[0.04]`, `hover:bg-purple-500/5`.

---

## Features & Stand

### Dashboard (`/`)
- Server-Cards mit Icon (Fallback-Platzhalter), MOTD, Live-Uptime (aus Docker `StartedAt`)
- Spieler-Count mit Flash-Animation bei Änderung
- Card-Tint: Emerald (running) / Slate (stopped)
- Aktionen: Start/Stop/Restart mit Confirm-Dialog

### Server-Detail (`/servers/[id]`)
- **2-Spalten-Layout**: Links Server-Details-Card + vertikale Nav, rechts Tab-Content
- **ConsoleTab**: Div-basierte Konsole, Stats-Sidebar (Status, CPU, RAM, Players), einklappbare Spielerliste mit mc-heads.net Avataren
- **FileManagerTab**: Dateibaum + Text-Editor mit Search
- **SettingsTab**: server.properties + Scheduled Tasks + Server-Icon-Upload
- **LogsTab**: logs/latest.log mit Search + Copy

---

## Offene Themen / Nächste Session

1. **🔴 Docker-Container-Härtung**: Non-root User, RCON auf 127.0.0.1 (erfordert Container-Neuerstellung = Downtime)
2. **🟡 Default-Passwort ändern**: `admin/admin` → sicheres Passwort
3. **🟡 TPS-Anzeige**: `/tps` per RCON pollen
4. **🟢 View Transitions**: Next.js View Transitions API für sanfte Seitenwechsel
5. **🟢 Discord-Webhook**: Benachrichtigungen bei Start/Stop/Crash

---

## Heutige Session (2026-08-04) — 14 Commits

| Commit | Was |
|--------|-----|
| `07e6609` | Obsidian Dark + Purple Theme, 2-Spalten-Layout |
| `9ae69fc` | Neue Server-IP + deploy.py |
| `ef2824f` | ⚠️ Produktionsserver-Warnung in deploy.py + DEEPSEEK_UPDATE.md |
| `6de848e` | Player-Count-Bug: VarInt-String-Längen-Präfix nicht geparst |
| `57df6be` | Max-Players immer 20: Operator-Präzedenz gefixt |
| `797a064` | deploy.py robust: MSYS2-Pfade, Encoding, Error-Handling |
| `09c2414` | Design-Konsistenz: 13 Komponenten auf Purple-Tokens |
| `ef991ab` | Quick Wins: Icon, MOTD, Uptime + 2x execFileSync→execFile |
| `038d6ec` | Mobile: Server-Detail-Header overflow fix |
| `28f4aee` | Uptime persistant: Docker StartedAt statt Client-Tracking |
| `53f612b` | Design: Flash-Animation, Card-Tints, Ghost-Icons |
| `a863472` | Icon-Fallback + einklappbare Spielerliste (Dashboard) |
| `34e8769` | Spielerliste von Dashboard → ConsoleTab verschoben |
| `9107fc0` | Crafatar → mc-heads.net (API down) |
