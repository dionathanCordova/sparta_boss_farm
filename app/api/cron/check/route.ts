import { NextRequest, NextResponse } from "next/server";
import { getBosses, saveBosses } from "@/lib/store";
import { sendDiscordAlert } from "@/lib/discord";
import { WARN_MINUTES } from "@/lib/bosses";

export const dynamic = "force-dynamic";

/**
 * Call this endpoint periodically (every 1-5 minutes) to trigger Discord
 * alerts. Vercel's own Cron Jobs only run once/day on the Hobby plan, so in
 * practice you'll usually hit this from an external pinger — see the
 * README for the cron-job.org / GitHub Actions setup.
 *
 * Auth: if CRON_SECRET is set, the request must carry it either as
 * `Authorization: Bearer <secret>` (what Vercel's own Cron sends
 * automatically when CRON_SECRET is set) or as `?secret=<secret>` (easier
 * for third-party cron pingers that can't set custom headers).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const queryToken = req.nextUrl.searchParams.get("secret");
    const provided = authHeader?.replace(/^Bearer\s+/i, "") ?? queryToken ?? undefined;
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const bosses = await getBosses();
  const now = Date.now();
  const alertsSent: { id: string; name: string; server: string; kind: "spawn" | "warn" }[] = [];
  const alertErrors: { id: string; error: string }[] = [];
  let changed = false;

  for (const boss of bosses) {
    const spawnMs = new Date(boss.spawnAt).getTime();
    const msLeft = spawnMs - now;

    if (msLeft <= 0 && !boss.alertedSpawn) {
      const res = await sendDiscordAlert({
        kind: "spawn",
        bossName: boss.name,
        server: boss.server,
        spawnAt: boss.spawnAt,
      });
      if (res.ok) {
        boss.alertedSpawn = true;
        changed = true;
        alertsSent.push({ id: boss.id, name: boss.name, server: boss.server, kind: "spawn" });
      } else if (res.error) {
        alertErrors.push({ id: boss.id, error: res.error });
      }
    } else if (msLeft > 0 && msLeft <= WARN_MINUTES * 60_000 && !boss.alertedWarn) {
      const minutesLeft = Math.max(1, Math.ceil(msLeft / 60_000));
      const res = await sendDiscordAlert({
        kind: "warn",
        bossName: boss.name,
        server: boss.server,
        spawnAt: boss.spawnAt,
        minutesLeft,
      });
      if (res.ok) {
        boss.alertedWarn = true;
        changed = true;
        alertsSent.push({ id: boss.id, name: boss.name, server: boss.server, kind: "warn" });
      } else if (res.error) {
        alertErrors.push({ id: boss.id, error: res.error });
      }
    }
  }

  if (changed) {
    await saveBosses(bosses);
  }

  return NextResponse.json({
    checkedAt: new Date(now).toISOString(),
    warnMinutes: WARN_MINUTES,
    alertsSent,
    alertErrors,
  });
}
