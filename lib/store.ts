import { Redis } from "@upstash/redis";
import fs from "node:fs/promises";
import path from "node:path";
import { Boss, SEED_BOSSES, nextMedusaSpawn } from "./bosses";

const KEY = "boss-farm:bosses:v1";
const LOCAL_FILE = path.join(process.cwd(), "data", "bosses.local.json");

// In-memory fallback used only when there is no Redis configured AND the
// filesystem can't be written to (e.g. a serverless deploy without Upstash
// env vars set). It resets whenever the serverless function cold-starts,
// so it's a last resort, not a real persistence layer — see the README.
let memoryStore: Boss[] | null = null;

function hasRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

let redisClient: Redis | null = null;
function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redisClient;
}

async function readLocalFile(): Promise<Boss[] | null> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf-8");
    return JSON.parse(raw) as Boss[];
  } catch {
    return null;
  }
}

async function writeLocalFile(bosses: Boss[]): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(bosses, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Fixed-schedule bosses (e.g. Medusa) never get a manual "definir respawn"
 * update. Once the spawn alert for the current cycle has gone out, roll
 * spawnAt forward to the next slot on its fixed clock and reset the alert
 * flags — this is what lets it keep spawning every 4h with no input.
 */
function rollForwardFixedSchedules(bosses: Boss[], now: Date): boolean {
  let changed = false;
  for (const boss of bosses) {
    if (!boss.fixedSchedule) continue;
    if (!boss.alertedSpawn) continue;
    if (new Date(boss.spawnAt).getTime() > now.getTime()) continue;
    const next = nextMedusaSpawn(now).toISOString();
    if (next === boss.spawnAt) continue;
    boss.spawnAt = next;
    boss.alertedSpawn = false;
    boss.alertedWarn = false;
    boss.alertedSpawnVoice = false;
    boss.alertedWarnVoice = false;
    changed = true;
  }
  return changed;
}

export async function getBosses(): Promise<Boss[]> {
  let bosses: Boss[];
  let freshlySeeded = false;

  if (hasRedis()) {
    const data = await getRedis().get<Boss[]>(KEY);
    if (data && Array.isArray(data) && data.length > 0) {
      bosses = data;
    } else {
      bosses = SEED_BOSSES;
      freshlySeeded = true;
    }
  } else {
    const fromFile = await readLocalFile();
    if (fromFile) {
      bosses = fromFile;
    } else if (memoryStore) {
      bosses = memoryStore;
    } else {
      bosses = SEED_BOSSES;
      freshlySeeded = true;
    }
  }

  if (!freshlySeeded && rollForwardFixedSchedules(bosses, new Date())) {
    await saveBosses(bosses);
  } else if (freshlySeeded) {
    await saveBosses(bosses);
  }

  return bosses;
}

export async function saveBosses(bosses: Boss[]): Promise<void> {
  if (hasRedis()) {
    await getRedis().set(KEY, bosses);
    return;
  }
  const wrote = await writeLocalFile(bosses);
  if (!wrote) memoryStore = bosses;
  else memoryStore = null;
}

export async function updateBoss(id: string, patch: Partial<Boss>): Promise<Boss | null> {
  const bosses = await getBosses();
  const idx = bosses.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const updated: Boss = { ...bosses[idx], ...patch };
  bosses[idx] = updated;
  await saveBosses(bosses);
  return updated;
}

/** True when boss data is stored somewhere that survives a redeploy / cold start. */
export function isPersistenceDurable(): boolean {
  return hasRedis();
}
