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

// ── Send / Edit helpers ──

async function fetchDiscord(url: string, options: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendDiscordEmbed(webhookUrl: string, embed: DiscordEmbed): Promise<string | null> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { id: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

export async function editDiscordEmbed(
  webhookUrl: string, messageId: string, embed: DiscordEmbed,
): Promise<boolean> {
  // Discord webhook edit: PATCH /webhooks/{id}/{token}/messages/{messageId}
  const url = `${webhookUrl}/messages/${messageId}`;
  return fetchDiscord(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

// ── Status embed manager ──

interface LiveStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  tps5s?: number;
  players?: { online: number; max: number };
  uptimeSeconds: number;
}

const liveIntervals = new Map<string, ReturnType<typeof setInterval>>();

export function buildStatusEmbed(
  name: string, serverType: string, version: string, port: number,
  status: "online" | "offline",
  stats?: LiveStats,
): DiscordEmbed {
  if (status === "offline") {
    return {
      title: `🔴 ${name} is offline`,
      color: 0xf15bb5,
      fields: [
        { name: "Type", value: serverType, inline: true },
        { name: "Version", value: version, inline: true },
        { name: "Port", value: `${port}`, inline: true },
      ],
      footer: { text: "Server stopped" },
    };
  }

  // Online embed with live data
  const cpu = Math.min(100, stats?.cpuPercent ?? 0);
  const cpuEmoji = cpu >= 80 ? "🔴" : cpu >= 50 ? "🟡" : "🟢";
  const tpsVal = stats?.tps5s?.toFixed(1) ?? "—";
  const tpsEmoji = (stats?.tps5s ?? 0) >= 19 ? "🟢" : (stats?.tps5s ?? 0) >= 15 ? "🟡" : "🔴";
  const ramUsed = stats ? formatBytes(stats.memoryUsage) : "—";
  const ramTotal = stats ? formatBytes(stats.memoryLimit) : "—";
  const ramPct = stats && stats.memoryLimit > 0
    ? ((stats.memoryUsage / stats.memoryLimit) * 100).toFixed(0) : "—";
  const uptime = formatUptime(stats?.uptimeSeconds ?? 0);

  return {
    title: `🟢 ${name} is online`,
    color: 0x00f5d4,
    fields: [
      { name: "Address", value: `${port}`, inline: true },
      { name: "Version", value: `${serverType} ${version}`, inline: true },
      { name: "Uptime", value: uptime, inline: true },
      { name: `${cpuEmoji} CPU`, value: `${cpu.toFixed(1)}%`, inline: true },
      { name: "RAM", value: `${ramUsed} / ${ramTotal} (${ramPct}%)`, inline: true },
      { name: `${tpsEmoji} TPS`, value: `${tpsVal}`, inline: true },
    ],
    footer: { text: stats?.players ? `${stats.players.online}/${stats.players.max} players online` : "Live status" },
    timestamp: new Date().toISOString(),
  };
}

export function startStatusEmbedUpdater(
  webhookUrl: string,
  messageId: string,
  serverId: string,
  name: string, serverType: string, version: string, port: number,
  getStats: () => LiveStats,
): void {
  // Clear existing interval if any
  stopStatusEmbedUpdater(serverId);

  const interval = setInterval(() => {
    const stats = getStats();
    const embed = buildStatusEmbed(name, serverType, version, port, "online", stats);
    editDiscordEmbed(webhookUrl, messageId, embed);
  }, 10_000);

  liveIntervals.set(serverId, interval);
}

export function stopStatusEmbedUpdater(serverId: string): void {
  const interval = liveIntervals.get(serverId);
  if (interval) {
    clearInterval(interval);
    liveIntervals.delete(serverId);
  }
}

export function stopAllStatusEmbedUpdaters(): void {
  for (const interval of liveIntervals.values()) clearInterval(interval);
  liveIntervals.clear();
}

// ── One-shot notifications ──

export function buildEventEmbed(
  name: string, serverType: string, version: string, port: number,
  status: "started" | "stopped" | "crashed",
): DiscordEmbed {
  const cfg = {
    started: { title: `🟢 ${name} is now online`, color: 0x00f5d4 },
    stopped: { title: `🔴 ${name} has been stopped`, color: 0xf15bb5 },
    crashed: { title: `⚠️ ${name} has crashed`, color: 0xfee440 },
  }[status];

  return {
    title: cfg.title,
    color: cfg.color,
    fields: [
      { name: "Type", value: serverType, inline: true },
      { name: "Version", value: version, inline: true },
      { name: "Port", value: `${port}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
