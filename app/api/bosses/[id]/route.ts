import { NextRequest, NextResponse } from "next/server";
import { updateBoss } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const minutes = (body as { minutes?: unknown })?.minutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return NextResponse.json(
      { error: "Campo 'minutes' precisa ser um número >= 0" },
      { status: 400 }
    );
  }

  const spawnAt = new Date(Date.now() + minutes * 60_000).toISOString();

  const updated = await updateBoss(id, {
    spawnAt,
    alertedSpawn: false,
    alertedWarn: false,
  });

  if (!updated) {
    return NextResponse.json({ error: "Boss não encontrado" }, { status: 404 });
  }

  return NextResponse.json({ boss: updated });
}
