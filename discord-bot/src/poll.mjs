import { evaluateBoss } from "./spawn-check.mjs";

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

      for (const boss of bosses) {
        const { action, phrase, patch } = evaluateBoss(boss, now, warnMinutes);
        // A patch with no action means "mark as handled, but stay silent"
        // (a spawn too far in the past to announce truthfully).
        if (!patch) continue;

        await store.updateBoss(boss.id, patch);
        if (!action) continue;

        try {
          const guildId = await resolveGuildId();
          await speak({ channelId: voiceChannelId, guildId, text: phrase });
        } catch (err) {
          logger.error(`[voice] falha ao anunciar ${boss.name}:`, err);
        }
      }
    } finally {
      polling = false;
    }
  };
}
