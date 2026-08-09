// ---- Obsidian Panel: Discord webhook sender ----

const DISCORD_TIMEOUT_MS = 5_000;

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  timestamp: string;
}

export async function sendDiscordNotification(
  webhookUrl: string,
  embed: DiscordEmbed,
): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[discord] Webhook failed: ${res.status}`);
    }
  } catch (err) {
    console.error("[discord] Webhook error:", err);
  }
}

export function buildServerEmbed(
  name: string,
  serverType: string,
  version: string,
  port: number,
  status: "started" | "stopped" | "crashed",
): DiscordEmbed {
  const statusConfig = {
    started: {
      title: `🟢 ${name} is now online`,
      color: 0x00f5d4, // cyan
    },
    stopped: {
      title: `🔴 ${name} has been stopped`,
      color: 0xf15bb5, // pink
    },
    crashed: {
      title: `⚠️ ${name} has crashed`,
      color: 0xfee440, // yellow
    },
  };

  const cfg = statusConfig[status];

  return {
    title: cfg.title,
    description: `Server \`${name}\` changed status`,
    color: cfg.color,
    fields: [
      { name: "Type", value: serverType, inline: true },
      { name: "Version", value: version, inline: true },
      { name: "Port", value: `${port}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}
