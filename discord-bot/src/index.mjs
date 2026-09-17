import "dotenv/config";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { createRedisStore } from "./store.mjs";
import { handleProximos, handleBosses, handleRespawnAutocomplete, handleRespawn } from "./handlers.mjs";
import { evaluateBoss } from "./spawn-check.mjs";
import { speakInChannel } from "./voice.mjs";

const WARN_MINUTES = Number(process.env.DISCORD_WARN_MINUTES ?? 10);
const VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const POLL_MS = 30_000;

const store = createRedisStore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.on(Events.InteractionCreate, async (interaction) => {
  const now = new Date();

  if (interaction.isAutocomplete()) {
    const server = interaction.options.getString("server") ?? undefined;
    const typed = interaction.options.getFocused();
    const choices = await handleRespawnAutocomplete(store, server, typed);
    await interaction.respond(choices);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "proximos") {
    await interaction.reply(await handleProximos(store, now));
    return;
  }

  if (interaction.commandName === "bosses") {
    const server = interaction.options.getString("server", true);
    await interaction.reply(await handleBosses(store, server, now));
    return;
  }

  if (interaction.commandName === "respawn") {
    const bossId = interaction.options.getString("boss", true);
    const tempo = interaction.options.getString("tempo", true);
    const res = await handleRespawn(store, { bossId, tempo, now });
    await interaction.reply(res.ephemeral ? { content: res.content, flags: 64 } : res);
  }
});

async function pollForVoiceAlerts() {
  if (!VOICE_CHANNEL_ID || !GUILD_ID) return;
  const bosses = await store.getBosses();
  const now = Date.now();

  for (const boss of bosses) {
    const { action, phrase, patch } = evaluateBoss(boss, now, WARN_MINUTES);
    if (!action) continue;

    await store.updateBoss(boss.id, patch);
    try {
      await speakInChannel({ client, channelId: VOICE_CHANNEL_ID, guildId: GUILD_ID, text: phrase });
    } catch (err) {
      console.error(`[voice] falha ao anunciar ${boss.name}:`, err);
    }
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Bot online como ${c.user.tag}`);
  setInterval(() => {
    pollForVoiceAlerts().catch((err) => console.error("[poll] erro:", err));
  }, POLL_MS);
});

client.login(process.env.DISCORD_BOT_TOKEN);
