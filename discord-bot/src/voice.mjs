import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { getAudioUrl } from "google-tts-api";
import { Readable } from "node:stream";

async function fetchTtsStream(text) {
  const url = getAudioUrl(text, { lang: "pt-BR", slow: false, host: "https://translate.google.com" });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`TTS fetch failed: ${res.status}`);
  return Readable.fromWeb(res.body);
}

export async function speakInChannel({ client, channelId, guildId, text }, deps = {}) {
  const join = deps.joinVoiceChannel ?? joinVoiceChannel;
  const makePlayer = deps.createAudioPlayer ?? createAudioPlayer;
  const makeResource = deps.createAudioResource ?? createAudioResource;
  const getStream = deps.fetchTtsStream ?? fetchTtsStream;
  const wait = deps.entersState ?? entersState;

  const connection = join({
    channelId,
    guildId,
    adapterCreator: client.guilds.cache.get(guildId).voiceAdapterCreator,
  });

  try {
    await wait(connection, VoiceConnectionStatus.Ready, 10_000);

    const stream = await getStream(text);
    const resource = makeResource(stream, { inputType: StreamType.Arbitrary });
    const player = makePlayer();

    connection.subscribe(player);
    player.play(resource);

    await wait(player, AudioPlayerStatus.Idle, 30_000);
  } finally {
    connection.destroy();
  }
}
