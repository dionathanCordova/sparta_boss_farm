# Discord bot: slash commands + voice-channel spawn announcements

Status: approved, moving to implementation plan.

## Context

The project already has a passive Discord alert: `app/api/cron/check` polls
boss spawn times and posts embeds to a Discord webhook (`lib/discord.ts`).
`BOT_DISCORD.MD` documents (but this repo does not yet implement) a second,
interactive layer: a slash-command bot (`/proximos`, `/bosses`, `/respawn`)
built on Discord's HTTP Interactions model, chosen there specifically because
the app runs on Vercel (serverless, no persistent process).

New requirement: the bot must also **join a voice channel and speak (TTS)**
when a boss is about to spawn / has spawned. This cannot run on Vercel:
serverless functions have a hard max execution duration (Hobby 60s, Pro 300s,
Enterprise 900s) and are killed at that ceiling regardless of what they're
doing; a voice bot needs an indefinitely-open Gateway WebSocket plus a live
voice UDP stream, which no serverless tier can hold open. This is a
structural mismatch (scale-to-zero request/response vs. always-on server),
not a config problem — it's why no discord.js Gateway bot runs on Vercel.

Decision: add a second always-on runtime on Railway (free/cheap tier,
git-push deploy, ffmpeg works with no extra setup). Since a persistent
process now exists anyway, it also absorbs the slash-command bot — one
discord.js Client does both jobs, replacing the raw HTTP-Interactions +
Ed25519-verification approach from BOT_DISCORD.MD entirely.

## Architecture

Two runtimes, split by shape of workload:

- **Vercel** (unchanged): web UI, REST API, `app/api/cron/check` webhook text
  alerts. Nothing here changes.
- **Railway** (new): one Node process, one `discord.js` Client:
  1. Slash commands `/proximos`, `/bosses`, `/respawn` — handled natively via
     `interactionCreate` (Gateway connection replaces HTTP Interactions).
  2. Internal poll loop (every 30s) reads bosses from the same Upstash Redis
     the Vercel app already uses, checks warn/spawn thresholds, and on
     trigger: builds a pt-BR phrase → Google TTS → joins the fixed voice
     channel via `@discordjs/voice` → plays → disconnects.

Both runtimes read/write the same Upstash Redis dataset (`boss-farm:bosses:v1`)
via the same REST API, so there is one source of truth for boss state.

## Data model

`Boss` gains two fields, mirroring the existing `alertedSpawn`/`alertedWarn`:

```ts
alertedWarnVoice?: boolean;
alertedSpawnVoice?: boolean;
```

These are tracked separately from the text-alert flags so the two mechanisms
(Vercel text webhook, Railway voice) trigger independently: whichever fires
first does not suppress the other. Note this is a *semantic* separation only —
see "Known accepted risk" below for why it does not make the two writers
safe against each other. Both flag-pairs (text + voice) are cleared together
whenever `spawnAt` is reset — in the site's existing "definir respawn" flow
(`updateBoss` call in `app/api/bosses`) and in the new bot's own `/respawn`
command.

## Repo layout

New `discord-bot/` folder at repo root, own `package.json`, deployed on
Railway pointing at that subdirectory (same git repo, no separate repo to
manage):

- `discord-bot/src/index.mjs` — client boot, `interactionCreate` handler,
  30s poll loop for warn/spawn checks
- `discord-bot/src/commands.mjs` — the 3 slash-command definitions (adapted
  from `lib/discord-commands.mjs` in BOT_DISCORD.MD)
- `discord-bot/src/store.mjs` — trimmed, Redis-only copy of `lib/store.ts`
  (no local-file fallback — Railway always has env vars configured)
- `discord-bot/src/format.mjs` — trimmed copy of the date/format helpers
  needed (`fmtEta`, `fmtSpawnAt`, `parseDurationToMinutes`, `statusFor`)
- `discord-bot/src/voice.mjs` — `speakInChannel(channelId, text)` helper:
  joins, plays TTS audio, disconnects
- `discord-bot/scripts/register-commands.mjs` — one-off command registration
  (same pattern as BOT_DISCORD.MD's script)
- `discord-bot/.env.example`

This duplicates a small slice of logic (the `Boss` type, a handful of date
helpers — under ~80 lines total) rather than extracting a shared npm
workspace package. The slice is small and changes rarely; a workspace/package
boundary would add tooling overhead this project doesn't otherwise have.

## Voice announcement flow

1. Poll loop wakes every 30s, calls `getBosses()`.
2. For each boss: if `now >= spawnAt` and `!alertedSpawnVoice` → speak spawn
   line, set `alertedSpawnVoice = true`.
3. Else if `spawnAt - now <= WARN_MINUTES` and `!alertedWarnVoice` → speak
   warn line, set `alertedWarnVoice = true`.
4. Phrases (pt-BR):
   - Warn: `Atenção! {boss} nasce em {N} minutos no {server}.`
   - Spawn: `{boss} nasceu agora no {server}!`
5. `speakInChannel`: join `DISCORD_VOICE_CHANNEL_ID` via `@discordjs/voice`,
   fetch TTS audio for the phrase (`google-tts-api`, `lang=pt-BR`), play it,
   disconnect once playback ends. The bot only joins to speak — it does not
   stay connected between announcements.

## Slash commands

Same three commands and behavior described in BOT_DISCORD.MD
(`/proximos`, `/bosses server:`, `/respawn server: boss: tempo:`), reimplemented
against discord.js's `interactionCreate` event instead of a raw HTTP route —
no Ed25519 signature verification needed, discord.js's Gateway connection is
already authenticated. `/respawn` clears both the text and voice alert flags
when it sets a new `spawnAt`.

## Environment variables (Railway service)

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID` (optional — registers commands to one guild instantly
  while testing; omit for global registration)
- `DISCORD_VOICE_CHANNEL_ID` — the fixed voice channel the bot joins to speak
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — same Upstash
  project the Vercel app already uses

The bot's Discord application needs the `bot` + `applications.commands`
OAuth scopes and the `Connect` + `Speak` permissions, plus the
`GuildVoiceStates` gateway intent (in addition to `Guilds`).

## Known accepted risk

The separate `*Voice` flags prevent a **semantic** collision: the two
mechanisms can never disagree about whether a given event was already
announced, because each reads and writes only its own boolean. They do
**not** prevent a **write** collision. Both runtimes still do read-all /
patch-one-or-many / write-all against the same Redis array key (`getBosses`
→ mutate → `saveBosses`), so a write from one process can still clobber a
flag the other process wrote in between its own read and write — distinct
booleans, same document, same last-write-wins race.

This race already exists in the current single-runtime code (e.g. two browser
tabs both hitting "definir respawn"). The worst case is a missed or repeated
announcement on one cycle. Not adding locking or per-boss keys for a
personal-use tracker — YAGNI.

## Testing plan

- Run the bot locally (`node discord-bot/src/index.mjs`) against a test
  guild with `DISCORD_GUILD_ID` set for instant command propagation.
- Set a boss's `spawnAt` to ~1 minute out via `/respawn`; confirm the warn
  line plays, then the spawn line plays, in the configured voice channel.
- Confirm the existing Vercel text webhook alert still fires independently
  for the same boss (separate flag pair, no interference).
- Confirm `/proximos`, `/bosses`, and `/respawn` autocomplete/behavior match
  BOT_DISCORD.MD's description.
- Confirm the bot disconnects from voice after each announcement rather than
  idling in the channel.
