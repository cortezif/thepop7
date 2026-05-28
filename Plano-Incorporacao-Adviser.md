# Plano de Incorporação — adviser-editor → tp7

**Princípio:** copiar e adaptar TUDO o que economize trabalho. Nunca tocar em `C:\adviser-editor`.

**Legenda de cor:**

| 🟢 | 🟡 | 🟠 | 🔴 | ⚫ |
|---|---|---|---|---|
| **Já portado** | **Parcial — completar** | **Pendente, alto valor** | **Pendente, médio valor** | **Não portar** (irrelevante / domínio-específico) |

---

## Mapa rápido — onde estamos

| Métrica | Valor |
|---|---|
| Total identificado pra reuso | **~6.500 linhas** de código testado |
| Já em tp7 | ~1.200 linhas (~18%) |
| Plano completo deste doc | ~4.800 linhas (~74%) |
| Skip consciente | ~500 linhas (~8%) |
| **Economia estimada com plano** | **~250 horas** de engenharia |

---

## 1 · Agente IA (`@tp7/agent`)

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟢 | `anthropicClient.ts` (parcial) | `@tp7/agent` | tools schema unificado | — | feito via SDK direto |
| 🟢 | `cascadeExecutor.ts` core | `packages/agent/providers.ts` | manter Ollama/Groq fallback | — | feito básico; falta smart routing |
| 🟢 | `agentLoop.ts` core | `packages/agent/agent.ts` | tool use loop | — | feito |
| 🟡 | `cascadeExecutor.ts` quality-gate | `packages/agent/providers.ts` | adicionar `min_tokens` + retry hint | 2h | **completar** |
| 🟠 | `aiCache.ts` (LRU + TTL 24h) | `packages/agent/cache.ts` | trocar localStorage → Redis (ou Map em dev) | 3h | crítico pra cortar custo |
| 🟠 | `aiSmartRouting.ts` | `packages/agent/routing.ts` | router por intenção (saudação→Haiku, venda→Sonnet) | 4h | corta custo ~40% |
| 🟠 | `aiExtractors.ts` (380 linhas) | `packages/agent/extractors.ts` | **NÚCLEO do enriquecimento de catálogo** | 6h | **prioridade 1** — Fase 1.1 do plano |
| 🟠 | `aiBatchExecutor.ts` | `apps/worker/jobs/batch-embedding.ts` | rate limit N-paralelo | 3h | pra enriquecer N produtos do catálogo |
| 🔴 | `aiTelemetry.ts` | `packages/agent/telemetry.ts` | persistir em `DomainEvent` | 4h | importante pra dashboard de custo IA |
| 🔴 | `promptStorage.ts` | `packages/db` (tabela `prompt_template`) | trocar localStorage → DB | 5h | versionamento de prompt |
| 🔴 | `systemInstructions.ts` | `packages/agent/instructions.ts` | já temos `tenant.agentTone` no DB | 2h | merge mecânico |
| 🟢 | `aiProviderProxyFetch.ts` | (não precisa — agente roda server-side) | — | — | **não portar** |

**Subtotal**: ~29h. Ganho: agente com cache, smart routing, extração estruturada, telemetria persistente.

---

## 2 · Catálogo e Busca (`@tp7/embedding` + `apps/api/services/product-search.ts`)

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟢 | `voyage.ts` (180l) | `packages/embedding/voyage.ts` | porte literal | — | feito |
| 🟢 | `productText` simples | `packages/embedding/productText.ts` | — | — | feito |
| 🟠 | `chunking.ts` completo (220l, hierárquico h3→§→frase) | `packages/embedding/chunking.ts` | usar pra FAQ + políticas + descrições longas | 4h | **agora** |
| 🟠 | `rerankers/` (Cohere + Voyage cross-encoder) | `packages/embedding/rerankers/` | re-rank top-20 → top-5 | 5h | precisão x2 quando catálogo > 100 itens |
| 🟠 | `searchApi.ts` cliente (596l) | `apps/web/src/lib/search-client.ts` | adaptar pra produto, manter per-user keys | 4h | quando painel for buscar produto |
| 🟠 | `infra/search-api/server.ts` (440l) | `apps/api` (já temos Fastify; absorver endpoints) | hybrid BM25 + semantic + chunks | 8h | quando precisar escalar |
| 🔴 | `reembed.ts` + `reembed-chunks.ts` | `apps/worker/jobs/reembed-products.ts` | re-embedding sob demanda | 3h | quando atributos mudarem em massa |
| ⚫ | jurisprudence schema (V1) | — | domínio jurídico | — | **não portar** |

**Subtotal**: ~24h. Ganho: busca semântica de produção com reranking, chunking robusto.

---

## 3 · UI do Painel (`@tp7/web`)

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟢 | Stack Vite + React 19 + Tailwind + Radix | `apps/web` | — | — | feito |
| 🟠 | `AiChatPanel.tsx` (450l) | `apps/web/src/pages/Inbox.tsx` | **base do Inbox unificado** (já tem placeholder) | 8h | **prioridade 2** — inbox real com streaming |
| 🟠 | `ChatMarkdown.tsx` (120l) | `apps/web/src/components/ChatMarkdown.tsx` | porte direto, render de mensagens | 2h | junto com Inbox |
| 🟠 | `DocumentContextHeader.tsx` | `apps/web/src/components/ConversationHeader.tsx` | header do chat com cliente + perfil | 2h | junto com Inbox |
| 🟠 | `ConfirmDialog.tsx` + outros modais genéricos | `apps/web/src/components/ui/` | shadcn-style | 2h | quando precisar |
| 🟠 | `attachments.ts` (PDF/ZIP) | `apps/web/src/lib/attachments.ts` | cliente quer mandar foto → catálogo enriquece | 4h | onboarding self-service |
| 🟠 | `hooks/useButtonPulseFeedback.ts` etc | `apps/web/src/hooks/` | UX feedback patterns | 1h | polish |
| ⚫ | Editor TipTap completo | — | tp7 não usa editor rico | — | **não portar** |
| ⚫ | BridgeToolbar (extensão browser) | — | irrelevante | — | **não portar** |

**Subtotal**: ~19h. Ganho: Inbox real com stream + componentes UI prontos.

---

## 4 · Backend Patterns (multi-tenant, outbox, audit)

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟢 | Schema multi-tenant | `packages/db/schema.prisma` | Prisma com RLS (diferente do schema-per-tenant do adviser) | — | feito |
| 🟢 | `withTenant()` transaction wrapper | `packages/db/src/index.ts` | porte da ideia | — | feito |
| 🟠 | `TenantContextFilter` (X-Tenant-Id header) | `apps/api/src/plugins/tenant-context.ts` | trocar `tenantSlug` no body por header HTTP | 3h | onboarding multi-tenant exige |
| 🟠 | `OutboxAdminService` + dispatcher (400l) | `apps/worker/jobs/outbox-dispatcher.ts` + `apps/api/admin/outbox.ts` | **crítico pra webhooks Meta** | 12h | **prioridade 3** — quando Meta aprovar |
| 🟠 | `audit_hash_chain` (V1__baseline.sql) | `packages/db/schema.prisma` + service | tabela append-only com hash encadeado | 6h | compliance LGPD futura |
| 🟠 | `OutboxMessageSink` composto (webhook + log) | `packages/agent/outbox-sinks.ts` | sink plugável | 4h | parte do dispatcher |
| 🔴 | Admin provision tenants (`/api/v1/admin/tenants`) | `apps/api/routes/admin.ts` | criar tenant via API com X-Admin-Secret | 4h | Fase 2.2 — onboarding self-service |
| 🔴 | Flyway → Prisma migrations versionadas | `packages/db/prisma/migrations/` | hoje usamos `db push` (dev) | 3h | antes de produção |
| ⚫ | Schema-per-tenant (`SET LOCAL search_path`) | — | escolhemos RLS (ADR-002) | — | **não portar** — incompatível com RLS |

**Subtotal**: ~32h. Ganho: webhooks confiáveis (Meta, Mercado Pago, Melhor Envio), auditoria, multi-tenant production-grade.

---

## 5 · Qualidade & Avaliação (`scripts/`, `e2e/`)

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟠 | `scripts/search-eval.ts` (NDCG@K vs gold set) | `scripts/maya-eval.ts` | **fixture de conversas + score** | 8h | **prioridade alta** — sem isso, mudar prompt é apostar |
| 🟠 | `scripts/ai-envelope-smoke.ts` | `scripts/agent-smoke.ts` | smoke test agente + tools | 3h | CI gate |
| 🟠 | `scripts/enrich-documents.ts` | `scripts/enrich-catalog.ts` | batch enrichment do catálogo via Haiku | 4h | onboarding de novo tenant |
| 🟠 | Playwright config + estrutura | `e2e/` | E2E painel + conversa | 6h | antes da Fase 2 |
| 🔴 | `roundtrip-smoke.ts` | — | adapt: ciclo pedido→entrega→devolução | 8h | regression test crítico |
| 🟠 | `test:search` quality gate no CI | `.github/workflows/ci.yml` | bloqueia merge se eval regredir | 2h | junto com `maya-eval.ts` |

**Subtotal**: ~31h. Ganho: confiança em mudanças de prompt; CI que detecta regressão de qualidade.

---

## 6 · Connectors externos

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟠 | `functions/api/ai/anthropic.ts` (proxy subsidy resolver) | `apps/api/routes/proxy/ai.ts` | só se for expor LLM pro frontend (não é caso agora) | 4h | adiar |
| 🟠 | `functions/api/login.ts` / `register.ts` / `me.ts` | `apps/api/routes/auth.ts` | adaptar; ou usar Clerk/WorkOS | 8h | Fase 2.2 |
| ⚫ | `datajud/*`, `legal/*`, `bau.ts` | — | jurídico-específico | — | **não portar** |
| ⚫ | `jurisprudence/proxy.ts` | — | mesmo motivo | — | **não portar** |

**Subtotal**: ~12h. Ganho: auth funcional, base pra subsidy resolver de IA.

---

## 7 · Storages e helpers

| 🎨 | Adviser | tp7 destino | Adaptação | Esforço | Status / Próximo passo |
|---|---|---|---|---|---|
| 🟠 | `modelBank/aiDedupHelper.ts` | `packages/agent/dedup.ts` | dedup semântico de mensagens repetidas | 3h | qualidade do inbox humano |
| 🟠 | `modelBank/transcribeMedia.ts` (Whisper) | `apps/worker/jobs/transcribe-audio.ts` | **cliente manda áudio no WhatsApp** | 4h | feature óbvia do produto |
| 🟠 | `modelBank/inlineExtractors.ts` (regex) | `packages/shared/extractors.ts` | CEP, CPF, telefone — patterns | 2h | tools auxiliares |
| 🟠 | `packages/markdown/` (MD ↔ MdDoc) | `packages/shared/markdown.ts` | render no painel | 3h | quando precisar formatar resposta da IA |
| 🟠 | `packages/document-model/` envelope | `packages/shared/document.ts` | base de documento estruturado | 3h | se for armazenar transcripts de áudio |
| 🟠 | `profiles/types.ts` (sistema plugável) | `packages/shared/profile.ts` | per-tenant config sofisticada | 4h | Fase 3 (white-label) |
| ⚫ | Editor profile components | — | editor-specific | — | **não portar** |

**Subtotal**: ~19h. Ganho: voice (Whisper), dedup, extração regex, base de doc.

---

## Tabela-resumo: ordem de execução

Prioridade pelo **ROI** (valor alto + bloqueia próxima fase):

| Ordem | Item | Esforço | Bloqueia | Por que agora |
|---|---|---|---|---|
| 1 | 🟢 `aiExtractors.ts` → `packages/agent/extractors.ts` ✓ | 6h | Enriquecimento de catálogo (Fase 1.1) | **FEITO** — pipeline ponta-a-ponta operando (falha só na chave Anthropic) |
| 2 | 🟢 `aiCache.ts` → cache LRU server-side ✓ | 3h | Custo de IA | **FEITO** — `packages/agent/cache.ts`, integrado no provider Anthropic, endpoint `/admin/cache/stats` |
| 3 | 🟢 `chunking.ts` hierárquico ✓ | 4h | FAQ + políticas no contexto | **FEITO** — porte literal 216 linhas, h3→§→frase com overlap, smoke test OK |
| 4 | 🟢 `aiSmartRouting.ts` → router por intenção ✓ | 4h | Custo de IA | **FEITO** — detecta saudação/venda/reclamação/browse, escolhe Sonnet vs Haiku |
| 5 | 🟢 `AiChatPanel.tsx` + `ChatMarkdown.tsx` ✓ | 10h | Inbox humano (Fase 1.2) | **FEITO** — Inbox real validado no navegador: lista, thread c/ tabelas markdown, chips de tools, custo, reply humano, simulador |
| 6 | 🟠 `scripts/maya-eval.ts` (search-eval adaptado) | 8h | Mudança de prompt sem regressão | Crítico pra refinar a Maya com segurança |
| 7 | 🟠 `OutboxDispatcher` + dead-letter | 12h | Webhooks Meta (Fase 1.3) | Mensagem perdida = venda perdida |
| 8 | 🟠 `X-Tenant-Id` header middleware | 3h | Multi-tenant production | Hoje vem no body — frágil |
| 9 | 🟠 `transcribeMedia.ts` (Whisper) | 4h | Áudio no WhatsApp | Cliente vai mandar áudio — temos que entender |
| 10 | 🟠 `rerankers/` | 5h | Precisão quando catálogo crescer | Só vira gargalo depois de 100+ produtos |
| 11 | 🟢 Métricas/telemetria no Dashboard ✓ | 4h | Dashboard de custo IA | **FEITO** — endpoint `/metrics/daily` + Dashboard com dados reais (custo IA, % resolvido, distribuição de modelos, catálogo) |
| 12 | 🟠 `audit_hash_chain` | 6h | Compliance LGPD futura | Pode ficar Fase 3 |

**Total: ~69h de trabalho focado** que destrava as Fases 1.1 → 1.3 do plano original.

---

## O que NÃO vamos portar (decisão consciente)

| Item | Motivo |
|---|---|
| Editor TipTap completo + EditorWorkspace | tp7 não tem editor rico de documento |
| Schema-per-tenant (Spring Boot) | Conflito com nossa decisão de RLS (ADR-002) |
| Tauri desktop / bridge-protocol | tp7 é web/SaaS |
| Jurisprudência (datajud, legal, bau) | Domínio jurídico, irrelevante |
| Profile institucional (85 instituições) | Domínio jurídico |
| Logos / paletas-adviser | Branding deles |
| Roundtrip-smoke editor | Editor-específico |
| AiProviderProxyFetch (CF Functions) | Agente roda server-side em tp7 |

---

## Próximo passo proposto

Sigo a **ordem 1 → 12** acima, em sprints curtos. Posso começar **agora** pelo item 1 (`aiExtractors.ts` adaptado para enriquecimento de catálogo de moda).

Resposta esperada:
- "vai" → começo pelo item 1
- "muda a ordem para X, Y, Z" → reordeno e começo
- "antes disso, resolva o DB" → finalizo Neon e depois portamos
- "porta tudo em paralelo" → não recomendo, mas faço se insistir

*Documento vivo. Atualizar conforme cada item passa de 🟠 pra 🟢.*
