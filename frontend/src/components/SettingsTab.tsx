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

  // Icon state
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);

  // Schedule state
  const [schedRestart, setSchedRestart] = useState("");
  const [schedBackup, setSchedBackup] = useState("");
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);

  // ---- load properties ----
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
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { loadProperties(); }, [loadProperties]);

  // ---- load icon preview (fetch raw binary, create blob URL for <img>) ----
  useEffect(() => {
    let cancelled = false;
    const iconPath = `/server-icon.png`;
    fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(iconPath)}&raw=true`)
      .then(async (r) => {
        if (!r.ok || cancelled) { await r.text(); throw null; } // consume body to suppress browser console 404
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        setIconUrl((prev) => {
          if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serverId]);

  // ---- save properties ----
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/properties`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { ...properties, motd } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSaveMsg("Saved! Restart the server to apply changes.");
      setTimeout(() => setSaveMsg(null), 5000);
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setSaving(false);
    }
  }, [serverId, properties, motd]);

  // ---- icon upload ----
  const handleIconUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconUploading(true);
    try {
      const form = new FormData();
      form.append("icon", file);
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/icon`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // Reload icon as blob URL (so auth interceptor attaches Bearer token)
      try {
        const iconRes = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent("/server-icon.png")}&raw=true`);
        if (iconRes.ok) {
          const blob = await iconRes.blob();
          setIconUrl((prev) => {
            if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
        } else { await iconRes.text(); } // consume body to suppress browser console 404
      } catch {}
    } catch (err: unknown) {
      console.error("Icon upload failed:", err);
    } finally {
      setIconUploading(false);
      if (e.target) e.target.value = "";
    }
  }, [serverId]);

  // ---- load schedule ----
  useEffect(() => {
    fetch(`${API_BASE}/api/servers/${serverId}/schedule`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.schedule) {
          setSchedRestart(data.schedule.restart ?? "");
          setSchedBackup(data.schedule.backup ?? "");
        }
      })
      .catch(() => {});
  }, [serverId]);

  // ---- save schedule ----
  const handleSaveSchedule = useCallback(async () => {
    setSchedSaving(true);
    setSchedMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restart: schedRestart || null,
          backup: schedBackup || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSchedMsg("Schedule saved.");
      setTimeout(() => setSchedMsg(null), 4000);
    } catch (err: unknown) {
      setSchedMsg(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally { setSchedSaving(false); }
  }, [serverId, schedRestart, schedBackup]);

  // ---- update a single property ----
  const updateProp = (key: string, value: string) => {
    setProperties(prev => ({ ...prev, [key]: value }));
  };

  if (serverType === "velocity") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
        <p className="text-sm">Velocity proxy settings are managed via velocity.toml in the file manager.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Left: Icon + MOTD */}
      <div className="w-full lg:w-64 lg:shrink-0 space-y-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="h-4 w-4 text-neutral-500" />
            <span className="text-sm font-medium text-neutral-300">Server Icon</span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="h-20 w-20 rounded-lg border border-white/[0.06] bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
              {iconUrl ? (
                <img src={iconUrl} alt="Server icon" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-8 w-8 text-neutral-700" />
              )}
            </div>
            <label className={`cursor-pointer rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-neutral-400 transition hover:border-white/[0.12] hover:text-neutral-200 ${iconUploading ? "opacity-50 pointer-events-none" : ""}`}>
              <Upload className="h-3.5 w-3.5 inline mr-1.5" />
              {iconUploading ? "Uploading…" : "Upload PNG"}
              <input type="file" accept="image/png" onChange={handleIconUpload} className="hidden" />
            </label>
            <p className="text-[10px] text-neutral-600">64×64px PNG</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <label className="mb-1.5 block text-xs font-medium text-neutral-400">MOTD</label>
          <textarea
            value={motd}
            onChange={(e) => setMotd(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                       px-3 py-2 text-sm text-white font-mono
                       placeholder:text-neutral-600
                       focus:border-sky-500/40 focus:outline-none
                       resize-none"
          />
        </div>

        {/* Scheduled Tasks */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-neutral-500" />
            <span className="text-sm font-medium text-neutral-300">Scheduled Tasks</span>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Auto-Restart</span>
              <input
                type="text"
                value={schedRestart}
                onChange={(e) => setSchedRestart(e.target.value)}
                placeholder="HH:MM (e.g. 04:00)"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                           px-3 py-2 text-sm text-white font-mono
                           placeholder:text-neutral-600
                           focus:border-sky-500/40 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Auto-Backup</span>
              <input
                type="text"
                value={schedBackup}
                onChange={(e) => setSchedBackup(e.target.value)}
                placeholder="HH:MM (e.g. 03:00)"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                           px-3 py-2 text-sm text-white font-mono
                           placeholder:text-neutral-600
                           focus:border-sky-500/40 focus:outline-none"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveSchedule}
                disabled={schedSaving}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium
                           text-white transition hover:bg-sky-500
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                {schedSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {schedSaving ? "Saving…" : "Save"}
              </button>
              {schedMsg && (
                <span className={`text-[11px] ${schedMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                  {schedMsg}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              Times are checked every 30 seconds. Leave empty to disable. Backups keep the 5 most recent.
            </p>
          </div>
        </div>
      </div>

      {/* Right: Properties grid */}
      <div className="flex-1 min-w-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-600" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm text-neutral-500">{error}</p>
            <button onClick={loadProperties} className="text-xs text-sky-400 hover:underline">Retry</button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {KNOWN_PROPERTIES.map(({ key, label, type, options }) => {
              const value = properties[key] ?? "";
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
                  {type === "select" && options ? (
                    <select
                      value={value}
                      onChange={(e) => updateProp(key, e.target.value)}
                      className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                                 px-3 py-2 text-sm text-white
                                 focus:border-sky-500/40 focus:outline-none"
                    >
                      {options.map(opt => (
                        <option key={opt} value={opt} className="bg-[#0a0a0a] text-white">{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => updateProp(key, e.target.value)}
                      className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                                 px-3 py-2 text-sm text-white font-mono
                                 placeholder:text-neutral-600
                                 focus:border-sky-500/40 focus:outline-none"
                    />
                  )}
                </label>
              );
            })}
          </div>
        )}

        {/* Save */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium
                       text-white transition hover:bg-sky-500
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saveMsg && (
            <span className={`text-xs ${saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
              {saveMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
