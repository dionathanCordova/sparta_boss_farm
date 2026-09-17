import { config } from "dotenv";
config({ path: ".env.local" });
import { Client, GatewayIntentBits, Events } from "discord.js";
import { createRedisStore } from "./store.mjs";
import { handleProximos, handleBosses, handleRespawnAutocomplete, handleRespawn } from "./handlers.mjs";
import { createVoicePoller } from "./poll.mjs";
import { speakInChannel } from "./voice.mjs";

const WARN_MINUTES = Number(process.env.DISCORD_WARN_MINUTES ?? 10);
const VOICE_CHANNEL_ID = process.env.DISCORD_VOICE_CHANNEL_ID;
const POLL_MS = 30_000;

// A rejected promise nobody awaits (a transient Upstash blip, a voice socket
// giving up late) must not take the whole process — and with it the poll
// loop — down. Log it and keep running.
process.on("unhandledRejection", (err) => console.error("[unhandled]", err));

const store = createRedisStore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.on(Events.InteractionCreate, async (interaction) => {
  const now = new Date();

  try {
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
  } catch (err) {
    // discord.js does not catch a rejected async listener, so without this a
    // single failed command would crash the process (and the poll loop).
    console.error("[interaction] erro:", err);
    if (interaction.isAutocomplete()) return;
    if (interaction.replied || interaction.deferred) return;
    try {
      await interaction.reply({ content: "Ocorreu um erro, tente de novo.", flags: 64 });
    } catch (replyErr) {
      console.error("[interaction] falha ao responder com erro:", replyErr);
    }
  }
});

// The voice channel's own guild — resolved from the channel rather than from
// DISCORD_GUILD_ID, which production deploys are told to omit (it only scopes
// command registration). Cached after the first successful fetch.
let voiceGuildId = null;

async function resolveVoiceGuildId() {
  if (voiceGuildId) return voiceGuildId;
  const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
  if (!channel?.guildId) {
    throw new Error(`Canal de voz ${VOICE_CHANNEL_ID} não encontrado ou não pertence a um servidor`);
  }
  voiceGuildId = channel.guildId;
  return voiceGuildId;
}

const pollForVoiceAlerts = createVoicePoller({
  store,
  speak: ({ channelId, guildId, text }) => speakInChannel({ client, channelId, guildId, text }),
  resolveGuildId: resolveVoiceGuildId,
  voiceChannelId: VOICE_CHANNEL_ID,
  warnMinutes: WARN_MINUTES,
});

client.once(Events.ClientReady, (c) => {
  console.log(`Bot online como ${c.user.tag}`);
  if (!VOICE_CHANNEL_ID) {
    console.error(
      "[voice] DISCORD_VOICE_CHANNEL_ID não configurada — os anúncios de voz estão DESLIGADOS."
    );
  }
  setInterval(() => {
    pollForVoiceAlerts().catch((err) => console.error("[poll] erro:", err));
  }, POLL_MS);
});

client.login(process.env.DISCORD_BOT_TOKEN);
