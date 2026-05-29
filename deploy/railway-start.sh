#!/bin/sh
# Início no Railway: prepara o banco (idempotente) e sobe a API (que serve o painel).
set -e

echo "[start] aplicando schema no banco..."
npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate

echo "[start] seed (loja-exemplo + produtos, idempotente)..."
node --import tsx packages/db/src/seed.ts || echo "[start] seed pulado"

echo "[start] seed admin (usa ADMIN_EMAIL/ADMIN_PASSWORD)..."
node --import tsx apps/api/src/seed-admin.ts || echo "[start] seed-admin pulado"

echo "[start] subindo API + painel..."
exec node --import tsx apps/api/src/main.ts
