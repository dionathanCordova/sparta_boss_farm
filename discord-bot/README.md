# boss-farm-discord-bot

Standalone, always-on Discord bot for boss-farm-tracker. Handles the
`/proximos`, `/bosses`, `/respawn` slash commands and speaks boss
warn/spawn announcements in a fixed voice channel. Runs as its own
process on Railway — it cannot run on Vercel (see
`../docs/superpowers/specs/2026-09-17-discord-voice-bot-design.md` for why).

## Setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications),
   reuse the same application as the site's webhook bot (or create one).
   Under **Bot**, enable the **GuildVoiceStates** intent (in addition to
   Guilds, which is always on) and grant the **Connect** + **Speak**
   permissions.
2. Copy `.env.example` to `.env.local` and fill in:
   - `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID` — from the Bot / General
     Information tabs.
   - `DISCORD_GUILD_ID` — your test server's ID, for instant command
     propagation while testing (omit in production for global commands).
   - `DISCORD_VOICE_CHANNEL_ID` — right-click the voice channel → Copy
     Channel ID (enable Developer Mode in Discord settings first).
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — same values as
     the Vercel project's environment variables.
3. `npm install`
4. `npm run register:commands` — registers the 3 slash commands.
5. `npm start` — logs in and starts polling for spawn/warn events.

## Deploy to Railway

1. Create a new Railway project from this GitHub repo.
2. Set the service's **root directory** to `discord-bot`.
3. Set the start command to `npm start` (Railway auto-detects this from
   `package.json` if left blank).
4. Add the same environment variables listed above in the Railway service's
   Variables tab.
5. Deploy. Check the deploy logs for `Bot online como <tag>`.
