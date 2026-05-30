# Hub Advisor — Plataforma de Comércio Autônomo (multi-segmento)

Monorepo do produto. (Antes "The Pop 7"; renomeado na ADR-029. "The Pop 7" passa a ser apenas uma loja/tenant.)

Documentação de produto e estratégia: [ADR-Sistema.md](ADR-Sistema.md), [Plano-Trabalho.md](Plano-Trabalho.md), [Briefing-Equipe.md](Briefing-Equipe.md).

---

## Estrutura

```
apps/
  api/         Fastify + tenant context (porta 3001)
  worker/      BullMQ workers (filas, jobs agendados)
  web/         Vite + React 19 + Tailwind + shadcn/ui (porta 3000)
packages/
  db/          Prisma schema multi-tenant + cliente + pgvector
  shared/      Tipos, eventos, erros
  agent/       Claude com Tool Use + provider cascade (Groq, Ollama)
  connectors/  ERP, logística, pagamento, fiscal, messaging
  embedding/   Voyage 1024-dim + helpers (portado do adviser-editor)
```

## Stack

- TypeScript 5.5+, Node 20+, npm workspaces, Turborepo
- Postgres 16 + Prisma (RLS por tenant) + pgvector (HNSW)
- Redis + BullMQ
- Fastify + Zod
- Anthropic Claude SDK (cascade: Sonnet → Haiku → Groq → Ollama)
- Voyage AI para embeddings de produto
- Vite 6 + React 19 + Tailwind 3 + Radix UI (painel)

**Alinhada com `C:\adviser-editor`** — mesmo padrão de provider cascade, mesma Voyage para embeddings (1024-dim), mesma stack de frontend (Vite + React 19 + Tailwind + shadcn).

## Requisitos locais

- Node 20+ (`node -v`)
- pnpm 9+ (`npm i -g pnpm@9`)
- Docker (para Postgres e Redis locais)

## Setup

```bash
# 1. Instalar deps
pnpm install

# 2. Subir Postgres e Redis locais
docker run --name thepop-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
docker run --name thepop-redis -p 6379:6379 -d redis:7

# 3. Configurar env
cp .env.example .env
# editar .env: ANTHROPIC_API_KEY no mínimo

# 4. Gerar e aplicar schema
pnpm db:generate
pnpm db:migrate

# 5. Aplicar RLS (manual, uma vez)
psql $DATABASE_URL -f packages/db/prisma/migrations/manual/rls.sql

# 6. Seed inicial
pnpm --filter @hubadvisor/db run seed

# 7. Subir tudo em dev
pnpm dev
```

API em http://localhost:3001 · Painel em http://localhost:3000

## Smoke test do agente

Sem WhatsApp/Instagram reais (`USE_MOCK_CONNECTORS=true` no .env):

```bash
curl -s -X POST http://localhost:3001/conversations/incoming \
  -H "Content-Type: application/json" \
  -d '{
    "tenantSlug": "thepop7",
    "channel": "manual",
    "contact": { "phone": "+5511999990001", "name": "Carol" },
    "text": "Oi! Vi um vestido floral no Instagram. Tem no M?"
  }'
```

Resposta esperada: JSON com `reply` da Maya + lista de `toolCalls` executadas + `cost.estimatedCostBRL`.

## Status do desenvolvimento

- ✅ Scaffolding monorepo
- ✅ Schema Prisma multi-tenant com RLS
- ✅ Conectores com interface estável + mocks
- ✅ Agente Claude (tool use + prompt caching)
- ✅ API com endpoint `/conversations/incoming`
- ✅ Worker com job de expiração de reservas
- 🔄 Próximo: integração real Bling, Mercado Pago, PlugNotas, Meta APIs
- 🔄 Próximo: busca semântica de produtos (pgvector)
- 🔄 Próximo: painel funcional (inbox, configurações, dashboard)

Veja [Plano-Trabalho.md](Plano-Trabalho.md) para o roteiro completo de fases.

## Por que mocks por default

Permite que qualquer dev rode o sistema ponta a ponta **sem credenciais externas** — o agente toma decisões reais, as tools são executadas, dados ficam no Postgres. Quando uma credencial chega (ex: Bling em produção), basta setar `USE_MOCK_CONNECTORS=false` e o connector real assume.

Cada connector externo tem implementação dupla:
- `Mock*` — dev offline, testes, demo
- Implementação real — chama a API do provedor

A `factory.ts` escolhe baseado em variável de ambiente.

## Convenções

- Tudo em TypeScript strict
- IDs CUID
- Datas em UTC
- Dinheiro em `Decimal(10,2)` (BRL)
- Nada de PII em logs (mascarar telefone e CPF)
- `withTenant(tenantId, fn)` em toda operação de tenant — ativa RLS
- Eventos em `EVENTS.*` (packages/shared/events.ts), não strings soltas

## Próximas integrações (ordem de prioridade)

1. **Anthropic** — só precisa de chave; testar agente real com Sonnet 4.6
2. **Bling** — depende de token de produção do The Pop 7
3. **Meta** (WhatsApp + Instagram) — depende de Business Verification
4. **Mercado Pago** — sandbox primeiro
5. **PlugNotas** — sandbox primeiro
6. **Melhor Envio** — sandbox primeiro
