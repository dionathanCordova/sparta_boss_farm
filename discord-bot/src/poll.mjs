import { evaluateBoss, buildSpawnPhrase, buildWarnPhrase } from "./spawn-check.mjs";

/**
 * Fixed-schedule bosses (e.g. Medusa) spawn on all 3 servers at the exact
 * same time — group them so a shared spawn gets ONE announcement instead of
 * one per server. Regular bosses each get their own group.
 */
function groupByAlert(bosses) {
  const groups = new Map();
  for (const boss of bosses) {
    const key = boss.fixedSchedule ? `${boss.name}|${boss.spawnAt}` : `single|${boss.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(boss);
  }
  return [...groups.values()];
}

/**
 * Builds the 30s poll-loop body. Dependencies are injected so the loop can be
 * exercised without Redis or a Discord client.
 *
 * The returned function is re-entrancy guarded: a single triggered boss can
 * take well over the poll interval (up to 10s to connect + up to 30s of
 * playback), and a second, overlapping run would join the very connection the
 * first run is about to destroy in its `finally` block.
 */
export function createVoicePoller({
  store,
  speak,
  resolveGuildId,
  voiceChannelId,
  warnMinutes,
  logger = console,
}) {
  let polling = false;

  return async function pollForVoiceAlerts() {
    if (!voiceChannelId) return;
    if (polling) return;
    polling = true;

    try {
      const bosses = await store.getBosses();
      const now = Date.now();

      for (const group of groupByAlert(bosses)) {
        const rep = group[0];
        const { action, patch, minutesLeft } = evaluateBoss(rep, now, warnMinutes);
        // A patch with no action means "mark as handled, but stay silent"
        // (a spawn too far in the past to announce truthfully).
        if (!patch) continue;

        for (const b of group) {
          await store.updateBoss(b.id, patch);
        }
        if (!action) continue;

        const servers = group.map((b) => b.server);
        const phrase =
          action === "spawn"
            ? buildSpawnPhrase({ name: rep.name, servers })
            : buildWarnPhrase({ name: rep.name, servers }, minutesLeft);

        try {
          const guildId = await resolveGuildId();
          await speak({ channelId: voiceChannelId, guildId, text: phrase });
        } catch (err) {
          logger.error(`[voice] falha ao anunciar ${rep.name}:`, err);
        }
      }
    } finally {
      polling = false;
    }
  };
}
