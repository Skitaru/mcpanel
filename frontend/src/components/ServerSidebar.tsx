"use client";

import Link from "next/link";
import { LogOut, PanelLeft, Plus } from "lucide-react";
import type { ServerStatus } from "@/lib/types";

interface Props {
  servers: ServerStatus[];
  activeId?: string;
  collapsed: boolean;
  onToggle: () => void;
  onCreateClick: () => void;
}

function statusColor(status: ServerStatus["status"]) {
  switch (status) {
    case "running": return "bg-emerald-500";
    case "exited": case "created": case "paused": return "bg-amber-500";
    default: return "bg-neutral-700";
  }
}

export default function ServerSidebar({
  servers,
  activeId,
  collapsed,
  onToggle,
  onCreateClick,
}: Props) {
  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full flex-col
          border-r border-white/[0.04] bg-[#050505] transition-all duration-200
          ${collapsed ? "-translate-x-full lg:translate-x-0 lg:w-14" : "w-60 lg:w-56"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-3">
          {!collapsed && (
            <Link href="/" className="text-sm font-semibold tracking-tight text-white/90 hover:text-sky-400 transition">
              MCPanel
            </Link>
          )}
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 text-neutral-600 hover:bg-white/[0.04] hover:text-neutral-400 transition"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Server list */}
        <nav className="flex-1 overflow-y-auto py-2">
          {servers.length === 0 && !collapsed && (
            <p className="px-3 py-6 text-center text-xs text-neutral-700">
              No servers yet
            </p>
          )}
          {servers.map((s) => {
            const isActive = s.id === activeId;
            return (
              <Link
                key={s.id}
                href={`/servers/${s.id}`}
                onClick={() => { if (window.innerWidth < 1024) onToggle(); }}
                className={`group flex items-center gap-2.5 mx-1.5 rounded-lg px-2.5 py-2
                  text-sm transition ${collapsed ? "justify-center" : ""}
                  ${isActive
                    ? "bg-sky-500/10 text-sky-300"
                    : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300"
                  }`}
                title={collapsed ? s.name : undefined}
              >
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor(s.status)}`} />
                {!collapsed && (
                  <span className="truncate">{s.name}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.04] p-2 space-y-1.5">
          <button
            onClick={onCreateClick}
            className={`flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium
              text-white transition hover:bg-sky-500 w-full ${collapsed ? "justify-center" : ""}`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && "New Server"}
          </button>
          <button
            onClick={() => { localStorage.removeItem("mcpanel-token"); window.location.reload(); }}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium
              text-neutral-600 transition hover:bg-red-500/10 hover:text-red-400 w-full
              ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}
