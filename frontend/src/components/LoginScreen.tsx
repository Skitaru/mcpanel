"use client";

import { useCallback, useState } from "react";
import { Loader2, LogIn } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0c10]">
      <div className="w-full max-w-xs animate-in">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-xl font-bold tracking-tight text-white">MCPanel</h1>
          <p className="mt-1 text-sm text-slate-500">Minecraft Server Dashboard</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-3">
          <div className="surface p-5">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              disabled={loading}
              className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm
                         text-white placeholder:text-slate-700
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50"
            />

            <label className="mt-3 mb-1.5 block text-xs font-medium text-slate-500">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="········"
              disabled={loading}
              className="w-full rounded-md border border-[#1a1f2e] bg-[#0a0c10] px-3 py-2 text-sm
                         text-white placeholder:text-slate-700
                         focus:border-violet-500/40 focus:outline-none
                         disabled:opacity-50"
            />

            {error && (
              <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg
                       bg-violet-600 px-4 py-2.5 text-sm font-medium text-white
                       transition hover:bg-violet-500
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
