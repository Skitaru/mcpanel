"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

interface Props {
  hostname: string;
  port: number;
  className?: string;
  /** Show the copy button only on hover (desktop groups). */
  hoverReveal?: boolean;
}

/** Copyable server address (IP:port) — shared by the console sidebar and the mobile header. */
export default function AddressPill({ hostname, port, className = "", hoverReveal = false }: Props) {
  const [copied, setCopied] = useState(false);
  const addr = `${hostname}:${port}`;

  const copy = useCallback(() => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(addr);
    } else {
      // Fallback for HTTP (non-secure context)
      const ta = document.createElement("textarea");
      ta.value = addr; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [addr]);

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      <span className="font-mono text-sm font-medium text-slate-200 tabular-nums truncate">{addr}</span>
      <button
        onClick={copy}
        aria-label="Copy server address"
        title="Copy address"
        className={`rounded p-0.5 text-slate-600 transition hover:text-slate-400 shrink-0 ${
          hoverReveal ? "opacity-0 group-hover:opacity-100" : ""
        }`}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}
