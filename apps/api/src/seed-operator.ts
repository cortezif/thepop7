/* Cria/garante um usuário operador de DEMO para login local na loja thepop7.
   Uso: npx tsx apps/api/src/seed-operator.ts   (a partir de C:\tp7) */
import { getPrisma } from "@hubadvisor/db";
import { hashPassword } from "./auth.js";

const EMAIL = "demo@thepop7.com";
const PASSWORD = "demo1234";

async function main() {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug: "thepop7" } });
  if (!tenant) throw new Error("Tenant thepop7 não existe — rode o seed principal antes.");
  const passwordHash = hashPassword(PASSWORD);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: EMAIL } },
    update: { passwordHash },
    create: { tenantId: tenant.id, email: EMAIL, name: "Operador Demo", role: "owner", passwordHash },
  });
  console.log(`✓ Operador demo pronto — login: ${EMAIL} / senha: ${PASSWORD} (loja ${tenant.slug})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
