#!/bin/sh
# Início no Railway: prepara o banco (idempotente) e sobe a API (que serve o painel).
set -e

echo "[start] aplicando schema no banco..."
npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate

echo "[start] seed (loja-exemplo + produtos, idempotente)..."
node --import tsx packages/db/src/seed.ts || echo "[start] seed pulado"

echo "[start] seed admin (usa ADMIN_EMAIL/ADMIN_PASSWORD)..."
node --import tsx apps/api/src/seed-admin.ts || echo "[start] seed-admin pulado"

# RLS (multi-tenant, ADR-002) — aplica DEPOIS dos seeds (que rodam como superuser)
# e ANTES de subir a API. Idempotente (DROP+CREATE). Não-fatal: defesa em
# profundidade não deve impedir o boot. Usa `prisma db execute` (TCP via
# DATABASE_URL), sem depender do cliente psql no container.
echo "[start] aplicando RLS (idempotente)..."
npx prisma db execute --schema packages/db/prisma/schema.prisma \
  --file packages/db/prisma/migrations/manual/rls.sql || echo "[start] RLS pulado"

echo "[start] subindo API + painel..."
exec node --import tsx apps/api/src/main.ts
