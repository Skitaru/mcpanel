"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Server,
  Loader2,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

const RAM_OPTIONS = ["512M", "1G", "2G", "4G", "6G", "8G", "12G", "16G"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after the server is created so the parent can refresh. */
  onCreated: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateServerDialog({ open, onClose, onCreated }: Props) {

  // Form state
  const [name, setName] = useState("");
  const [ram, setRam] = useState("4G");
  const [serverType, setServerType] = useState<"paper" | "fabric" | "velocity">("paper");
  const [paperVersion, setPaperVersion] = useState("");
  const [javaArgs, setJavaArgs] = useState("");
  const [port, setPort] = useState(25565);

  // PaperMC versions
  const [versions, setVersions] = useState<string[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ---- elapsed timer during submission ----
  useEffect(() => {
    if (!submitting) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [submitting]);

  // phase label based on elapsed time
  const phase =
    elapsed < 4 ? "Creating directories…"
    : elapsed < 15 ? "Downloading PaperMC jar…"
    : elapsed < 25 ? "Pulling Docker image…"
    : "Creating container…";

  // ---- fetch versions based on server type ----

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadVersions() {
      setVersionsLoading(true);
      setVersionsError(null);
      try {
        const endpoint = serverType === "fabric"
          ? `${API_BASE}/api/fabric/versions`
          : serverType === "velocity"
          ? `${API_BASE}/api/velocity/versions`
          : `${API_BASE}/api/paper/versions`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list: string[] = data.versions ?? [];
        setVersions(list);
        if (list.length > 0) setPaperVersion(list[0]);
      } catch (err: unknown) {
        if (!cancelled) {
          setVersionsError(
            err instanceof Error ? err.message : "Failed to load versions.",
          );
        }
      } finally {
        if (!cancelled) setVersionsLoading(false);
      }
    }

    loadVersions();
    return () => {
      cancelled = true;
    };
  }, [open, serverType]);

  // ---- reset form on open ----

  useEffect(() => {
    if (open) {
      setName("");
      setRam("4G");
      setJavaArgs("");
      setError(null);
      // Auto-suggest next free port
      fetch(`${API_BASE}/api/servers`)
        .then(r => r.json())
        .then((servers: { port: number }[]) => {
          const used = new Set(servers.map(s => s.port));
          let p = 25565;
          while (used.has(p)) p++;
          setPort(p);
        })
        .catch(() => setPort(25565));
    }
  }, [open]);

  // ---- submit ----

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !paperVersion) return;

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            ram,
            port,
            serverType,
            paperVersion,
            javaArgs: javaArgs.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
        }

        onCreated(); // tell the dashboard to refresh
        onClose(); // dismiss the modal
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to create server.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [name, ram, port, serverType, paperVersion, javaArgs, onCreated, onClose],
  );

  // ---- close on backdrop click ----

  const handleBackdropClick = useCallback(
    () => {
      if (!submitting) onClose();
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

  // ==================================================================
  // Render
  // ==================================================================

  if (!open) return null;

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center
                 bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-xl
                   border border-[#1a1f2e] bg-[#0f1119] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1a1f2e] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Server className="h-5 w-5 text-violet-400" />
            <h2 className="text-base font-bold text-white">
              Create Server
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
              placeholder="e.g. Survival World"
              required
              disabled={submitting}
              className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                         px-3.5 py-2.5 text-sm text-white
                         placeholder:text-neutral-600
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50"
            />
          </label>

          {/* Server type */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-300">
              Server Type
            </span>
            <div className="relative">
              <select
                value={serverType}
                onChange={(e) => setServerType(e.target.value as "paper" | "fabric" | "velocity")}
                disabled={submitting}
                className="w-full appearance-none rounded-lg border
                           border-[#1a1f2e] bg-[#0a0c10] px-3.5 py-2.5
                           text-sm text-white focus:border-violet-500/40
                           focus:outline-none disabled:opacity-50"
              >
                <option value="paper" className="bg-[#0a0a0a] text-white">PaperMC (Vanilla)</option>
                <option value="fabric" className="bg-[#0a0a0a] text-white">Fabric (Modded)</option>
                <option value="velocity" className="bg-[#0a0a0a] text-white">Velocity (Proxy)</option>
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2
                           h-4 w-4 -translate-y-1/2 text-neutral-600"
              />
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
              onChange={(e) => setPort(Math.max(1024, Math.min(65535, parseInt(e.target.value) || 25565)))}
              min={1024}
              max={65535}
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
                  <option key={opt} value={opt} className="bg-[#0a0a0a] text-white">
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2
                           h-4 w-4 -translate-y-1/2 text-neutral-600"
              />
            </div>
          </label>

          {/* Version */}
          <label className="mb-1.5 block">
            <span className="mb-1.5 block text-sm font-medium text-neutral-300">
              {serverType === "velocity" ? "Velocity Version" : "Minecraft Version"}
            </span>
            {versionsLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3.5 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />
                <span className="text-sm text-neutral-500">
                  Loading versions…
                </span>
              </div>
            ) : versionsError ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="text-sm text-amber-400">
                  {versionsError}
                </span>
              </div>
            ) : (
              <div className="relative">
                <select
                  value={paperVersion}
                  onChange={(e) => setPaperVersion(e.target.value)}
                  disabled={submitting}
                  className="w-full appearance-none rounded-lg border
                             border-[#1a1f2e] bg-[#0a0c10] px-3.5 py-2.5
                             text-sm text-white focus:border-violet-500/40
                             focus:outline-none disabled:opacity-50"
                >
                  {versions.map((v) => (
                    <option key={v} value={v} className="bg-[#0a0a0a] text-white">
                      {v}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2
                             h-4 w-4 -translate-y-1/2 text-neutral-600"
                />
              </div>
            )}
          </label>

          {/* Java Args (Advanced) */}
          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-400 transition">
              Advanced: JVM Arguments
            </summary>
            <textarea
              value={javaArgs}
              onChange={(e) => setJavaArgs(e.target.value)}
              placeholder="Custom JVM flags (replaces Aikar GC defaults)&#10;e.g. -XX:+UseZGC -XX:+ZGenerational"
              rows={3}
              disabled={submitting}
              className="mt-2 w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                         px-3.5 py-2.5 text-xs text-white font-mono
                         placeholder:text-neutral-600
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50 resize-none"
            />
            <p className="mt-1 text-[10px] text-neutral-600">
              -Xms512M and -Xmx are auto-set from RAM. Leave empty for optimized defaults.
            </p>
          </details>

          {/* Error */}
          {error && (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg
                          border border-red-500/30 bg-red-500/10 px-3 py-2.5"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={
              submitting || !name.trim() || !paperVersion || versionsLoading
            }
            className="mt-2 flex w-full items-center justify-center gap-2
                       rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium
                       text-white transition hover:bg-violet-500
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {phase}
              </>
            ) : (
              "Create Server"
            )}
          </button>

          {submitting && (
            <div className="mt-3 space-y-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className="h-full animate-pulse rounded-full bg-violet-500"
                  style={{ width: `${Math.min(elapsed * 3, 90)}%` }}
                />
              </div>
              <p className="text-center text-xs text-neutral-600">
                {elapsed}s elapsed — this may take up to 30s
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
