export function isDiscordConfigured(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL);
}

type AlertKind = "spawn" | "warn";

export async function sendDiscordAlert(params: {
  kind: AlertKind;
  bossName: string;
  servers: string[];
  spawnAt: string; // ISO datetime
  minutesLeft?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    return { ok: false, error: "DISCORD_WEBHOOK_URL não configurada" };
  }

  const spawnDate = new Date(params.spawnAt);
  const timeLabel = spawnDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const title =
    params.kind === "spawn"
      ? `🟢 ${params.bossName} nasceu!`
      : `⏳ ${params.bossName} nasce em ${params.minutesLeft} min`;

  const serverLabel = params.servers.length > 1 ? "Servers" : "Server";
  const description = `**${serverLabel}:** ${params.servers.join(", ")}\n**Horário:** ${timeLabel}`;
  const color = params.kind === "spawn" ? 0x2f8f74 : 0xb8860b;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{ title, description, color }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Discord respondeu ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
