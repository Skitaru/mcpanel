"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Plus, KeyRound, Download, LayoutDashboard, Server } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { statusColor } from "@/lib/format";
import type { ServerStatus } from "@/lib/types";

interface Props {
  servers: ServerStatus[];
  activeId?: string;
  collapsed: boolean;
  onToggle: () => void;
  onCreateClick: () => void;
  onInstallModpack: () => void;
}

export default function ServerSidebar({
  servers, activeId, collapsed, onToggle, onCreateClick, onInstallModpack,
}: Props) {
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const pathname = usePathname();
  const runningCount = servers.filter(s => s.status === "running").length;
  const isDashboard = pathname === "/";

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={onToggle} />
      )}

      <aside className={`fixed left-0 top-0 z-50 flex h-full flex-col
        border-r border-edge bg-void transition-all duration-200
        ${collapsed ? "-translate-x-full lg:translate-x-0 lg:w-13" : "w-52"}`}>

        {/* Brand */}
        <Link href="/" className={`flex items-center border-b border-edge px-4 py-3.5
          ${collapsed ? "justify-center" : "gap-2.5"}`}>
          <div className="h-2.5 w-2.5 rounded-full bg-violet-500 shrink-0" />
          {!collapsed && <span className="text-sm font-bold tracking-tight text-white">Obsidian Panel</span>}
        </Link>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {/* Navigation section */}
          {!collapsed && (
            <div className="mb-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Navigation
            </div>
          )}
          <div className="space-y-0.5 mb-3">
            <Link
              href="/"
              onClick={() => { if (window.innerWidth < 1024) onToggle(); }}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition
                ${collapsed ? "justify-center" : ""}
                ${isDashboard
                  ? "bg-accent/10 text-violet-300 relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-0.5 before:h-5 before:bg-accent before:rounded-r before:shadow-[0_0_8px_#9D4EDD]"
                  : "text-slate-500 hover:bg-accent/5 hover:text-slate-300"
                }`}
              title={collapsed ? "Dashboard" : undefined}
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Dashboard</span>}
            </Link>
          </div>

          {/* Servers Quick Access */}
          {servers.length > 0 && (
            <>
              {!collapsed && (
                <div className="mb-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Quick Access
                  {runningCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-online/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      {runningCount}
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-0.5">
                {servers.map((s) => {
                  const isActive = s.id === activeId;
                  return (
                    <Link
                      key={s.id}
                      href={`/servers/${s.id}`}
                      onClick={() => { if (window.innerWidth < 1024) onToggle(); }}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition
                        ${collapsed ? "justify-center" : ""}
                        ${isActive
                          ? "bg-accent/10 text-violet-300 relative before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-0.5 before:h-5 before:bg-accent before:rounded-r before:shadow-[0_0_8px_#9D4EDD]"
                          : "text-slate-500 hover:bg-accent/5 hover:text-slate-300"
                        }`}
                      title={collapsed ? s.name : undefined}
                    >
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor(s.status)} ${s.status === "running" ? "pulse-dot" : ""}`} />
                      {!collapsed && <span className="truncate text-xs">{s.name}</span>}
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {servers.length === 0 && !collapsed && (
            <p className="px-3 py-8 text-center text-xs text-muted">No servers yet</p>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-edge p-2 space-y-1">
          <button
            onClick={onCreateClick}
            className={`flex items-center gap-2 rounded-md bg-accent px-2.5 py-2 text-xs font-medium
              text-white transition hover:bg-accent-strong hover:scale-[1.02] w-full ${collapsed ? "justify-center" : ""}`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && "New Server"}
          </button>
          <button
            onClick={onInstallModpack}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium
              text-slate-600 transition hover:bg-accent/5 hover:text-slate-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <Download className="h-4 w-4 shrink-0" />
            {!collapsed && "Modpack"}
          </button>
          <button
            onClick={() => setPwDialogOpen(true)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium
              text-slate-600 transition hover:bg-accent/5 hover:text-slate-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            {!collapsed && "Password"}
          </button>
          <button
            onClick={() => { localStorage.removeItem("obsidian-token"); window.location.reload(); }}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium
              text-slate-600 transition hover:bg-danger/10 hover:text-red-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && "Logout"}
          </button>

          {/* Version */}
          {!collapsed && (
            <p className="pt-1 text-center text-[10px] text-edge">
              Obsidian Panel v1.0.0
            </p>
          )}
        </div>
      </aside>

      <ChangePasswordDialog open={pwDialogOpen} onClose={() => setPwDialogOpen(false)} />
    </>
  );
}
