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
