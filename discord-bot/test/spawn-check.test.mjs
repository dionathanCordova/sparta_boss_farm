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

  it("still fires spawn for a boss that spawned a minute ago (inside the staleness window)", () => {
    const now = new Date("2026-01-01T12:01:00.000Z").getTime();
    const result = evaluateBoss(boss, now, 10);
    expect(result.action).toBe("spawn");
    expect(result.phrase).toContain("nasceu agora");
    expect(result.patch).toEqual({ alertedSpawnVoice: true });
  });

  it("stays silent for a stale spawn but still marks it handled", () => {
    const now = new Date("2026-01-01T12:10:00.000Z").getTime(); // 10 min past spawn
    const result = evaluateBoss(boss, now, 10);
    expect(result.action).toBeNull();
    expect(result.phrase).toBeNull();
    // The flag is still written so the poll loop stops re-checking it forever.
    expect(result.patch).toEqual({ alertedSpawnVoice: true });
  });

  it("does not re-fire spawn once alertedSpawnVoice is set", () => {
    const now = new Date("2026-01-01T12:00:01.000Z").getTime();
    const result = evaluateBoss({ ...boss, alertedSpawnVoice: true }, now, 10);
    expect(result.action).toBeNull();
    expect(result.patch).toBeNull();
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
    expect(buildWarnPhrase(boss, 5)).toBe("Fala Galeraaa... Kundum nasce em 5 minutos no Server 1.");
  });
  it("builds spawn phrase", () => {
    expect(buildSpawnPhrase(boss)).toBe("Fala Galeraaa... Kundum nasceu agora no Server 1!");
  });
});
