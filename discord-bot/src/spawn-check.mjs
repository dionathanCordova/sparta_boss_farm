export function buildWarnPhrase(boss, minutesLeft) {
  return `Atenção! ${boss.name} nasce em ${minutesLeft} minutos no ${boss.server}.`;
}

export function buildSpawnPhrase(boss) {
  return `${boss.name} nasceu agora no ${boss.server}!`;
}

// Mirrors app/api/cron/check's text-alert logic, but reads/writes the
// *Voice flag pair so it never collides with the text alert's flags.
export function evaluateBoss(boss, nowMs, warnMinutes) {
  const spawnMs = new Date(boss.spawnAt).getTime();
  const msLeft = spawnMs - nowMs;

  if (msLeft <= 0 && !boss.alertedSpawnVoice) {
    return { action: "spawn", phrase: buildSpawnPhrase(boss), patch: { alertedSpawnVoice: true } };
  }

  if (msLeft > 0 && msLeft <= warnMinutes * 60_000 && !boss.alertedWarnVoice) {
    const minutesLeft = Math.max(1, Math.ceil(msLeft / 60_000));
    return { action: "warn", phrase: buildWarnPhrase(boss, minutesLeft), patch: { alertedWarnVoice: true } };
  }

  return { action: null, phrase: null, patch: null };
}
