import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/* ============================================================
   Auth de operador (F2 / ADR-013): senha com scrypt + JWT HS256.
   Sem dependência externa — usa só node:crypto. Chave: env JWT_SECRET
   (dev usa fallback fixo, marcado; prod DEVE definir).
   ============================================================ */

function jwtSecret(): string {
  const s = process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me";
  if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET ausente em produção.");
  }
  return s;
}

// ---- Senha (scrypt) ----
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.startsWith("scrypt:")) return false;
  const [, saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(plain, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// ---- JWT HS256 ----
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (data: string) => crypto.createHmac("sha256", jwtSecret()).update(data).digest("base64url");

export type AuthClaims = { sub: string; email: string; role: string; tenantId: string; tenantSlug: string };

export function signJwt(claims: AuthClaims, ttlSeconds = 60 * 60 * 12): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export function verifyJwt(token: string): (AuthClaims & { exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (sign(`${header}.${payload}`) !== sig) return null; // assinatura inválida
  try {
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null; // expirado
    return claims;
  } catch {
    return null;
  }
}

// ---- preHandler de proteção ----
declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthClaims & { exp: number };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const claims = token ? verifyJwt(token) : null;
  if (!claims) {
    reply.code(401).send({ error: "não autenticado" });
    return reply; // interrompe a cadeia
  }
  // Isolamento multi-tenant: o tenantSlug pedido (query/body) DEVE bater com o
  // do token — impede operador de uma loja acessar dados de outra.
  const requested = (req.query as any)?.tenantSlug ?? (req.body as any)?.tenantSlug;
  if (requested && requested !== claims.tenantSlug) {
    reply.code(403).send({ error: "tenant não autorizado" });
    return reply;
  }
  req.auth = claims;
}
