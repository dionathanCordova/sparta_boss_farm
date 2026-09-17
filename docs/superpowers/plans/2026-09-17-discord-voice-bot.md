# Discord Bot: Commands + Voice-Channel Spawn Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone, always-on Discord bot (deployed on Railway) that handles the `/proximos`, `/bosses`, `/respawn` slash commands and announces boss spawns/warnings by speaking (TTS) in a fixed voice channel — without touching the existing Vercel app's behavior.

**Architecture:** New `discord-bot/` package in this same repo, running one `discord.js` `Client` with a Gateway connection (not HTTP Interactions, since a persistent process now exists anyway). It reads/writes the same Upstash Redis dataset the Next.js app already uses. Pure decision/formatting logic lives in small, independently-tested modules (`format.mjs`, `spawn-check.mjs`, `handlers.mjs`); `voice.mjs` wraps `@discordjs/voice` behind an injectable-dependency interface so its orchestration (join → play → wait → disconnect) is unit-testable without a real Discord connection; `index.mjs` is thin wiring with no independent logic of its own.

**Tech Stack:** Node.js (ESM, `.mjs`), `discord.js` 14, `@discordjs/voice`, `google-tts-api`, `ffmpeg-static` (auto-picked-up by `@discordjs/voice`'s internal `prism-media` transcoder), `opusscript` (pure-JS Opus encoder, no native build step — matters because Railway shouldn't need `node-gyp`), `@upstash/redis` (same client/project the Vercel app uses), `vitest` for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-17-discord-voice-bot-design.md`

## Global Constraints

- Voice bot cannot run on Vercel (serverless max execution duration caps out at 900s; a voice/Gateway connection must stay open indefinitely) — it runs as a separate always-on process on Railway.
- One `discord.js` Client handles both slash commands and voice announcements (per spec's "unify" decision) — no separate HTTP-Interactions route.
- New Boss fields `alertedWarnVoice` / `alertedSpawnVoice` are tracked independently from the existing `alertedWarn` / `alertedSpawn` text-alert flags — never read or write the text flags from the bot, and vice versa.
- Voice phrases are exactly: warn = `Atenção! {boss} nasce em {N} minutos no {server}.`, spawn = `{boss} nasceu agora no {server}!`.
- Bot joins the voice channel only to speak, then disconnects — it must not idle in the channel between announcements.
- `discord-bot/` is a separate npm package (own `package.json`, own `node_modules`) — do not add its dependencies to the root `package.json`.
- Root Next.js app has no test tooling today (`npm run build` / `tsc --noEmit` is the existing verification method) — don't introduce a test framework there. `discord-bot/` is a new, isolated package, so `vitest` there is fine.

---

### Task 1: Scaffold the `discord-bot` package

**Files:**
- Create: `discord-bot/package.json`
- Create: `discord-bot/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: an installable npm package at `discord-bot/` that later tasks add source files to.

- [ ] **Step 1: Create `discord-bot/package.json`**

```json
{
  "name": "boss-farm-discord-bot",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node src/index.mjs",
    "register:commands": "node scripts/register-commands.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "@discordjs/voice": "0.17.0",
    "@upstash/redis": "1.34.3",
    "discord.js": "14.16.3",
    "dotenv": "16.4.5",
    "ffmpeg-static": "5.2.0",
    "google-tts-api": "2.0.1",
    "opusscript": "0.0.8"
  },
  "devDependencies": {
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create `discord-bot/.env.example`**

```
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DISCORD_VOICE_CHANNEL_ID=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
DISCORD_WARN_MINUTES=10
```

- [ ] **Step 3: Add `discord-bot`-specific ignores to root `.gitignore`**

The existing `/node_modules` and `.env` / `.env*.local` patterns are rooted with a leading `/` and only match the repo root — they won't catch `discord-bot/node_modules` or `discord-bot/.env`. Append:

```
# discord-bot (separate npm package)
discord-bot/node_modules
discord-bot/.env
discord-bot/.env*.local
```

- [ ] **Step 4: Install dependencies**

Run: `cd discord-bot && npm install`
Expected: installs cleanly, creates `discord-bot/node_modules` and `discord-bot/package-lock.json`, no errors.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/package.json discord-bot/package-lock.json discord-bot/.env.example .gitignore
git commit -m "chore(discord-bot): scaffold standalone bot package"
```

---

### Task 2: Format helpers (`format.mjs`)

**Files:**
- Create: `discord-bot/src/format.mjs`
- Test: `discord-bot/test/format.test.mjs`

**Interfaces:**
- Produces: `fmtEta(ms) -> string|null`, `fmtSpawnAt(date, today) -> string`, `statusFor(ms) -> { cls: "urgent"|"soon"|"safe", label: string }`, `parseDurationToMinutes(input) -> number|null`, `bossLine(boss, now) -> string`. `boss` here is a plain object `{ id, name, server, spawnAt }` (ISO string) — same shape used everywhere else in this task.

- [ ] **Step 1: Write the failing tests**

Create `discord-bot/test/format.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { fmtEta, parseDurationToMinutes, statusFor, bossLine } from "../src/format.mjs";

describe("fmtEta", () => {
  it("formats hours minutes seconds", () => {
    expect(fmtEta(3 * 3600_000 + 11 * 60_000 + 5_000)).toBe("03:11:05");
  });
  it("returns null for zero or negative", () => {
    expect(fmtEta(0)).toBeNull();
    expect(fmtEta(-1000)).toBeNull();
  });
});

describe("parseDurationToMinutes", () => {
  it("parses h:mm", () => {
    expect(parseDurationToMinutes("3:11")).toBe(191);
  });
  it("parses bare number as minutes", () => {
    expect(parseDurationToMinutes("45")).toBe(45);
  });
  it("rejects invalid minutes over 59", () => {
    expect(parseDurationToMinutes("1:75")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseDurationToMinutes("abc")).toBeNull();
  });
});

describe("statusFor", () => {
  it("is urgent within 1h", () => {
    expect(statusFor(30 * 60_000).cls).toBe("urgent");
  });
  it("is safe when already spawned", () => {
    expect(statusFor(0).cls).toBe("safe");
  });
});

describe("bossLine", () => {
  it("includes name, server and eta", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    const boss = { id: "x", name: "Kundum", server: "Server 1", spawnAt: "2026-01-01T11:00:00.000Z" };
    const line = bossLine(boss, now);
    expect(line).toContain("Kundum");
    expect(line).toContain("Server 1");
    expect(line).toContain("01:00:00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd discord-bot && npx vitest run test/format.test.mjs`
Expected: FAIL — `Cannot find module '../src/format.mjs'`

- [ ] **Step 3: Write `discord-bot/src/format.mjs`**

```js
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function fmtSpawnAt(d, today) {
  const sameDay = d.toDateString() === today.toDateString();
  const dayLabel = sameDay ? "hoje" : "amanhã";
  return `${dayLabel} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtEta(ms) {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function statusFor(ms) {
  if (ms <= 0) return { cls: "safe", label: "disponível" };
  if (ms <= 60 * 60 * 1000) return { cls: "urgent", label: "em breve" };
  if (ms <= 3 * 60 * 60 * 1000) return { cls: "soon", label: "aproximando" };
  return { cls: "safe", label: "programado" };
}

export function parseDurationToMinutes(input) {
  const str = input.trim().replace(",", ".");
  if (!str) return null;

  const withColon = str.match(/^(\d{1,3})\s*[:h]\s*(\d{1,2})?$/i);
  if (withColon) {
    const h = parseInt(withColon[1], 10);
    const min = withColon[2] ? parseInt(withColon[2], 10) : 0;
    if (min > 59) return null;
    return h * 60 + min;
  }

  const bareNumber = str.match(/^(\d{1,4})$/);
  if (bareNumber) {
    return parseInt(bareNumber[1], 10);
  }

  return null;
}

export function bossLine(boss, now) {
  const spawnMs = new Date(boss.spawnAt).getTime() - now.getTime();
  const eta = fmtEta(spawnMs) ?? "disponível agora";
  const at = fmtSpawnAt(new Date(boss.spawnAt), now);
  const st = statusFor(spawnMs);
  const emoji = st.cls === "urgent" ? "🔴" : st.cls === "soon" ? "🟡" : "🟢";
  return `${emoji} **${boss.name}** (${boss.server}) — ${eta} (${at})`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd discord-bot && npx vitest run test/format.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/format.mjs discord-bot/test/format.test.mjs
git commit -m "feat(discord-bot): add format helpers with tests"
```

---

### Task 3: Slash command definitions (`commands.mjs`)

**Files:**
- Create: `discord-bot/src/commands.mjs`
- Test: `discord-bot/test/commands.test.mjs`

**Interfaces:**
- Produces: `COMMANDS` — array of 3 Discord application-command definitions (`proximos`, `bosses`, `respawn`), consumed by `index.mjs` (Task 8) and `scripts/register-commands.mjs` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `discord-bot/test/commands.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { COMMANDS } from "../src/commands.mjs";

describe("COMMANDS", () => {
  it("defines exactly proximos, bosses, respawn", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(["proximos", "bosses", "respawn"]);
  });

  it("bosses requires a server choice", () => {
    const bosses = COMMANDS.find((c) => c.name === "bosses");
    const server = bosses.options.find((o) => o.name === "server");
    expect(server.required).toBe(true);
    expect(server.choices.map((c) => c.value)).toEqual(["Server 1", "Server 2", "Server 3"]);
  });

  it("respawn has autocomplete boss and required tempo", () => {
    const respawn = COMMANDS.find((c) => c.name === "respawn");
    const boss = respawn.options.find((o) => o.name === "boss");
    const tempo = respawn.options.find((o) => o.name === "tempo");
    expect(boss.autocomplete).toBe(true);
    expect(tempo.required).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd discord-bot && npx vitest run test/commands.test.mjs`
Expected: FAIL — `Cannot find module '../src/commands.mjs'`

- [ ] **Step 3: Write `discord-bot/src/commands.mjs`**

```js
const SERVER_CHOICES = [
  { name: "Server 1", value: "Server 1" },
  { name: "Server 2", value: "Server 2" },
  { name: "Server 3", value: "Server 3" },
];

export const COMMANDS = [
  {
    name: "proximos",
    description: "Mostra os 5 bosses mais próximos de nascer, em todos os servers",
    type: 1,
  },
  {
    name: "bosses",
    description: "Lista os bosses de um server com o tempo até nascer",
    type: 1,
    options: [
      {
        type: 3,
        name: "server",
        description: "Qual server",
        required: true,
        choices: SERVER_CHOICES,
      },
    ],
  },
  {
    name: "respawn",
    description: "Define o tempo de respawn de um boss (igual clicar em 'definir respawn' no site)",
    type: 1,
    options: [
      {
        type: 3,
        name: "server",
        description: "Qual server",
        required: true,
        choices: SERVER_CHOICES,
      },
      {
        type: 3,
        name: "boss",
        description: "Qual boss (comece a digitar pra ver as opções)",
        required: true,
        autocomplete: true,
      },
      {
        type: 3,
        name: "tempo",
        description: "Tempo até nascer: 3:11 (3h11) ou 45 (45 min)",
        required: true,
      },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd discord-bot && npx vitest run test/commands.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/commands.mjs discord-bot/test/commands.test.mjs
git commit -m "feat(discord-bot): add slash command definitions with tests"
```

---

### Task 4: Redis-backed store (`store.mjs`)

**Files:**
- Create: `discord-bot/src/store.mjs`
- Test: `discord-bot/test/store.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createStore(redisClient) -> { getBosses(): Promise<Boss[]>, saveBosses(bosses): Promise<void>, updateBoss(id, patch): Promise<Boss|null> }` where `redisClient` is any object with async `get(key)` / `set(key, value)`. `createRedisStore() -> Store` builds the real one from `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. Consumed by `handlers.mjs` (Task 5) and `index.mjs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `discord-bot/test/store.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { createStore } from "../src/store.mjs";

function fakeRedis(initial) {
  let value = initial;
  return {
    async get() {
      return value;
    },
    async set(_key, v) {
      value = v;
    },
  };
}

describe("createStore", () => {
  it("returns empty array when nothing stored", async () => {
    const store = createStore(fakeRedis(null));
    expect(await store.getBosses()).toEqual([]);
  });

  it("updateBoss patches the matching boss and persists it", async () => {
    const store = createStore(
      fakeRedis([{ id: "a", name: "Kundum", server: "Server 1", spawnAt: "2026-01-01T00:00:00.000Z" }])
    );
    const updated = await store.updateBoss("a", { spawnAt: "2026-02-02T00:00:00.000Z" });
    expect(updated.spawnAt).toBe("2026-02-02T00:00:00.000Z");
    const all = await store.getBosses();
    expect(all[0].spawnAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("updateBoss returns null for an unknown id", async () => {
    const store = createStore(fakeRedis([]));
    expect(await store.updateBoss("missing", {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd discord-bot && npx vitest run test/store.test.mjs`
Expected: FAIL — `Cannot find module '../src/store.mjs'`

- [ ] **Step 3: Write `discord-bot/src/store.mjs`**

```js
import { Redis } from "@upstash/redis";

const KEY = "boss-farm:bosses:v1";

// Bot never seeds — the Next.js app already owns first-run seeding of this key.
export function createStore(redisClient) {
  async function getBosses() {
    const data = await redisClient.get(KEY);
    if (data && Array.isArray(data)) return data;
    return [];
  }

  async function saveBosses(bosses) {
    await redisClient.set(KEY, bosses);
  }

  async function updateBoss(id, patch) {
    const bosses = await getBosses();
    const idx = bosses.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    const updated = { ...bosses[idx], ...patch };
    bosses[idx] = updated;
    await saveBosses(bosses);
    return updated;
  }

  return { getBosses, saveBosses, updateBoss };
}

export function createRedisStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN não configuradas");
  }
  return createStore(new Redis({ url, token }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd discord-bot && npx vitest run test/store.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/store.mjs discord-bot/test/store.test.mjs
git commit -m "feat(discord-bot): add Redis-backed boss store with tests"
```

---

### Task 5: Spawn/warn decision logic (`spawn-check.mjs`)

**Files:**
- Create: `discord-bot/src/spawn-check.mjs`
- Test: `discord-bot/test/spawn-check.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure functions over a plain `Boss` object).
- Produces: `buildWarnPhrase(boss, minutesLeft) -> string`, `buildSpawnPhrase(boss) -> string`, `evaluateBoss(boss, nowMs, warnMinutes) -> { action: "spawn"|"warn"|null, phrase: string|null, patch: object|null }`. Consumed by `index.mjs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `discord-bot/test/spawn-check.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { evaluateBoss, buildWarnPhrase, buildSpawnPhrase } from "../src/spawn-check.mjs";

const boss = { id: "s1-kundum", name: "Kundum", server: "Server 1", spawnAt: "2026-01-01T12:00:00.000Z" };

describe("evaluateBoss", () => {
  it("fires spawn when time has passed and not yet alerted", () => {
    const now = new Date("2026-01-01T12:00:01.000Z").getTime();
    const result = evaluateBoss(boss, now, 10);
    expect(result.action).toBe("spawn");
    expect(result.patch).toEqual({ alertedSpawnVoice: true });
  });

  it("does not re-fire spawn once alertedSpawnVoice is set", () => {
    const now = new Date("2026-01-01T12:00:01.000Z").getTime();
    const result = evaluateBoss({ ...boss, alertedSpawnVoice: true }, now, 10);
    expect(result.action).toBeNull();
  });

  it("fires warn inside the warn window", () => {
    const now = new Date("2026-01-01T11:55:00.000Z").getTime(); // 5 min left
    const result = evaluateBoss(boss, now, 10);
    expect(result.action).toBe("warn");
    expect(result.phrase).toContain("5 minutos");
    expect(result.patch).toEqual({ alertedWarnVoice: true });
  });

  it("does not fire warn outside the warn window", () => {
    const now = new Date("2026-01-01T11:00:00.000Z").getTime(); // 60 min left
    const result = evaluateBoss(boss, now, 10);
    expect(result.action).toBeNull();
  });

  it("does not re-fire warn once alertedWarnVoice is set", () => {
    const now = new Date("2026-01-01T11:55:00.000Z").getTime();
    const result = evaluateBoss({ ...boss, alertedWarnVoice: true }, now, 10);
    expect(result.action).toBeNull();
  });
});

describe("phrase builders", () => {
  it("builds warn phrase", () => {
    expect(buildWarnPhrase(boss, 5)).toBe("Atenção! Kundum nasce em 5 minutos no Server 1.");
  });
  it("builds spawn phrase", () => {
    expect(buildSpawnPhrase(boss)).toBe("Kundum nasceu agora no Server 1!");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd discord-bot && npx vitest run test/spawn-check.test.mjs`
Expected: FAIL — `Cannot find module '../src/spawn-check.mjs'`

- [ ] **Step 3: Write `discord-bot/src/spawn-check.mjs`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd discord-bot && npx vitest run test/spawn-check.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/spawn-check.mjs discord-bot/test/spawn-check.test.mjs
git commit -m "feat(discord-bot): add spawn/warn voice-alert decision logic with tests"
```

---

### Task 6: Command handlers (`handlers.mjs`)

**Files:**
- Create: `discord-bot/src/handlers.mjs`
- Test: `discord-bot/test/handlers.test.mjs`

**Interfaces:**
- Consumes: `bossLine`, `fmtEta`, `fmtSpawnAt`, `parseDurationToMinutes` from `./format.mjs` (Task 2); a `store` object shaped like Task 4's `createStore()` return value.
- Produces: `handleProximos(store, now) -> Promise<{embeds}>`, `handleBosses(store, server, now) -> Promise<{embeds}>`, `handleRespawnAutocomplete(store, server, typed) -> Promise<Array<{name, value}>>`, `handleRespawn(store, { bossId, tempo, now }) -> Promise<{embeds}|{ephemeral: true, content}>`. Consumed by `index.mjs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `discord-bot/test/handlers.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { handleProximos, handleBosses, handleRespawnAutocomplete, handleRespawn } from "../src/handlers.mjs";

function fakeStore(bosses) {
  const data = bosses;
  return {
    async getBosses() {
      return data;
    },
    async updateBoss(id, patch) {
      const idx = data.findIndex((b) => b.id === id);
      if (idx === -1) return null;
      data[idx] = { ...data[idx], ...patch };
      return data[idx];
    },
  };
}

const now = new Date("2026-01-01T10:00:00.000Z");

describe("handleProximos", () => {
  it("lists up to 5 future bosses sorted by soonest", async () => {
    const store = fakeStore([
      { id: "a", name: "A", server: "Server 1", spawnAt: "2026-01-01T12:00:00.000Z" },
      { id: "b", name: "B", server: "Server 1", spawnAt: "2026-01-01T11:00:00.000Z" },
      { id: "c", name: "C", server: "Server 1", spawnAt: "2025-01-01T00:00:00.000Z" },
    ]);
    const res = await handleProximos(store, now);
    const lines = res.embeds[0].description.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("B");
    expect(lines[1]).toContain("A");
  });

  it("shows fallback message when nothing upcoming", async () => {
    const res = await handleProximos(fakeStore([]), now);
    expect(res.embeds[0].description).toBe("Nenhum boss com horário futuro definido ainda.");
  });
});

describe("handleBosses", () => {
  it("filters by server", async () => {
    const store = fakeStore([
      { id: "a", name: "Alfa", server: "Server 1", spawnAt: "2026-01-01T12:00:00.000Z" },
      { id: "b", name: "Beta", server: "Server 2", spawnAt: "2026-01-01T12:00:00.000Z" },
    ]);
    const res = await handleBosses(store, "Server 2", now);
    expect(res.embeds[0].description).toContain("Beta");
    expect(res.embeds[0].description).not.toContain("Alfa");
  });
});

describe("handleRespawnAutocomplete", () => {
  it("filters by typed text and server", async () => {
    const store = fakeStore([
      { id: "s1-kundum", name: "Kundum", server: "Server 1", spawnAt: now.toISOString() },
      { id: "s2-kundum", name: "Kundum", server: "Server 2", spawnAt: now.toISOString() },
    ]);
    const choices = await handleRespawnAutocomplete(store, "Server 1", "kund");
    expect(choices).toEqual([{ name: "Kundum (Server 1)", value: "s1-kundum" }]);
  });
});

describe("handleRespawn", () => {
  it("updates spawnAt and clears all four alert flags", async () => {
    const store = fakeStore([
      {
        id: "a",
        name: "A",
        server: "Server 1",
        spawnAt: "2020-01-01T00:00:00.000Z",
        alertedSpawn: true,
        alertedWarn: true,
        alertedSpawnVoice: true,
        alertedWarnVoice: true,
      },
    ]);
    const res = await handleRespawn(store, { bossId: "a", tempo: "45", now });
    const updated = (await store.getBosses())[0];
    expect(updated.alertedSpawn).toBe(false);
    expect(updated.alertedWarn).toBe(false);
    expect(updated.alertedSpawnVoice).toBe(false);
    expect(updated.alertedWarnVoice).toBe(false);
    expect(res.embeds[0].title).toBe("✅ Respawn atualizado");
  });

  it("rejects invalid tempo", async () => {
    const store = fakeStore([{ id: "a", name: "A", server: "Server 1", spawnAt: now.toISOString() }]);
    const res = await handleRespawn(store, { bossId: "a", tempo: "abc", now });
    expect(res.ephemeral).toBe(true);
  });

  it("rejects missing bossId", async () => {
    const res = await handleRespawn(fakeStore([]), { bossId: undefined, tempo: "45", now });
    expect(res.ephemeral).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd discord-bot && npx vitest run test/handlers.test.mjs`
Expected: FAIL — `Cannot find module '../src/handlers.mjs'`

- [ ] **Step 3: Write `discord-bot/src/handlers.mjs`**

```js
import { bossLine, fmtEta, fmtSpawnAt, parseDurationToMinutes } from "./format.mjs";

const EMBED_COLOR = 0xa3720f;
const SUCCESS_COLOR = 0x2f8f74;

export async function handleProximos(store, now) {
  const bosses = await store.getBosses();
  const upcoming = bosses
    .filter((b) => new Date(b.spawnAt).getTime() - now.getTime() > 0)
    .sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime())
    .slice(0, 5);

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd discord-bot && npx vitest run test/handlers.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/handlers.mjs discord-bot/test/handlers.test.mjs
git commit -m "feat(discord-bot): add command handlers with tests"
```

---

### Task 7: Voice announcement (`voice.mjs`)

**Files:**
- Create: `discord-bot/src/voice.mjs`
- Test: `discord-bot/test/voice.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (depends on `@discordjs/voice` and `google-tts-api`, both installed in Task 1).
- Produces: `speakInChannel({ client, channelId, guildId, text }, deps?) -> Promise<void>` — joins the voice channel, plays TTS audio for `text`, disconnects. `deps` optionally overrides `joinVoiceChannel`, `createAudioPlayer`, `createAudioResource`, `fetchTtsStream`, `entersState` for testing. Consumed by `index.mjs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `discord-bot/test/voice.test.mjs`:

```js
import { describe, it, expect, vi } from "vitest";
import { speakInChannel } from "../src/voice.mjs";

function fakeClient() {
  return { guilds: { cache: new Map([["g1", { voiceAdapterCreator: "adapter" }]]) } };
}

describe("speakInChannel", () => {
  it("joins, plays the fetched stream, waits for idle, then destroys the connection", async () => {
    const destroy = vi.fn();
    const subscribe = vi.fn();
    const connection = { subscribe, destroy };
    const play = vi.fn();
    const player = { play };
    const resource = { fake: "resource" };
    const stream = { fake: "stream" };

    const joinVoiceChannel = vi.fn(() => connection);
    const createAudioPlayer = vi.fn(() => player);
    const createAudioResource = vi.fn((s) => {
      expect(s).toBe(stream);
      return resource;
    });
    const fetchTtsStream = vi.fn(async (text) => {
      expect(text).toBe("oi");
      return stream;
    });
    const entersState = vi.fn(async () => {});

    await speakInChannel(
      { client: fakeClient(), channelId: "c1", guildId: "g1", text: "oi" },
      { joinVoiceChannel, createAudioPlayer, createAudioResource, fetchTtsStream, entersState }
    );

    expect(joinVoiceChannel).toHaveBeenCalledWith({ channelId: "c1", guildId: "g1", adapterCreator: "adapter" });
    expect(subscribe).toHaveBeenCalledWith(player);
    expect(play).toHaveBeenCalledWith(resource);
    expect(destroy).toHaveBeenCalled();
  });

  it("destroys the connection even if playback wait rejects", async () => {
    const destroy = vi.fn();
    const connection = { subscribe: vi.fn(), destroy };
    const joinVoiceChannel = vi.fn(() => connection);
    const createAudioPlayer = vi.fn(() => ({ play: vi.fn() }));
    const createAudioResource = vi.fn(() => ({}));
    const fetchTtsStream = vi.fn(async () => ({}));
    let call = 0;
    const entersState = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("timed out");
    });

    await expect(
      speakInChannel(
        { client: fakeClient(), channelId: "c1", guildId: "g1", text: "oi" },
        { joinVoiceChannel, createAudioPlayer, createAudioResource, fetchTtsStream, entersState }
      )
    ).rejects.toThrow("timed out");

    expect(destroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd discord-bot && npx vitest run test/voice.test.mjs`
Expected: FAIL — `Cannot find module '../src/voice.mjs'`

- [ ] **Step 3: Write `discord-bot/src/voice.mjs`**

```js
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { getAudioUrl } from "google-tts-api";
import { Readable } from "node:stream";

async function fetchTtsStream(text) {
  const url = getAudioUrl(text, { lang: "pt-BR", slow: false, host: "https://translate.google.com" });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`TTS fetch failed: ${res.status}`);
  return Readable.fromWeb(res.body);
}

export async function speakInChannel({ client, channelId, guildId, text }, deps = {}) {
  const join = deps.joinVoiceChannel ?? joinVoiceChannel;
  const makePlayer = deps.createAudioPlayer ?? createAudioPlayer;
  const makeResource = deps.createAudioResource ?? createAudioResource;
  const getStream = deps.fetchTtsStream ?? fetchTtsStream;
  const wait = deps.entersState ?? entersState;

  const connection = join({
    channelId,
    guildId,
    adapterCreator: client.guilds.cache.get(guildId).voiceAdapterCreator,
  });

  try {
    await wait(connection, VoiceConnectionStatus.Ready, 10_000);

    const stream = await getStream(text);
    const resource = makeResource(stream, { inputType: StreamType.Arbitrary });
    const player = makePlayer();

    connection.subscribe(player);
    player.play(resource);

    await wait(player, AudioPlayerStatus.Idle, 30_000);
  } finally {
    connection.destroy();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd discord-bot && npx vitest run test/voice.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/voice.mjs discord-bot/test/voice.test.mjs
git commit -m "feat(discord-bot): add voice announcement helper with tests"
```

---

### Task 8: Client wiring (`index.mjs`) and command registration script

**Files:**
- Create: `discord-bot/src/index.mjs`
- Create: `discord-bot/scripts/register-commands.mjs`

**Interfaces:**
- Consumes: `createRedisStore` (Task 4), `handleProximos`/`handleBosses`/`handleRespawnAutocomplete`/`handleRespawn` (Task 6), `evaluateBoss` (Task 5), `speakInChannel` (Task 7), `COMMANDS` (Task 3).
- Produces: the runnable bot process (`npm start`) and the one-off `npm run register:commands` script. No exported interface — this is thin wiring with no independent logic, so it is verified manually (Task 10) rather than unit tested; every decision it delegates to is already covered by the tests in Tasks 2–7.

- [ ] **Step 1: Write `discord-bot/src/index.mjs`**

```js
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
```

- [ ] **Step 2: Write `discord-bot/scripts/register-commands.mjs`**

```js
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
```

- [ ] **Step 3: Sanity-check the wiring loads without crashing**

Run: `cd discord-bot && node --check src/index.mjs && node --check scripts/register-commands.mjs`
Expected: no output, exit code 0 (syntax/import-resolution check only — this does not require real Discord credentials).

- [ ] **Step 4: Run the full test suite once more**

Run: `cd discord-bot && npm test`
Expected: PASS — all tests from Tasks 2–7 (28 tests total) still pass.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/src/index.mjs discord-bot/scripts/register-commands.mjs
git commit -m "feat(discord-bot): wire up Client, interaction handling, and voice poll loop"
```

---

### Task 9: Wire the new voice flags into the existing Next.js app

**Files:**
- Modify: `lib/bosses.ts:1-11` (the `Boss` type)
- Modify: `app/api/bosses/[id]/route.ts:29-33` (the `updateBoss` call in the site's "definir respawn" endpoint)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Boss` now includes optional `alertedWarnVoice` / `alertedSpawnVoice`, and the site's own respawn action clears all four alert flags — keeping it consistent with `discord-bot`'s `handleRespawn` (Task 6), so setting a respawn from either the website or `/respawn` behaves identically.

- [ ] **Step 1: Add the two fields to the `Boss` type**

In `lib/bosses.ts`, change:

```ts
export type Boss = {
  id: string;
  server: string;
  name: string;
  /** ISO datetime string for the next spawn */
  spawnAt: string;
  /** true once the "spawn" Discord alert has been sent for the current spawnAt */
  alertedSpawn?: boolean;
  /** true once the "coming soon" Discord alert has been sent for the current spawnAt */
  alertedWarn?: boolean;
};
```

to:

```ts
export type Boss = {
  id: string;
  server: string;
  name: string;
  /** ISO datetime string for the next spawn */
  spawnAt: string;
  /** true once the "spawn" Discord alert has been sent for the current spawnAt */
  alertedSpawn?: boolean;
  /** true once the "coming soon" Discord alert has been sent for the current spawnAt */
  alertedWarn?: boolean;
  /** true once the Discord bot's voice "spawn" announcement has played for the current spawnAt */
  alertedSpawnVoice?: boolean;
  /** true once the Discord bot's voice "coming soon" announcement has played for the current spawnAt */
  alertedWarnVoice?: boolean;
};
```

- [ ] **Step 2: Clear the voice flags when the site sets a new respawn**

In `app/api/bosses/[id]/route.ts`, change:

```ts
  const updated = await updateBoss(id, {
    spawnAt,
    alertedSpawn: false,
    alertedWarn: false,
  });
```

to:

```ts
  const updated = await updateBoss(id, {
    spawnAt,
    alertedSpawn: false,
    alertedWarn: false,
    alertedSpawnVoice: false,
    alertedWarnVoice: false,
  });
```

- [ ] **Step 3: Type-check the app**

Run: `npx tsc --noEmit`
Expected: no errors (this repo has no test suite of its own — type-checking is its existing verification method, same as `npm run build` would do).

- [ ] **Step 4: Commit**

```bash
git add lib/bosses.ts app/api/bosses/[id]/route.ts
git commit -m "feat: track voice alert flags alongside text alert flags on Boss"
```

---

### Task 10: Railway deployment docs and manual end-to-end verification

**Files:**
- Create: `discord-bot/README.md`

**Interfaces:**
- Produces: none (documentation + manual verification only).

- [ ] **Step 1: Write `discord-bot/README.md`**

```markdown
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
```

- [ ] **Step 2: Manual end-to-end verification (requires a real test Discord server)**

Run the bot locally: `cd discord-bot && npm start` (with `.env.local` fully filled in, `DISCORD_GUILD_ID` set to a test server for instant command propagation).

Verify, in that test server:
- [ ] `/proximos`, `/bosses`, `/respawn` all appear when typing `/`.
- [ ] `/respawn server:"Server 1" boss:<pick from autocomplete> tempo:1` sets that boss ~1 minute out.
- [ ] Around 1 minute later (with `DISCORD_WARN_MINUTES` temporarily set low, e.g. `1`, to trigger fast), the bot joins `DISCORD_VOICE_CHANNEL_ID` and speaks the warn phrase, then the spawn phrase, then leaves each time rather than idling in the channel.
- [ ] The existing Vercel `/api/cron/check` text webhook still fires independently for the same boss (check the text alert channel) — confirming the voice and text flag pairs don't interfere with each other.
- [ ] Restart the bot process mid-test and confirm it doesn't re-announce a boss whose `alertedSpawnVoice`/`alertedWarnVoice` was already set (flags persisted in Redis survive the restart).

- [ ] **Step 3: Commit**

```bash
git add discord-bot/README.md
git commit -m "docs(discord-bot): add setup and Railway deploy instructions"
```
