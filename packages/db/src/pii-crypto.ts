import crypto from "node:crypto";

/* ============================================================
   Criptografia de PII at-rest (ADR-013).

   - phone/email/cpf são cifrados com AES-256-GCM antes de gravar.
   - Para permitir busca exata (resolveContact) e dedup sem decifrar,
     guardamos também um HMAC-SHA256 determinístico em colunas *Hash.
   - Valores cifrados ganham o prefixo "enc:v1:" → dá pra detectar dado
     ainda em texto puro (migração idempotente) e decifrar com segurança.

   Chave: env PII_KEY (hex de 64 chars = 32 bytes). Em dev, cai num default
   FIXO marcado — NÃO usar em produção (defina PII_KEY no ambiente real).
   ============================================================ */

const PREFIX = "enc:v1:";
const DEV_KEY_HEX = "0".repeat(64); // 32 bytes de zero — só dev/local

function masterKey(): Buffer {
  const hex = process.env.PII_KEY ?? DEV_KEY_HEX;
  if (!process.env.PII_KEY && process.env.NODE_ENV === "production") {
    throw new Error("PII_KEY ausente em produção — defina uma chave de 32 bytes (hex).");
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error("PII_KEY deve ter 32 bytes (64 chars hex).");
  return buf;
}
const aesKey = () => masterKey();
const hmacKey = () => crypto.createHash("sha256").update(Buffer.concat([masterKey(), Buffer.from(":hmac")])).digest();

/** Normaliza pro hash: trim; e-mail em minúsculas. Mantém consistência entre escrita e busca. */
function normalizeForHash(value: string): string {
  const v = value.trim();
  return v.includes("@") ? v.toLowerCase() : v;
}

/** Cifra um valor de PII. null/"" passam direto. Idempotente (não re-cifra). */
export function encryptPII(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  if (plain.startsWith(PREFIX)) return plain; // já cifrado
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decifra. Valores sem o prefixo (texto puro/legado) voltam como estão. */
export function decryptPII(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // texto puro/legado
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return stored; // não falha o fluxo se algo estiver inconsistente
  }
}

/** HMAC determinístico pra lookup/dedup. null/"" → null. */
export function hashPII(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  // Se vier cifrado por engano, não dá pra hashear o plaintext — retorna null.
  if (plain.startsWith(PREFIX)) return null;
  return crypto.createHmac("sha256", hmacKey()).update(normalizeForHash(plain)).digest("hex");
}
