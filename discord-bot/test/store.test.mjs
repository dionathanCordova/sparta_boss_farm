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
