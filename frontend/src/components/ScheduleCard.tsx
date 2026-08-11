"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  serverId: string;
}

interface Schedule {
  restart?: string;
  backup?: string;
}

/** Auto-restart / auto-backup scheduler — its own tab on the detail page. */
export default function ScheduleCard({ serverId }: Props) {
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/servers/${serverId}/schedule`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.schedule) setSchedule({ restart: data.schedule.restart ?? "", backup: data.schedule.backup ?? "" });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: schedule.restart || null, backup: schedule.backup || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("Schedule saved");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [serverId, schedule]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-edge bg-surface py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
      </div>
    );
  }

  const hasAny = !!(schedule.restart || schedule.backup);

  return (
    <div className="rounded-xl border border-edge bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
        <CalendarClock className="h-4 w-4 text-violet-400" strokeWidth={1.75} />
        <h3 className="text-xs font-semibold text-white">Scheduled Tasks</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
          hasAny ? "border-online/20 bg-online/10 text-emerald-300" : "border-edge bg-void text-muted"
        }`}>
          {hasAny ? "Active" : "Off"}
        </span>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {/* ── Auto-Restart ── */}
        <div className="rounded-lg border border-edge bg-void p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
              <RotateCcw className="h-3.5 w-3.5 text-warn" /> Auto-Restart
            </span>
            {schedule.restart ? (
              <span className="rounded-full border border-warn/20 bg-warn/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                {schedule.restart}
              </span>
            ) : (
              <span className="text-[10px] text-muted">off</span>
            )}
          </div>
          <p className="mb-2.5 text-[10px] leading-relaxed text-muted">
            Restarts the container (fast stop+start, no rebuild) at the given time.
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="time"
              value={schedule.restart ?? ""}
              onChange={(e) => setSchedule((s) => ({ ...s, restart: e.target.value || undefined }))}
              aria-label="Auto-restart time"
              className="w-full rounded-md border border-edge bg-void px-2.5 py-1.5 font-mono text-xs text-white focus:border-accent/40 focus:outline-none"
            />
            {schedule.restart && (
              <button
                onClick={() => setSchedule((s) => ({ ...s, restart: undefined }))}
                className="shrink-0 rounded-md border border-edge px-2 py-1.5 text-muted transition hover:border-danger/40 hover:text-danger"
                title="Disable auto-restart" aria-label="Disable auto-restart"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* ── Auto-Backup ── */}
        <div className="rounded-lg border border-edge bg-void p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
              <Save className="h-3.5 w-3.5 text-online" /> Auto-Backup
            </span>
            {schedule.backup ? (
              <span className="rounded-full border border-online/20 bg-online/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                {schedule.backup}
              </span>
            ) : (
              <span className="text-[10px] text-muted">off</span>
            )}
          </div>
          <p className="mb-2.5 text-[10px] leading-relaxed text-muted">
            Creates a backup without stopping the server. Keeps the 5 most recent scheduled backups.
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="time"
              value={schedule.backup ?? ""}
              onChange={(e) => setSchedule((s) => ({ ...s, backup: e.target.value || undefined }))}
              aria-label="Auto-backup time"
              className="w-full rounded-md border border-edge bg-void px-2.5 py-1.5 font-mono text-xs text-white focus:border-accent/40 focus:outline-none"
            />
            {schedule.backup && (
              <button
                onClick={() => setSchedule((s) => ({ ...s, backup: undefined }))}
                className="shrink-0 rounded-md border border-edge px-2 py-1.5 text-muted transition hover:border-danger/40 hover:text-danger"
                title="Disable auto-backup" aria-label="Disable auto-backup"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="border-t border-edge px-4 py-2.5 text-[10px] text-slate-600">
        Tasks are checked every 30 seconds (HH:MM, server time). Leave a time empty to disable it.
      </p>
    </div>
  );
}
