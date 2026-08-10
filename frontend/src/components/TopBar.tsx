"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, KeyRound, Download, LayoutDashboard, ChevronDown, Users } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { statusColor } from "@/lib/format";
import type { ServerStatus } from "@/lib/types";

interface Props {
  servers: ServerStatus[];
  activeId?: string;
  onInstallModpack: () => void;
  /** Total online players across all running servers (dashboard only). */
  onlinePlayers?: number;
}

/** Slim top navigation bar — replaces the old left sidebar (Pterodactyl-style). */
export default function TopBar({ servers, activeId, onInstallModpack, onlinePlayers }: Props) {
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const pathname = usePathname();
  const isDashboard = pathname === "/";
  const active = servers.find((s) => s.id === activeId);

  return (
    <>
      <header className="sticky top-0 z-50 flex items-center gap-3 sm:gap-5 border-b border-edge bg-void/80 backdrop-blur px-4 sm:px-6 py-3">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Obsidian Panel">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_10px_#9D4EDD] shrink-0" />
          <span className="hidden sm:inline text-sm font-bold tracking-tight text-white">Obsidian Panel</span>
        </Link>

        {/* Dashboard nav */}
        <Link
          href="/"
          className={`flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-[13px] font-medium transition ${
            isDashboard
              ? "bg-accent/15 text-purple-200"
              : "text-muted hover:text-slate-200 hover:bg-accent/5"
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        <div className="flex-1" />

        {/* Server switch */}
        <div className="relative">
          <button
            onClick={() => setSwitchOpen((o) => !o)}
            className="flex items-center gap-2 rounded-xl border border-edge bg-surface px-3 py-1.5 text-[13px] text-purple-200 transition hover:border-accent/40"
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${active ? statusColor(active.status) : "bg-edge"} ${active?.status === "running" ? "pulse-dot" : ""}`} />
            <span className="max-w-[130px] sm:max-w-[180px] truncate">{active ? active.name : "No server selected"}</span>
            <ChevronDown className="h-3 w-3 text-muted shrink-0" />
          </button>

          {switchOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSwitchOpen(false)} />
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-edge bg-surface shadow-2xl overflow-hidden z-50">
                <div className="px-3.5 py-2 border-b border-edge">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-widest">
                    Quick Access
                    {onlinePlayers != null && onlinePlayers > 0 && (
                      <span className="ml-1.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-purple-300" title="Players online">
                        <Users className="h-2.5 w-2.5 inline -mt-0.5 mr-0.5" />
                        {onlinePlayers}
                      </span>
                    )}
                  </span>
                </div>
                {servers.map((s) => (
                  <Link
                    key={s.id}
                    href={`/servers/${s.id}`}
                    onClick={() => setSwitchOpen(false)}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition ${
                      s.id === activeId ? "bg-accent/10 text-purple-200" : "text-slate-300 hover:bg-accent/5"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${statusColor(s.status)} ${s.status === "running" ? "pulse-dot" : ""}`} />
                    <span className="truncate flex-1">{s.name}</span>
                    <span className="font-mono text-[10px] text-muted">{s.port}</span>
                  </Link>
                ))}
                {servers.length === 0 && <p className="px-3.5 py-3 text-xs text-muted">No servers yet</p>}
              </div>
            </>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-0.5">
          <button onClick={onInstallModpack} title="Install Modpack" aria-label="Install Modpack"
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-[13px] font-medium text-slate-300 transition hover:border-accent/40 hover:text-purple-200">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Modpack</span>
          </button>
          <button onClick={() => setPwDialogOpen(true)} title="Change Password" aria-label="Change Password"
            className="p-2 rounded-lg text-muted transition hover:text-purple-300 hover:bg-accent/10">
            <KeyRound className="h-4 w-4" />
          </button>
          <button onClick={() => { localStorage.removeItem("obsidian-token"); window.location.reload(); }}
            title="Logout" aria-label="Logout"
            className="p-2 rounded-lg text-muted transition hover:text-danger hover:bg-danger/10">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <ChangePasswordDialog open={pwDialogOpen} onClose={() => setPwDialogOpen(false)} />
    </>
  );
}
