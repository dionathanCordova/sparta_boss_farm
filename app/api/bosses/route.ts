import { NextResponse } from "next/server";
import { getBosses, isPersistenceDurable } from "@/lib/store";
import { isDiscordConfigured } from "@/lib/discord";
import { WARN_MINUTES } from "@/lib/bosses";

export const dynamic = "force-dynamic";

export async function GET() {
  const bosses = await getBosses();
  return NextResponse.json({
    bosses,
    now: new Date().toISOString(),
    discordConfigured: isDiscordConfigured(),
    persistenceDurable: isPersistenceDurable(),
    warnMinutes: WARN_MINUTES,
  });
}
