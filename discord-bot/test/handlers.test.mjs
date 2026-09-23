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
  it("lists up to 15 future bosses sorted by soonest", async () => {
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

  it("caps the list at 15 even with more future bosses", async () => {
    const bosses = Array.from({ length: 25 }, (_, i) => ({
      id: `b${i}`,
      name: `Boss ${i}`,
      server: "Server 1",
      spawnAt: new Date(now.getTime() + (i + 1) * 60_000).toISOString(),
    }));
    const res = await handleProximos(fakeStore(bosses), now);
    const lines = res.embeds[0].description.split("\n");
    expect(lines).toHaveLength(15);
    expect(lines[0]).toContain("Boss 0");
    expect(lines[14]).toContain("Boss 14");
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
