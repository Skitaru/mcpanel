"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, X, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ChangePasswordDialog({ open, onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentPassword("");
      setNewPassword("");
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!currentPassword || !newPassword) return;
      setSubmitting(true);
      setError(null);
      try {
        const token = localStorage.getItem("mcpanel-token");
        const res = await fetch(`${API_BASE}/api/auth/change-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed");
        setSuccess(true);
        // After 2s, log out so user re-authenticates with new password
        setTimeout(() => {
          localStorage.removeItem("mcpanel-token");
          window.location.reload();
        }, 2000);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed");
      } finally {
        setSubmitting(false);
      }
    },
    [currentPassword, newPassword],
  );

  if (!open) return null;

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center
                 bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-xl
                   border border-[#1a1f2e] bg-[#0f1119] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1a1f2e] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-violet-400" />
            <h2 className="text-base font-bold text-white">
              Change Password
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
        {success ? (
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <div className="rounded-full bg-emerald-500/10 p-3">
              <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-white font-medium">Password changed</p>
            <p className="text-xs text-neutral-500">All sessions invalidated. Logging out…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5">
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-300">
                Current Password
              </span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoFocus
                disabled={submitting}
                className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                           px-3.5 py-2.5 text-sm text-white
                           placeholder:text-neutral-600
                           focus:border-violet-500/40 focus:outline-none
                           disabled:opacity-50"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-300">
                New Password
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
                placeholder="Min. 4 characters"
                className="w-full rounded-lg border border-[#1a1f2e] bg-[#0a0c10]
                           px-3.5 py-2.5 text-sm text-white
                           placeholder:text-neutral-600
                           focus:border-violet-500/40 focus:outline-none
                           disabled:opacity-50"
              />
            </label>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !currentPassword || !newPassword}
              className="flex w-full items-center justify-center gap-2 rounded-lg
                         bg-violet-600 px-4 py-2.5 text-sm font-medium text-white
                         transition hover:bg-violet-500
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Change Password"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
