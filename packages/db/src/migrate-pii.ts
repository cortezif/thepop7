import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { getPrisma, encryptPII, hashPII } from "./index.js";

/**
 * Migração ADR-013: cifra phone/email/cpf existentes (texto puro) e popula os
 * hashes de busca. Idempotente — valores já cifrados (prefixo enc:) são pulados.
 */
async function main() {
  const prisma = getPrisma();
  const contacts = await prisma.contact.findMany({
    select: { id: true, phone: true, email: true, cpf: true, phoneHash: true, emailHash: true, cpfHash: true },
  });

  let migrated = 0;
  for (const c of contacts) {
    const data: Record<string, string | null> = {};
    if (c.phone && !c.phone.startsWith("enc:")) { data.phone = encryptPII(c.phone); data.phoneHash = hashPII(c.phone); }
    if (c.email && !c.email.startsWith("enc:")) { data.email = encryptPII(c.email); data.emailHash = hashPII(c.email); }
    if (c.cpf && !c.cpf.startsWith("enc:"))     { data.cpf = encryptPII(c.cpf);     data.cpfHash = hashPII(c.cpf); }
    // Repara hash faltante mesmo se já cifrado (não dá pra re-hashear sem o plaintext — pula)
    if (Object.keys(data).length) {
      await prisma.contact.update({ where: { id: c.id }, data });
      migrated++;
    }
  }
  console.log(`PII migrada: ${migrated} de ${contacts.length} contatos cifrados/hasheados.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await getPrisma().$disconnect(); });
