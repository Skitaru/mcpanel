"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  serverId: string;
}

/** Compact auto-restart / auto-backup scheduler (moved out of the removed Settings tab). */
export default function ScheduleCard({ serverId }: Props) {
  const [schedRestart, setSchedRestart] = useState("");
  const [schedBackup, setSchedBackup] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/servers/${serverId}/schedule`).then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.schedule) { setSchedRestart(data.schedule.restart ?? ""); setSchedBackup(data.schedule.backup ?? ""); } }).catch(() => {});
  }, [serverId]);

  const handleSave = useCallback(async () => {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/schedule`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: schedRestart || null, backup: schedBackup || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      setMsg("Schedule saved.");
      setTimeout(() => setMsg(null), 4000);
    } catch (err: unknown) { setMsg(`Error: ${err instanceof Error ? err.message : "unknown"}`); }
    finally { setSaving(false); }
  }, [serverId, schedRestart, schedBackup]);

  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2 border-b border-edge pb-2 mb-3">
        <Clock className="h-4 w-4 text-slate-500" />
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scheduled Tasks</span>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Auto-Restart</span>
          <input type="text" value={schedRestart} onChange={e => setSchedRestart(e.target.value)} placeholder="HH:MM (e.g. 04:00)"
            className="w-full rounded-md border border-edge bg-void px-2.5 py-1.5 text-xs text-white font-mono
                       placeholder:text-muted focus:border-accent/40 focus:outline-none" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Auto-Backup</span>
          <input type="text" value={schedBackup} onChange={e => setSchedBackup(e.target.value)} placeholder="HH:MM (e.g. 03:00)"
            className="w-full rounded-md border border-edge bg-void px-2.5 py-1.5 text-xs text-white font-mono
                       placeholder:text-muted focus:border-accent/40 focus:outline-none" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-accent-strong disabled:opacity-50">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Schedule"}
        </button>
        {msg && <span className={`text-[10px] ${msg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{msg}</span>}
      </div>
      <p className="mt-2 text-[10px] text-slate-600">Checked every 30s. Leave empty to disable. Keeps 5 most recent backups.</p>
    </div>
  );
}
