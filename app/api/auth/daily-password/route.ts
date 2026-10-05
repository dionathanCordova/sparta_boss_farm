import { NextRequest, NextResponse } from "next/server";
import { setDailyPassword } from "@/lib/auth";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * proxy.ts já bloqueia isso pra quem não é admin, mas Server Actions e Route
 * Handlers devem se tratar como endpoint público e reverificar sozinhos —
 * ver node_modules/next/dist/docs/01-app/02-guides/authentication.md.
 */
export async function POST(req: NextRequest) {
  const session = verifySessionCookieValue(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const password = (body as { password?: unknown })?.password;
  if (typeof password !== "string" || password.trim().length < 4) {
    return NextResponse.json(
      { error: "A senha do dia precisa ter pelo menos 4 caracteres" },
      { status: 400 }
    );
  }

  const data = await setDailyPassword(password.trim());
  return NextResponse.json({ ok: true, updatedAt: data.updatedAt });
}
