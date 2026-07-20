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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

const RAM_OPTIONS = ["512M", "1G", "2G", "4G", "6G", "8G", "12G", "16G"];

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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- fill form when opening ----
  useEffect(() => {
    if (open && server) {
      setName(server.name);
      setRam(mbToRamString(server.ram));
      setPort(server.port);
      setJavaArgs(server.javaArgs ?? "");
      setError(null);
    }
  }, [open, server]);

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
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        onUpdated();
        onClose();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update server.");
      } finally {
        setSubmitting(false);
      }
    },
    [server, name, ram, port, javaArgs, onUpdated, onClose],
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
                   border border-[#1a1f2e] bg-[#0f1119] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1a1f2e] px-5 py-3.5">
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
                       hover:bg-white/[0.04] hover:text-slate-400
                       disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5">
          {/* Server name */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-300">
              Server Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={submitting}
              className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-neutral-600
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* RAM */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-300">
              RAM
            </span>
            <div className="relative">
              <select
                value={ram}
                onChange={(e) => setRam(e.target.value)}
                disabled={submitting}
                className="w-full appearance-none rounded-lg border
                           border-[#1a1f2e] bg-[#0a0c10] px-3.5 py-2.5
                           text-sm text-white focus:border-violet-500/40
                           focus:outline-none disabled:opacity-50"
              >
                {RAM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} className="bg-[#0a0a0a] text-white">{opt}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-600" />
            </div>
          </label>

          {/* Port */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-300">
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
              className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                         px-3.5 py-2.5 text-sm text-white
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* Java Args */}
          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-400 transition">
              Advanced: JVM Arguments
            </summary>
            <textarea
              value={javaArgs}
              onChange={(e) => setJavaArgs(e.target.value)}
              placeholder="Custom JVM flags (replaces Aikar GC defaults)"
              rows={3}
              disabled={submitting}
              className="mt-2 w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                         px-3.5 py-2.5 text-xs text-white font-mono
                         placeholder:text-neutral-600
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50 resize-none"
            />
            <p className="mt-1 text-[10px] text-neutral-600">
              -Xms512M and -Xmx are auto-set from RAM. Requires container recreation to apply.
            </p>
          </details>

          {/* Note */}
          <p className="mb-4 text-xs text-neutral-600">
            RAM and port changes only take effect after restarting the server.
          </p>

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="flex w-full items-center justify-center gap-2
                       rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium
                       text-white transition hover:bg-violet-500
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
