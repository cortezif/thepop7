#!/usr/bin/env node
/**
 * Bootstrap idempotente: sobe DB, aplica migrations, RLS, pgvector, seed.
 * Pré-requisito: Docker Desktop rodando.
 *
 * Uso:  node scripts/bootstrap.mjs
 */
import { execSync, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

function sh(cmd, opts = {}) {
  console.log(`\n→ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function shTry(cmd) {
  const r = spawnSync(cmd, { shell: true, stdio: "pipe" });
  return r.status === 0;
}

// 0. Verifica Docker
console.log("→ verificando Docker daemon...");
if (!shTry("docker info")) {
  console.error("\n✗ Docker daemon não está rodando.");
  console.error("  Abra o Docker Desktop e rode esse script de novo.");
  process.exit(1);
}

// 1. Sobe containers
sh("docker compose up -d");

// 2. Espera Postgres ficar healthy
console.log("→ aguardando Postgres healthy...");
for (let i = 0; i < 30; i++) {
  if (shTry("docker exec thepop-pg pg_isready -U postgres")) {
    console.log("  Postgres ✓");
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}

// 3. Lê .env pra obter DATABASE_URL
const envPath = resolve(ROOT, ".env");
if (!existsSync(envPath)) {
  console.error("✗ Arquivo .env não encontrado. Copie .env.example → .env e ajuste.");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const DATABASE_URL = env.DATABASE_URL;

// 4. Prisma generate + sincroniza schema (db push é mais rápido pra dev local;
//    `migrate dev` é pra commitar histórico — fazer separadamente quando
//    o schema estabilizar).
sh("npx prisma generate --schema=packages/db/prisma/schema.prisma");
sh("npx prisma db push --schema=packages/db/prisma/schema.prisma --accept-data-loss", {
  env: { ...process.env, DATABASE_URL },
});

// 5. Aplica RLS (SQL manual)
console.log("→ aplicando RLS...");
sh(`docker exec -i thepop-pg psql -U postgres -d thepop < packages/db/prisma/migrations/manual/rls.sql`);

// 6. Aplica pgvector + índices HNSW
console.log("→ aplicando pgvector + HNSW...");
sh(`docker exec -i thepop-pg psql -U postgres -d thepop < packages/db/prisma/migrations/manual/pgvector.sql`);

// 7. Seed
sh("npm --workspace @thepop/db run seed", { env: { ...process.env, DATABASE_URL } });

console.log("\n✓ Bootstrap completo. Stack pronto pra:\n");
console.log("    npm run dev:api      # API em :3001");
console.log("    npm run dev:worker   # Worker em filas BullMQ");
console.log("    npm run dev:web      # Painel Vite em :3000");
