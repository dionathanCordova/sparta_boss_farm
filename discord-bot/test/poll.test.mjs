import { describe, it, expect, vi } from "vitest";
import { createVoicePoller } from "../src/poll.mjs";

const silentLogger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };

function fakeStore(bosses) {
  return {
    getBosses: vi.fn(async () => bosses),
    updateBoss: vi.fn(async () => {}),
  };
}

// A boss that spawned a few seconds ago — inside the staleness window, so it
// should actually be announced.
function justSpawned() {
  return {
    id: "s1-kundum",
    name: "Kundum",
    server: "Server 1",
    spawnAt: new Date(Date.now() - 5_000).toISOString(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createVoicePoller", () => {
  it("does nothing when no voice channel is configured", async () => {
    const store = fakeStore([justSpawned()]);
    const speak = vi.fn();
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: undefined,
      warnMinutes: 10,
      logger: silentLogger,
    });

    await poll();

    expect(store.getBosses).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("announces a fresh spawn and writes the flag", async () => {
    const store = fakeStore([justSpawned()]);
    const speak = vi.fn(async () => {});
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger: silentLogger,
    });

    await poll();

    expect(store.updateBoss).toHaveBeenCalledWith("s1-kundum", { alertedSpawnVoice: true });
    expect(speak).toHaveBeenCalledWith({
      channelId: "c1",
      guildId: "g1",
      text: "Fala Galeraaa... Kundum nasceu agora no Server 1!",
    });
  });

  it("writes the flag but stays silent for a spawn too old to announce", async () => {
    const stale = { ...justSpawned(), spawnAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    const store = fakeStore([stale]);
    const speak = vi.fn(async () => {});
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger: silentLogger,
    });

    await poll();

    expect(store.updateBoss).toHaveBeenCalledWith("s1-kundum", { alertedSpawnVoice: true });
    expect(speak).not.toHaveBeenCalled();
  });

  it("skips an overlapping run while a previous one is still speaking", async () => {
    const store = fakeStore([justSpawned()]);
    const gate = deferred();
    const speak = vi.fn(() => gate.promise);
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger: silentLogger,
    });

    const first = poll(); // hangs inside speak()
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));

    // Second tick fires while the first is mid-announcement. Guarded, it
    // returns immediately; unguarded it would block on the same speak(), so
    // race it against a short timer rather than hanging the test.
    const second = poll();
    await Promise.race([second, new Promise((r) => setTimeout(r, 50))]);

    expect(speak).toHaveBeenCalledTimes(1);
    expect(store.getBosses).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([first, second]);
  });

  it("releases the guard after a run so the next tick proceeds", async () => {
    const store = fakeStore([justSpawned()]);
    const speak = vi.fn(async () => {});
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger: silentLogger,
    });

    await poll();
    await poll();

    expect(store.getBosses).toHaveBeenCalledTimes(2);
  });

  it("releases the guard even when the run throws", async () => {
    const store = {
      getBosses: vi.fn(async () => {
        throw new Error("upstash down");
      }),
      updateBoss: vi.fn(),
    };
    const poll = createVoicePoller({
      store,
      speak: vi.fn(),
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger: silentLogger,
    });

    await expect(poll()).rejects.toThrow("upstash down");
    await expect(poll()).rejects.toThrow("upstash down");
    expect(store.getBosses).toHaveBeenCalledTimes(2);
  });

  it("keeps polling the remaining bosses when one announcement fails", async () => {
    const a = { ...justSpawned(), id: "a", name: "A" };
    const b = { ...justSpawned(), id: "b", name: "B" };
    const store = fakeStore([a, b]);
    const speak = vi.fn(async ({ text }) => {
      if (text.includes(a.name)) throw new Error("voice ws closed");
    });
    const logger = { error: vi.fn() };
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger,
    });

    await poll();

    expect(speak).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("announces a fixed-schedule boss spawning on 3 servers only once", async () => {
    const spawnAt = new Date(Date.now() - 5_000).toISOString();
    const medusas = ["Server 1", "Server 2", "Server 3"].map((server, i) => ({
      id: `s${i + 1}-medusa`,
      name: "Medusa",
      server,
      spawnAt,
      fixedSchedule: true,
    }));
    const store = fakeStore(medusas);
    const speak = vi.fn(async () => {});
    const poll = createVoicePoller({
      store,
      speak,
      resolveGuildId: async () => "g1",
      voiceChannelId: "c1",
      warnMinutes: 10,
      logger: silentLogger,
    });

    await poll();

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith({
      channelId: "c1",
      guildId: "g1",
      text: "Fala Galeraaa... Medusa nasceu agora no Server 1, Server 2 e Server 3!",
    });
    expect(store.updateBoss).toHaveBeenCalledTimes(3);
    for (const m of medusas) {
      expect(store.updateBoss).toHaveBeenCalledWith(m.id, { alertedSpawnVoice: true });
    }
  });
});
