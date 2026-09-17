import { describe, it, expect } from "vitest";
import { fmtEta, fmtSpawnAt, parseDurationToMinutes, statusFor, bossLine } from "../src/format.mjs";

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

// All instants below are pinned in UTC and asserted against their
// America/Sao_Paulo (UTC-3) rendering, so these pass under any host TZ.
describe("fmtSpawnAt", () => {
  it("renders the hour in São Paulo time, not host-local time", () => {
    const today = new Date("2026-01-01T10:00:00.000Z"); // 07:00 in SP
    expect(fmtSpawnAt(new Date("2026-01-01T11:00:00.000Z"), today)).toBe("hoje 08:00");
  });

  it("treats a late-evening São Paulo instant as the same day even though UTC has rolled over", () => {
    const today = new Date("2026-01-01T10:00:00.000Z"); // 2026-01-01 in SP
    // 02:00 UTC on Jan 2 is 23:00 on Jan 1 in São Paulo.
    expect(fmtSpawnAt(new Date("2026-01-02T02:00:00.000Z"), today)).toBe("hoje 23:00");
  });

  it("labels a genuinely later São Paulo day as amanhã", () => {
    const today = new Date("2026-01-01T10:00:00.000Z");
    expect(fmtSpawnAt(new Date("2026-01-02T15:00:00.000Z"), today)).toBe("amanhã 12:00");
  });
});

describe("bossLine", () => {
  it("includes name, server, eta and the São Paulo spawn time", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    const boss = { id: "x", name: "Kundum", server: "Server 1", spawnAt: "2026-01-01T11:00:00.000Z" };
    const line = bossLine(boss, now);
    expect(line).toContain("Kundum");
    expect(line).toContain("Server 1");
    expect(line).toContain("01:00:00");
    expect(line).toContain("hoje 08:00");
  });
});
