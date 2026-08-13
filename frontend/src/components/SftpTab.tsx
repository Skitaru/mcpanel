"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Lock, Network, Server } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Props {
  serverName: string;
}

/** SFTP access card for one server — login as "<user>.<server>" lands directly
 *  in this server's folder. */
export default function SftpTab({ serverName }: Props) {
  const [port, setPort] = useState<number | null>(null);
  const [baseUser, setBaseUser] = useState<string>("admin");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/sftp/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.port) setPort(d.port);
        if (d?.username) setBaseUser(d.username);
      })
      .catch(() => {});
  }, []);

  const host = typeof window !== "undefined" ? window.location.hostname : "—";
  const sftpUser = `${baseUser}.${serverName.replace(/\s+/g, "_")}`;
  const address = port ? `sftp://${sftpUser}@${host}:${port}` : null;

  const copy = useCallback((label: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const Row = ({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[12px] text-slate-200">{value}</span>
        <button
          onClick={() => copy(copyLabel, value)}
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          className="shrink-0 rounded p-0.5 text-slate-600 transition hover:text-slate-400"
        >
          {copied === copyLabel ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-edge bg-surface">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <Network className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-slate-200">SFTP-Zugang</h3>
          <span className="ml-auto rounded-full border border-online/30 bg-online/10 px-2 py-0.5 text-[10px] font-semibold text-online">
            {serverName}
          </span>
        </div>

        <div className="px-4 py-3">
          {address ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-edge bg-void px-3 py-2">
              <span className="truncate font-mono text-[12.5px] text-slate-300">{address}</span>
              <button
                onClick={() => copy("address", address)}
                aria-label="Copy SFTP address"
                title="Copy address"
                className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-accent-strong"
              >
                {copied === "address" ? "Kopiert ✓" : "Kopieren"}
              </button>
            </div>
          ) : (
            <div className="mb-3 h-9 animate-pulse rounded-lg border border-edge bg-void" />
          )}

          <div className="divide-y divide-edge">
            <Row label="Host" value={host} copyLabel="host" />
            <Row label="Port" value={port ? String(port) : "…"} copyLabel="port" />
            <Row label="Benutzer" value={sftpUser} copyLabel="user" />
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-edge bg-void px-3 py-2">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            <p className="text-[11px] leading-relaxed text-slate-400">
              <span className="font-medium text-slate-300">Passwort:</span> dein Panel-Login-Passwort
              (der Benutzername <code className="font-mono text-warn">{sftpUser}</code> pinnt dich direkt in den
              Ordner von <span className="font-medium text-slate-300">{serverName}</span>).
            </p>
          </div>

          <div className="mt-2 flex items-start gap-2 rounded-lg border border-edge bg-void px-3 py-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Hinweis: Der normale Benutzername <code className="font-mono">{baseUser}</code> zeigt alle Server
              (Root-Ansicht). Über den Server-Suffix siehst du nur diesen Server. Empfohlene Clients: FileZilla,
              WinSCP oder <code className="font-mono">sftp</code> in der Konsole.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
            <Server className="h-4 w-4 shrink-0 text-accent" />
            <div className="text-[11px] leading-relaxed text-slate-300">
              <span className="font-semibold">Kommandozeile:</span>{" "}
              <code className="rounded bg-void px-1.5 py-0.5 font-mono text-[10.5px] text-purple-200">
                sftp {sftpUser}@{host} -P {port ?? 2222}
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
