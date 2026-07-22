"use client";

import { useCallback, useState } from "react";
import { X, Download, Loader2, ExternalLink } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const RAM_OPTIONS = ["1G", "2G", "4G", "6G", "8G", "12G", "16G"];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function InstallModpackDialog({ open, onClose, onCreated }: Props) {
  const [url, setUrl] = useState("");
  const [ram, setRam] = useState("4G");
  const [name, setName] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    if (!url.trim()) return;
    setInstalling(true);
    setError(null);
    setStep("Fetching modpack info…");

    try {
      const res = await fetch(`${API_BASE}/api/servers/modpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          ram,
          name: name.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      setStep("Server created! Starting…");
      onCreated();
      onClose();
      setUrl("");
      setName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Installation failed");
      setStep(null);
    } finally {
      setInstalling(false);
    }
  }, [url, ram, name, onCreated, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md surface p-6 relative animate-slide-up">
        {/* Close */}
        <button onClick={onClose} disabled={installing}
          className="absolute right-4 top-4 rounded-md p-1 text-slate-600 transition hover:text-slate-400 disabled:opacity-30">
          <X className="h-4 w-4" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="rounded-lg bg-violet-500/10 p-2">
            <Download className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Install Modpack</h2>
            <p className="text-[11px] text-slate-600">Download a Modrinth modpack and create a server</p>
          </div>
        </div>

        {/* Progress state */}
        {installing ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
            <p className="text-sm text-slate-400">{step || "Installing…"}</p>
            <p className="text-[11px] text-slate-600">This may take a minute or two while mods are downloaded.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Modpack URL */}
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                Modrinth URL or Slug
              </span>
              <input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="fabulously-optimized or modrinth.com/modpack/…"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleInstall(); }}
                className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2.5 text-sm text-white font-mono
                           placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none"
              />
            </label>

            {/* Name (optional) */}
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                Server Name <span className="text-slate-700">(optional)</span>
              </span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Defaults to modpack slug"
                className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2.5 text-sm text-white
                           placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none"
              />
            </label>

            {/* RAM */}
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">RAM</span>
              <select value={ram} onChange={e => setRam(e.target.value)}
                className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2.5 text-sm text-white
                           focus:border-violet-500/40 focus:outline-none appearance-none">
                {RAM_OPTIONS.map(o => <option key={o} value={o} className="bg-[#0f1119]">{o}</option>)}
              </select>
            </label>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            {/* Install button */}
            <button
              onClick={handleInstall}
              disabled={!url.trim()}
              className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition
                         hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              Install Modpack
            </button>

            <p className="text-center text-[10px] text-slate-700">
              Only Fabric/Quilt modpacks are supported.{" "}
              <a href="https://modrinth.com/modpacks" target="_blank" rel="noopener noreferrer"
                className="text-slate-600 hover:text-violet-400 inline-flex items-center gap-0.5 underline transition">
                Browse Modrinth <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
