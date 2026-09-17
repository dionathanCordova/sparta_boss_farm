export type Boss = {
  id: string;
  server: string;
  name: string;
  /** ISO datetime string for the next spawn */
  spawnAt: string;
  /** true once the "spawn" Discord alert has been sent for the current spawnAt */
  alertedSpawn?: boolean;
  /** true once the "coming soon" Discord alert has been sent for the current spawnAt */
  alertedWarn?: boolean;
  /** true once the Discord bot's voice "spawn" announcement has played for the current spawnAt */
  alertedSpawnVoice?: boolean;
  /** true once the Discord bot's voice "coming soon" announcement has played for the current spawnAt */
  alertedWarnVoice?: boolean;
};

/**
 * Seed data. These timestamps are just placeholders carried over from the
 * original tracker — the moment you deploy, open the app and click
 * "definir respawn" on each boss to set real, current values. From then on
 * everything is driven by what you enter in the UI (or via the API).
 */
export const SEED_BOSSES: Boss[] = [
  // Server 1
  { id: "s1-kundum", server: "Server 1", name: "Kundum", spawnAt: "2026-09-14T12:55:00-03:00" },
  { id: "s1-selupan", server: "Server 1", name: "Selupan", spawnAt: "2026-09-14T18:06:00-03:00" },
  { id: "s1-silvester", server: "Server 1", name: "Silvester", spawnAt: "2026-09-15T00:07:00-03:00" },
  { id: "s1-core", server: "Server 1", name: "Core", spawnAt: "2026-09-14T22:00:00-03:00" },
  { id: "s1-ferrea", server: "Server 1", name: "Ferrea", spawnAt: "2026-09-15T03:53:00-03:00" },
  { id: "s1-nix", server: "Server 1", name: "Nix", spawnAt: "2026-09-15T07:51:00-03:00" },
  { id: "s1-god", server: "Server 1", name: "God", spawnAt: "2026-09-14T16:58:00-03:00" },

  // Server 2
  { id: "s2-kundum", server: "Server 2", name: "Kundum", spawnAt: "2026-09-15T04:51:00-03:00" },
  { id: "s2-selupan", server: "Server 2", name: "Selupan", spawnAt: "2026-09-14T13:48:00-03:00" },
  { id: "s2-core", server: "Server 2", name: "Core", spawnAt: "2026-09-14T23:04:00-03:00" },
  { id: "s2-silvester", server: "Server 2", name: "Silvester", spawnAt: "2026-09-15T02:03:00-03:00" },
  { id: "s2-nix-2", server: "Server 2", name: "Nix", spawnAt: "2026-09-15T03:50:00-03:00" },
  { id: "s2-ferrea", server: "Server 2", name: "Ferrea", spawnAt: "2026-09-14T23:53:00-03:00" },
  { id: "s2-god", server: "Server 2", name: "God", spawnAt: "2026-09-15T01:44:00-03:00" },

  // Server 3
  { id: "s3-kundum", server: "Server 3", name: "Kundum", spawnAt: "2026-09-14T10:51:00-03:00" },
  { id: "s3-selupan", server: "Server 3", name: "Selupan", spawnAt: "2026-09-14T18:51:00-03:00" },
  { id: "s3-silvester", server: "Server 3", name: "Silvester", spawnAt: "2026-09-15T00:01:00-03:00" },
  { id: "s3-core", server: "Server 3", name: "Core", spawnAt: "2026-09-14T23:03:00-03:00" },
  { id: "s3-ferrea", server: "Server 3", name: "Ferrea", spawnAt: "2026-09-14T23:54:00-03:00" },
  { id: "s3-nix", server: "Server 3", name: "Nix", spawnAt: "2026-09-15T03:51:00-03:00" },
  { id: "s3-god", server: "Server 3", name: "God", spawnAt: "2026-09-14T14:04:00-03:00" },
];

export const SERVERS = ["Server 1", "Server 2", "Server 3"];

/** Minutes before spawn to send the "coming soon" Discord alert. */
export const WARN_MINUTES = Number(process.env.DISCORD_WARN_MINUTES ?? 10);
