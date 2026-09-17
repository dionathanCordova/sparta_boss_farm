const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

// The site and the text webhook (lib/discord.ts) both render times in
// America/Sao_Paulo. The bot must match, so it cannot use the host-local
// getHours()/getMinutes() — Railway runs in UTC.
const SP_TIME_ZONE = "America/Sao_Paulo";

const spTime = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: SP_TIME_ZONE,
});

// en-CA renders an ISO-like YYYY-MM-DD, so São Paulo calendar days compare
// as plain strings.
const spDate = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: SP_TIME_ZONE,
});

export function fmtSpawnAt(d, today) {
  const sameDay = spDate.format(d) === spDate.format(today);
  const dayLabel = sameDay ? "hoje" : "amanhã";
  return `${dayLabel} ${spTime.format(d)}`;
}

export function fmtEta(ms) {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function statusFor(ms) {
  if (ms <= 0) return { cls: "safe", label: "disponível" };
  if (ms <= 60 * 60 * 1000) return { cls: "urgent", label: "em breve" };
  if (ms <= 3 * 60 * 60 * 1000) return { cls: "soon", label: "aproximando" };
  return { cls: "safe", label: "programado" };
}

export function parseDurationToMinutes(input) {
  const str = input.trim().replace(",", ".");
  if (!str) return null;

  const withColon = str.match(/^(\d{1,3})\s*[:h]\s*(\d{1,2})?$/i);
  if (withColon) {
    const h = parseInt(withColon[1], 10);
    const min = withColon[2] ? parseInt(withColon[2], 10) : 0;
    if (min > 59) return null;
    return h * 60 + min;
  }

  const bareNumber = str.match(/^(\d{1,4})$/);
  if (bareNumber) {
    return parseInt(bareNumber[1], 10);
  }

  return null;
}

export function bossLine(boss, now) {
  const spawnMs = new Date(boss.spawnAt).getTime() - now.getTime();
  const eta = fmtEta(spawnMs) ?? "disponível agora";
  const at = fmtSpawnAt(new Date(boss.spawnAt), now);
  const st = statusFor(spawnMs);
  const emoji = st.cls === "urgent" ? "🔴" : st.cls === "soon" ? "🟡" : "🟢";
  return `${emoji} **${boss.name}** (${boss.server}) — ${eta} (${at})`;
}
