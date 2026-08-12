"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Server,
  Loader2,
  ChevronDown,
  AlertTriangle,
  Settings,
} from "lucide-react";
import type { ServerStatus } from "@/lib/types";
import toast from "react-hot-toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

const RAM_CHIPS = ["512M", "1G", "2G", "4G", "6G", "8G", "12G", "16G", "24G", "32G", "48G", "64G"];

function mbToRamString(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}G`;
  return `${mb}M`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  server: ServerStatus | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EditServerDialog({ open, onClose, onUpdated, server }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [ram, setRam] = useState("4G");
  const [port, setPort] = useState(25565);
  const [javaArgs, setJavaArgs] = useState("");
  const [voicePort, setVoicePort] = useState<number | null>(null);
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [tag, setTag] = useState("");
  const [maxRamMB, setMaxRamMB] = useState(16384);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- fill form when opening ----
  useEffect(() => {
    if (open && server) {
      setName(server.name);
      setRam(mbToRamString(server.ram));
      setPort(server.port);
      setJavaArgs(server.javaArgs ?? "");
      setVoicePort(server.voicePort ?? null);
      setDiscordWebhook(server.discordWebhook ?? "");
      setTag(server.tag ?? "");
      setError(null);
      fetch(`${API_BASE}/api/system/info`)
        .then(r => r.json())
        .then((info: { totalMemoryMB: number }) => setMaxRamMB(info.totalMemoryMB))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- submit ----
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!server || !name.trim()) return;

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/servers/${server.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            ram,
            port,
            javaArgs: javaArgs.trim() || undefined,
            voicePort: voicePort ?? null,
            discordWebhook: discordWebhook.trim() || null,
            tag: tag.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json().catch(() => ({}));
        // A port change only takes effect on the running container after a
        // Recreate (the config + config files are updated immediately).
        if (data.portChanged) {
          toast("Port geändert — wird nach 'Recreate' auf dem laufenden Container aktiv.", { icon: "ℹ️" });
        }

        onUpdated();
        onClose();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update server.");
      } finally {
        setSubmitting(false);
      }
    },
    [server, name, ram, port, javaArgs, voicePort, discordWebhook, onUpdated, onClose],
  );

  // ---- close on backdrop click ----
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current && !submitting) onClose();
    },
    [onClose, submitting],
  );

  // ---- close on Escape ----
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  if (!open || !server) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center
                 bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl
                   border border-edge bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-violet-400" />
            <h2 className="text-base font-bold text-white">
              Edit Server
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md p-1.5 text-slate-600 transition
                       hover:bg-accent/5 hover:text-slate-400
                       disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5">
          {/* Server name */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              Server Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={submitting}
              className="w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-slate-600
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* Tag */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              Tag <span className="ml-1 text-[10px] text-slate-600 font-normal">(optional, z.B. survival / modded / proxy)</span>
            </span>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="survival"
              disabled={submitting}
              className="w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-slate-600
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* RAM */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              RAM
              <span className="ml-1 text-[10px] text-slate-600 font-normal">
                (max {(maxRamMB / 1024).toFixed(0)} GB available)
              </span>
            </span>
            <input
              type="text"
              value={ram}
              onChange={(e) => setRam(e.target.value)}
              placeholder="e.g. 4G or 4096M"
              disabled={submitting}
              className="w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-sm text-white font-mono
                         placeholder:text-slate-600
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50"
            />
            {/* Preset chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RAM_CHIPS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRam(opt)}
                  disabled={submitting}
                  className={"rounded-md border px-2.5 py-1 text-[11px] font-medium transition"
                            + " disabled:opacity-50"
                            + (ram === opt
                              ? " border-violet-500/40 bg-accent/15 text-violet-300"
                              : " border-edge bg-accent/[0.04] text-slate-500 hover:border-accent/40 hover:text-slate-400")}
                >
                  {opt}
                </button>
              ))}
            </div>
          </label>

          {/* Port */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              Port
            </span>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              min={1024}
              max={65535}
              required
              disabled={submitting}
              className="w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-sm text-white
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* Voice Port */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              Voice Port (UDP)
            </span>
            <input
              type="number"
              value={voicePort ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setVoicePort(v === "" ? null : parseInt(v) || null);
              }}
              placeholder="e.g. 24454 (SimpleVoiceChat)"
              disabled={submitting}
              className="w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-slate-600
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50"
            />
            <p className="mt-1 text-[10px] text-slate-600">
              Requires container recreation to apply. Leave empty to disable.
            </p>
          </label>

          {/* Discord Webhook */}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              Discord Webhook URL
            </span>
            <input
              type="text"
              value={discordWebhook}
              onChange={(e) => setDiscordWebhook(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              disabled={submitting}
              className="w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-slate-600
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50"
            />
            <p className="mt-1 text-[10px] text-slate-600">
              Sends start/stop/crash notifications to a Discord channel.
            </p>
          </label>

          {/* Java Args */}
          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-400 transition">
              Advanced: JVM Arguments
            </summary>
            <textarea
              value={javaArgs}
              onChange={(e) => setJavaArgs(e.target.value)}
              placeholder="Custom JVM flags (replaces Aikar GC defaults)"
              rows={3}
              disabled={submitting}
              className="mt-2 w-full rounded-lg border border-edge bg-void
                         px-3.5 py-2.5 text-xs text-white font-mono
                         placeholder:text-slate-600
                         focus:border-accent/40 focus:outline-none
                         disabled:opacity-50 resize-none"
            />
            <p className="mt-1 text-[10px] text-slate-600">
              -Xms512M and -Xmx are auto-set from RAM. Requires container recreation to apply.
            </p>
          </details>

          {/* Note */}
          <p className="mb-4 text-xs text-slate-600">
            RAM updates apply immediately. Port changes need a server restart.
          </p>

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="flex w-full items-center justify-center gap-2
                       rounded-lg bg-accent px-4 py-2.5 text-sm font-medium
                       text-white transition hover:bg-accent-strong
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
