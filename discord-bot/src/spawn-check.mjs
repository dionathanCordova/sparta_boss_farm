// "Server 1" / "Server 1 e Server 2" / "Server 1, Server 2 e Server 3"
function formatServers(servers) {
  if (servers.length <= 1) return servers[0] ?? "";
  return `${servers.slice(0, -1).join(", ")} e ${servers[servers.length - 1]}`;
}

// boss.servers (plural, for a boss spawning on several servers at once — see
// evaluateGroup) takes priority; falls back to the single boss.server field.
export function buildWarnPhrase(boss, minutesLeft) {
  const where = formatServers(boss.servers ?? [boss.server]);
  return `Falahh Galeraaa... ${boss.name} nasce em ${minutesLeft} minutos no ${where}.`;
}

export function buildSpawnPhrase(boss) {
  const where = formatServers(boss.servers ?? [boss.server]);
  return `Falahh Galeraaa... ${boss.name} nasceu agora no ${where}!`;
}

// How long after a spawn we're still willing to say "nasceu agora". Past
// this, the announcement would be a lie — on first deploy or after downtime
// every long-past boss would otherwise be announced as spawning right now.
export const MAX_STALENESS_MS = 5 * 60_000;

// Mirrors app/api/cron/check's text-alert logic, but reads/writes the
// *Voice flag pair so it never collides with the text alert's flags.
export function evaluateBoss(boss, nowMs, warnMinutes) {
  const spawnMs = new Date(boss.spawnAt).getTime();
  const msLeft = spawnMs - nowMs;

  if (msLeft <= 0 && !boss.alertedSpawnVoice) {
    // Too old to announce: mark it handled anyway, so the poll loop stops
    // re-evaluating it every 30s, but stay silent.
    if (msLeft <= -MAX_STALENESS_MS) {
      return { action: null, phrase: null, patch: { alertedSpawnVoice: true } };
    }
    return { action: "spawn", phrase: buildSpawnPhrase(boss), patch: { alertedSpawnVoice: true } };
  }

  if (msLeft > 0 && msLeft <= warnMinutes * 60_000 && !boss.alertedWarnVoice) {
    const minutesLeft = Math.max(1, Math.ceil(msLeft / 60_000));
    return {
      action: "warn",
      phrase: buildWarnPhrase(boss, minutesLeft),
      patch: { alertedWarnVoice: true },
      minutesLeft,
    };
  }

  return { action: null, phrase: null, patch: null };
}
