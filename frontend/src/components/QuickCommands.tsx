"use client";

import { useCallback, useState } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface CmdDef {
  id: string;
  icon: string;
  label: string;
  /** Base command (no leading slash). If needsInput, the user value is appended. */
  cmd: string;
  needsInput?: { label: string; placeholder: string };
}

const CMDS: CmdDef[] = [
  { id: "say", icon: "💬", label: "Say", cmd: "say", needsInput: { label: "Nachricht", placeholder: "Hallo zusammen!" } },
  { id: "op", icon: "⭐", label: "Op", cmd: "op", needsInput: { label: "Spielername", placeholder: "Steve" } },
  { id: "deop", icon: "🚫", label: "Deop", cmd: "deop", needsInput: { label: "Spielername", placeholder: "Steve" } },
  { id: "gamemode", icon: "🎮", label: "Gamemode", cmd: "gamemode", needsInput: { label: "Gamemode + Spieler", placeholder: "creative Steve" } },
  { id: "whitelist-add", icon: "📋", label: "Whitelist +", cmd: "whitelist add", needsInput: { label: "Spielername", placeholder: "Steve" } },
  { id: "whitelist-remove", icon: "🗑", label: "Whitelist −", cmd: "whitelist remove", needsInput: { label: "Spielername", placeholder: "Steve" } },
  { id: "save-all", icon: "💾", label: "save-all", cmd: "save-all" },
  { id: "list", icon: "⚡", label: "list", cmd: "list" },
  { id: "kick", icon: "👢", label: "Kick", cmd: "kick", needsInput: { label: "Spielername", placeholder: "Steve" } },
  { id: "ban", icon: "⛔", label: "Ban", cmd: "ban", needsInput: { label: "Spielername", placeholder: "Steve" } },
  { id: "restart", icon: "⏳", label: "Restart 60s", cmd: "restart" },
];

/** Quick command buttons — run RCON commands with a tiny input modal. */
export default function QuickCommands({ serverId }: { serverId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState<CmdDef | null>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(true);

  const runRcon = useCallback(async (fullCommand: string, label: string) => {
    setBusy(label);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: fullCommand }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = (data.response ?? "").trim();
      if (reply) toast.success(reply.length > 120 ? reply.slice(0, 120) + "…" : reply);
      else toast.success(`/${fullCommand} sent`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Command failed");
    } finally {
      setBusy(null);
    }
  }, [serverId]);

  const handleClick = useCallback((cmd: CmdDef) => {
    if (cmd.id === "restart") {
      // Say a countdown, then restart after 60 s.
      runRcon("say ⚠ Server restarting in 60 seconds!", "restart");
      setTimeout(() => {
        fetch(`${API_BASE}/api/servers/${serverId}/restart`, { method: "POST" }).catch(() => {});
      }, 60_000);
      return;
    }
    if (cmd.needsInput) {
      setActive(cmd);
      setValue("");
      return;
    }
    runRcon(cmd.cmd, cmd.label);
  }, [runRcon, serverId]);

  const handleConfirm = useCallback(() => {
    if (!active) return;
    const full = active.needsInput ? `${active.cmd} ${value.trim()}` : active.cmd;
    setActive(null);
    if (!value.trim()) {
      toast.error("Bitte einen Wert eingeben.");
      return;
    }
    runRcon(full, active.label);
  }, [active, value, runRcon]);

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-xl border border-edge bg-surface">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 transition hover:bg-surface2"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
            ⚡ Quick Commands
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        {open && (
          <div className="grid grid-cols-2 gap-1.5 p-3 pt-0 sm:grid-cols-3">
            {CMDS.map((c) => (
              <button
                key={c.id}
                onClick={() => handleClick(c)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg border border-edge bg-void px-2.5 py-1.5 text-[11px] text-slate-300 transition hover:border-accent/40 hover:text-purple-200 disabled:opacity-50"
                title={`/${c.cmd}`}
              >
                {busy === c.label ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>{c.icon}</span>}
                <span className="truncate">{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input modal for commands with parameters */}
      {active?.needsInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setActive(null)}>
          <div className="surface m-4 w-full max-w-sm border border-edge p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">/{active.cmd} …</h3>
              <button onClick={() => setActive(null)} className="rounded p-1 text-slate-500 transition hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); if (e.key === "Escape") setActive(null); }}
              placeholder={active.needsInput.placeholder}
              aria-label={active.needsInput.label}
              className="mt-2 w-full rounded-lg border border-edge bg-void px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:border-accent/40 focus:outline-none"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setActive(null)} className="rounded-md bg-edge px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-accent-deep">Cancel</button>
              <button onClick={handleConfirm} disabled={!value.trim()} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-strong disabled:opacity-50">Run</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
