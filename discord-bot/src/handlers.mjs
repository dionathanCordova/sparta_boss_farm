import { bossLine, fmtEta, fmtSpawnAt, parseDurationToMinutes } from "./format.mjs";
import { expandFixedSchedule } from "./fixed-schedule.mjs";

const EMBED_COLOR = 0xa3720f;
const SUCCESS_COLOR = 0x2f8f74;

// A fixed-schedule boss (e.g. Medusa) only stores its next occurrence, which
// would otherwise hide the fact it spawns again a few hours later — expand
// it so /proximos surfaces those too. 6 occurrences comfortably covers the
// 15-slot window even right after a pause (4h cadence = 24h of coverage).
const FIXED_SCHEDULE_LOOKAHEAD = 6;

export async function handleProximos(store, now) {
  const bosses = await store.getBosses();
  const expanded = bosses.flatMap((b) =>
    b.fixedSchedule ? expandFixedSchedule(b, FIXED_SCHEDULE_LOOKAHEAD) : [b]
  );
  const upcoming = expanded
    .filter((b) => new Date(b.spawnAt).getTime() - now.getTime() > 0)
    .sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime())
    .slice(0, 15);

  const description = upcoming.length
    ? upcoming.map((b) => bossLine(b, now)).join("\n")
    : "Nenhum boss com horário futuro definido ainda.";

  return { embeds: [{ title: "⏳ Próximos a nascer", description, color: EMBED_COLOR }] };
}

export async function handleBosses(store, server, now) {
  const bosses = (await store.getBosses())
    .filter((b) => b.server === server)
    .sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime());

  const description = bosses.length
    ? bosses.map((b) => bossLine(b, now)).join("\n")
    : "Nenhum boss cadastrado nesse server.";

  return { embeds: [{ title: `📋 Bosses — ${server}`, description, color: EMBED_COLOR }] };
}

export async function handleRespawnAutocomplete(store, server, typed) {
  const bosses = await store.getBosses();
  const pool = server ? bosses.filter((b) => b.server === server) : bosses;
  return pool
    .filter((b) => b.name.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 25)
    .map((b) => ({ name: `${b.name} (${b.server})`, value: b.id }));
}

export async function handleRespawn(store, { bossId, tempo, now }) {
  if (!bossId) {
    return { ephemeral: true, content: "Escolha um boss na lista de sugestões enquanto digita." };
  }

  const minutes = tempo ? parseDurationToMinutes(tempo) : null;
  if (minutes === null) {
    return { ephemeral: true, content: "Não entendi o tempo. Use algo como `3:11` (3h11) ou `45` (45 min)." };
  }

  const updated = await store.updateBoss(bossId, {
    spawnAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
    alertedSpawn: false,
    alertedWarn: false,
    alertedSpawnVoice: false,
    alertedWarnVoice: false,
  });

  if (!updated) {
    return { ephemeral: true, content: "Boss não encontrado — tente escolher de novo pela lista de sugestões." };
  }

  const ms = new Date(updated.spawnAt).getTime() - now.getTime();
  return {
    embeds: [
      {
        title: "✅ Respawn atualizado",
        description: `**${updated.name}** (${updated.server}) nasce ${fmtSpawnAt(
          new Date(updated.spawnAt),
          now
        )} — daqui a ${fmtEta(ms) ?? "menos de 1s"}.`,
        color: SUCCESS_COLOR,
      },
    ],
  };
}
