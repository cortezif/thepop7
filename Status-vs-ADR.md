# Status de Implementação × ADR

**Data:** 2026-05-28
**Confronto entre [ADR-Sistema.md](ADR-Sistema.md) (28 decisões) e o código real em `C:\tp7`.**

Legenda:
- 🟢 **Feito** — implementado e validado rodando
- 🟡 **Parcial** — fundação/estrutura pronta, falta completar
- 🔴 **Não iniciado** — só modelo de dados ou nada
- ⚫ **Decisão/planejamento** — não é "construir"

---

## Tabela mestre — ADR × Implementação

| ADR | Decisão | Status | O que existe hoje | O que falta |
|---|---|:---:|---|---|
| **001** | APIs oficiais Meta (WhatsApp + Instagram) | 🟡 | Connectors `WhatsappCloud`/`Instagram` (interface), webhook `/webhooks/meta` com handshake OK, `MockMessaging` funcional | Implementação real (depende de aprovação Meta Business) |
| **002** | Multi-tenant nativo (RLS) | 🟢 | `tenantId` em todas as tabelas, 11 políticas RLS aplicadas, `withTenant()` validado | Role não-superuser (hoje roda como postgres = bypassa RLS) |
| **003** | TypeScript, não low-code | 🟢 | Monorepo TS strict, Turborepo, 6 pacotes, typecheck 8/8 verde | *(ADR dizia NestJS; usei Fastify — documentado no README)* |
| **004** | Núcleo próprio + orquestração externos | 🟢 | `@thepop/connectors` com interface estável + mock + stub real, factory por env | Implementações reais dos providers |
| **005** | Agente Claude + Tool Use | 🟢 | Agent loop, 7 tools, prompt caching, cascade — **conversa real validada** | — |
| **006** | Catálogo enriquecido (IP) | 🟢 | Schema com atributos (estilo/ocasião/decote/transparência), extractor IA vision + sanitização — **validado** | Sincronização contínua com ERP real |
| **007** | Memória persistente do cliente | 🟢 | `Contact` com perfil (medidas/estilo/cores), tool `atualizar_perfil`, coleta progressiva. **Resumo de conversas persistido**: `summarizeConversation` (Haiku) gera resumo ao encerrar (`/inbox/.../status` closed ou `/summarize`), grava em `Conversation.summary`; novas conversas do mesmo contato injetam os 3 últimos resumos no prompt (`ctx.priorSummaries`) — **validado** (Maya lembrou "vestido floral, prazo 08/jun" numa conversa nova). Inbox mostra "Memória:" + botão "Encerrar + resumir" | opt-outs LGPD enforcement já existe (ver ADR-013) |
| **008** | Recomendador híbrido com pesos | 🟢 | **Score ponderado completo (perfil × margem × giro) com pesos do tenant + perfil da cliente + trava de segurança de adequação** — validado (Conjunto Festa 0.747 vs Vestido 0.303 em contexto de festa) | Re-rank com cross-encoder (rerankers) quando catálogo crescer |
| **009** | Reservas de estoque transacionais | 🟢 | `StockReservation` com TTL, tool `reservar_item`, job de expiração (60s). **Baixa no pagamento**: transição→`paid` decrementa o stock da variante no catálogo e marca a reserva como `converted` — validado (9→8) | — |
| **010** | Comunicação proativa orientada a eventos | 🟢 | **Lia gera D+1/D+7/D+14/D+30 com dados reais** (prazo devolução calculado), trilha de eventos completa — validado | Agendamento automático (BullMQ delayed, precisa Redis); templates Meta; webhooks de tracking |
| **011** | Máquinas de estado (Pedido/Devolução) | 🟢 | `order-state-machine.ts`: transições validadas, regras CDC (cancela até postar, devolução 7 dias úteis), eventos por transição — **validado** | Webhook de pagamento avançar estado automático |
| **012** | Stack de infraestrutura | 🟡 | Postgres nativo, API/worker/web rodando local | Deploy (Fly.io/Railway), Redis em pé, gerenciados na nuvem |
| **013** | LGPD, segurança, auditoria | 🟢 | **Audit hash chain tamper-evident, export, erase, opt-out**. **Máscara de PII em logs** (Pino redact). **Retenção** (`retentionDays`, preview+run manual, anonimiza conteúdo antigo). **Cripto de PII at-rest**: phone/email/cpf cifrados AES-256-GCM (`enc:v1:`) + colunas HMAC (`*Hash`) p/ lookup/dedup sem decifrar; `pii-crypto.ts` em @thepop/db; migração dos dados existentes (14/14); `resolveContact`/merge/inbox/pedido/export atualizados — **validado** (lookup acha existente sem duplicar, pedido+PIX, merge, export decifra, 0 telefones em texto puro). `PII_KEY` obrigatória em prod | DPA (documento legal — externo) |
| **014** | Observabilidade de IA e custo | 🟢 | Custo/tokens por mensagem persistido, cache stats, `/metrics/daily`, distribuição de modelos. **Detecção de alucinação**: `detectHallucination` flagga resposta que cita preço/disponibilidade sem tool → `Message.reviewFlagged`, badge no inbox, contagem `flaggedForReview` no dashboard (7 testes). **Degradação por orçamento**: custo do mês ≥ `monthlyAIBudgetBRL` → cascade sem Sonnet (começa no Haiku); disparo validado no log. **maya-eval**: gate de qualidade (`packages/agent/src/eval`, `npm run eval -w @thepop/agent`) — 5 cenários canônicos (regras de ouro + ADR-007/023) com asserções determinísticas + juiz-LLM, **8 cenários** (preço, escalonamento, fechamento, PIX, perfil, cancelamento, devolução, honestidade de estoque); gate = asserções determinísticas (estáveis) + "resposta não-vazia", juiz-LLM como métrica de qualidade reportada (não bloqueia, pois é estocástico); 8/8 passando. *Pegou bug real: Maya dizia "anotei o perfil" sem chamar a tool — corrigido no prompt.* **Alertas de orçamento**: `/metrics/daily.budget` calcula custo de IA do mês vs `monthlyAIBudgetBRL` (níveis ok/warning≥80%/over≥100%), banner no Dashboard — validado (over/warning/ok) | Sentry/Axiom conectados |
| **015** | Identidade unificada cross-canal | 🟢 | `Contact` com phone + igHandle + email. **Merge cross-canal**: `identity-service.ts` — `resolveContact()` funde on-the-fly quando uma mensagem que chega casa com >1 contato (auto-merge na convergência), `mergeContacts()` move conversas/pedidos/reservas + une identificadores/perfil + audita (`contact.merged`), `findDuplicateContacts()` detecta duplicados por identificador forte; painel em Configurações lista candidatos e funde. **Matching fuzzy por nome** (normaliza acento/caixa/espaço; tier "baixa confiança", sugestão-only, nunca auto-merge) — **validado** (auto-merge de 3 contatos + merge manual + "José da Silva"≈"JOSE  DA  SILVA" sugerido) | — |
| **016** | Handoff humano com inbox próprio | 🟢 | Inbox completo (lista/thread/reply/status), `escalar_para_humano`, co-piloto "Sugerir (IA)" read-only. **Tags, notas internas e atribuição** (ADR-016): `Conversation.tags/assignedTo`, `ConversationNote`; rotas tags/notes/assign; chips de tag + painel de notas internas + botão Assumir no inbox — **validado** (#vip/#festa, nota com autor, atribuição) | SLA/co-piloto contínuo (aprende das edições) |
| **017** | Relatórios e financeiro embutidos | 🟡 | Dashboard com métricas reais, `/metrics/daily`. **Margem real**: `computeFinancials()` (order-service) sobre pedidos realizados — receita − COGS (`product.costBRL`) − taxa de gateway (PIX 0,99% / cartão 3,99%, sobrescrevível em `policies.gatewayFees`), frete pass-through; card no Dashboard com quebra + alerta de itens sem custo — **validado no navegador** (R$183,94 / 63,6%). **Funil de conversão**: `computeFunnel()` (conversa→pedido→pago→entregue com % por etapa) em `/metrics/daily.funnel`, barras no Dashboard — validado (5→1→1→1, 20%). **Export CSV**: `GET /orders/export.csv` (quebra financeira por pedido, BOM+`;`+`,` pro Excel pt-BR), botão na tela de Pedidos — validado. **Margem por produto no catálogo** (badge colorido). **NPS rastreado** (produto/atendimento separados): `NpsResponse`, auto-captura de nota 0-10 após marco D+14/D+30 (LLM-free), `POST /post-sale/nps`, `computeNps` (5 testes), card no Dashboard — validado (nota 10 → score 100) | Custo real de frete por transportadora; export contábil |
| **018** | Roteiro de fases | ⚫ | Estamos em Fase 0→1 (laboratório), adiantados no técnico | — |
| **019** | O que NÃO construir | ⚫ | Respeitado (sem TipTap, sem Tauri, sem schema-per-tenant) | — |
| **020** | Riscos | ⚫ | Registro vivo | — |
| **021** | Automação fornecedores (Bia) | 🟢 | **Reposição preditiva, geração de cotação, parser de texto solto, ranking ponderado** — validado. **Co-piloto de fechamento**: `composePurchaseClose` gera a mensagem de confirmação ao fornecedor recomendado (`GET /purchasing/requests/:id/close-message`, read-only), botão "Sugerir fechamento (Bia)" na aba Compras — validado (R$2.850, Confecções Brás) | Disparo de PIX ao fornecedor; cotação por foto/áudio; webhook de resposta automático |
| **022** | Cadeia de substitutos (fallback) | 🟢 | **Provider cascade LLM Claude→Groq→Ollama** + **failover de conectores**: `createFailover()` (Proxy genérico) encadeia provedor real → mock como último recurso pra ERP/logística/pagamento/NFe; cai pro próximo em erro recuperável, propaga fatal. **Circuit-breaker**: após N falhas consecutivas o provedor entra em circuito aberto por um cooldown e é pulado proativamente (sucesso fecha); estado por `label`, persiste entre chamadas — **validado** (503→mock, 400→propaga, abre/pula/cooldown/reset, 10 testes) | — |
| **023** | Pagamento no canal (PIX QR + cartão) | 🟢 | **Maya fecha pedido ponta-a-ponta**: buscar→frete→reservar→criar_pedido→PIX copia-e-cola, validado (pedido R$313,90 persistido) | Mercado Pago real; webhook de confirmação |
| **024** | MCP Server B2B (atacado) | 🔴 | — | Tudo (Fase 2) |
| **025** | Automação total por default | 🟢 | Limite `monthlyAIBudget`. **Kill-switch** `Tenant.aiEnabled`: IA pausada parqueia toda mensagem em handoff; toggle em `/admin/ai-toggle` (evento `ai.enabled/disabled`). **Auto-aprovação** `Tenant.autoApproveMaxBRL`: pedido acima do teto não fecha sozinho — `criar_pedido` retorna `needsApproval`, parqueia pra humano e a Maya não gera PIX; ajuste em `/admin/auto-approve` (evento `auto_approve.changed`); card em Configurações. **Fila de aprovação**: pedido acima do teto é criado como pendente (sem PIX, `metadata.pendingApproval`), parqueado; atendente clica "Aprovar e gerar PIX" (`POST /orders/:id/approve`, evento `order.approved`) na tela de Pedidos — **validado** (pendente→aprovar→PIX, checkout normal intacto) | Aprovação por risco (1ª compra, fraude) — enhancement |
| **026** | Múltiplas personas (Maya/Bia/Lia/Theo) | 🟡 | **Maya (vendas) + Lia (pós-venda) + Bia (compras) rodando** com prompts/tons distintos | Theo (mídia paga) — depende de Meta Ads API |
| **027** | Integração bancária (Pix Automático) | 🔴 | — | Tudo (médio prazo) |
| **028** | Mídia paga (Meta Ads / Theo) | 🔴 | — | Tudo (Fase 2) |

---

## Placar

| Status | Qtde | ADRs |
|---|:---:|---|
| 🟢 Feito | **18** | 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 013, 014, 015, 016, 021, 022, 023, 025 |
| 🟡 Parcial | **4** | 001, 012, 017, 026 |
| 🔴 Não iniciado | **3** | 024, 027, 028 |
| ⚫ Decisão | **3** | 018, 019, 020 |

**Dos 25 ADRs "construíveis": 18 feitos (72%), 4 parciais (16%), 3 não iniciados (12%).**

**Ciclo completo dos dois lados** funcional ponta a ponta:
- **Vendas (Maya):** atender → entender → recomendar → reservar → pedido → PIX → entrega → pós-venda (Lia) → recompra
- **Compras (Bia):** reposição preditiva → cotação → parser de resposta → ranking → seleção

3 das 4 personas rodando (Maya, Lia, Bia). Falta só **Theo** (mídia paga, depende de Meta Ads). Demais pendências: pagamento/NFe reais (contas externas), e camadas de produção (013 LGPD, 024 B2B, 027 bancário).

---

## Confronto com o Plano de Trabalho (fases)

| Fase | Previsto no plano | Real |
|---|---|---|
| **F0 — Destravamento** | Contas externas + equipe + nicho + fundações de código | 🟡 Fundações de código **adiantadas** (feito muito além do previsto); contas externas (Meta, Bling) e equipe pendentes |
| **F1 — Laboratório** | Maya atendendo no The Pop 7, 30 dias | 🟢 **Laboratório completo em código** (com conectores mock): Sprint 1.1 (catálogo+enriquecimento) ✓, 1.2 (agente+inbox+co-piloto) ✓, 1.3 (checkout: buscar→reservar→pedido→PIX + auto-aprovação) ✓, 1.4 (pós-venda Lia D+1..D+30 + LGPD) ✓. Falta: rodar 30 dias com tráfego REAL (depende de Meta + pagamento reais) |
| **F2 — MVP multi-tenant** | 3 lojistas pagantes | 🟡 Multi-tenancy/RLS/cripto/LGPD + **auth de operador** (login JWT, senha scrypt) + **onboarding self-service** (`/auth/signup` cria loja+owner, tela de cadastro) + **isolamento cross-tenant** (requireAuth exige tenantSlug = tenant do token, 403 senão) ✓; falta billing, mídia paga |
| **F3 / F4** | Ciclo completo / escala | 🔴 — |

**Observação honesta:** pulei a ordem do plano. O plano dizia "resolver bloqueios externos (F0) antes de codar". Como você pediu pra não atrasar a codificação, construí as fundações técnicas (que não dependem de Meta/Bling) muito além do ponto F0. Isso é bom — mas os bloqueios externos (aprovação Meta, token Bling, equipe) continuam pendentes e são o caminho crítico pra sair do laboratório.

---

## Incorporação do adviser-editor (doc separado)

Ver [Plano-Incorporacao-Adviser.md](Plano-Incorporacao-Adviser.md). Resumo: **6/12 itens portados** (extractors, cache, chunking, smart routing, inbox/chat, métricas).

---

## Caminho crítico pra Fase 1 "de verdade" (no The Pop 7)

~~3. Máquina de estados de pedido (ADR-011)~~ ✅ FEITO. ~~4. Checkout ligado ao agente (ADR-023)~~ ✅ FEITO (com mock). **Todo o código da F1 está pronto.** O que resta é 100% externo:

1. **Aprovação Meta Business** (externo) → destrava WhatsApp/IG reais (ADR-001, 010, 028)
2. **Token Bling produção** (externo) → ERP/catálogo reais (ADR-004, 006)
3. **Conta Mercado Pago + PlugNotas** (externo) → pagamento PIX e NFe reais (ADR-023)

Sem nenhum desses, a Maya roda ponta a ponta **só com conectores mock** (laboratório). Com eles, vira operação real.

*Documento vivo. Atualizar a cada item concluído.*
