"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Plus, KeyRound, Download } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import type { ServerStatus } from "@/lib/types";

interface Props {
  servers: ServerStatus[];
  activeId?: string;
  collapsed: boolean;
  onToggle: () => void;
  onCreateClick: () => void;
  onInstallModpack: () => void;
}

function statusColor(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "bg-emerald-500";
    case "exited": case "created": case "paused": return "bg-amber-500";
    default: return "bg-slate-700";
  }
}

export default function ServerSidebar({
  servers, activeId, collapsed, onToggle, onCreateClick, onInstallModpack,
}: Props) {
  const [pwDialogOpen, setPwDialogOpen] = useState(false);

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={onToggle} />
      )}

      <aside className={`fixed left-0 top-0 z-50 flex h-full flex-col
        border-r border-[#1a1f2e] bg-[#0a0c10] transition-all duration-200
        ${collapsed ? "-translate-x-full lg:translate-x-0 lg:w-13" : "w-52"}`}>

        {/* Brand */}
        <Link href="/" className={`flex items-center border-b border-[#1a1f2e] px-4 py-3.5
          ${collapsed ? "justify-center" : "gap-2.5"}`}>
          <div className="h-2.5 w-2.5 rounded-full bg-violet-500 shrink-0" />
          {!collapsed && <span className="text-sm font-bold tracking-tight text-white">MCPanel</span>}
        </Link>

        {/* Server list */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {servers.length === 0 && !collapsed && (
            <p className="px-3 py-8 text-center text-xs text-slate-700">No servers</p>
          )}
          {servers.map((s) => {
            const isActive = s.id === activeId;
            return (
              <Link
                key={s.id}
                href={`/servers/${s.id}`}
                onClick={() => { if (window.innerWidth < 1024) onToggle(); }}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition
                  ${collapsed ? "justify-center" : ""}
                  ${isActive
                    ? "bg-violet-500/10 text-violet-300"
                    : "text-slate-500 hover:bg-white/[0.03] hover:text-slate-300"
                  }`}
                title={collapsed ? s.name : undefined}
              >
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor(s.status)} ${s.status === "running" ? "pulse-dot" : ""}`} />
                {!collapsed && <span className="truncate">{s.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[#1a1f2e] p-2 space-y-1">
          <button
            onClick={onCreateClick}
            className={`flex items-center gap-2 rounded-md bg-violet-600 px-2.5 py-2 text-xs font-medium
              text-white transition hover:bg-violet-500 w-full ${collapsed ? "justify-center" : ""}`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && "New Server"}
          </button>
          <button
            onClick={onInstallModpack}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium
              text-slate-600 transition hover:bg-white/[0.03] hover:text-slate-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <Download className="h-4 w-4 shrink-0" />
            {!collapsed && "Modpack"}
          </button>
          <button
            onClick={() => setPwDialogOpen(true)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium
              text-slate-600 transition hover:bg-white/[0.03] hover:text-slate-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            {!collapsed && "Password"}
          </button>
          <button
            onClick={() => { localStorage.removeItem("mcpanel-token"); window.location.reload(); }}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium
              text-slate-600 transition hover:bg-red-500/10 hover:text-red-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && "Logout"}
          </button>
        </div>
      </aside>

      <ChangePasswordDialog open={pwDialogOpen} onClose={() => setPwDialogOpen(false)} />
    </>
  );
}
