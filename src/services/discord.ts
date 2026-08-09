// ---- Obsidian Panel: Discord webhook with live status embeds ----

const DISCORD_TIMEOUT_MS = 5_000;

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

// ── Shared live stats store (WebSocket writes, Discord poller reads) ──

interface LiveStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  tps5s?: number;
  uptimeSeconds: number;
  startTime: number;
}

const liveStore = new Map<string, LiveStats>();

export function setLiveStats(serverId: string, stats: Partial<LiveStats>): void {
  const e = liveStore.get(serverId);
  if (e) Object.assign(e, stats);
  else liveStore.set(serverId, { cpuPercent: 0, memoryUsage: 0, memoryLimit: 0, uptimeSeconds: 0, startTime: Date.now(), ...stats });
}

export function getLiveStats(serverId: string): LiveStats {
  const s = liveStore.get(serverId);
  if (!s) return { cpuPercent: 0, memoryUsage: 0, memoryLimit: 0, uptimeSeconds: 0, startTime: Date.now() };
  s.uptimeSeconds = Math.floor((Date.now() - s.startTime) / 1000);
  return s;
}

export function initLiveStats(serverId: string, memoryLimit: number): void {
  liveStore.set(serverId, { cpuPercent: 0, memoryUsage: 0, memoryLimit, uptimeSeconds: 0, startTime: Date.now() });
}

export function clearLiveStats(serverId: string): void { liveStore.delete(serverId); }

// ── Discord API ──

export async function sendDiscordEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<string | null> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }), signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { id: string };
    return data.id ?? null;
  } catch { return null; }
}

export async function editDiscordEmbed(webhookUrl: string, messageId: string, embed: DiscordEmbed): Promise<boolean> {
  try {
    const res = await fetch(`${webhookUrl}/messages/${messageId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }), signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    return res.ok;
  } catch { return false; }
}

// ── Embed builders ──

export function buildStatusEmbed(
  name: string, serverType: string, version: string, port: number,
  status: "online" | "offline",
): DiscordEmbed {
  const stats = status === "online" ? getLiveStats(name) : undefined;

  if (status === "offline") {
    return {
      title: `🔴 ${name} is offline`, color: 0xf15bb5,
      fields: [
        { name: "Type", value: serverType, inline: true },
        { name: "Version", value: version, inline: true },
        { name: "Port", value: `${port}`, inline: true },
      ],
      footer: { text: "Server stopped" },
    };
  }

  const cpu = Math.min(100, stats?.cpuPercent ?? 0);
  const cpuEmoji = cpu >= 80 ? "🔴" : cpu >= 50 ? "🟡" : "🟢";
  const tps = stats?.tps5s?.toFixed(1) ?? "—";
  const tpsEmoji = (stats?.tps5s ?? 0) >= 19 ? "🟢" : (stats?.tps5s ?? 0) >= 15 ? "🟡" : "🔴";
  const ramU = stats ? fmtBytes(stats.memoryUsage) : "—";
  const ramT = stats ? fmtBytes(stats.memoryLimit) : "—";
  const ramP = stats && stats.memoryLimit > 0 ? ((stats.memoryUsage / stats.memoryLimit) * 100).toFixed(0) : "—";

  return {
    title: `🟢 ${name} is online`, color: 0x00f5d4,
    fields: [
      { name: "Address", value: `${port}`, inline: true },
      { name: "Version", value: `${serverType} ${version}`, inline: true },
      { name: "Uptime", value: fmtUptime(stats?.uptimeSeconds ?? 0), inline: true },
      { name: `${cpuEmoji} CPU`, value: `${cpu.toFixed(1)}%`, inline: true },
      { name: "RAM", value: `${ramU} / ${ramT} (${ramP}%)`, inline: true },
      { name: `${tpsEmoji} TPS`, value: `${tps}`, inline: true },
    ],
    footer: { text: "Live status · updates every 10s" },
    timestamp: new Date().toISOString(),
  };
}

// ── Live updater ──

const updaters = new Map<string, ReturnType<typeof setInterval>>();

export function startStatusEmbedUpdater(
  webhookUrl: string, messageId: string, serverId: string,
  name: string, serverType: string, version: string, port: number,
): void {
  stopStatusEmbedUpdater(serverId);
  const interval = setInterval(() => {
    const embed = buildStatusEmbed(name, serverType, version, port, "online");
    editDiscordEmbed(webhookUrl, messageId, embed);
  }, 10_000);
  updaters.set(serverId, interval);
}

export function stopStatusEmbedUpdater(serverId: string): void {
  const i = updaters.get(serverId);
  if (i) { clearInterval(i); updaters.delete(serverId); }
}

// ── Helpers ──

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}
