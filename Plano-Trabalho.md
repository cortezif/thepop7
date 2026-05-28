# Plano de Trabalho — Plataforma de Comércio Autônomo

**Documento companheiro do [ADR-Sistema.md](ADR-Sistema.md)**
**Data de início:** 2026-05-27
**Versão:** 1.0

---

## Estado atual

| Item | Situação |
|---|---|
| Decisões arquiteturais | Documentadas em ADR-Sistema.md (v1.2, 28 ADRs) |
| Material comercial | Folder visual em PDF/PPTX entregue |
| Briefing de equipe | Documento para Thoyama/Iatagan entregue |
| Código | Nada escrito ainda |
| Contas externas | Nenhuma criada ainda |
| Nicho | Definição pendente |
| Equipe técnica | A contratar |
| The Pop 7 | Operando manualmente, sem automação |

---

## Princípios de execução

1. **Validar antes de codar.** Cada fase só começa quando a anterior provou o que precisava provar.
2. **The Pop 7 é o laboratório vivo.** Tudo é construído, medido e ajustado lá primeiro.
3. **Não escalar antes de ter retenção.** Vender pra 10 lojas com produto cru queima reputação.
4. **Decisões irreversíveis (contratos, integrações fiscais, marcas) sempre por Cortez.** Decisões técnicas reversíveis (escolha de lib, schema interno) por quem está codando.
5. **Bloqueador externo destrava antes de começar trabalho técnico que depende dele.** Ex.: não codar mídia paga antes da aprovação Meta Marketing API.

---

## Linha do tempo

```
M0      M1      M2      M3      M4      M5      M6      M7      M8      M9 +
|---F0--|----------F1-----------|--------F2-------|-----F3----|-----F4-----...
```

- **F0** — Destravamento (4 semanas): contas, equipe, nicho, fundações
- **F1** — Laboratório no The Pop 7 (8 semanas): monolítico mínimo rodando
- **F2** — MVP multi-tenant (12 semanas): 3 lojistas piloto pagantes
- **F3** — Ciclo completo (12 semanas): todas as frentes maduras, 15 lojistas
- **F4** — Escala (contínuo): self-service, mais connectors, B2B operando

**Total realista até produto vendável robusto: 9 meses.**

---

# FASE 0 — Destravamento

**Duração:** 4 semanas (06/2026)
**Objetivo:** eliminar todos os bloqueios externos antes da primeira linha de código.
**Critério de saída:** todos os bloqueios da seção "destravar antes de codar" abaixo resolvidos.

## Semana 1 (atual) — Decisões e cadastros

| Quem | O que | Quando |
|---|---|---|
| Cortez | Reunião com Thoyama e Iatagan sobre o briefing | Esta semana |
| Cortez | Resposta às 13 decisões pendentes do briefing | Esta semana |
| Cortez | Definição do nicho exato (decisão #13) | Esta semana |
| Cortez | Início do cadastro Meta Business Verification | Dia 1 |
| Cortez | Início do processo de aprovação WhatsApp Cloud API | Dia 1 |
| Cortez | Início do processo de aprovação Instagram Graph API (Direct) | Dia 1 |
| Cortez | Cadastro PlugNotas (NFe) — sandbox | Dia 3 |
| Cortez | Cadastro Mercado Pago e PagBank — sandbox | Dia 3 |
| Cortez | Acesso de produção ao Bling do The Pop 7 | Dia 3 |
| Cortez | Cadastro Melhor Envio + Frete Rápido — sandbox | Dia 5 |

## Semana 2 — Equipe e infraestrutura

| Quem | O que |
|---|---|
| Cortez | Publicar vaga: 1 dev sênior TypeScript (backend) |
| Cortez | Publicar vaga: 1 dev pleno TypeScript (full-stack) |
| Cortez | Conta Fly.io (ou Railway) com cartão configurado |
| Cortez | Conta GitHub Organization + repositório privado |
| Cortez | Conta Anthropic API com limite mensal configurado |
| Cortez | Conta Doppler (cofre de segredos) |
| Cortez | Conta Sentry + Axiom (observability) |
| Cortez | Conta Linear (gestão de tarefas) |

## Semana 3 — Onboarding técnico

| Quem | O que |
|---|---|
| Cortez | Entrevistas e contratação dos 2 devs |
| Dev sênior | Onboarding: lê ADR-Sistema.md e o plano de trabalho |
| Dev sênior | Setup do monorepo (Turborepo) com 3 apps: api, worker, web |
| Dev sênior | Pipeline CI básico (lint, type, test) |
| Dev sênior | Postgres + Redis no Fly.io ou Neon |
| Cortez | Validação do nicho com 3 conversas a lojistas amigas |

## Semana 4 — Fundações de código

| Quem | O que |
|---|---|
| Dev sênior | Modelo de dados base: tenant, user, contato, produto, pedido |
| Dev sênior | RLS no Postgres ativado e testado |
| Dev sênior | Auth básica (Clerk integrado) |
| Dev sênior | Sistema de filas BullMQ |
| Dev pleno | Painel web vazio (Next.js 15 + Tailwind + shadcn) |
| Dev pleno | Página de login + onboarding placeholder |
| Cortez | Aprovações Meta provavelmente saem nesta semana |

### Checkpoint F0 → F1 (fim da semana 4)

Critérios obrigatórios pra entrar na Fase 1:
- ✅ Meta Business Verification aprovada
- ✅ WhatsApp Cloud API homologada (mesmo que ainda em desenvolvimento)
- ✅ Instagram Graph API com permissões de Direct concedidas
- ✅ Acesso Bling com token de produção do The Pop 7
- ✅ Equipe técnica contratada e operando
- ✅ Monorepo, CI, Postgres com RLS, filas — funcionando
- ✅ Nicho final definido (estilo, ticket, perfil)
- ✅ Tom de voz e políticas do The Pop 7 documentados

**Se algum item falhar, F0 estende em mais 1–2 semanas. Não pular.**

---

# FASE 1 — Laboratório no The Pop 7

**Duração:** 8 semanas (07–08/2026)
**Objetivo:** sistema operando 100% no atendimento do The Pop 7, com Cortez/Thoyama vendo o resultado em produção real.
**Critério de saída:** 30 dias consecutivos com >70% das vendas iniciadas via WhatsApp/IG sendo conduzidas pela IA até o checkout, com NPS positivo da Thoyama.

## Sprint 1.1 (semanas 5–6) — Conexão e catálogo

| Entrega | Detalhe |
|---|---|
| Webhook WhatsApp + IG recebendo | Mensagens chegam ao backend e são persistidas |
| Modelo de Catálogo enriquecido | Schema com todos os atributos (ADR-006) |
| Sincronização Bling → catálogo interno | Job recorrente, cache local |
| Enriquecimento por IA | Haiku sugere atributos a partir de foto + descrição |
| Painel de revisão de catálogo | Thoyama aprova/corrige sugestões em batch |

## Sprint 1.2 (semanas 7–8) — Agente Maya básico

| Entrega | Detalhe |
|---|---|
| System prompt do agente | Tom, políticas, FAQ do The Pop 7 |
| Tools básicas | buscar_produto, mostrar_midia, verificar_estoque, consultar_frete |
| Loop conversacional | Sonnet 4.6 com prompt caching, memória curta no contexto |
| Persistência de perfil | Coleta progressiva de medidas/estilo/ocasião |
| Inbox humano básico | Conversa vista em tempo real, possibilidade de assumir |

## Sprint 1.3 (semanas 9–10) — Checkout e logística

| Entrega | Detalhe |
|---|---|
| Reserva de estoque com TTL | Tabela própria, deduzida do disponível |
| Geração de PIX via Mercado Pago | QR Code + copia-cola entregues no chat |
| Webhook de confirmação de pagamento | Estado do pedido avança automaticamente |
| Emissão de NFe via PlugNotas | XML/PDF retornado e arquivado |
| Etiqueta via Melhor Envio | Geração + envio do código de rastreio à cliente |
| Webhook de tracking | Mudanças de fase → mensagens proativas |

## Sprint 1.4 (semanas 11–12) — Pós-venda e estabilização

| Entrega | Detalhe |
|---|---|
| Jobs agendados | D+1, D+7, D+14 — mensagens proativas |
| Fluxo de devolução | Máquina de estados completa, reembolso automático |
| Painel financeiro básico | Vendas, margem, custo de IA por pedido |
| Observabilidade | Sentry + Axiom rodando, dashboards básicos no Grafana |
| Limites de segurança | Kill-switch, rate limit por número, alertas |

### Checkpoint F1 → F2 (fim da semana 12)

Critérios:
- ✅ 30 dias consecutivos rodando no The Pop 7 sem cair
- ✅ >70% das conversas conduzidas pela IA até venda ou handoff consciente
- ✅ Zero venda perdida por bug de reserva ou pagamento
- ✅ Thoyama considera o atendimento "melhor ou igual" ao manual em qualidade
- ✅ Custo de IA por venda <2% do ticket médio
- ✅ Dados operacionais: ticket médio, taxa de conversão, tempo médio de venda — todos medidos e melhores que linha de base

**Se a Maya estiver alucinando, recomendando errado ou frustrando clientes, F1 estende. Não vender pra outros lojistas com produto ruim.**

---

# FASE 2 — MVP multi-tenant + 3 lojistas piloto

**Duração:** 12 semanas (09–11/2026)
**Objetivo:** transformar o monolito do The Pop 7 em produto vendável e ter 3 lojistas pagantes além do The Pop 7.
**Critério de saída:** 3 lojistas externas pagantes, churn = 0 nos primeiros 60 dias, NPS médio ≥ 8.

## Sprint 2.1 (semanas 13–14) — Multi-tenancy real

- Refatoração com tenant_id em toda tabela
- Políticas RLS ativadas e testadas
- Cofre de segredos por tenant (Doppler)
- Logs/métricas particionados por tenant
- Migração do The Pop 7 pra ser o tenant #1

## Sprint 2.2 (semanas 15–16) — Onboarding self-service

- Fluxo de cadastro de lojista no painel
- Conexão guiada com WhatsApp/IG (OAuth Meta)
- Conexão guiada com Bling (ou ERP escolhido)
- Conexão guiada com gateway de pagamento e NFe
- Importação automática de catálogo + enriquecimento por IA

## Sprint 2.3 (semanas 17–18) — Painel da lojista

- Inbox humano embutido com sugestão de resposta IA
- Configuração do agente (tom, persona, políticas, FAQ)
- Configuração do recomendador (pesos de margem/giro)
- Dashboard diário de vendas, conversões, custo IA
- Gestão de templates de WhatsApp (aprovação via Meta)

## Sprint 2.4 (semanas 19–20) — Mídia paga + B2B alpha

- Conexão com Meta Marketing API
- Criação de campanhas Click-to-WhatsApp
- Sincronização de catálogo com Meta Commerce
- Conversions API integrada
- Primeiros experimentos de criativo por IA (modo supervisionado)
- Spike de MCP Server (catálogo exposto a 1 cliente teste)

## Sprint 2.5 (semanas 21–22) — Compras inteligentes (Bia)

- Cálculo de ponto de pedido
- Cotação automatizada a fornecedores (email + WhatsApp)
- Parser de cotação por IA (texto, foto, áudio)
- Fluxo de aprovação + solicitação de PIX
- Acompanhamento de envio do fornecedor

## Sprint 2.6 (semanas 23–24) — Venda comercial

- Cortez/Iatagan abordam 10 lojistas selecionadas
- Demos ao vivo no The Pop 7
- 3 lojistas assinam contrato + onboarding acompanhado
- Suporte hands-on durante primeiras 4 semanas pra cada

### Checkpoint F2 → F3 (fim da semana 24)

- ✅ 4 tenants em produção (The Pop 7 + 3 pagantes)
- ✅ Churn = 0 nos primeiros 60 dias
- ✅ NPS médio ≥ 8
- ✅ Tempo médio de onboarding < 1 dia
- ✅ Cada novo tenant gerando margem positiva após custos

---

# FASE 3 — Ciclo completo, 15 lojistas

**Duração:** 12 semanas (12/2026–02/2027)
**Objetivo:** maturidade das 9 frentes funcionais, expansão controlada da base.
**Critério de saída:** 15 tenants pagantes, NPS ≥ 8, churn mensal < 5%, NRR > 105%.

## Marcos

| Sprint | Foco |
|---|---|
| 3.1 (25–26) | Fiscal/financeiro completo (custo, margem, conciliação Open Finance) |
| 3.2 (27–28) | Mídia paga otimização autônoma (limites + relatórios em PT) |
| 3.3 (29–30) | Rede B2B (MCP) com 5 lojistas-piloto trocando entre si |
| 3.4 (31–32) | Conectores adicionais: Tray, Nuvemshop, Tiny |
| 3.5 (33–34) | Identidade unificada cross-canal sólida + relatórios avançados |
| 3.6 (35–36) | Venda comercial pra +10 lojistas |

---

# FASE 4 — Escala

**Duração:** contínua (a partir de 03/2027)
**Objetivo:** crescimento sustentável, defensibilidade via rede B2B, expansão de nicho.

- Self-service completo (lojista entra sem suporte humano)
- Shopify, VTEX, mais connectors
- White-label opcional
- SOC 2 Type I (quando justificar)
- Expansão de nicho (lingerie, plus size, moda evangélica focada, masculina)
- Programa de parceiros (agências revendem)

---

# Decisões em aberto / dependências externas

São itens que **bloqueiam a fase em que aparecem**. Resolver assim que possível.

| Item | Bloqueia | Quem | Quando |
|---|---|---|---|
| Definição final do nicho | F1 | Cortez + Thoyama | Semana 1 |
| Aprovação Meta Business | F1 | Cortez | Semana 1–4 |
| Acesso Bling produção | F1 | Cortez | Semana 1 |
| Contratação dos 2 devs | F1 | Cortez | Semana 2–3 |
| Tom de voz The Pop 7 documentado | F1.2 | Thoyama | Semana 4 |
| Lista de fornecedores reais cadastrados | F2.5 | Thoyama | Semana 18 |
| Aprovação Meta Marketing API | F2.4 | Cortez | Semanas 10–18 |
| Modelo fiscal da rede B2B validado | F3.3 | Cortez + contador | Semana 24 |

---

# O que começa agora (próximas 72h)

Em ordem de execução:

1. **Hoje** — Cortez compartilha [Briefing-Equipe.md](Briefing-Equipe.md) com Thoyama e Iatagan e marca reunião pra esta semana.
2. **Hoje** — Cortez inicia processo de Meta Business Verification (link: business.facebook.com/settings, processo demora 24h–10 dias).
3. **Amanhã** — Cortez cadastra conta dev no Anthropic Console com cartão.
4. **Amanhã** — Cortez extrai token de API de produção do Bling do The Pop 7 e guarda no 1Password.
5. **Amanhã** — Cortez cria conta no PlugNotas (sandbox) e estuda o processo de NFe.
6. **Esta semana** — Cortez prepara descrição da vaga "Dev Sênior TypeScript" e posta em LinkedIn + Trampos + Coodesh.
7. **Esta semana** — Reunião com Thoyama: passar pelas 13 decisões do briefing, decidir nicho final.
8. **Esta semana** — Cortez documenta o tom de voz do The Pop 7 (5–10 exemplos de conversas reais que ele aprova) — esse é o seed do system prompt da Maya.
9. **Próxima semana** — Cortez agenda 3 conversas com lojistas amigas pra validar nicho e disposição a pagar.
10. **Dia 14** — Decisão de Go/No-Go com base no que se aprendeu nas duas primeiras semanas.

---

# Riscos do plano (não da arquitetura)

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Meta demora demais a aprovar | Alta | Alto | Iniciar dia 1. Plano B: começar com IG enquanto WhatsApp aprova. |
| Contratação atrasa | Alta | Médio | Começar busca já. Aceitar 1 freelancer pleno se sênior demorar. |
| Cortez gasta tempo em código em vez de produto/vendas | Médio | Alto | Disciplina. Cortez não codifica em produção; revisa decisões. |
| Thoyama não tem tempo de validar IA | Médio | Alto | Pré-acordo de 5h/semana dela na Fase 1. |
| Custo de IA estoura no laboratório | Médio | Médio | Limite mensal por tenant; alertas; degradação para Haiku. |
| Primeiros 3 lojistas piloto não pagam de verdade ("favor") | Médio | Alto | Cobrar mesmo que pouco. Validação real exige dinheiro trocando. |
| Construir features sem validar | Alto | Alto | Cada sprint começa com pergunta de validação. Sem resposta, não codifica. |

---

# Critérios de Go/No-Go entre fases

Não passa pra próxima fase se não bater os critérios. Estende a atual.

- **F0 → F1**: contas aprovadas, equipe contratada, nicho definido
- **F1 → F2**: 30 dias no The Pop 7 com qualidade comprovada
- **F2 → F3**: 3 pagantes externos com retenção
- **F3 → F4**: 15 pagantes, NRR > 105%

---

*Documento vivo. Revisar ao final de cada sprint. Atualizar Estado Atual e Decisões em Aberto.*

*Última atualização: 2026-05-27 — início do plano.*
