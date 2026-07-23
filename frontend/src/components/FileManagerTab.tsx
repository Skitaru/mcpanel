"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight, Download, File, FilePlus, Folder, FolderPlus,
  Save, Loader2, Trash2, Upload,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface FileEntry { name: string; size: number; isDirectory: boolean; }

function formatSize(bytes: number) {
  if (bytes === 0) return ""; if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`; return `${bytes} B`;
}

/** File extensions that shouldn't be opened in the text editor (binary junk). */
function isBinary(filename: string) {
  return /\.(jar|png|jpg|jpeg|gif|ico|webp|dat|mca|nbt|lock|gz|zip)$/i.test(filename);
}

interface Props { serverId: string; }

export default function FileManagerTab({ serverId }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreate, setShowCreate] = useState<"file" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/files?path=${encodeURIComponent(currentPath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFiles(await res.json());
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed."); }
    finally { setLoading(false); }
  }, [serverId, currentPath]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => {
    const i = setInterval(() => {
      fetch(`${API_BASE}/api/servers/${serverId}/files?path=${encodeURIComponent(currentPath)}`)
        .then(res => { if (res.ok) return res.json(); throw null; })
        .then((data: FileEntry[]) => setFiles(data)).catch(() => {});
    }, 5000); return () => clearInterval(i);
  }, [serverId, currentPath]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false); dragCounter.current = 0;
    const dropped = Array.from(e.dataTransfer.files); if (!dropped.length) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("path", currentPath);
      for (const f of dropped) fd.append("files", f);
      await fetch(`${API_BASE}/api/servers/${serverId}/upload`, { method: "POST", body: fd });
      await fetchFiles();
    } catch (err) { console.error("Upload failed:", err); }
    finally { setUploading(false); }
  }, [serverId, currentPath, fetchFiles]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("path", currentPath);
      for (const f of selected) fd.append("files", f);
      await fetch(`${API_BASE}/api/servers/${serverId}/upload`, { method: "POST", body: fd });
      await fetchFiles();
    } catch (err) { console.error("Upload failed:", err); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }, [serverId, currentPath, fetchFiles]);

  const openFile = useCallback(async (name: string) => {
    const fp = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    setSelectedFile(fp); setFileLoading(true); setSaveMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(fp)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFileContent((await res.json()).content);
    } catch (err: unknown) {
      setFileContent(`// Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally { setFileLoading(false); }
  }, [serverId, currentPath]);

  const navigateTo = useCallback((dir: string) => {
    setSelectedFile(null); setFileContent("");
    setCurrentPath(prev => prev === "/" ? `/${dir}` : `${prev}/${dir}`);
  }, []);

  const goUp = useCallback(() => {
    if (currentPath === "/") return;
    setSelectedFile(null); setFileContent("");
    const parts = currentPath.split("/").filter(Boolean); parts.pop();
    setCurrentPath(parts.length === 0 ? "/" : "/" + parts.join("/"));
  }, [currentPath]);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return; setSaving(true); setSaveMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveMessage("Saved ✓"); setTimeout(() => setSaveMessage(null), 2000);
    } catch (err: unknown) { setSaveMessage(`Error: ${err instanceof Error ? err.message : "unknown"}`); }
    finally { setSaving(false); }
  }, [serverId, selectedFile, fileContent]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (selectedFile && !saving) saveFile(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [selectedFile, saving, saveFile]);

  const downloadFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(selectedFile)}&raw=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = selectedFile.split("/").pop() ?? "file"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error("Download failed:", err); }
  }, [serverId, selectedFile]);

  const handleCreate = useCallback(async () => {
    if (!showCreate || !createName.trim()) return;
    const np = currentPath === "/" ? `/${createName.trim()}` : `${currentPath}/${createName.trim()}`;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: np, type: showCreate === "folder" ? "directory" : "file" }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      setShowCreate(null); setCreateName(""); await fetchFiles();
    } catch (err) { console.error("Create failed:", err); }
    finally { setCreating(false); }
  }, [serverId, currentPath, showCreate, createName, fetchFiles]);

  const confirmDelete = useCallback(async (name: string) => {
    const fp = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(fp)}`, { method: "DELETE" });
      if (selectedFile === fp) { setSelectedFile(null); setFileContent(""); }
      await fetchFiles();
    } catch (err) { console.error("Delete failed:", err); }
    finally { setDeleting(false); setDeleteTarget(null); }
  }, [serverId, currentPath, selectedFile, fetchFiles]);

  const breadcrumbs = currentPath === "/"
    ? [{ label: "root", path: "/" }]
    : [{ label: "root", path: "/" }, ...currentPath.split("/").filter(Boolean).map((seg, i, arr) => ({
        label: seg, path: "/" + arr.slice(0, i + 1).join("/"),
      }))];

  return (
    <div className="relative flex flex-col lg:flex-row gap-0 overflow-hidden rounded-xl border border-[#1a1f2e] bg-[#0f1119] h-[calc(100vh-16rem)] lg:h-[calc(100vh-12rem)]"
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragEnter={() => { dragCounter.current++; setDragOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragOver(false); }}
      onDrop={handleDrop}>

      {/* ── Left: File tree ── */}
      <div className="flex flex-col lg:w-64 lg:shrink-0 border-b lg:border-b-0 lg:border-r border-[#1a1f2e] min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border-b border-[#1a1f2e] px-2 py-1.5">
          <button onClick={() => setShowCreate("file")}
            className="rounded p-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300" title="New File">
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setShowCreate("folder")}
            className="rounded p-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300" title="New Folder">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleUploadClick} disabled={uploading}
            className="rounded p-1.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-violet-400" title="Upload Files">
            <Upload className="h-3.5 w-3.5" />
          </button>
          <span className="flex-1" />
          {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400 mx-1" />}
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-[#1a1f2e] px-3 py-1.5 text-[11px]">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-0.5 whitespace-nowrap">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-700 shrink-0" />}
              <button onClick={() => { setSelectedFile(null); setFileContent(""); setCurrentPath(crumb.path); }}
                className="rounded px-1 py-0.5 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300">
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Create form */}
        {showCreate && (
          <form onSubmit={e => { e.preventDefault(); handleCreate(); }} className="flex items-center gap-1.5 border-b border-[#1a1f2e] px-2 py-1.5">
            <span className="text-[10px] text-slate-500 shrink-0">New {showCreate}:</span>
            <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
              placeholder={showCreate === "folder" ? "name" : "file.yml"} autoFocus disabled={creating}
              className="flex-1 rounded border border-[#1a1f2e] bg-[#0a0c10] px-1.5 py-0.5 text-[11px] text-slate-200
                         placeholder:text-slate-700 focus:border-violet-500/40 focus:outline-none" />
            <button type="submit" disabled={creating || !createName.trim()}
              className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-violet-500 disabled:opacity-50">OK</button>
            <button type="button" onClick={() => { setShowCreate(null); setCreateName(""); }} disabled={creating}
              className="rounded px-1 py-0.5 text-[10px] text-slate-500 hover:text-slate-300">×</button>
          </form>
        )}

        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0f1119]/90 backdrop-blur-sm pointer-events-none">
            <Upload className="h-8 w-8 text-violet-400" />
            <p className="text-sm font-medium text-violet-300">Drop files to upload</p>
            <p className="text-[11px] text-slate-500">to {currentPath}</p>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-slate-600" /></div>
          ) : error ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-red-400">{error}</p>
              <button onClick={fetchFiles} className="mt-1 text-[10px] text-violet-400 hover:underline">Retry</button>
            </div>
          ) : files.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-600">Empty directory</p>
          ) : (
            <ul>
              {currentPath !== "/" && (
                <li>
                  <button onClick={goUp}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-400 transition hover:bg-white/[0.03]">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-violet-400" />..
                  </button>
                </li>
              )}
              {files.map(f => {
                const fp = currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`;
                const isSelected = selectedFile === fp;
                const bin = !f.isDirectory && isBinary(f.name);
                return (
                  <li key={f.name} className="group relative">
                    <button onClick={() => {
                      if (f.isDirectory) { navigateTo(f.name); return; }
                      if (bin) return; // binary file — don't open in editor
                      openFile(f.name);
                    }}
                      title={bin ? "Binary file — cannot preview" : undefined}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-white/[0.03] ${isSelected ? "bg-violet-500/10 text-violet-300" : bin ? "text-slate-700 cursor-default" : "text-slate-300"}`}>
                      {f.isDirectory ? <Folder className="h-3.5 w-3.5 shrink-0 text-violet-400" /> : <File className={`h-3.5 w-3.5 shrink-0 ${bin ? "text-slate-700" : "text-slate-500"}`} />}
                      <span className="truncate flex-1">{f.name}</span>
                      {!f.isDirectory && f.size > 0 && <span className="text-[10px] text-slate-600 shrink-0 mr-5">{formatSize(f.size)}</span>}
                    </button>
                    {deleteTarget === f.name ? (
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded bg-[#0f1119] border border-[#1a1f2e] px-1.5 py-0.5">
                        <span className="text-[10px] text-red-400">Delete?</span>
                        <button onClick={() => confirmDelete(f.name)} disabled={deleting}
                          className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-500">Yes</button>
                        <button onClick={() => setDeleteTarget(null)}
                          className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-600">No</button>
                      </div>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); setDeleteTarget(f.name); }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-700 opacity-0 transition hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                        title="Delete"><Trash2 className="h-3 w-3" /></button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Right: Editor ── */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {/* Editor header */}
        <div className="flex items-center justify-between border-b border-[#1a1f2e] px-3 py-1.5">
          <span className="truncate font-mono text-[11px] text-slate-500">{selectedFile ?? "No file selected"}</span>
          <div className="flex items-center gap-1.5">
            {saveMessage && (
              <span className={`text-[11px] ${saveMessage.startsWith("Saved") || saveMessage.startsWith("Error") === false ? "text-emerald-400" : "text-red-400"}`}>{saveMessage}</span>
            )}
            {selectedFile && (<>
              <button onClick={downloadFile} className="rounded p-1 text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-300" title="Download">
                <Download className="h-3.5 w-3.5" />
              </button>
              <button onClick={saveFile} disabled={saving}
                className="flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-violet-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {saving ? "…" : "Save"}
              </button>
            </>)}
          </div>
        </div>

        {/* Editor body */}
        {!selectedFile ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-600">
            <File className="mb-2 h-8 w-8 opacity-20" />
            <p className="text-xs">Select a file to edit</p>
          </div>
        ) : fileLoading ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-600" /></div>
        ) : (
          <div className="flex flex-1 min-h-0">
            <div ref={lineNumberRef} className="select-none overflow-hidden bg-[#0a0c10] py-3 pl-3 pr-2 font-mono text-[12.5px] leading-[1.75] text-slate-700 text-right" style={{ minWidth: "2.5rem" }}>
              {(fileContent || "\n").split("\n").map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea ref={textareaRef} value={fileContent} onChange={e => setFileContent(e.target.value)}
              onScroll={() => { if (textareaRef.current && lineNumberRef.current) lineNumberRef.current.scrollTop = textareaRef.current.scrollTop; }}
              className="flex-1 resize-none bg-[#0a0c10] p-3 font-mono text-[12.5px] leading-[1.75] text-slate-200 placeholder:text-slate-700 focus:outline-none"
              spellCheck={false} placeholder="File content…" />
          </div>
        )}
      </div>

      {/* Hidden file input for upload button */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  );
}
