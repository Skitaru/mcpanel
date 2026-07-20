"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Save, Upload, Image as ImageIcon, AlertTriangle, Clock,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  serverId: string;
  serverType: string;
}

const KNOWN_PROPERTIES: { key: string; label: string; type: "text" | "select"; options?: string[] }[] = [
  { key: "motd", label: "MOTD", type: "text" },
  { key: "difficulty", label: "Difficulty", type: "select", options: ["peaceful", "easy", "normal", "hard"] },
  { key: "gamemode", label: "Gamemode", type: "select", options: ["survival", "creative", "adventure", "spectator"] },
  { key: "max-players", label: "Max Players", type: "text" },
  { key: "pvp", label: "PVP", type: "select", options: ["true", "false"] },
  { key: "online-mode", label: "Online Mode", type: "select", options: ["true", "false"] },
  { key: "allow-flight", label: "Allow Flight", type: "select", options: ["true", "false"] },
  { key: "spawn-protection", label: "Spawn Protection", type: "text" },
  { key: "view-distance", label: "View Distance", type: "text" },
  { key: "simulation-distance", label: "Simulation Distance", type: "text" },
  { key: "enable-command-block", label: "Command Blocks", type: "select", options: ["true", "false"] },
  { key: "allow-nether", label: "Allow Nether", type: "select", options: ["true", "false"] },
  { key: "generate-structures", label: "Structures", type: "select", options: ["true", "false"] },
  { key: "hardcore", label: "Hardcore", type: "select", options: ["true", "false"] },
  { key: "level-seed", label: "World Seed", type: "text" },
  { key: "level-type", label: "World Type", type: "select", options: ["default", "flat", "largebiomes", "amplified"] },
  { key: "enforce-secure-profile", label: "Secure Profile", type: "select", options: ["true", "false"] },
];

export default function SettingsTab({ serverId, serverType }: Props) {
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [motd, setMotd] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [schedRestart, setSchedRestart] = useState("");
  const [schedBackup, setSchedBackup] = useState("");
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);

  const loadProperties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/properties`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProperties(data.properties ?? {});
      setMotd(data.motd ?? "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally { setLoading(false); }
  }, [serverId]);

  useEffect(() => { loadProperties(); }, [loadProperties]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/server-icon.png")}&raw=true`)
      .then(async r => { if (!r.ok || cancelled || r.status === 204) return null; return r.blob(); })
      .then(blob => { if (cancelled || !blob) return; setIconUrl(prev => { if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serverId]);

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/properties`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { ...properties, motd } }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      setSaveMsg("Saved! Restart the server to apply changes.");
      setTimeout(() => setSaveMsg(null), 5000);
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally { setSaving(false); }
  }, [serverId, properties, motd]);

  const handleIconUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIconUploading(true);
    try {
      const form = new FormData(); form.append("icon", file);
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/icon`, { method: "POST", body: form });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      const iconRes = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/server-icon.png")}&raw=true`);
      if (iconRes.ok) { const blob = await iconRes.blob(); setIconUrl(prev => { if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); }); }
    } catch (err: unknown) { console.error("Icon upload failed:", err); }
    finally { setIconUploading(false); if (e.target) e.target.value = ""; }
  }, [serverId]);

  useEffect(() => {
    fetch(`${API_BASE}/api/servers/${serverId}/schedule`).then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.schedule) { setSchedRestart(data.schedule.restart ?? ""); setSchedBackup(data.schedule.backup ?? ""); } }).catch(() => {});
  }, [serverId]);

  const handleSaveSchedule = useCallback(async () => {
    setSchedSaving(true); setSchedMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/schedule`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: schedRestart || null, backup: schedBackup || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      setSchedMsg("Schedule saved.");
      setTimeout(() => setSchedMsg(null), 4000);
    } catch (err: unknown) { setSchedMsg(`Error: ${err instanceof Error ? err.message : "unknown"}`); }
    finally { setSchedSaving(false); }
  }, [serverId, schedRestart, schedBackup]);

  const updateProp = (key: string, value: string) => setProperties(prev => ({ ...prev, [key]: value }));

  if (serverType === "velocity") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <p className="text-sm">Velocity proxy settings are managed via velocity.toml in the file manager.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Properties Card ── */}
      <div className="surface p-5">
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Left: Icon + MOTD */}
          <div className="lg:w-48 shrink-0 space-y-4">
            <div className="flex flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-lg border border-[#1a1f2e] bg-[#0a0c10] flex items-center justify-center overflow-hidden">
                {iconUrl ? <img src={iconUrl} alt="Server icon" className="h-full w-full object-cover" />
                  : <ImageIcon className="h-6 w-6 text-slate-700" />}
              </div>
              <label className={`cursor-pointer rounded-md border border-[#1a1f2e] px-2.5 py-1 text-[11px] text-slate-500 transition hover:border-[#252b3b] hover:text-slate-300 ${iconUploading ? "opacity-50 pointer-events-none" : ""}`}>
                <Upload className="h-3 w-3 inline mr-1" />{iconUploading ? "…" : "Upload"}
                <input type="file" accept="image/png" onChange={handleIconUpload} className="hidden" />
              </label>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">MOTD</label>
              <textarea value={motd} onChange={e => setMotd(e.target.value)} rows={2}
                className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white font-mono
                           placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none resize-none" />
            </div>
          </div>

          {/* Right: Properties grid */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-600" /></div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <p className="text-xs text-slate-500">{error}</p>
                <button onClick={loadProperties} className="text-xs text-violet-400 hover:underline">Retry</button>
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {KNOWN_PROPERTIES.map(({ key, label, type, options }) => {
                  const value = properties[key] ?? "";
                  return (
                    <label key={key} className="block">
                      <span className="mb-0.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">{label}</span>
                      {type === "select" && options ? (
                        <select value={value} onChange={e => updateProp(key, e.target.value)}
                          className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-2.5 py-1.5 text-sm text-white
                                     focus:border-violet-500/40 focus:outline-none">
                          {options.map(opt => <option key={opt} value={opt} className="bg-[#0f1119]">{opt}</option>)}
                        </select>
                      ) : (
                        <input type="text" value={value} onChange={e => updateProp(key, e.target.value)}
                          className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-2.5 py-1.5 text-sm text-white font-mono
                                     placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button onClick={handleSave} disabled={saving || loading}
                className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : "Save Settings"}
              </button>
              {saveMsg && <span className={`text-xs ${saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{saveMsg}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Schedule Card ── */}
      <div className="surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium text-white">Scheduled Tasks</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Auto-Restart</span>
            <input type="text" value={schedRestart} onChange={e => setSchedRestart(e.target.value)} placeholder="HH:MM (e.g. 04:00)"
              className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white font-mono
                         placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Auto-Backup</span>
            <input type="text" value={schedBackup} onChange={e => setSchedBackup(e.target.value)} placeholder="HH:MM (e.g. 03:00)"
              className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white font-mono
                         placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={handleSaveSchedule} disabled={schedSaving}
            className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-50">
            {schedSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Schedule"}
          </button>
          {schedMsg && <span className={`text-[11px] ${schedMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{schedMsg}</span>}
        </div>
        <p className="mt-2 text-[10px] text-slate-600">Times checked every 30s. Leave empty to disable. Keeps 5 most recent backups.</p>
      </div>
    </div>
  );
}
