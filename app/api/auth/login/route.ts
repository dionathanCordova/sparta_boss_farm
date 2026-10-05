import { NextRequest, NextResponse } from "next/server";
import { adminUsername, commonUsername, getDailyPassword } from "@/lib/auth";
import {
  createSessionCookieValue,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const username = (body as { username?: unknown })?.username;
  const password = (body as { password?: unknown })?.password;
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Usuário e senha são obrigatórios" }, { status: 400 });
  }

  if (username === adminUsername() && password === process.env.ADMIN_PASSWORD) {
    const cookieValue = createSessionCookieValue({ role: "admin" });
    const res = NextResponse.json({ ok: true, role: "admin" });
    res.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  }

  if (username === commonUsername()) {
    const daily = await getDailyPassword();
    if (daily && password === daily.password) {
      const cookieValue = createSessionCookieValue({ role: "user", v: daily.updatedAt });
      const res = NextResponse.json({ ok: true, role: "user" });
      res.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
      return res;
    }
  }

  return NextResponse.json({ error: "Usuário ou senha incorretos" }, { status: 401 });
}
