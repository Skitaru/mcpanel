"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Save,
  Loader2,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  size: number;
  isDirectory: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "";

function formatSize(bytes: number) {
  if (bytes === 0) return "";
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  serverId: string;
}

export default function FileManagerTab({ serverId }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Create file/folder
  const [showCreate, setShowCreate] = useState<"file" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  // Editor refs for line numbers
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);

  // Drag & drop upload
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);

  // ---- fetch directory listing ----

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverId}/files?path=${encodeURIComponent(currentPath)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FileEntry[] = await res.json();
      setFiles(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setLoading(false);
    }
  }, [serverId, currentPath]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Background poll: auto-refresh file list every 5s (silent, no spinner)
  useEffect(() => {
    const i = setInterval(() => {
      fetch(`${API_BASE}/api/servers/${serverId}/files?path=${encodeURIComponent(currentPath)}`)
        .then((res) => { if (res.ok) return res.json(); throw null; })
        .then((data: FileEntry[]) => setFiles(data))
        .catch(() => {}); // silent fail
    }, 5_000);
    return () => clearInterval(i);
  }, [serverId, currentPath]);

  // Drag & drop handler (after fetchFiles is defined)
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      dragCounter.current = 0;
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length === 0) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("path", currentPath);
        for (const f of droppedFiles) formData.append("files", f);
        const res = await fetch(`${API_BASE}/api/servers/${serverId}/upload`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchFiles();
      } catch (err: unknown) {
        console.error("Upload failed:", err);
      } finally {
        setUploading(false);
      }
    },
    [serverId, currentPath, fetchFiles],
  );

  // ---- open a file in the editor ----

  const openFile = useCallback(
    async (name: string) => {
      const filePath =
        currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
      setSelectedFile(filePath);
      setFileLoading(true);
      setSaveMessage(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(filePath)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setFileContent(data.content);
      } catch (err: unknown) {
        setFileContent(
          `// Error loading file: ${err instanceof Error ? err.message : "unknown"}`,
        );
      } finally {
        setFileLoading(false);
      }
    },
    [serverId, currentPath],
  );

  // ---- navigate directory ----

  const navigateTo = useCallback((dirName: string) => {
    setSelectedFile(null);
    setFileContent("");
    setCurrentPath((prev) =>
      prev === "/" ? `/${dirName}` : `${prev}/${dirName}`,
    );
  }, []);

  const goUp = useCallback(() => {
    if (currentPath === "/") return;
    setSelectedFile(null);
    setFileContent("");
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? "/" : "/" + parts.join("/"));
  }, [currentPath]);

  // ---- breadcrumbs ----

  const breadcrumbs = currentPath === "/"
    ? [{ label: "root", path: "/" }]
    : [
        { label: "root", path: "/" },
        ...currentPath
          .split("/")
          .filter(Boolean)
          .map((seg, i, arr) => ({
            label: seg,
            path: "/" + arr.slice(0, i + 1).join("/"),
          })),
      ];

  // ---- save file ----

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveMessage("Saved ✓");
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err: unknown) {
      setSaveMessage(
        `Save failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setSaving(false);
    }
  }, [serverId, selectedFile, fileContent]);

  // ---- Ctrl+S shortcut ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (selectedFile && !saving) saveFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedFile, saving, saveFile]);

  // ---- download file ----

  const downloadFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(selectedFile)}&raw=true`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedFile.split("/").pop() ?? "file";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      console.error("Download failed:", err);
    }
  }, [serverId, selectedFile]);

  // ---- create file / folder ----

  const handleCreate = useCallback(async () => {
    if (!showCreate || !createName.trim()) return;
    const newPath =
      currentPath === "/" ? `/${createName.trim()}` : `${currentPath}/${createName.trim()}`;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: newPath,
          type: showCreate === "folder" ? "directory" : "file",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setShowCreate(null);
      setCreateName("");
      await fetchFiles();
    } catch (err: unknown) {
      console.error("Create failed:", err);
    } finally {
      setCreating(false);
    }
  }, [serverId, currentPath, showCreate, createName, fetchFiles]);

  // ---- delete file / folder ----

  const confirmDelete = useCallback(
    async (name: string) => {
      const filePath =
        currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
      setDeleting(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/servers/${serverId}/file?path=${encodeURIComponent(filePath)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // If we deleted the currently-open file, close the editor.
        if (selectedFile === filePath) {
          setSelectedFile(null);
          setFileContent("");
        }
        await fetchFiles();
      } catch (err: unknown) {
        console.error("Delete failed:", err);
      } finally {
        setDeleting(false);
        setDeleteTarget(null);
      }
    },
    [serverId, currentPath, selectedFile, fetchFiles],
  );

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-4">
      {/* ---- Left panel: file tree ---- */}
      <div
        className="flex w-full flex-col lg:w-72 lg:shrink-0"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={() => { dragCounter.current++; setDragOver(true); }}
        onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragOver(false); }}
        onDrop={handleDrop}
      >
        <div
          className={`relative overflow-hidden rounded-xl border border-slate-800
                      bg-slate-900 ${dragOver ? "ring-2 ring-sky-500/50" : ""}`}
        >
          {/* Drop overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-sky-500/10 backdrop-blur-sm">
              <div className="rounded-xl border-2 border-dashed border-sky-500/50 px-6 py-4 text-center">
                <p className="text-sm font-medium text-sky-400">Drop files to upload</p>
              </div>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70">
              <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
            </div>
          )}
          {/* Breadcrumbs */}
          <div
            className="flex items-center gap-1 overflow-x-auto border-b
                        border-slate-800 px-4 py-2.5 text-xs"
          >
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />
                )}
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setFileContent("");
                    setCurrentPath(crumb.path);
                  }}
                  className="whitespace-nowrap rounded px-1 py-0.5 text-slate-400
                             transition hover:bg-slate-800 hover:text-slate-200"
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>

          {/* Create file / folder */}
          {showCreate ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
              className="flex items-center gap-2 border-b border-slate-800 px-4 py-2"
            >
              <span className="text-xs text-slate-400 shrink-0">
                New {showCreate === "folder" ? "folder" : "file"}:
              </span>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={showCreate === "folder" ? "folder-name" : "file-name.yml"}
                autoFocus
                disabled={creating}
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1
                           text-xs text-slate-200 placeholder:text-slate-600
                           focus:border-sky-500/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={creating || !createName.trim()}
                className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white
                           hover:bg-sky-500 disabled:opacity-50"
              >
                {creating ? "…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(null); setCreateName(""); }}
                disabled={creating}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:text-slate-300"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1 border-b border-slate-800 px-2 py-1.5">
              <button
                onClick={() => setShowCreate("file")}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500
                           transition hover:bg-slate-800 hover:text-slate-300"
              >
                <FilePlus className="h-3.5 w-3.5" />
                New File
              </button>
              <button
                onClick={() => setShowCreate("folder")}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500
                           transition hover:bg-slate-800 hover:text-slate-300"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New Folder
              </button>
            </div>
          )}

          {/* File list */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
              </div>
            ) : error ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-red-400">{error}</p>
                <button
                  onClick={fetchFiles}
                  className="mt-2 text-xs text-sky-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : files.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-slate-600">
                Empty directory
              </p>
            ) : (
              <ul>
                {currentPath !== "/" && (
                  <li>
                    <button
                      onClick={goUp}
                      className="flex w-full items-center gap-2.5 px-4 py-2
                                 text-left text-sm text-slate-400 transition
                                 hover:bg-slate-800/70"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-sky-500" />
                      <span className="truncate">..</span>
                    </button>
                  </li>
                )}
                {files.map((f) => (
                  <li key={f.name} className="group relative">
                    <button
                      onClick={() =>
                        f.isDirectory ? navigateTo(f.name) : openFile(f.name)
                      }
                      className={`flex w-full items-center gap-2.5 px-4 py-2
                                 text-left text-sm transition hover:bg-slate-800/70
                                 ${selectedFile === (currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`) ? "bg-sky-500/10 text-sky-300" : "text-slate-300"}
                                 `}
                    >
                      {f.isDirectory ? (
                        <Folder className="h-4 w-4 shrink-0 text-sky-500" />
                      ) : (
                        <File className="h-4 w-4 shrink-0 text-slate-500" />
                      )}
                      <span className="truncate">{f.name}</span>
                      {!f.isDirectory && f.size > 0 && (
                        <span className="ml-auto shrink-0 text-xs text-slate-600">
                          {formatSize(f.size)}
                        </span>
                      )}
                    </button>

                    {/* Delete button (icon on hover) */}
                    {deleteTarget === f.name ? (
                      <div
                        className="absolute right-2 top-1/2 flex -translate-y-1/2
                                    items-center gap-1 rounded bg-slate-800 px-2 py-1"
                      >
                        <span className="text-xs text-slate-400">Delete?</span>
                        <button
                          onClick={() => confirmDelete(f.name)}
                          disabled={deleting}
                          className="rounded bg-red-600 px-2 py-0.5 text-xs
                                     font-medium text-white hover:bg-red-500"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteTarget(null)}
                          className="rounded bg-slate-700 px-2 py-0.5 text-xs
                                     text-slate-300 hover:bg-slate-600"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(f.name);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2
                                   rounded p-1 text-slate-700 opacity-0
                                   transition hover:bg-red-500/20 hover:text-red-400
                                   group-hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ---- Right panel: editor ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="overflow-hidden rounded-xl border border-slate-800
                      bg-slate-900"
        >
          {/* Editor header */}
          <div
            className="flex items-center justify-between border-b
                        border-slate-800 px-4 py-2.5"
          >
            <span className="truncate font-mono text-xs text-slate-400">
              {selectedFile ?? "No file selected"}
            </span>
            <div className="flex items-center gap-3">
              {saveMessage && (
                <span
                  className={`text-xs ${
                    saveMessage.startsWith("Saved")
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {saveMessage}
                </span>
              )}
              {selectedFile && (
                <>
                  <button
                    onClick={downloadFile}
                    className="flex items-center gap-1.5 rounded-lg border
                               border-slate-800 px-3 py-1.5 text-xs
                               text-slate-400 transition hover:border-slate-700
                               hover:text-slate-200"
                    title="Download file"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3
                               py-1.5 text-xs font-medium text-white transition
                               hover:bg-sky-500 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Editor body */}
          {!selectedFile ? (
            <div
              className="flex flex-col items-center justify-center py-20
                          text-slate-600"
            >
              <File className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">Select a file to edit</p>
            </div>
          ) : fileLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
            </div>
          ) : (
            <div className="flex h-72">
              {/* Line numbers */}
              <div
                ref={lineNumberRef}
                className="select-none overflow-hidden bg-slate-900 py-4 pl-3 pr-2
                           font-mono text-sm leading-relaxed text-slate-600 text-right"
                style={{ minWidth: "3rem" }}
              >
                {(fileContent || "\n").split("\n").map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                onScroll={() => {
                  if (textareaRef.current && lineNumberRef.current) {
                    lineNumberRef.current.scrollTop = textareaRef.current.scrollTop;
                  }
                }}
                className="block flex-1 resize-none bg-slate-950 p-4
                           font-mono text-sm leading-relaxed text-slate-200
                           placeholder:text-slate-700 focus:outline-none"
                spellCheck={false}
                placeholder="File content…"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
