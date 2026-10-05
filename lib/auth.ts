import { Redis } from "@upstash/redis";
import fs from "node:fs/promises";
import path from "node:path";

const KEY = "boss-farm:auth:daily-password:v1";
const LOCAL_FILE = path.join(process.cwd(), "data", "daily-password.local.json");

export type DailyPassword = { password: string; updatedAt: string };

// Mesmo fallback de lib/store.ts: some sem Redis configurado, só não
// sobrevive a um cold start em produção — ver README.
let memoryStore: DailyPassword | null = null;

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

async function readLocalFile(): Promise<DailyPassword | null> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf-8");
    return JSON.parse(raw) as DailyPassword;
  } catch {
    return null;
  }
}

async function writeLocalFile(data: DailyPassword): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** A senha do dia atual, ou null se o admin ainda não definiu nenhuma. */
export async function getDailyPassword(): Promise<DailyPassword | null> {
  if (hasRedis()) {
    return (await getRedis().get<DailyPassword>(KEY)) ?? null;
  }
  return (await readLocalFile()) ?? memoryStore;
}

/** Define a nova senha do dia — isso invalida na hora a sessão de quem
 * entrou como usuário comum com a senha antiga (ver proxy.ts). */
export async function setDailyPassword(password: string): Promise<DailyPassword> {
  const data: DailyPassword = { password, updatedAt: new Date().toISOString() };
  if (hasRedis()) {
    await getRedis().set(KEY, data);
    return data;
  }
  const wrote = await writeLocalFile(data);
  memoryStore = wrote ? null : data;
  return data;
}

export function adminUsername(): string {
  return process.env.ADMIN_USERNAME || "admin";
}

export function commonUsername(): string {
  return process.env.USER_USERNAME || "farm";
}
