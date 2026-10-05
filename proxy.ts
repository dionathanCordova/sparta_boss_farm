import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDailyPassword } from "@/lib/auth";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/session";

// Rotas acessíveis sem sessão. /api/cron/check fica de fora de propósito —
// é chamado por um pinger externo (ver README) autenticado via CRON_SECRET,
// não por alguém logado no navegador.
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/cron/check"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionCookieValue(cookie);

  if (!session) {
    return redirectToLogin(request);
  }

  // Senha do dia trocada → sessão de usuário comum some na hora, mesmo que
  // o cookie ainda esteja "válido" (assinatura ok, só a versão ficou velha).
  if (session.role === "user") {
    const daily = await getDailyPassword();
    if (!daily || daily.updatedAt !== session.v) {
      return redirectToLogin(request);
    }
  }

  if (pathname.startsWith("/admin") && session.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/api/auth/daily-password") && session.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin" }, { status: 403 });
  }

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest) {
  const url = new URL("/login", request.url);
  const res = NextResponse.redirect(url);
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
