"use client";

import { useCallback, useState } from "react";
import { Loader2, LogIn, KeyRound } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!username || !password) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Login failed");
        }
        const data = await res.json();
        localStorage.setItem("mcpanel-token", data.token);
        onLogin(data.token);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setLoading(false);
      }
    },
    [username, password, onLogin],
  );

  const handleChangePassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!currentPw || !newPw) return;
      setLoading(true);
      setPwMsg(null);
      try {
        const token = localStorage.getItem("mcpanel-token");
        const res = await fetch(`${API_BASE}/api/auth/change-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed");
        setPwMsg("Password changed. Please log in again.");
        setShowChangePw(false);
        localStorage.removeItem("mcpanel-token");
      } catch (err: unknown) {
        setPwMsg(err instanceof Error ? err.message : "Failed");
      } finally {
        setLoading(false);
      }
    },
    [currentPw, newPw],
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#030303]">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_30%,rgba(14,165,233,0.08),transparent)]" />

      <div className="relative w-full max-w-sm animate-in">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">MCPanel</h1>
          <p className="mt-1 text-sm text-neutral-500">Minecraft Server Dashboard</p>
        </div>

        {/* Login form */}
        {!showChangePw ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-6">
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoFocus
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                             px-3.5 py-2.5 text-sm text-white
                             placeholder:text-neutral-600
                             focus:border-sky-500/40 focus:outline-none
                             disabled:opacity-50"
                />
              </div>
              <div className="mb-1">
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                             px-3.5 py-2.5 text-sm text-white
                             placeholder:text-neutral-600
                             focus:border-sky-500/40 focus:outline-none
                             disabled:opacity-50"
                />
              </div>

              {error && (
                <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl
                         bg-sky-600 px-4 py-3 text-sm font-medium text-white
                         transition hover:bg-sky-500
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {loading ? "Signing in…" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => setShowChangePw(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl
                         border border-white/[0.04] px-4 py-2.5 text-xs text-neutral-500
                         transition hover:border-white/[0.08] hover:text-neutral-300"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Change password
            </button>
          </form>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="rounded-2xl border border-white/[0.06] bg-[#0a0a0a] p-6">
              <h2 className="mb-4 text-sm font-medium text-white">Change Password</h2>
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  autoFocus
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                             px-3.5 py-2.5 text-sm text-white
                             focus:border-sky-500/40 focus:outline-none
                             disabled:opacity-50"
                />
              </div>
              <div className="mb-1">
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02]
                             px-3.5 py-2.5 text-sm text-white
                             focus:border-sky-500/40 focus:outline-none
                             disabled:opacity-50"
                />
              </div>
              {pwMsg && (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  pwMsg.includes("changed") ? "border border-emerald-500/20 bg-emerald-500/5 text-emerald-400" : "border border-red-500/20 bg-red-500/5 text-red-400"
                }`}>
                  {pwMsg}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !currentPw || !newPw}
              className="flex w-full items-center justify-center gap-2 rounded-xl
                         bg-sky-600 px-4 py-3 text-sm font-medium text-white
                         transition hover:bg-sky-500
                         disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change Password"}
            </button>

            <button
              type="button"
              onClick={() => { setShowChangePw(false); setPwMsg(null); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl
                         border border-white/[0.04] px-4 py-2.5 text-xs text-neutral-500
                         transition hover:border-white/[0.08] hover:text-neutral-300"
            >
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
