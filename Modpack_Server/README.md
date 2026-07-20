# MCPanel - Minecraft Modpack Server Panel

Ein selbst-gehostetes Web-Panel für Minecraft Modpack Server – aufgebaut wie Pterodactyl.

## Features

- **Live Console** – Echtzeit-Serveroutput via WebSocket, Commandeingabe
- **Datei-Manager** – Upload, Download, Bearbeiten, Löschen, Ordner erstellen
- **CurseForge Browser** – Modpacks suchen und mit einem Klick installieren
- **Multi-Server** – Mehrere Server gleichzeitig verwalten
- **Auth** – Login-System mit JWT, Passwort änderbar
- **Systemd** – Läuft als systemd Service, startet automatisch beim Boot

## Schnellinstallation (Linux)

### Schritt 1: Installer bauen

Führe auf deinem Windows-Rechner aus (Git Bash oder WSL):
```bash
bash build_installer.sh
```

Das erstellt `install_standalone.sh` – eine vollständig selbst-enthaltene Installationsdatei.

### Schritt 2: Auf Linux-Server hochladen

```bash
scp install_standalone.sh user@dein-server:~/
```

### Schritt 3: Auf dem Server installieren

```bash
sudo bash install_standalone.sh
```

**Mit Optionen:**
```bash
sudo bash install_standalone.sh --port 3000 --cf-key DEIN_CURSEFORGE_KEY
```

### Optionen

| Option | Beschreibung | Standard |
|--------|-------------|---------|
| `--port PORT` | Panel Port | `3000` |
| `--cf-key KEY` | CurseForge API Key | leer |
| `--dir DIR` | Installationsverzeichnis | `/opt/mcpanel` |
| `--no-java` | Java-Installation überspringen | nein |

## CurseForge API Key

Benötigt für den Modpack-Browser:
1. Gehe zu https://console.curseforge.com
2. Erstelle einen Account / logge dich ein
3. Erstelle unter **API Keys** einen neuen Key
4. Trage den Key in den Panel-Einstellungen ein

## Dateien & Verzeichnisse

```
/opt/mcpanel/
├── app/
│   ├── server.js          # Node.js Backend
│   ├── package.json
│   └── public/
│       └── index.html     # Frontend (Single-Page-App)
├── data/
│   ├── panel.db           # SQLite Datenbank
│   └── servers/
│       ├── 1/             # Server 1 Dateien
│       └── 2/             # Server 2 Dateien
└── .env                   # Konfiguration
```

## Service verwalten

```bash
systemctl status mcpanel      # Status anzeigen
systemctl start mcpanel       # Starten
systemctl stop mcpanel        # Stoppen
systemctl restart mcpanel     # Neustart
journalctl -u mcpanel -f      # Logs verfolgen
```

## Server einrichten (nach der Installation)

1. **Panel öffnen** → `http://SERVER-IP:3000`
2. **Einloggen** → `admin / admin` (sofort ändern!)
3. **CurseForge Key** → Einstellungen → API Key eintragen
4. **Neuer Server** → "+ Neuen Server" klicken
5. **Modpack wählen** → CurseForge Browser → Modpack suchen → auswählen
6. **Server erstellen** → Erstellen klicken
7. **server.jar hochladen** → Dateien-Tab → Forge/Fabric Installer hochladen
8. **Server starten** → ▶ Start drücken

## Technologie

- **Backend**: Node.js + Express + Socket.io
- **Datenbank**: SQLite (better-sqlite3)
- **Frontend**: Vanilla HTML/CSS/JS (kein Build-Schritt)
- **Prozesse**: child_process.spawn (Java-Prozesse)
- **Auth**: JWT + bcrypt

## Standard-Login

```
Username: admin
Passwort: admin
```

**Sofort nach der Installation das Passwort ändern!**
