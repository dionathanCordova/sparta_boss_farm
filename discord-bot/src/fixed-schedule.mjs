// Mirrors nextMedusaSpawn() in ../../lib/bosses.ts. Duplicated here because
// the bot is a plain-JS package deployed standalone (Railway) and doesn't
// build/import the Next app's TypeScript.
const MEDUSA_HOURS = [10, 14, 18, 22, 0];
const MEDUSA_TZ_OFFSET_MIN = -180; // -03:00

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Next Medusa spawn (4h cadence, paused 00:00–10:00) strictly after `afterMs`. */
export function nextMedusaSpawn(afterMs) {
  const shifted = new Date(afterMs + MEDUSA_TZ_OFFSET_MIN * 60_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();

  const candidates = [];
  for (const dayOffset of [0, 1]) {
    const base = new Date(Date.UTC(y, m - 1, d + dayOffset));
    const by = base.getUTCFullYear();
    const bm = base.getUTCMonth() + 1;
    const bd = base.getUTCDate();
    for (const h of MEDUSA_HOURS) {
      candidates.push(new Date(`${by}-${pad(bm)}-${pad(bd)}T${pad(h)}:00:00-03:00`));
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates.find((c) => c.getTime() > afterMs) ?? candidates[candidates.length - 1];
}

/**
 * Fixed-schedule bosses only ever have ONE stored spawnAt (their next
 * occurrence) — unlike a normal recurring listing, that hides the fact
 * they'll spawn again a few hours later. Expand a boss into its next
 * `count` occurrences so lists like /proximos surface those too.
 */
export function expandFixedSchedule(boss, count) {
  const occurrences = [{ ...boss }];
  let cursor = new Date(boss.spawnAt).getTime();
  for (let i = 1; i < count; i++) {
    const next = nextMedusaSpawn(cursor);
    occurrences.push({ ...boss, spawnAt: next.toISOString() });
    cursor = next.getTime();
  }
  return occurrences;
}
