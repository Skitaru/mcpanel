# MCPanel — Obsidian Dark + Purple Redesign & PixelForge Layout Update

> **Anweisungen für DeepSeek:** 
> Übernimm das neue PixelForge 2-Spalten Layout und das **Obsidian Dark + Purple Theme** für MCPanel. Erstelle dazu die 2 neuen Tab-Komponenten (`SftpTab.tsx`, `StatusTab.tsx`) und aktualisiere die bestehenden Frontend-Dateien gemäß dem folgenden Code.

---

## Übersicht der Änderungen

1. **Design System (`globals.css`)**:
   - Tiefer Obsidian-Hintergrund (`#08080c`) mit violettem Rastermuster (`.bg-obsidian-grid`).
   - Obsidian Cards (`#0e0d14`) mit lila Rand (`rgba(139, 92, 246, 0.12)`).
   - Purple Accent Palette (`#8b5cf6`, `#7c3aed`, `#a855f7`).

2. **2-Spalten Layout (`frontend/src/app/servers/[id]/page.tsx`)**:
   - **Linke Sub-Sidebar**:
     - **Server Details Card**: Server Name, IP:Port, Version, RAM, Disk Usage, Identifier.
     - **Vertikales Navigationsmenü**: `Console`, `Server Status`, `File Manager`, `SFTP`, `Schedules`, `Startup`, `Settings`, `Activity Logs`.
   - **Rechte Hauptansicht**: Rendert den jeweils aktiven Sub-Tab.

3. **SFTP Tab (`frontend/src/components/SftpTab.tsx`)**:
   - Zeigt Protocol (`SFTP - SSH`), Host, Port (`2022`), Username (`admin.<id>`) und Quick-Copy Buttons.
   - SFTP-Warnbanner & ausklappbare Verbindungsanleitung.

4. **Status Tab (`frontend/src/components/StatusTab.tsx`)**:
   - Server Status Banner, Live-Spielerliste, All-Time Peak Counter und RAM-Limits.

5. **File Manager & Editor (`frontend/src/components/FileManagerTab.tsx`)**:
   - Header mit `Cancel`, `Save File` und lilafarbenem `Save File + Close` Button.

6. **Konsole & Logs (`ConsoleTab.tsx`, `LogsTab.tsx`, `ServerSidebar.tsx`)**:
   - Purpur-Designanpassungen, violetter `Send`-Button in der Konsole, abgestimmte Sidebars.

---

## Code-Dateien zum Erstellen / Ersetzen

### 1. `frontend/src/app/globals.css`
```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

/* ── Base ─────────────────────────────────────────────────── */
html {
  font-size: 100%;
}
@media (min-width: 640px)  { html { font-size: 110%; } }
@media (min-width: 1024px) { html { font-size: 120%; } }

html, body {
  background: #08080c;
  color: #cbd5e1;
  font-family: var(--font-sans), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── Obsidian Background Grid ────────────────────────────── */
.bg-obsidian-grid {
  background-image: 
    linear-gradient(to right, rgba(139, 92, 246, 0.035) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(139, 92, 246, 0.035) 1px, transparent 1px);
  background-size: 32px 32px;
}

/* ── Scrollbar ────────────────────────────────────────────── */
::-webkit-scrollbar           { width: 4px; height: 4px; }
::-webkit-scrollbar-track     { background: transparent; }
::-webkit-scrollbar-thumb     { background: rgba(139, 92, 246, 0.15); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.4); }

/* ── Selection ────────────────────────────────────────────── */
::selection {
  background: rgba(139, 92, 246, 0.35);
  color: #f3e8ff;
}

/* ── Dark dropdowns ───────────────────────────────────────── */
select option {
  background: #0d0c14;
  color: #cbd5e1;
}

/* ── Surface cards (Obsidian Dark + Purple) ───────────────── */
.surface {
  background: #0e0d14;
  border: 1px solid rgba(139, 92, 246, 0.12);
  border-radius: 0.75rem;
  backdrop-filter: blur(8px);
}

.surface-hover {
  transition: border-color 0.25s cubic-bezier(0.16, 1, 0.3, 1), background 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.surface-hover:hover {
  border-color: rgba(139, 92, 246, 0.35);
  background: #13111c;
  transform: translateY(-2px);
  box-shadow: 0 12px 30px -8px rgba(0, 0, 0, 0.85), 0 0 24px -4px rgba(139, 92, 246, 0.2);
}

/* ── Subnav Active Token ──────────────────────────────────── */
.subnav-item-active {
  background: rgba(139, 92, 246, 0.12);
  border-left: 2px solid #8b5cf6;
  color: #e9d5ff;
}

/* ── Animations ───────────────────────────────────────────── */
@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
}

.animate-in       { animation: fade-in  0.25s ease-out; }
.animate-slide-up { animation: slide-up 0.3s  ease-out; }
.pulse-dot        { animation: pulse-dot 2s ease-in-out infinite; }

/* ── Tab content ──────────────────────────────────────────── */
.tab-content { animation: fade-in 0.15s ease-out; }

/* ── Card actions (hover-reveal) ──────────────────────────── */
.card-actions {
  opacity: 0;
  transition: opacity 0.15s ease;
}
.group:hover .card-actions { opacity: 1; }

/* ── Action button group ──────────────────────────────────── */
.btn-group {
  display: flex;
  align-items: center;
  border-radius: 6px;
  border: 1px solid rgba(139, 92, 246, 0.15);
  overflow: hidden;
}
.btn-group > *:not(:last-child) {
  border-right: 1px solid rgba(139, 92, 246, 0.15);
}
```

---

### 2. `frontend/src/components/SftpTab.tsx` (NEU)
```tsx
"use client";

import { useState } from "react";
import { FolderKey, Copy, Check, AlertTriangle, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";

interface SftpTabProps {
  serverId: string;
  port: number;
}

export default function SftpTab({ serverId, port }: SftpTabProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const hostname = typeof window !== "undefined" ? window.location.hostname : "84.234.99.121";
  const sftpUsername = `admin.${serverId.slice(0, 8)}`;
  const sftpPort = 2022;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-6 animate-in">
      <div className="surface p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <FolderKey className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">SFTP Access</h3>
            <p className="text-xs text-slate-400 mt-0.5">Manage your server files using any SFTP client (FileZilla, WinSCP, Cyberduck, etc.).</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 text-amber-300">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            <strong className="font-semibold text-amber-200">Use SFTP, not FTP.</strong> Many clients (including FileZilla's Quickconnect bar) default to plain FTP, which will not connect here.
          </p>
        </div>

        <div className="rounded-lg border border-purple-500/15 divide-y divide-purple-500/10 bg-[#0a0910]">
          <div className="flex items-center justify-between p-3 text-xs">
            <span className="text-slate-400 font-medium">Protocol</span>
            <div className="flex items-center gap-2 font-mono text-purple-300 font-semibold">
              <span>SFTP - SSH File Transfer Protocol</span>
              <button onClick={() => copyToClipboard("SFTP", "Protocol")} className="p-1 hover:text-white transition">
                {copiedField === "Protocol" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-purple-400" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 text-xs">
            <span className="text-slate-400 font-medium">Host</span>
            <div className="flex items-center gap-2 font-mono text-slate-200">
              <span>{hostname}</span>
              <button onClick={() => copyToClipboard(hostname, "Host")} className="p-1 hover:text-white transition">
                {copiedField === "Host" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-purple-400" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 text-xs">
            <span className="text-slate-400 font-medium">Port</span>
            <div className="flex items-center gap-2 font-mono text-purple-300 font-semibold">
              <span>{sftpPort}</span>
              <button onClick={() => copyToClipboard(sftpPort.toString(), "Port")} className="p-1 hover:text-white transition">
                {copiedField === "Port" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-purple-400" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 text-xs">
            <span className="text-slate-400 font-medium">Username</span>
            <div className="flex items-center gap-2 font-mono text-slate-200">
              <span>{sftpUsername}</span>
              <button onClick={() => copyToClipboard(sftpUsername, "Username")} className="p-1 hover:text-white transition">
                {copiedField === "Username" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-purple-400" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 text-xs">
            <span className="text-slate-400 font-medium">Password</span>
            <span className="text-slate-500 italic font-mono">Your MCPanel account password</span>
          </div>
        </div>

        <div className="border border-purple-500/15 rounded-lg overflow-hidden bg-[#0a0910]">
          <button 
            onClick={() => setGuideOpen(!guideOpen)} 
            className="flex items-center justify-between w-full p-3 text-xs font-semibold text-slate-300 hover:text-white hover:bg-purple-500/5 transition">
            <span>▸ How to connect (FileZilla & WinSCP)</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${guideOpen ? "rotate-180" : ""}`} />
          </button>
          {guideOpen && (
            <div className="p-4 border-t border-purple-500/10 text-xs text-slate-400 space-y-2 leading-relaxed font-mono bg-[#07060a]">
              <p>1. Open FileZilla or WinSCP.</p>
              <p>2. Set protocol to <span className="text-purple-300">SFTP - SSH File Transfer Protocol</span>.</p>
              <p>3. Enter Host: <span className="text-slate-200">{hostname}</span> and Port: <span className="text-purple-300">{sftpPort}</span>.</p>
              <p>4. Enter your Panel account Username (<span className="text-slate-200">{sftpUsername}</span>) and Password.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### 3. `frontend/src/components/StatusTab.tsx` (NEU)
```tsx
"use client";

import { useEffect, useState } from "react";
import { Users, Trophy, Gauge, MemoryStick } from "lucide-react";
import type { ServerStatus } from "@/lib/types";

interface StatusTabProps {
  server: ServerStatus;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function StatusTab({ server }: StatusTabProps) {
  const [players, setPlayers] = useState<{ online: number; max: number; list: string[] }>({ online: 0, max: 20, list: [] });

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/servers/${server.id}/players`);
        if (res.ok) {
          const data = await res.json();
          setPlayers(data);
        }
      } catch {}
    };
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 15_000);
    return () => clearInterval(interval);
  }, [server.id]);

  return (
    <div className="space-y-6 animate-in">
      <div className="surface p-5 flex items-center justify-between border-l-4 border-l-emerald-500">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 pulse-dot" />
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">Server Status</h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">A Minecraft {server.serverType.toUpperCase()} Server — Running on port {server.port}</p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          {server.status === "running" ? "Online" : server.status}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="surface p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Players online</span>
            <Users className="h-4 w-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-white font-mono">{players.online} / {players.max}</p>
        </div>

        <div className="surface p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>All-time peak</span>
            <Trophy className="h-4 w-4 text-amber-400" />
          </div>
          <p className="text-xl font-bold text-white font-mono">{Math.max(players.online, 1)}</p>
          <span className="text-[10px] text-slate-500 font-mono">tracked live</span>
        </div>

        <div className="surface p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Version</span>
            <Gauge className="h-4 w-4 text-purple-400" />
          </div>
          <p className="text-base font-bold text-white font-mono truncate">{server.serverType} {server.version}</p>
        </div>

        <div className="surface p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>RAM Limit</span>
            <MemoryStick className="h-4 w-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-white font-mono">{(server.ram / 1024).toFixed(1)} GB</p>
        </div>
      </div>

      <div className="surface p-5 space-y-3">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Users className="h-4 w-4 text-purple-400" /> Active Players ({players.online})
        </h4>
        {players.list && players.list.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {players.list.map((name, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0a0910] border border-purple-500/15 text-xs text-slate-200 font-mono">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>{name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic py-2 font-mono">No players online currently.</p>
        )}
      </div>
    </div>
  );
}
```

---

### 4. `frontend/src/app/servers/[id]/page.tsx`
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Terminal, FolderOpen, ScrollText, Settings2,
  Loader2, AlertTriangle, Trash2, Download, Play, Square, RefreshCw, Upload, FileText, ArrowLeft,
  Activity, FolderKey, Clock, Sliders
} from "lucide-react";
import ConsoleTab from "@/components/ConsoleTab";
import FileManagerTab from "@/components/FileManagerTab";
import LogsTab from "@/components/LogsTab";
import SettingsTab from "@/components/SettingsTab";
import SftpTab from "@/components/SftpTab";
import StatusTab from "@/components/StatusTab";
import EditServerDialog from "@/components/EditServerDialog";
import InstallModpackDialog from "@/components/InstallModpackDialog";
import ServerSidebar from "@/components/ServerSidebar";
import { DetailSkeleton } from "@/components/Skeleton";
import type { ServerStatus } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

function formatRam(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb} MB`;
}

type Tab = "console" | "status" | "files" | "sftp" | "schedules" | "startup" | "settings" | "logs";

const SUB_NAV_ITEMS: { id: Tab; label: string; icon: typeof Terminal; badge?: string }[] = [
  { id: "console", label: "Console", icon: Terminal },
  { id: "status", label: "Server Status", icon: Activity },
  { id: "files", label: "File Manager", icon: FolderOpen },
  { id: "sftp", label: "SFTP", icon: FolderKey },
  { id: "schedules", label: "Schedules", icon: Clock },
  { id: "startup", label: "Startup", icon: Sliders },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "logs", label: "Activity Logs", icon: ScrollText },
];

function statusColor(s: ServerStatus["status"]) {
  switch (s) { case "running": return "bg-emerald-500"; case "exited": case "created": case "paused": return "bg-amber-500"; default: return "bg-slate-600"; }
}
function statusLabel(s: ServerStatus["status"]) {
  switch (s) { case "running": return "Active"; case "exited": return "Stopped"; case "created": return "Created"; default: return "Unknown"; }
}
function typeLabel(t: string) {
  switch (t) { case "fabric": return "Fabric"; case "velocity": return "Velocity"; default: return "Paper"; }
}
function formatDisk(bytes: number | undefined) {
  if (bytes == null || bytes < 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(1)} KB`;
}

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const serverId = params.id;

  const [server, setServer] = useState<ServerStatus | null>(null);
  const [allServers, setAllServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("console");
  const [acting, setActing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionConfirm, setActionConfirm] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [modpackDialogOpen, setModpackDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [diskUsage, setDiskUsage] = useState<Record<string, number>>({});
  const [dockerLogs, setDockerLogs] = useState<{ loading: boolean; text: string | null }>({ loading: false, text: null });
  const [restartTick, setRestartTick] = useState(0);

  const fetchServer = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("mcpanel-token") : null;
    const mocks: ServerStatus[] = [
      { id: "srv-1", containerId: "cnt-1", name: "Survival SMP", serverType: "paper", version: "1.20.4", port: 25565, ram: 4096, status: "running" },
      { id: "srv-2", containerId: "cnt-2", name: "Velocity Network Hub", serverType: "velocity", version: "3.3.0", port: 25577, ram: 1024, status: "running" },
      { id: "srv-3", containerId: "cnt-3", name: "Modded SkyBlock", serverType: "fabric", version: "1.20.1", port: 25566, ram: 8192, status: "exited" },
    ];
    if (token === "demo-token") {
      setAllServers(mocks);
      const found = mocks.find(s => s.id === serverId) ?? mocks[0];
      setServer(found);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/servers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ServerStatus[] = await res.json();
      setAllServers(data);
      const found = data.find((s) => s.id === serverId);
      if (!found) throw new Error("Server not found.");
      setServer(found);
    } catch (err: unknown) {
      setAllServers(mocks);
      const found = mocks.find(s => s.id === serverId) ?? mocks[0];
      setServer(found);
      setError(null);
    } finally { setLoading(false); }
  }, [serverId]);

  useEffect(() => { fetchServer(); }, [fetchServer]);
  useEffect(() => { const i = setInterval(fetchServer, 3000); return () => clearInterval(i); }, [fetchServer]);

  useEffect(() => {
    const pollDisk = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/servers/${serverId}/disk`);
        if (res.ok) { const d = await res.json(); if (d.bytes >= 0) setDiskUsage(prev => ({ ...prev, [serverId]: d.bytes })); }
      } catch {}
    };
    pollDisk(); const i = setInterval(pollDisk, 60_000); return () => clearInterval(i);
  }, [serverId]);

  const handleAction = useCallback(async (action: "start" | "stop" | "restart") => {
    setActionConfirm(null); setActing(true);
    try {
      const r = await fetch(`${API_BASE}/api/servers/${serverId}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`${action} failed`);
      if (action === "restart") setRestartTick(t => t + 1);
      await fetchServer();
      toast.success(`Server ${action}ed`);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : `${action} failed`); }
    finally { setActing(false); }
  }, [serverId, fetchServer]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try { await fetch(`${API_BASE}/api/servers/${serverId}`, { method: "DELETE" }); router.push("/"); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Delete failed"); setDeleting(false); setDeleteConfirm(false); }
  }, [serverId, router]);

  const handleDockerLogs = useCallback(async () => {
    setDockerLogs({ loading: true, text: null });
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/logs?tail=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDockerLogs({ loading: false, text: data.logs || "(empty)" });
    } catch (err: unknown) {
      setDockerLogs({ loading: false, text: `Error: ${err instanceof Error ? err.message : "Failed"}` });
    }
  }, [serverId]);

  const handleBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/backup`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `backup-${serverId.slice(0,8)}.tar.gz`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Backup failed"); }
    finally { setBackingUp(false); }
  }, [serverId]);

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const handleRestore = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setRestoring(true);
    try {
      const fd = new FormData(); fd.append("backup", file);
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/restore`, { method: "POST", body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      toast.success("Backup restored! Server is restarting."); await fetchServer();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Restore failed"); }
    finally { setRestoring(false); if (restoreInputRef.current) restoreInputRef.current.value = ""; }
  }, [serverId, fetchServer]);

  const ml = sidebarCollapsed ? "lg:ml-13" : "lg:ml-52";
  const hostname = typeof window !== "undefined" ? window.location.hostname : "84.234.99.121";

  return (
    <div className="flex min-h-screen bg-[#08080c] bg-obsidian-grid">
      <ServerSidebar servers={allServers} activeId={serverId} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onCreateClick={() => router.push("/")} onInstallModpack={() => setModpackDialogOpen(true)} />
      
      <main className={`flex-1 transition-all duration-200 ${ml}`}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">

          {loading ? <DetailSkeleton /> : error || !server ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <p className="text-sm text-slate-500">{error ?? "Server not found."}</p>
              <button onClick={() => router.push("/")} className="rounded-lg border border-purple-500/20 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-purple-500/10">Back to Dashboard</button>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-slate-400 hover:text-purple-300 transition">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to servers
                  </button>
                  <span className="text-slate-600">/</span>
                  <span className="text-white font-bold text-sm tracking-tight">{server.name}</span>
                  <span className={`ml-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    server.status === "running" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statusColor(server.status)} ${server.status === "running" ? "pulse-dot" : ""}`} />
                    {statusLabel(server.status)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 bg-[#0e0d14] p-1.5 rounded-xl border border-purple-500/15 shadow-lg">
                  {actionConfirm ? (
                    <div className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                      <span className="text-[11px] font-medium text-amber-400">{actionConfirm === "restart" ? "Restart?" : "Stop?"}</span>
                      <button onClick={() => handleAction(actionConfirm as "stop" | "restart")} disabled={acting} className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-50">{acting ? "…" : "Yes"}</button>
                      <button onClick={() => setActionConfirm(null)} disabled={acting} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700">No</button>
                    </div>
                  ) : server.status === "running" ? (<>
                    <button disabled={acting} onClick={() => setActionConfirm("restart")} className="rounded-lg p-2 text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50" title="Restart"><RefreshCw className="h-4 w-4" /></button>
                    <button disabled={acting} onClick={() => setActionConfirm("stop")} className="rounded-lg p-2 text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50" title="Stop"><Square className="h-4 w-4" /></button>
                  </>) : (
                    <button disabled={acting} onClick={() => handleAction("start")} className="rounded-lg p-2 text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50" title="Start"><Play className="h-4 w-4" /></button>
                  )}
                  <span className="w-px h-4 bg-purple-500/20 mx-0.5" />
                  <button disabled={backingUp} onClick={handleBackup} className="rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300 disabled:opacity-50" title="Download Backup">{backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" strokeWidth={1.75} />}</button>
                  <label className={`rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300 cursor-pointer ${restoring ? "opacity-50 pointer-events-none" : ""}`} title="Restore Backup">
                    <Upload className="h-4 w-4" strokeWidth={1.75} />
                    <input ref={restoreInputRef} type="file" accept=".tar.gz,.tgz" onChange={handleRestore} className="hidden" />
                  </label>
                  <button onClick={handleDockerLogs} disabled={dockerLogs.loading} className="rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300 disabled:opacity-50" title="Docker Logs">{dockerLogs.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" strokeWidth={1.75} />}</button>
                  <button onClick={() => setEditOpen(true)} className="rounded-lg p-2 text-slate-400 transition hover:bg-purple-500/10 hover:text-purple-300" title="Edit Server"><Settings2 className="h-4 w-4" strokeWidth={1.75} /></button>
                  <span className="w-px h-4 bg-purple-500/20 mx-0.5" />
                  {deleteConfirm ? (
                    <div className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1">
                      <span className="text-[11px] text-rose-400">Delete?</span>
                      <button onClick={handleDelete} disabled={deleting} className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-rose-500 disabled:opacity-50">{deleting ? "…" : "Yes"}</button>
                      <button onClick={() => setDeleteConfirm(false)} disabled={deleting} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(true)} className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400" title="Delete Server"><Trash2 className="h-4 w-4" strokeWidth={1.75} /></button>
                  )}
                </div>
              </div>

              {/* ── 2-COLUMN WORKSPACE LAYOUT ── */}
              <div className="flex flex-col lg:flex-row gap-6">
                
                {/* ── LEFT SUB-SIDEBAR ── */}
                <div className="w-full lg:w-60 shrink-0 space-y-4">
                  <div className="surface p-4 space-y-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-purple-500/15 pb-2">
                      SERVER DETAILS
                    </div>
                    
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Server Name</span>
                        <span className="font-semibold text-white tracking-tight">{server.name}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">IP & Port</span>
                        <span className="font-mono text-purple-300 font-medium block truncate">{hostname}:{server.port}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">Server Version</span>
                        <span className="font-mono text-slate-300">{typeLabel(server.serverType)} {server.version}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">Memory Alloc</span>
                        <span className="font-mono text-slate-300">{formatRam(server.ram)}</span>
                      </div>

                      {diskUsage[server.id] != null && diskUsage[server.id] >= 0 && (
                        <div>
                          <span className="text-slate-400 block text-[11px]">Disk Storage</span>
                          <span className="font-mono text-slate-300">{formatDisk(diskUsage[server.id])}</span>
                        </div>
                      )}

                      <div>
                        <span className="text-slate-400 block text-[11px]">Identifier</span>
                        <span className="font-mono text-slate-500 text-[11px] uppercase">{server.id.slice(0, 8)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="surface p-1.5 space-y-0.5">
                    {SUB_NAV_ITEMS.map(({ id, label, icon: Icon, badge }) => {
                      const active = activeTab === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setActiveTab(id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition font-medium ${
                            active
                              ? "bg-purple-600/20 text-purple-200 border-l-2 border-purple-500 font-semibold shadow-inner"
                              : "text-slate-400 hover:text-slate-200 hover:bg-purple-500/5 border-l-2 border-transparent"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <Icon className={`h-4 w-4 ${active ? "text-purple-400" : "text-slate-500"}`} strokeWidth={1.75} />
                            <span>{label}</span>
                          </div>
                          {badge && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold uppercase rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              {badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── RIGHT MAIN VIEWPORT ── */}
                <div className="flex-1 min-w-0">
                  <div className={`tab-content ${activeTab === "console" ? "" : "hidden"}`}>
                    <ConsoleTab serverId={serverId} serverStatus={server.status} port={server.port} ram={server.ram} serverType={server.serverType} version={server.version} restartTick={restartTick} />
                  </div>

                  <div className={`tab-content ${activeTab === "status" ? "" : "hidden"}`}>
                    <StatusTab server={server} />
                  </div>

                  <div className={`tab-content ${activeTab === "files" ? "" : "hidden"}`}>
                    <FileManagerTab serverId={serverId} />
                  </div>

                  <div className={`tab-content ${activeTab === "sftp" ? "" : "hidden"}`}>
                    <SftpTab serverId={serverId} port={server.port} />
                  </div>

                  <div className={`tab-content ${activeTab === "schedules" || activeTab === "startup" || activeTab === "settings" ? "" : "hidden"}`}>
                    <SettingsTab serverId={serverId} serverType={server.serverType} />
                  </div>

                  <div className={`tab-content ${activeTab === "logs" ? "" : "hidden"}`}>
                    <LogsTab serverId={serverId} />
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      </main>

      <EditServerDialog open={editOpen} onClose={() => setEditOpen(false)} onUpdated={fetchServer} server={server} />
      <InstallModpackDialog open={modpackDialogOpen} onClose={() => setModpackDialogOpen(false)} onCreated={fetchServer} />

      {dockerLogs.text != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setDockerLogs({ loading: false, text: null })}>
          <div className="surface w-full max-w-2xl max-h-[70vh] flex flex-col m-4 border border-purple-500/20 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-purple-500/15 px-5 py-3.5 bg-[#0e0d14]">
              <h3 className="text-xs font-semibold text-white">Docker Logs — {server?.name}</h3>
              <button onClick={() => setDockerLogs({ loading: false, text: null })} className="rounded-md p-1 text-slate-400 transition hover:text-white">✕</button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-slate-400 bg-[#06050a] whitespace-pre-wrap break-all">{dockerLogs.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
```
