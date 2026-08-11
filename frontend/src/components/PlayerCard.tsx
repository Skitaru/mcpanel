"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import toast from "react-hot-toast";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Player {
  name: string;
  id: string;
}

interface Props {
  serverId: string;
  isOnline: boolean;
  playerCount: { online: number; max: number };
  playerList: Player[];
}

/** Player management: online players with OP/Kick/Ban + whitelist via RCON. */
export default function PlayerCard({ serverId, isOnline, playerCount, playerList }: Props) {
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [wlLoading, setWlLoading] = useState(false);
  const [newPlayer, setNewPlayer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const rcon = useCallback(async (command: string, label: string) => {
    setBusy(label);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = (data.response ?? "").trim();
      if (reply) toast.success(reply.length > 120 ? reply.slice(0, 120) + "…" : reply);
      return reply;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Command failed");
      return "";
    } finally {
      setBusy(null);
    }
  }, [serverId]);

  const loadWhitelist = useCallback(async () => {
    if (!isOnline) { setWhitelist([]); return; }
    setWlLoading(true);
    const reply = await rcon("whitelist list", "wl");
    // "There are 2 whitelisted players: Steve, Alex" (or "none")
    const match = reply.match(/:\s*(.*)$/);
    const names = (match?.[1] ?? "")
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    setWhitelist(names);
    setWlLoading(false);
  }, [isOnline, rcon]);

  useEffect(() => {
    loadWhitelist();
  }, [loadWhitelist, isOnline, serverId]);

  const addWhitelist = useCallback(async () => {
    const name = newPlayer.trim();
    if (!name) return;
    setNewPlayer("");
    await rcon(`whitelist add ${name}`, "wla");
    loadWhitelist();
  }, [newPlayer, rcon, loadWhitelist]);

  const removeWhitelist = useCallback(async (name: string) => {
    await rcon(`whitelist remove ${name}`, "wlr");
    loadWhitelist();
  }, [rcon, loadWhitelist]);

  const act = useCallback((name: string, action: "op" | "deop" | "kick" | "ban") => {
    const cmd = action === "op" ? `op ${name}` : action === "deop" ? `deop ${name}` : action === "kick" ? `kick ${name}` : `ban ${name}`;
    rcon(cmd, `${action}:${name}`);
  }, [rcon]);

  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        Spieler {isOnline ? `· ${playerCount.online}/${playerCount.max}` : ""}
      </h4>

      {isOnline && playerList.length > 0 && (
        <>
          {playerList.slice(0, 8).map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1 text-xs text-slate-300">
              <img src={`https://mc-heads.net/avatar/${p.id}/20`} alt="" className="h-5 w-5 rounded-full border border-edge" loading="lazy" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => act(p.name, "op")} disabled={busy !== null}
                  className="rounded border border-edge bg-void px-1.5 py-0.5 text-[9px] text-warn transition hover:border-warn/40 disabled:opacity-40" title="Op" aria-label={`Op ${p.name}`}>OP</button>
                <button onClick={() => act(p.name, "kick")} disabled={busy !== null}
                  className="rounded border border-edge bg-void px-1.5 py-0.5 text-[9px] text-online transition hover:border-online/40 disabled:opacity-40" title="Kick" aria-label={`Kick ${p.name}`}>Kick</button>
                <button onClick={() => act(p.name, "ban")} disabled={busy !== null}
                  className="rounded border border-edge bg-void px-1.5 py-0.5 text-[9px] text-danger transition hover:border-danger/40 disabled:opacity-40" title="Ban" aria-label={`Ban ${p.name}`}>Ban</button>
              </div>
            </div>
          ))}
          {playerList.length > 8 && <p className="mt-1 text-[10px] text-muted">+ {playerList.length - 8} weitere…</p>}
        </>
      )}
      {isOnline && playerList.length === 0 && <p className="text-xs text-muted">Keine Spieler online</p>}
      {!isOnline && <p className="text-xs text-muted">—</p>}

      {/* Whitelist */}
      <div className="mt-3 border-t border-edge pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Whitelist</span>
          {wlLoading && <Loader2 className="h-3 w-3 animate-spin text-slate-600" />}
        </div>
        {whitelist.length > 0 ? (
          whitelist.map((name) => (
            <div key={name} className="flex items-center justify-between py-0.5 text-[11px] text-slate-400">
              <span className="truncate">{name}</span>
              <button onClick={() => removeWhitelist(name)} disabled={busy !== null}
                className="rounded px-1 text-muted transition hover:text-danger disabled:opacity-40" title="Von Whitelist entfernen" aria-label={`Remove ${name} from whitelist`}>✕</button>
            </div>
          ))
        ) : (
          <p className="text-[10px] text-muted">Leer</p>
        )}
        {isOnline && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              type="text"
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addWhitelist(); }}
              placeholder="Spieler hinzufügen…"
              aria-label="Spieler zur Whitelist hinzufügen"
              className="min-w-0 flex-1 rounded-md border border-edge bg-void px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-accent/40 focus:outline-none"
            />
            <button onClick={addWhitelist} disabled={!newPlayer.trim() || busy !== null}
              className="rounded-md bg-accent px-2 py-1 text-[11px] text-white transition hover:bg-accent-strong disabled:opacity-50" aria-label="Hinzufügen">
              <Plus className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
