"use client";

import { useCallback, useEffect, useState } from "react";
import LoginScreen from "@/components/LoginScreen";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

let _token: string | null = null;

/** Install the fetch interceptor immediately (not via useEffect) */
function installInterceptor(token: string) {
  _token = token;
  const { fetch: originalFetch } = window;
  // Don't double-wrap
  if ((window.fetch as any).__obsidianPatched) return;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const [input, init] = args;
    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    if (url.includes("/api/") && _token) {
      const headers = new Headers(init?.headers);
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${_token}`);
      }
      const res = await originalFetch(input, { ...init, headers });
      // If token expired, clear it and reload so user sees login screen
      if (res.status === 401) {
        _token = null;
        localStorage.removeItem("obsidian-token");
        window.location.reload();
      }
      return res;
    }
    return originalFetch(input, init);
  } as typeof fetch;
  (window.fetch as any).__obsidianPatched = true;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Check for existing token on mount
  useEffect(() => {
    // Swallow unhandled promise rejections (e.g. a poll failing right before
    // a tab switch) — log to console instead of spewing uncaught errors.
    const onRejection = (e: PromiseRejectionEvent) => {
      console.warn("[panel] Unhandled promise rejection:", e.reason);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);

    const stored = localStorage.getItem("obsidian-token");
    if (stored) {
      fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${stored}` },
      })
        .then((res) => {
          if (res.ok) {
            installInterceptor(stored);
            setToken(stored);
          } else {
            localStorage.removeItem("obsidian-token");
          }
        })
        .catch(() => localStorage.removeItem("obsidian-token"))
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  const handleLogin = useCallback((newToken: string) => {
    localStorage.setItem("obsidian-token", newToken);
    installInterceptor(newToken);
    setToken(newToken);
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-violet-500" />
      </div>
    );
  }

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <>{children}</>;
}
