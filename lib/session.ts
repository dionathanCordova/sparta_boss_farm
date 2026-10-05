import crypto from "node:crypto";

export type SessionPayload = { role: "admin" } | { role: "user"; v: string };

export const SESSION_COOKIE_NAME = "session";

/** Cookie lifetime cap. For role "user" what actually ends the session early
 * is the admin setting a new daily password (its `updatedAt` stops matching
 * the `v` baked into the cookie) — this is just the outer bound. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET não configurada — veja o .env.example");
  }
  return value;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("hex");
}

export function createSessionCookieValue(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionCookieValue(value: string | undefined | null): SessionPayload | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const encoded = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    if (payload?.role === "admin") return { role: "admin" };
    if (payload?.role === "user" && typeof payload.v === "string") {
      return { role: "user", v: payload.v };
    }
    return null;
  } catch {
    return null;
  }
}
