import { NextRequest, NextResponse } from "next/server";
import { getBosses, saveBosses } from "@/lib/store";
import { sendDiscordAlert } from "@/lib/discord";
import { Boss, WARN_MINUTES } from "@/lib/bosses";

/**
 * Fixed-schedule bosses (e.g. Medusa) spawn on all 3 servers at the exact
 * same time — group them so a shared spawn gets ONE alert instead of one
 * per server. Regular bosses each get their own group (their spawnAt is
 * set per-kill and rarely lines up with another server's).
 */
function groupByAlert(bosses: Boss[]): Boss[][] {
  const groups = new Map<string, Boss[]>();
  for (const boss of bosses) {
    const key = boss.fixedSchedule ? `${boss.name}|${boss.spawnAt}` : `single|${boss.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(boss);
  }
  return Array.from(groups.values());
}

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

  for (const group of groupByAlert(bosses)) {
    const rep = group[0];
    const servers = group.map((b) => b.server);
    const spawnMs = new Date(rep.spawnAt).getTime();
    const msLeft = spawnMs - now;

    // A previous run may have alerted some but not all servers in this group
    // (partial failure, or data from before grouping existed) — sync them so
    // the group is only ever alerted once per flag going forward.
    const spawnAlreadySent = group.some((b) => b.alertedSpawn);
    if (spawnAlreadySent) {
      for (const b of group) {
        if (!b.alertedSpawn) {
          b.alertedSpawn = true;
          changed = true;
        }
      }
    }
    const warnAlreadySent = group.some((b) => b.alertedWarn);
    if (warnAlreadySent) {
      for (const b of group) {
        if (!b.alertedWarn) {
          b.alertedWarn = true;
          changed = true;
        }
      }
    }

    if (msLeft <= 0 && !spawnAlreadySent) {
      const res = await sendDiscordAlert({
        kind: "spawn",
        bossName: rep.name,
        servers,
        spawnAt: rep.spawnAt,
      });
      if (res.ok) {
        for (const b of group) b.alertedSpawn = true;
        changed = true;
        alertsSent.push({ id: rep.id, name: rep.name, server: servers.join(", "), kind: "spawn" });
      } else if (res.error) {
        alertErrors.push({ id: rep.id, error: res.error });
      }
    } else if (msLeft > 0 && msLeft <= WARN_MINUTES * 60_000 && !warnAlreadySent) {
      const minutesLeft = Math.max(1, Math.ceil(msLeft / 60_000));
      const res = await sendDiscordAlert({
        kind: "warn",
        bossName: rep.name,
        servers,
        spawnAt: rep.spawnAt,
        minutesLeft,
      });
      if (res.ok) {
        for (const b of group) b.alertedWarn = true;
        changed = true;
        alertsSent.push({ id: rep.id, name: rep.name, server: servers.join(", "), kind: "warn" });
      } else if (res.error) {
        alertErrors.push({ id: rep.id, error: res.error });
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
