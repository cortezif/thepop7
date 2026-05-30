import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { getPrisma } from "@hubadvisor/db";
import { hashPassword } from "./auth.js";

/**
 * Semeia/atualiza um usuário admin do tenant (F2 — auth de operador).
 * Credenciais via env ADMIN_EMAIL/ADMIN_PASSWORD ou defaults de dev.
 * Uso: node --import tsx src/seed-admin.ts
 */
async function main() {
  const prisma = getPrisma();
  const slug = process.env.SEED_TENANT_SLUG ?? "thepop7";
  const email = (process.env.ADMIN_EMAIL ?? "admin@thepop7.local").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD ?? "admin123";

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`tenant ${slug} não encontrado (rode o seed primeiro)`);

  const passwordHash = hashPassword(password);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: { passwordHash, role: "owner" },
    create: { tenantId: tenant.id, email, name: "Admin", role: "owner", passwordHash },
  });

  console.log(`Admin semeado: ${email} (tenant ${slug}).` + (process.env.ADMIN_PASSWORD ? "" : ` Senha dev: "${password}" — defina ADMIN_PASSWORD em produção.`));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await getPrisma().$disconnect(); });
