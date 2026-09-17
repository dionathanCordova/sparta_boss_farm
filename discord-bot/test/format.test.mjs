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
