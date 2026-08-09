"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Server,
  Loader2,
  ChevronDown,
  AlertTriangle,
  Settings2,
  Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

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
  const [maxPlayers, setMaxPlayers] = useState(20);
  const [hardcore, setHardcore] = useState(false);
  const [difficulty, setDifficulty] = useState("normal");
  const [voicePort, setVoicePort] = useState<number | null>(null);
  const [maxRamMB, setMaxRamMB] = useState(16384); // fallback 16 GB

  // RAM quick-select presets — extended up to 64G
  const RAM_CHIPS = ["512M", "1G", "2G", "4G", "6G", "8G", "12G", "16G", "24G", "32G", "48G", "64G"];

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
    : elapsed < 15 ? "Downloading server jar…"
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
      setMaxPlayers(20);
      setHardcore(false);
      setDifficulty("normal");
      setVoicePort(null);
      setError(null);
      // Fetch max system RAM
      fetch(`${API_BASE}/api/system/info`)
        .then(r => r.json())
        .then((info: { totalMemoryMB: number }) => setMaxRamMB(info.totalMemoryMB))
        .catch(() => {});
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
            maxPlayers,
            voicePort: voicePort ?? undefined,
            ...(serverType !== "velocity" ? { hardcore, difficulty } : {}),
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
    [name, ram, port, serverType, paperVersion, javaArgs, maxPlayers, hardcore, difficulty, voicePort, onCreated, onClose],
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
        className="relative w-full max-w-2xl overflow-hidden rounded-xl
                   border border-[#28223D] bg-[#151221] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#28223D] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9D4EDD]/10">
              <Server className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Create Server
              </h2>
              <p className="text-xs text-slate-600">Set up a new Minecraft server instance</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md p-1.5 text-slate-600 transition
                       hover:bg-[#9D4EDD]/5 hover:text-slate-400
                       disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-2 gap-6">
            {/* ── Left Column: Basic Information ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#9D4EDD]/10">
                  <Info className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Basic Information</h3>
                  <p className="text-[11px] text-slate-600">Server identity</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Server name */}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">
                    Server Name <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Survival World"
                    required
                    disabled={submitting}
                    className="w-full rounded-lg border border-[#28223D] bg-[#0B0914]
                               px-3.5 py-2.5 text-sm text-white
                               placeholder:text-slate-600
                               focus:border-[#9D4EDD]/40 focus:outline-none
                               disabled:opacity-50"
                  />
                </label>

                {/* Server type */}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">
                    Server Type
                  </span>
                  <div className="relative">
                    <select
                      value={serverType}
                      onChange={(e) => setServerType(e.target.value as "paper" | "fabric" | "velocity")}
                      disabled={submitting}
                      className="w-full appearance-none rounded-lg border
                                 border-[#28223D] bg-[#0B0914] px-3.5 py-2.5
                                 text-sm text-white focus:border-[#9D4EDD]/40
                                 focus:outline-none disabled:opacity-50"
                    >
                      <option value="paper" className="bg-[#0a0a0a] text-white">PaperMC (Vanilla)</option>
                      <option value="fabric" className="bg-[#0a0a0a] text-white">Fabric (Modded)</option>
                      <option value="velocity" className="bg-[#0a0a0a] text-white">Velocity (Proxy)</option>
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2
                                 h-4 w-4 -translate-y-1/2 text-slate-600"
                    />
                  </div>
                </label>

                {/* Version */}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">
                    {serverType === "velocity" ? "Velocity Version" : "Minecraft Version"}
                  </span>
                  {versionsLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[#28223D] bg-[#0B0914] px-3.5 py-2.5">
                      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                      <span className="text-sm text-slate-500">
                        Loading versions…
                      </span>
                    </div>
                  ) : versionsError ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[#FEE440]/20 bg-[#FEE440]/5 px-3.5 py-2.5">
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
                                   border-[#28223D] bg-[#0B0914] px-3.5 py-2.5
                                   text-sm text-white focus:border-[#9D4EDD]/40
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
                                   h-4 w-4 -translate-y-1/2 text-slate-600"
                      />
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* ── Right Column: Server Configuration ── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#9D4EDD]/10">
                  <Settings2 className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Configuration</h3>
                  <p className="text-[11px] text-slate-600">Performance & network</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Port + Max Players row */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-300">Port</span>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Math.max(1024, Math.min(65535, parseInt(e.target.value) || 25565)))}
                      min={1024}
                      max={65535}
                      disabled={submitting}
                      className="w-full rounded-lg border border-[#28223D] bg-[#0B0914]
                                 px-3.5 py-2.5 text-sm text-white
                                 focus:border-[#9D4EDD]/40 focus:outline-none
                                 disabled:opacity-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-300">Max Players</span>
                    <input
                      type="number"
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Math.max(1, Math.min(1000, parseInt(e.target.value) || 20)))}
                      min={1}
                      max={1000}
                      disabled={submitting}
                      className="w-full rounded-lg border border-[#28223D] bg-[#0B0914]
                                 px-3.5 py-2.5 text-sm text-white
                                 focus:border-[#9D4EDD]/40 focus:outline-none
                                 disabled:opacity-50"
                    />
                  </label>
                </div>

                {/* Voice Port (UDP — SimpleVoiceChat) */}
                <label className="block">
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
                    className="w-full rounded-lg border border-[#28223D] bg-[#0B0914]
                               px-3.5 py-2.5 text-sm text-white
                               placeholder:text-slate-600
                               focus:border-[#9D4EDD]/40 focus:outline-none
                               disabled:opacity-50"
                  />
                  <p className="mt-1 text-[10px] text-slate-600">
                    Leave empty if you don't need voice chat. Requires container recreation to change later.
                  </p>
                </label>

                {/* Difficulty + Hardcore (non-Velocity only) */}
                {serverType !== "velocity" && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-slate-300">Difficulty</span>
                      <div className="relative">
                        <select
                          value={difficulty}
                          onChange={(e) => setDifficulty(e.target.value)}
                          disabled={submitting}
                          className="w-full appearance-none rounded-lg border
                                     border-[#28223D] bg-[#0B0914] px-3.5 py-2.5
                                     text-sm text-white focus:border-[#9D4EDD]/40
                                     focus:outline-none disabled:opacity-50"
                        >
                          <option value="peaceful" className="bg-[#0a0a0a] text-white">Peaceful</option>
                          <option value="easy" className="bg-[#0a0a0a] text-white">Easy</option>
                          <option value="normal" className="bg-[#0a0a0a] text-white">Normal</option>
                          <option value="hard" className="bg-[#0a0a0a] text-white">Hard</option>
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-3 top-1/2
                                     h-4 w-4 -translate-y-1/2 text-slate-600"
                        />
                      </div>
                    </label>
                    <label className="flex flex-col">
                      <span className="mb-1.5 block text-sm font-medium text-slate-300">Hardcore</span>
                      <button
                        type="button"
                        onClick={() => setHardcore(!hardcore)}
                        disabled={submitting}
                        className={`relative mt-0.5 inline-flex h-9 w-full cursor-pointer items-center rounded-lg border px-3 transition
                                   disabled:opacity-50 disabled:cursor-not-allowed
                                   ${hardcore
                                     ? "border-[#F15BB5]/30 bg-[#F15BB5]/10 text-red-400"
                                     : "border-[#28223D] bg-[#0B0914] text-slate-600 hover:border-[#9D4EDD]/40"}`}
                      >
                        <span className={`mr-2 h-2 w-2 rounded-full ${hardcore ? "bg-red-500 animate-pulse" : "bg-[#28223D]"}`} />
                        <span className="text-sm font-medium">{hardcore ? "Enabled" : "Off"}</span>
                      </button>
                    </label>
                  </div>
                )}

                {/* RAM */}
                <label className="block">
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
                    className="w-full rounded-lg border border-[#28223D] bg-[#0B0914]
                               px-3.5 py-2.5 text-sm text-white font-mono
                               placeholder:text-slate-600
                               focus:border-[#9D4EDD]/40 focus:outline-none
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
                                    ? " border-violet-500/40 bg-[#9D4EDD]/15 text-violet-300"
                                    : " border-[#28223D] bg-[#9D4EDD]/[0.04] text-slate-500 hover:border-[#9D4EDD]/40 hover:text-slate-400")}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </label>

                {/* JVM Arguments */}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-300">
                    JVM Arguments
                  </span>
                  <textarea
                    value={javaArgs}
                    onChange={(e) => setJavaArgs(e.target.value)}
                    placeholder="Custom JVM flags (replaces Aikar GC defaults)&#10;e.g. -XX:+UseZGC -XX:+ZGenerational"
                    rows={3}
                    disabled={submitting}
                    className="w-full rounded-lg border border-[#28223D] bg-[#0B0914]
                               px-3.5 py-2.5 text-xs text-white font-mono
                               placeholder:text-slate-600
                               focus:border-[#9D4EDD]/40 focus:outline-none
                               disabled:opacity-50 resize-none"
                  />
                  <p className="mt-1 text-[10px] text-slate-600">
                    -Xms and -Xmx are auto-set from RAM. Leave empty for optimized defaults.
                  </p>
                </label>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mt-5 flex items-start gap-2 rounded-lg
                          border border-[#F15BB5]/30 bg-[#F15BB5]/10 px-3 py-2.5"
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
            className="mt-5 flex w-full items-center justify-center gap-2
                       rounded-lg bg-[#9D4EDD] px-4 py-2.5 text-sm font-medium
                       text-white transition hover:bg-[#B100E8] hover:scale-[1.02]
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
              <div className="h-1.5 overflow-hidden rounded-full bg-[#9D4EDD]/[0.04]">
                <div
                  className="h-full animate-pulse rounded-full bg-violet-500"
                  style={{ width: `${Math.min(elapsed * 3, 90)}%` }}
                />
              </div>
              <p className="text-center text-xs text-slate-600">
                {elapsed}s elapsed — this may take up to 30s
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
