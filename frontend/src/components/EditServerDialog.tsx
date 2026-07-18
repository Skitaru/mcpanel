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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- fill form when opening ----
  useEffect(() => {
    if (open && server) {
      setName(server.name);
      setRam(mbToRamString(server.ram));
      setPort(server.port);
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
    [server, name, ram, port, onUpdated, onClose],
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
                 bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl
                   border border-slate-800 bg-slate-950 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-sky-500" />
            <h2 className="text-lg font-semibold text-white">
              Edit Server
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-500 transition
                       hover:bg-slate-800 hover:text-slate-300
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
              className="w-full rounded-lg border border-slate-800 bg-slate-900
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-slate-600
                         focus:border-sky-500/50 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* RAM */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-300">
              RAM
            </span>
            <div className="relative">
              <select
                value={ram}
                onChange={(e) => setRam(e.target.value)}
                disabled={submitting}
                className="w-full appearance-none rounded-lg border
                           border-slate-800 bg-slate-900 px-3.5 py-2.5
                           text-sm text-white focus:border-sky-500/50
                           focus:outline-none disabled:opacity-50"
              >
                {RAM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
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
              className="w-full rounded-lg border border-slate-800 bg-slate-900
                         px-3.5 py-2.5 text-sm text-white
                         focus:border-sky-500/50 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* Note */}
          <p className="mb-4 text-xs text-slate-600">
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
                       rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium
                       text-white transition hover:bg-sky-500
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
