process.env.JWT_SECRET = "test-secret-fixo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, signJwt, verifyJwt, requireAuth, requireRole, type AuthClaims } from "./auth.js";

const claims: AuthClaims = { sub: "u1", email: "a@b.com", role: "owner", tenantId: "t1", tenantSlug: "loja-a" };

test("senha: hash + verify (roundtrip) e rejeições", () => {
  const h = hashPassword("segredo123");
  assert.match(h, /^scrypt:/);
  assert.equal(verifyPassword("segredo123", h), true);
  assert.equal(verifyPassword("errada", h), false);
  assert.equal(verifyPassword("segredo123", null), false);
  assert.equal(verifyPassword("segredo123", "lixo"), false);
});

test("senha: mesmo texto gera hashes diferentes (salt) mas ambos verificam", () => {
  const a = hashPassword("x"), b = hashPassword("x");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("x", a), true);
  assert.equal(verifyPassword("x", b), true);
});

test("JWT: sign + verify devolve as claims", () => {
  const token = signJwt(claims);
  const v = verifyJwt(token);
  assert.equal(v!.sub, "u1");
  assert.equal(v!.tenantSlug, "loja-a");
});

test("JWT: assinatura adulterada → null", () => {
  const token = signJwt(claims);
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${"a".repeat(parts[2]!.length)}`;
  assert.equal(verifyJwt(tampered), null);
});

test("JWT: payload adulterado invalida a assinatura → null", () => {
  const token = signJwt(claims);
  const parts = token.split(".");
  const fakePayload = Buffer.from(JSON.stringify({ ...claims, tenantSlug: "loja-b", exp: 9999999999 })).toString("base64url");
  assert.equal(verifyJwt(`${parts[0]}.${fakePayload}.${parts[2]}`), null);
});

test("JWT: expirado → null; malformado → null", () => {
  const expired = signJwt(claims, -10); // exp no passado
  assert.equal(verifyJwt(expired), null);
  assert.equal(verifyJwt("não.é.jwt"), null);
  assert.equal(verifyJwt("só-uma-parte"), null);
});

// --- requireAuth (preHandler) ---
function fakeReply() {
  const state: { code: number; body: any } = { code: 200, body: undefined };
  const reply: any = {
    code(c: number) { state.code = c; return reply; },
    send(b: any) { state.body = b; return reply; },
    _state: state,
  };
  return reply;
}

test("requireAuth: sem token → 401", async () => {
  const reply = fakeReply();
  await requireAuth({ headers: {}, query: {}, body: {} } as any, reply);
  assert.equal(reply._state.code, 401);
});

test("requireAuth: token válido + tenant batendo → passa (anexa req.auth)", async () => {
  const token = signJwt(claims);
  const req: any = { headers: { authorization: `Bearer ${token}` }, query: { tenantSlug: "loja-a" }, body: {} };
  const reply = fakeReply();
  await requireAuth(req, reply);
  assert.equal(reply._state.code, 200, "não deve responder erro");
  assert.equal(req.auth.tenantSlug, "loja-a");
});

test("requireAuth: tenant do request ≠ do token → 403 (isolamento)", async () => {
  const token = signJwt(claims);
  const req: any = { headers: { authorization: `Bearer ${token}` }, query: { tenantSlug: "loja-b" }, body: {} };
  const reply = fakeReply();
  await requireAuth(req, reply);
  assert.equal(reply._state.code, 403);
});

// --- requireRole (preHandler de papel) ---
test("requireRole: papel permitido → passa", async () => {
  const reply = fakeReply();
  await requireRole("owner", "admin")({ auth: { role: "admin" } } as any, reply);
  assert.equal(reply._state.code, 200, "não deve responder erro");
});

test("requireRole: papel insuficiente → 403", async () => {
  const reply = fakeReply();
  await requireRole("owner", "admin")({ auth: { role: "operator" } } as any, reply);
  assert.equal(reply._state.code, 403);
});

test("requireRole: sem auth → 403", async () => {
  const reply = fakeReply();
  await requireRole("owner")({} as any, reply);
  assert.equal(reply._state.code, 403);
});
