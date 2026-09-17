import { config } from "dotenv";
config({ path: ".env.local" });

import { COMMANDS } from "../src/commands.mjs";

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !token) {
  console.error("Defina DISCORD_APPLICATION_ID e DISCORD_BOT_TOKEN no .env.local antes de rodar este script.");
  process.exit(1);
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
  console.error(`Falhou (HTTP ${res.status}):`, await res.text());
  process.exit(1);
}

const data = await res.json();
console.log(
  `✅ ${data.length} comando(s) registrado(s) ${
    guildId ? `no server ${guildId} (aparece na hora)` : "globalmente (pode levar até 1h pra aparecer em todo lugar)"
  }.`
);
for (const cmd of data) console.log(`   /${cmd.name} — ${cmd.description}`);
