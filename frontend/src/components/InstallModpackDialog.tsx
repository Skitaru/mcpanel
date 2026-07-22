"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Download, Loader2, Search } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const RAM_OPTIONS = ["2G", "4G", "6G", "8G", "12G", "16G"];

interface CfModpack {
  id: number;
  name: string;
  summary: string;
  logo?: { thumbnailUrl: string };
  downloadCount: number;
}

interface CfFile {
  id: number;
  displayName: string;
  fileName: string;
  fileDate: string;
  fileLength: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function InstallModpackDialog({ open, onClose, onCreated }: Props) {
  // ---- CF API key ----
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem("mcp_cf_key") || ""; } catch { return ""; }
  });

  // ---- Search ----
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<CfModpack[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ---- Selected modpack + version ----
  const [selectedPack, setSelectedPack] = useState<CfModpack | null>(null);
  const [files, setFiles] = useState<CfFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CfFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ---- Config ----
  const [name, setName] = useState("");
  const [ram, setRam] = useState("4G");
  const [port, setPort] = useState("25565");

  // ---- Installing ----
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installServerId, setInstallServerId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: string; percent: number; error?: string } | null>(null);

  // ---- Poll progress ----
  useEffect(() => {
    if (!installServerId) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/servers/modpack/progress/${installServerId}`);
        const p = await res.json();
        setProgress(p);
        if (p.percent >= 100 || p.error) {
          clearInterval(poll);
          if (p.percent >= 100) { setInstalling(false); onCreated(); onClose(); }
          if (p.error) setInstallError(p.error);
        }
      } catch {}
    }, 800);
    return () => clearInterval(poll);
  }, [installServerId, onCreated, onClose]);

  // ---- Search ----
  const doSearch = useCallback(async () => {
    if (!apiKey.trim() || !searchQuery.trim()) return;
    setSearching(true); setSearchError(null); setResults([]); setSelectedPack(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/curseforge/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), query: searchQuery.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      setResults(await res.json());
    } catch (err: unknown) { setSearchError(err instanceof Error ? err.message : "Search failed"); }
    finally { setSearching(false); }
  }, [apiKey, searchQuery]);

  // ---- Select modpack → load versions ----
  const selectPack = useCallback(async (pack: CfModpack) => {
    setSelectedPack(pack); setSelectedFile(null); setFiles([]); setLoadingFiles(true);
    setName(pack.name);
    try {
      const res = await fetch(`${API_BASE}/api/servers/curseforge/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), modpackId: pack.id }),
      });
      if (!res.ok) throw new Error("Failed to load versions");
      const fileList: CfFile[] = await res.json();
      setFiles(fileList);
      if (fileList.length > 0) setSelectedFile(fileList[0]);
    } catch { setFiles([]); }
    finally { setLoadingFiles(false); }
  }, [apiKey]);

  // ---- Save API key on change ----
  useEffect(() => {
    if (apiKey) { try { localStorage.setItem("mcp_cf_key", apiKey); } catch {} }
  }, [apiKey]);

  // ---- Install ----
  const handleInstall = useCallback(async () => {
    if (!selectedPack || !selectedFile) return;
    setInstalling(true); setInstallError(null); setProgress(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/modpack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          modpackId: selectedPack.id,
          fileId: selectedFile.id,
          ram,
          port: parseInt(port) || 25565,
          name: name.trim() || selectedPack.name,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      const data = await res.json();
      setInstallServerId(data.id); // start polling progress
      setSearchQuery(""); setResults([]); setSelectedPack(null); setFiles([]); setSelectedFile(null);
    } catch (err: unknown) { setInstallError(err instanceof Error ? err.message : "Installation failed"); setInstalling(false); }
  }, [apiKey, selectedPack, selectedFile, ram, port, name]);

  const formatSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
  const formatCount = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl surface p-0 relative max-h-[90vh] flex flex-col animate-slide-up overflow-hidden rounded-xl">
        {/* Close */}
        <button onClick={onClose} disabled={installing}
          className="absolute right-3 top-3 z-10 rounded-md p-1 text-slate-600 transition hover:text-slate-400 disabled:opacity-30">
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#1a1f2e]">
          <div className="rounded-lg bg-violet-500/10 p-2">
            <Download className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Install Modpack</h2>
            <p className="text-[11px] text-slate-600">Browse CurseForge modpacks and create a server</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* API Key */}
          <label className="block">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                CurseForge API Key
              </span>
              <a href="https://console.curseforge.com" target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-violet-400 hover:text-violet-300 underline transition">
                Get API Key →
              </a>
            </div>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="$2a$10$... — from console.curseforge.com"
              className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white font-mono
                         placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
          </label>

          {/* Search */}
          <div className="flex gap-2">
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
              placeholder="Search modpacks (e.g. RLCraft, All the Mods...)"
              disabled={!apiKey.trim()}
              className="flex-1 rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white
                         placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none disabled:opacity-40" />
            <button onClick={doSearch} disabled={!apiKey.trim() || !searchQuery.trim() || searching}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition
                         hover:bg-violet-500 disabled:opacity-40 flex items-center gap-1.5">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>

          {/* Search error */}
          {searchError && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5"><p className="text-xs text-red-400">{searchError}</p></div>}

          {/* Results grid */}
          {results.length > 0 && (
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {results.map(p => (
                <button key={p.id} onClick={() => selectPack(p)}
                  className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition ${
                    selectedPack?.id === p.id ? "border-violet-500/40 bg-violet-500/10" : "border-[#1a1f2e] hover:border-[#252b3b]"
                  }`}>
                  {p.logo?.thumbnailUrl ? (
                    <img src={p.logo.thumbnailUrl} alt="" className="h-10 w-10 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="h-10 w-10 rounded bg-[#0a0c10] shrink-0 flex items-center justify-center text-[10px] text-slate-600 font-bold">{p.name.slice(0, 2).toUpperCase()}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-white truncate">{p.name}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">⬇ {formatCount(p.downloadCount)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Searching spinner */}
          {searching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
            </div>
          )}

          {/* Version selector */}
          {selectedPack && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#1a1f2e] bg-[#0a0c10] p-3 flex items-center gap-3">
                {selectedPack.logo?.thumbnailUrl ? (
                  <img src={selectedPack.logo.thumbnailUrl} alt="" className="h-10 w-10 rounded shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded bg-[#0f1119] shrink-0 flex items-center justify-center text-[10px] text-slate-500 font-bold">{selectedPack.name.slice(0, 2).toUpperCase()}</div>
                )}
                <div>
                  <div className="text-sm font-medium text-white">{selectedPack.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{selectedPack.summary}</div>
                </div>
              </div>

              {loadingFiles ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading versions…
                </div>
              ) : files.length > 0 ? (
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Version</span>
                  <select value={selectedFile?.id ?? ""} onChange={e => {
                    const found = files.find(f => f.id === Number(e.target.value));
                    if (found) setSelectedFile(found);
                  }}
                    className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2.5 text-sm text-white
                               focus:border-violet-500/40 focus:outline-none appearance-none">
                    {files.map(f => (
                      <option key={f.id} value={f.id} className="bg-[#0f1119]">
                        {f.displayName} — {formatSize(f.fileLength)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          )}

          {/* Config */}
          {selectedPack && selectedFile && (
            <div className="space-y-3">
              <div className="w-px-full h-px bg-[#1a1f2e]" />
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Server Name <span className="text-slate-700">(optional)</span></span>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={selectedPack.name}
                  className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white
                             placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">RAM</span>
                  <select value={ram} onChange={e => setRam(e.target.value)}
                    className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white
                               focus:border-violet-500/40 focus:outline-none appearance-none">
                    {RAM_OPTIONS.map(o => <option key={o} value={o} className="bg-[#0f1119]">{o}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Port</span>
                  <input type="text" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ""))} placeholder="25565"
                    className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm text-white font-mono
                               placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
                </label>
              </div>
            </div>
          )}

          {/* Install error */}
          {installError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
              <p className="text-xs text-red-400">{installError}</p>
            </div>
          )}

          {/* Installing progress */}
          {installing && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              <div className="w-full max-w-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-400">{progress?.step || "Starting…"}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{progress?.percent ?? 0}%</span>
                </div>
                <div className="h-2 rounded-full bg-[#1a1f2e] overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500 transition-all duration-500 ease-out"
                    style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedPack && selectedFile && !installing && (
          <div className="flex items-center justify-between border-t border-[#1a1f2e] px-5 py-3">
            <p className="text-[10px] text-slate-700">
              API key saved in browser. Get yours at <span className="text-slate-600">console.curseforge.com</span>
            </p>
            <button onClick={handleInstall}
              className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white transition
                         hover:bg-violet-500 flex items-center gap-2">
              <Download className="h-4 w-4" />
              Install Modpack
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
