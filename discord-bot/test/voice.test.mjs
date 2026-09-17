import { describe, it, expect, vi } from "vitest";
import { speakInChannel } from "../src/voice.mjs";

function fakeClient() {
  return { guilds: { cache: new Map([["g1", { voiceAdapterCreator: "adapter" }]]) } };
}

describe("speakInChannel", () => {
  it("joins, plays the fetched stream, waits for idle, then destroys the connection", async () => {
    const destroy = vi.fn();
    const subscribe = vi.fn();
    const connection = { subscribe, destroy };
    const play = vi.fn();
    const player = { play };
    const resource = { fake: "resource" };
    const stream = { fake: "stream" };

    const joinVoiceChannel = vi.fn(() => connection);
    const createAudioPlayer = vi.fn(() => player);
    const createAudioResource = vi.fn((s) => {
      expect(s).toBe(stream);
      return resource;
    });
    const fetchTtsStream = vi.fn(async (text) => {
      expect(text).toBe("oi");
      return stream;
    });
    const entersState = vi.fn(async () => {});

    await speakInChannel(
      { client: fakeClient(), channelId: "c1", guildId: "g1", text: "oi" },
      { joinVoiceChannel, createAudioPlayer, createAudioResource, fetchTtsStream, entersState }
    );

    expect(joinVoiceChannel).toHaveBeenCalledWith({ channelId: "c1", guildId: "g1", adapterCreator: "adapter" });
    expect(subscribe).toHaveBeenCalledWith(player);
    expect(play).toHaveBeenCalledWith(resource);
    expect(destroy).toHaveBeenCalled();
  });

  it("destroys the connection even if playback wait rejects", async () => {
    const destroy = vi.fn();
    const connection = { subscribe: vi.fn(), destroy };
    const joinVoiceChannel = vi.fn(() => connection);
    const createAudioPlayer = vi.fn(() => ({ play: vi.fn() }));
    const createAudioResource = vi.fn(() => ({}));
    const fetchTtsStream = vi.fn(async () => ({}));
    let call = 0;
    const entersState = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("timed out");
    });

    await expect(
      speakInChannel(
        { client: fakeClient(), channelId: "c1", guildId: "g1", text: "oi" },
        { joinVoiceChannel, createAudioPlayer, createAudioResource, fetchTtsStream, entersState }
      )
    ).rejects.toThrow("timed out");

    expect(destroy).toHaveBeenCalled();
  });
});
