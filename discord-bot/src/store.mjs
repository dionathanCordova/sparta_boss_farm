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
