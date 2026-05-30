# ADR — Plataforma de Atendimento Conversacional Omnichannel com IA

**Projeto:** Hub Advisor → Produto SaaS multi-segmento (atendimento social com IA + comércio + suprimentos)
**Versão:** 1.3
**Data:** 2026-05-30
**Status:** Proposto

> **Nota de fundação (v1.3, 2026-05-30):** o produto foi renomeado para **Hub Advisor** e ampliado de "varejo de moda" para **qualquer tipo de loja/segmento**. Foi incorporada a função de **Mercadológica / Rede de Fornecedores** (fornecedores se cadastram ofertando preços; a loja roda pesquisa de preços e envia cotações inclusive para fornecedores não cadastrados). Ver **ADR-029**, que funda essa nova direção. Menções a "The Pop 7" e "varejo de moda" ao longo deste documento devem ser lidas sob a ótica do novo posicionamento.

---

## Sumário Executivo

Construir uma plataforma SaaS multi-tenant que conecta, em tempo real, o ERP/catálogo da lojista, o WhatsApp Business e o Instagram Direct a um agente de IA capaz de **vender de forma consultiva**, gerenciar todo o ciclo do pedido (estoque, pagamento, NFe, logística, devolução) e manter comunicação proativa e humanizada com o cliente final — do primeiro "oi" ao pós-venda.

O diferencial competitivo declarado é **humanização real**: respostas contextualizadas, memória persistente da cliente, sugestões pertinentes ao perfil dela (medidas, estilo, ocasião, restrições de modéstia), uso natural de mídia (fotos/vídeos das peças) e iniciativa do agente em informar status da entrega — sem os roteiros rígidos típicos de ManyChat, ChatGuru, Olist e similares.

---

## Visão

> Cliente envia pergunta no Direct ou WhatsApp → o sistema consulta ERP (preço, estoque, pagamento) e Melhor Envio (frete por CEP) em tempo real → responde de forma natural e personalizada → após a compra, acompanha proativamente entrega, devolução e satisfação. Tudo via APIs oficiais Meta, sem risco de banimento.

**Visão expandida (v1.1):** o sistema não é apenas um agente de atendimento. É um **hub autônomo que atua em todas as pontas do negócio** — falando com clientes, fornecedores, transportadores, bancos, fisco e até com outras lojas (B2B). Cada lado é automatizado por default; humano intervém só em exceção. O princípio é: **tudo o que pode ser automatizado, será** — e cada serviço externo crítico tem cadeia de substitutos.

**Visão expandida (v1.2):** o sistema também **adquire o cliente**, não só o atende. Anúncios pagos no Facebook e Instagram (Meta Ads API) são criados, segmentados, otimizados e medidos pelo mesmo núcleo de IA. Como temos dados de primeira parte (perfil, conversas, pedidos, devoluções, NPS), conseguimos audiências, criativos e atribuição que nenhuma agência ou ferramenta externa consegue replicar. O resultado é **funil fechado e autônomo**: anúncio → conversa → venda → entrega → recompra, tudo orquestrado pela mesma IA com mesmo dataset.

---

## Mapa de Stakeholders

O sistema é o núcleo que orquestra **todos os intervenientes** do ciclo de comércio. Cada stakeholder tem fluxos próprios, automatizados:

```
                ┌──────────────────┐   ┌──────────────────────┐
                │   META ADS       │   │   FISCO / CONTÁBIL   │
                │ FB + IG anúncios │   │  NFe, NFCe, SPED     │
                │ criativo, audi-  │   └──────────┬───────────┘
                │ ência, ROAS auto │              │
                └────────┬─────────┘              │
                         │                        │
   ┌──────────────────┐  │  ┌────────────────────▼┐   ┌──────────────────┐
   │   FORNECEDORES   │◀─┼──┤                     ├──▶│  TRANSPORTADORES │
   │ cotação, pedido, │  │  │     NÚCLEO IA       │   │ fallback chain:  │
   │ reposição auto,  │  │  │   (multi-tenant)    │   │ Melhor Envio →   │
   │ PIX, conversa    │  │  │                     │   │ Frete Rápido →   │
   └──────────────────┘  │  │  - Agente Vendas    │   │ Kangu → Loggi    │
                         │  │  - Agente Compras   │   └──────────────────┘
   ┌──────────────────┐  │  │  - Agente Pós-venda │   ┌──────────────────┐
   │ CLIENTE FINAL    │◀─┴──┤  - Agente Mídia     ├──▶│     BANCOS /     │
   │ WhatsApp + IG    │     │  - Orquestrador     │   │   PAGAMENTOS     │
   │ cross-canal      │     │                     │   │ MP, PagBank,     │
   └──────────────────┘     └──┬────────┬─────────┘   │ Asaas (fallback) │
            ▲                  │        │              └──────────────────┘
            │     ┌────────────▼─┐   ┌──▼──────────────┐
   click-to-chat  │   LOJISTA    │   │ OUTRAS LOJAS    │
   ad fecha aqui  │ painel,      │   │ via MCP (B2B    │
                  │ inbox humano │   │ atacado)        │
                  └──────────────┘   └─────────────────┘
```

**Funil fechado**: anúncio (Meta Ads) → click-to-WhatsApp/Direct → Maya atende → venda → Lia pós-venda → recompra (público de retargeting alimentado pelo perfil enriquecido). Cada evento alimenta o próximo via Conversions API.

Cada seta é um conjunto de tools do agente + jobs proativos + webhooks. **Falha de qualquer ponta tem fallback** (ADR-023).

---

## ADR-001 — Apenas APIs oficiais Meta (WhatsApp Cloud API + Instagram Graph API)

**Status:** Aceito

**Contexto.** Alternativas como Z-API, Evolution API, WPPConnect operam sobre WhatsApp Web não-oficial. São baratas e rápidas de integrar, mas violam os ToS do Meta e expõem o número da lojista a banimento permanente. Para um produto vendido a terceiros, isso é risco intransferível e potencialmente fatal ao cliente final.

**Decisão.** Toda comunicação será feita exclusivamente por:
- **WhatsApp Business Platform — Cloud API** (Meta hospeda, sem BSP intermediário no início)
- **Instagram Graph API** (mensagens do Direct via webhook, contas Business/Creator vinculadas a uma Página)
- Ambas integradas via **Meta App** próprio, com autenticação OAuth dos clientes finais (lojistas)

**Consequências.**
- Positivas: zero risco de ban, SLA do Meta, mensagens template oficiais, números verificáveis com selo verde, suporte oficial.
- Negativas: custo por conversa do WhatsApp (categorias de mensagem), processo de aprovação de templates (24–72h), restrição de janela de 24h pra mensagens livres, onboarding mais lento (verificação de negócio).
- Aceitas como custo de fazer certo.

**Alternativas descartadas.** Z-API / Evolution / WPPConnect — incompatíveis com produto comercial.

---

## ADR-002 — Multi-tenant nativo desde o primeiro commit

**Status:** Aceito

**Contexto.** O produto será vendido a múltiplas lojas. Refatorar de single-tenant pra multi-tenant depois custa 10x.

**Decisão.**
- `tenant_id` em **toda** tabela de dados de negócio
- **Postgres com Row-Level Security (RLS)** ativado e políticas por tenant
- Credenciais de cada tenant (tokens Meta, ERP, Melhor Envio, NFe) em cofre dedicado (**Doppler** ou **HashiCorp Vault**), nunca em variáveis de ambiente compartilhadas
- `tenant_id` propagado em logs, filas, traces e métricas
- Subdomínio por cliente no painel (`loja.thepop.app`)

**Consequências.**
- Positivas: isolamento real de dados, conformidade LGPD facilitada, possibilidade de oferecer planos por uso.
- Negativas: complexidade extra em queries e migrations.

---

## ADR-003 — Código próprio em TypeScript, não low-code/n8n

**Status:** Aceito

**Contexto.** n8n e plataformas de automação visual aceleram protótipos, mas falham em produto comercial: difícil testar, versionar, fazer code review, rollback, e debugar em produção. ManyChat/ChatGuru são exatamente isso — e é o motivo deles serem "engessados".

**Decisão.** Stack principal:
- **Runtime:** Node.js 22 + TypeScript estrito
- **Framework:** NestJS (módulos, DI, decorators — padrão pra times)
- **Filas:** BullMQ sobre Redis (mensagens, eventos, jobs agendados)
- **ORM:** Prisma com migrations versionadas
- **Testes:** Vitest + Testcontainers (Postgres real, não mock)
- **Monorepo:** Turborepo (api, worker, web, shared)

**Consequências.**
- Positivas: testabilidade, contratação de devs comum, ferramental maduro, deploy reproduzível.
- Negativas: curva inicial maior que n8n; sem editor visual pra lojistas customizarem fluxos (resolvido por configuração declarativa no painel).

---

## ADR-004 — Núcleo próprio + orquestração de serviços externos

**Status:** Aceito

**Contexto.** A tentação é construir tudo. É o que mata startups. A linha:

| Construir nós | Orquestrar externos |
|---|---|
| Agente conversacional e tools | NFe (PlugNotas / Focus NFe) |
| Catálogo enriquecido + recomendador | ERP (Bling, Tiny, Omie via API) |
| Memória/perfil do cliente | Pagamento (Mercado Pago, Asaas) |
| Reservas e máquina de estados de pedido | Logística (Melhor Envio, Frete Rápido) |
| Inbox de handoff humano | Plataforma e-commerce (Tray, Nuvemshop, Shopify) |
| Painel multi-tenant e billing | Auth (Clerk ou WorkOS) |
| Observabilidade de IA e métricas | Erros/logs (Sentry, Axiom) |

**Decisão.** Construir apenas o que **é o moat** ou não existe como API confiável. NFe brasileira, gateways de pagamento e tracking de transportadora são commodities — usar.

**Consequências.**
- Positivas: foco no diferencial, time-to-market real, menor superfície de manutenção fiscal/regulatória.
- Negativas: dependência de terceiros (mitigada por contratos de SLA e plano B documentado por integração crítica).

---

## ADR-005 — Agente IA com Claude + Tool Use, não fluxo rígido

**Status:** Aceito

**Contexto.** A humanização exigida é incompatível com árvore de decisão. O agente precisa raciocinar sobre a conversa, decidir quando consultar o estoque, quando enviar mídia, quando perguntar medidas, quando recomendar, quando escalar.

**Decisão.**
- **Modelo principal:** Claude Sonnet 4.6 para o agente (qualidade é o que vende)
- **Modelo auxiliar:** Claude Haiku 4.5 para classificação rápida, extração estruturada, enriquecimento de catálogo
- **Prompt caching obrigatório** no system prompt + descrição do catálogo + políticas — corta 80–90% do custo de tokens repetidos
- **Tool use nativo** — o agente expõe funções e o backend executa:

```
buscar_produto(filtros)              consultar_frete(cep, sku)
mostrar_midia(produto_id, tipo)      criar_pedido(itens, endereço, pagto)
verificar_estoque(sku)               status_pedido(id)
reservar_item(sku, ttl)              cancelar_pedido(id, motivo)
atualizar_perfil(cliente, campo)     iniciar_devolucao(pedido_id)
recomendar(perfil, contexto)         escalar_humano(razão)
```

- **System prompt por tenant**, com tom de voz, persona, políticas e FAQ específicos
- **Guardrails determinísticos**: regras de negócio (prazo de devolução, regras de cancelamento, limites de desconto) vivem em código, **não no prompt** — o agente consulta, não inventa

**Consequências.**
- Positivas: respostas naturais, capacidade real de raciocínio, fácil estender com novas tools.
- Negativas: custo variável de IA (mitigado por cache + Haiku); alucinação possível (mitigada por guardrails e por nunca deixar o agente afirmar fato que não veio de uma tool).

---

## ADR-006 — Catálogo enriquecido como propriedade intelectual

**Status:** Aceito

**Contexto.** ERPs guardam SKU, preço, estoque, fotos. Para o agente vender consultivamente, precisa de muito mais: estilo, ocasião, modéstia, medidas reais por tamanho, margem, giro.

**Decisão.** Modelo de produto interno enriquecido, sincronizado com o ERP:

```
produto {
  // do ERP
  sku, nome, preço, estoque, fotos[], variantes[]

  // enriquecido (nosso)
  estilo: [moderno, evangélico, romântico, fitness, festa, casual, …]
  ocasiao: [trabalho, balada, igreja, dia-a-dia, casamento, …]
  modesto: { decote: alto|médio|baixo, transparencia: bool, comprimento, manga }
  fit: { tamanhos[], medidas_reais_por_tamanho: { PP:{busto,cintura,quadril}, … } }
  cores: [{ nome, hex, foto_variante }]
  videos: [{ url, tipo: caimento|detalhe|provador }]

  // métricas de negócio
  margem_bruta, giro_estoque_dias, taxa_devolucao_historica

  // IA
  embedding: vector(1536)   // gerado de tudo acima + descrição
  tags_geradas[]            // sugeridas por LLM, validadas pela lojista
}
```

- **Onboarding inteligente:** ao conectar o ERP, o Haiku analisa nome+descrição+fotos e **sugere** todos os atributos enriquecidos. A lojista revisa em batch. Catálogo inteiro vira inteligente em horas, não semanas.
- **pgvector** no mesmo Postgres pra busca semântica.

**Consequências.**
- Positivas: recomendação que de fato entende a cliente; switching cost alto (catálogo enriquecido fica preso à plataforma).
- Negativas: precisa manter sincronizado com ERP (eventos + reconciliação noturna).

---

## ADR-007 — Memória persistente do cliente final

**Status:** Aceito

**Contexto.** Vendedora boa lembra. Bot sem memória repete perguntas e queima a relação.

**Decisão.** Tabela `cliente_perfil` por contato (telefone + IG handle, unificados quando possível):

```
{
  identidade: { nome, telefone, instagram, email, cpf? }
  fisico: { altura, busto, cintura, quadril, tamanho_usual }
  estilo: { preferencias[], evita[], cores_favoritas[], ocasiao_frequente }
  comportamento: { ticket_medio, frequencia, ultimos_pedidos[], devolveu_motivos[] }
  preferencias: { canal_preferido, horario, frete: barato|rapido }
  contexto: { ultima_conversa_resumo, em_aberto: { reserva, pedido, devolucao } }
}
```

- Coleta **progressiva** — agente nunca dispara questionário, integra perguntas na conversa
- Resumo de conversas anteriores via Haiku, persistido (não fica só no contexto da LLM)
- Cliente pode pedir esquecimento (LGPD) → soft-delete + purga em 30 dias

**Consequências.**
- Positivas: experiência genuinamente personalizada na 2ª, 3ª, 10ª conversa. Esse é o "wow" que ManyChat não entrega.
- Negativas: dados sensíveis → trata como PII confidencial (ADR-013).

---

## ADR-008 — Recomendador híbrido com pesos configuráveis por lojista

**Status:** Aceito

**Contexto.** A lojista quer empurrar produtos de maior margem ou maior estoque, **sem destruir a experiência** com recomendações inadequadas.

**Decisão.** Score por item candidato:

```
score(item, cliente, contexto) =
    w_perfil   · similaridade(embedding_item, embedding_perfil)
  + w_intent   · match(item, intent_atual)
  + w_margem   · normaliza(margem_bruta)
  + w_estoque  · urgencia_giro(item)
  + w_recencia · novidade(item)
  - w_repeticao · ja_ofereceu_recente(item, cliente)
  - w_devolucao · taxa_devolucao_historica(item)
```

- Pesos default conservadores (perfil domina)
- Lojista configura via painel com slider + simulação
- **Trava de segurança:** adequação ao perfil tem peso mínimo não-removível — vender peça errada explode devolução e custa mais do que a margem extra

**Consequências.**
- Positivas: ferramenta real de gestão comercial, não só atendimento.
- Negativas: lojistas vão querer abusar dos pesos; trava previne autodestruição.

---

## ADR-009 — Reservas de estoque transacionais com TTL

**Status:** Aceito

**Contexto.** Sem reserva durante a conversa, duas clientes "compram" a última peça.

**Decisão.**
- Tabela `reserva_estoque(sku, conversa_id, qtd, expira_em)`
- `estoque_disponivel = estoque_real_erp - SUM(reservas_ativas)`
- Reserva criada quando agente entende intenção de compra (não em browsing)
- TTL default 15 min, renovado se a conversa avança
- Conversão em baixa real só após pagamento confirmado
- Webhook do ERP atualiza estoque real; reconciliação noturna

**Consequências.**
- Positivas: zero oversell sem precisar travar o ERP.
- Negativas: leve subestimação do estoque disponível durante picos — aceitável.

---

## ADR-010 — Comunicação proativa orientada a eventos

**Status:** Aceito

**Contexto.** "Que faça uma pesquisa de satisfação alguns dias após a entrega", "informe cada mudança de fase", "lembre o prazo de devolução". Não é polling, é evento.

**Decisão.** Arquitetura orientada a eventos:

- **Webhooks recebidos** (Melhor Envio, gateway pagamento, ERP) → fila → handler decide ação
- **Jobs agendados** (BullMQ delayed): pós-entrega +1d (mensagem de boas-vindas à peça), +7d (lembrete prazo devolução), +14d (NPS produto), +30d (sugestão recompra/upsell)
- **Janela de 24h do WhatsApp:** mensagens proativas fora da janela exigem **template aprovado** pelo Meta — biblioteca de templates pré-aprovados por cenário (rastreamento, entrega, devolução, NPS, recompra)
- Cliente pode optar por receber/não receber cada categoria (LGPD + experiência)

Eventos típicos disparados:
```
pedido_pago              → confirma + estimativa entrega
pedido_postado           → envia código de rastreio
status_envio_mudou       → "Sua encomenda chegou em São Paulo"
saiu_para_entrega        → "Chega hoje! ✨"
entregue                 → "Entregue 14h32 — recebido por Maria"
entrega + 1d             → "Caiu bem? Quer ver outras peças?"
entrega + 7d             → "Você tem até DD/MM pra trocar"
entrega + 14d            → NPS produto + atendimento
entrega + 30d            → sugestão complementar (perfilada)
devolucao_solicitada     → instruções + etiqueta
devolucao_recebida       → "Recebemos! Analisando…"
reembolso_efetuado       → confirmação
```

**Consequências.**
- Positivas: cliente sente acompanhamento real, fidelização mensurável.
- Negativas: precisa gerir templates Meta (aprovação 24–72h); custo de mensagem por categoria.

---

## ADR-011 — Máquinas de estado explícitas para Pedido e Devolução

**Status:** Aceito

**Contexto.** Regras de cancelamento, devolução e reembolso são jurídicas (CDC) e variam por situação. **Não podem viver no prompt do agente.**

**Decisão.** Máquinas de estado em código, agente apenas consulta e dispara transições:

```
PEDIDO
  criado → pago → separado → postado → em_transito → entregue → finalizado
                                  │
                                  ├─→ cancelado (até "postado": livre)
                                  └─→ devolucao (após "entregue": prazo CDC)

DEVOLUCAO
  solicitada → autorizada → etiqueta_emitida → coletado
              → recebido → analisado → { reembolsado | recusado | troca_emitida }
```

- Transições válidas codificadas; tentativa inválida → erro estruturado que o agente comunica humanamente
- Cada transição emite evento → dispara mensagem proativa (ADR-010)
- Regra de prazo (CDC: 7 dias úteis após recebimento pra arrependimento) calculada pelo sistema, não pelo agente

**Consequências.**
- Positivas: conformidade legal; sem alucinação de prazo.
- Negativas: estados precisam ser estendidos com cuidado quando novas regras surgirem.

---

## ADR-012 — Stack de infraestrutura

**Status:** Aceito (revisitar quando passar de ~20 tenants ou ~100k mensagens/dia)

**Decisão.**

| Camada | Escolha | Por quê |
|---|---|---|
| Hosting | **Fly.io** (ou Railway) → migrar pra AWS na escala | Deploy simples, regiões SP, custo previsível inicial |
| Banco principal | **Postgres 16 gerenciado** (Neon ou Supabase) | RLS, JSONB, pgvector, point-in-time recovery |
| Fila/cache | **Redis gerenciado** (Upstash) | BullMQ, sessões, rate limit |
| Object storage | **Cloudflare R2** ou S3 | Mídia recebida/enviada, custos baixos de egress |
| Auth (painel) | **Clerk** ou **WorkOS** | Não construir auth |
| Cofre de segredos | **Doppler** | Por-tenant, rotação fácil |
| NFe | **PlugNotas** | Coberta toda complexidade fiscal BR |
| Logística | **Melhor Envio** + **Frete Rápido** | API maduras, cobertura nacional |
| Pagamento | **Mercado Pago** + **Asaas** | PIX, cartão, boleto, split |
| ERP/E-commerce | Connectors: **Tray, Bling, Nuvemshop** (fase 1); Shopify, Tiny, Omie (fase 2) | Cobre 80% do nicho moda BR |
| Observabilidade | **Sentry** (erros) + **Axiom** (logs) + **Grafana** embarcado (métricas pro cliente) | |
| Frontend painel | **Next.js 15** + Tailwind + shadcn | |

---

## ADR-013 — LGPD, segurança e auditoria

**Status:** Aceito

**Contexto.** Manipulação massiva de PII (nome, telefone, CPF, endereço, medidas corporais, histórico de compra, conversas). Lojista é controlador, nós somos operador.

**Decisão.**
- DPA (Data Processing Agreement) padrão no contrato com cada lojista
- **Criptografia at-rest** no banco; campos sensíveis (CPF, endereço, medidas) com criptografia adicional em coluna
- **Logs sem PII** (mascaramento automático no logger)
- Direito de portabilidade e esquecimento via API e botão no painel
- Retenção configurável por tenant (default: 5 anos de pedidos, 18 meses de conversas)
- Conversas armazenadas mas acesso humano auditado
- Pen-test anual; SOC 2 Type I na escala (quando justificar)
- Acesso interno por SSO + 2FA + audit log

**Consequências.**
- Positivas: defensável juridicamente; tranquiliza lojistas grandes.
- Negativas: custo de implementação e operação contínua.

---

## ADR-014 — Observabilidade de IA e controle de custo

**Status:** Aceito

**Contexto.** Custo de LLM pode estourar; qualidade pode degradar silenciosamente; alucinações causam prejuízo.

**Decisão.**
- Toda chamada à LLM logada: tenant, conversa, modelo, tokens (input/output/cache), latência, custo em R$, resultado da tool
- **Dashboard de custo por tenant** — base pra cobrança por uso
- **Limite por tenant** (alarme + degradação graceful: cai pra Haiku, depois pra fluxo simples)
- **Evals contínuas:** conjunto de casos de teste rodados a cada mudança de prompt/modelo
- **Detecção de alucinação:** se agente afirma fato sem ter chamado tool correspondente, flagga revisão

**Consequências.**
- Positivas: controle financeiro real; base de dados pra otimizar prompt/modelo.
- Negativas: trabalho não-trivial de instrumentação (não é opcional).

---

## ADR-015 — Identidade unificada cross-canal (WhatsApp + Instagram)

**Status:** Aceito

**Contexto.** Cliente pergunta no Instagram, finaliza no WhatsApp. Precisa ser a mesma cliente pra contexto não quebrar.

**Decisão.**
- Entidade `Contato` com múltiplos `identificadores` (telefone, IG ID, email)
- **Unificação automática** quando dois canais convergem (ex.: agente pergunta WhatsApp da pessoa no IG e confere)
- Contexto e perfil únicos; histórico de canal preservado
- Painel de lojista mostra timeline unificada

**Consequências.**
- Positivas: continuidade real cross-canal — outro diferencial vs. concorrência.
- Negativas: lógica de merge precisa ser cuidadosa (conflitos resolvidos com confirmação).

---

## ADR-016 — Handoff humano com inbox próprio

**Status:** Aceito

**Contexto.** IA não resolve tudo. Casos sensíveis (reclamação séria, pedido especial, problema fiscal) precisam de humano. Mandar pra Utalk/Chatwoot externo cria fricção e perde contexto.

**Decisão.** Inbox embutido no painel:
- Conversa unificada (WhatsApp + IG) com histórico completo
- Resumo da conversa gerado pela IA pro humano não ler 80 mensagens
- Sugestão de resposta da IA (humano edita e envia)
- Tags, atribuição, SLA, notas internas
- Modo "co-piloto": agente continua sugerindo enquanto humano conduz

**Consequências.**
- Positivas: experiência fluida pra atendente; contexto nunca se perde.
- Negativas: precisa construir inbox decente — escopo significativo, mas é parte do produto vendável.

---

## ADR-017 — Relatórios e financeiro embutidos

**Status:** Aceito

**Contexto.** "Emita relatórios diários, controle custo e lucro." Lojista precisa enxergar resultado pra renovar contrato.

**Decisão.** Painel com:
- **Diário:** vendas, ticket médio, conversas atendidas, % resolvido por IA, top produtos, devoluções abertas
- **Margem real:** receita - custo - frete - taxa pagamento - custo IA - devoluções
- **Funil conversacional:** abordadas → engajadas → cotaram → compraram → recompraram
- **NPS rastreado:** produto e atendimento separados, com drill-down
- **Alertas:** estoque crítico de top giro, devoluções acima da média, custo IA acima do orçado
- **Export:** CSV, integração contábil (futuro)

Stack: Postgres + view materializada → API → React (recharts). Não usar BI externo no painel (UX ruim e dependência).

**Consequências.**
- Positivas: renovação de contrato data-driven; ferramenta de gestão real.
- Negativas: escopo significativo — priorizar relatórios diários no MVP, drill-downs depois.

---

## ADR-018 — Roteiro de construção em fases

**Status:** Aceito

| Fase | Duração | Escopo | Critério de saída |
|---|---|---|---|
| **0 — Laboratório (The Pop 7)** | 4–8 semanas | Monólito mínimo, multi-tenant já estruturado mas com 1 tenant; WhatsApp Cloud API, Instagram Direct, agente Sonnet com 6 tools básicas (busca, mídia, estoque, frete, criar pedido, status), integração Bling, Melhor Envio, PlugNotas, Mercado Pago. Sem painel sofisticado. | The Pop 7 vendendo com IA, medindo ROI |
| **1 — MVP vendável** | 12 semanas | Painel multi-tenant, onboarding self-service, catálogo enriquecido com sugestão IA, recomendador, memória de cliente, comunicação proativa, máquinas de estado completas (cancelamento, devolução), templates Meta aprovados | 3 lojistas pagantes, métricas de retenção positivas |
| **2 — Ciclo completo** | 12 semanas | Inbox humano embutido, identidade unificada cross-canal, observabilidade de IA, relatórios financeiros, mais connectors (Nuvemshop, Tiny), white-label parcial | 15 lojistas, churn < 5%/mês |
| **3 — Escala** | contínuo | Shopify, marketplace de integrações, planos por volume, SOC 2, expansão de nicho | Métricas de SaaS saudável (NRR > 110%) |

**Total realista até produto sólido: 7–9 meses** com 2 devs sêniores TS + 1 produto/operação (você) + designer part-time.

---

## ADR-021 — Automação total do ciclo com fornecedores

**Status:** Aceito *(detalhes a validar com Thoyama — ver perguntas abertas)*

**Contexto.** Lojista pequena gasta tempo enorme em compras: identificar o que repor, pedir cotação, escolher fornecedor, fazer pedido, pagar PIX, acompanhar envio do fornecedor. Isso é tão automatizável quanto a venda — e ninguém no mercado faz.

**Decisão.** Módulo de **Compras Autônomas** com agente próprio (persona "Compras", separada da "Vendas"):

**1. Reposição preditiva, não reativa.**
- Não basta "estoque < X → repor". Sistema calcula:
  - Velocidade de venda por SKU (média móvel + sazonalidade)
  - Lead time histórico do fornecedor
  - Ponto de pedido = (velocidade × lead time) + estoque de segurança
  - Quantidade ótima = considera desconto por volume vs. custo de capital parado
- Dispara automaticamente quando atinge ponto de pedido. Lojista aprova em 1 clique (ou auto-aprova até limite configurável).

**2. Cotação multi-fornecedor automática.**
- Cadastro de fornecedores por categoria/SKU, com canais (email, WhatsApp) e histórico (preço, prazo, qualidade, taxa de avaria)
- Sistema dispara solicitação de cotação simultânea pra N fornecedores
- Templates personalizados por canal — WhatsApp soa como mensagem humana, não como bot
- Janela de resposta configurável (ex.: 24h)

**3. Parser de cotações recebidas (o ponto mais difícil).**
- Email: parser estruturado + LLM (Haiku) extrai itens, preço, prazo, condições
- WhatsApp: LLM faz o mesmo, mesmo que o fornecedor mande texto solto ("o vestido 042 sai a 28, prazo 5 dias")
- Mídia (foto/print de tabela): Haiku com visão extrai dados
- Sistema normaliza e insere no quadro de cotações

**4. Seleção e fechamento.**
- Ranking automático com pesos configuráveis: preço, prazo, histórico de qualidade, relacionamento
- Recomenda melhor opção; lojista aprova (ou auto-aprova até limite)
- Sistema responde fornecedor escolhido, solicita PIX
- Recebe chave PIX (parser idem), gera comprovante de pagamento (integração bancária — ADR-024), envia ao fornecedor
- Acompanha envio do fornecedor; quando chega, atualiza estoque

**5. Conversa contínua com fornecedor.**
- Mesmo agente conduz follow-up: "Quando posta?", "Tem o código de rastreio?", "Posso adiantar o pedido de junho?"
- Histórico de relacionamento alimenta score de qualidade

**Consequências.**
- Positivas: lojista deixa de gastar 10–20h/semana em compras; otimização real de capital de giro; transparência total da cadeia.
- Negativas: complexidade alta; depende de fornecedores responderem WhatsApp/email — *muitos respondem, mas alguns só por telefone*; parser de cotação tem que ser muito bom.

**Perguntas abertas (validar com Thoyama):**
- Fornecedores do nicho moda BR (sacolões 25 de Março, confecções Brás, Goiânia, Caruaru) aceitam negociar via WhatsApp formal? Que percentual ainda exige ligação?
- Lead time típico e variância? Sazonalidade (datas comemorativas)?
- Existe "fornecedor de confiança" único ou rotação real? Se único, cotação multi é teatro.

---

## ADR-022 — Cadeia de substitutos para todo serviço externo crítico

**Status:** Aceito

**Contexto.** "Se entregador 1 falhar, contate entregador 2." Princípio aplicável a tudo: transportadora, gateway de pagamento, emissor NFe, canal de mensagem, fornecedor.

**Decisão.** Toda integração externa crítica é declarada como uma **cadeia priorizada com health-check**:

```yaml
transportadoras:
  - { provider: melhor_envio, prioridade: 1, condicoes: "padrão" }
  - { provider: frete_rapido, prioridade: 2, condicoes: "se ME indisponível ou frete > X% mais barato" }
  - { provider: kangu,        prioridade: 3, condicoes: "metrópole, mesmo dia" }
  - { provider: loggi,        prioridade: 4, condicoes: "última milha SP/RJ" }

pagamento:
  - { provider: mercado_pago, prioridade: 1 }
  - { provider: pagbank,      prioridade: 2 }
  - { provider: asaas,        prioridade: 3 }

nfe:
  - { provider: plugnotas,  prioridade: 1 }
  - { provider: focus_nfe,  prioridade: 2 }
```

- **Health-check ativo** (ping de status + monitoramento de latência/erro)
- **Failover automático** com critério: se provider primário >X% de erro em janela de Y min → degrada pro próximo
- **Decisão por contexto**, não só por saúde: melhor preço, área de cobertura, prazo
- Painel mostra qual provider está sendo usado e por quê
- Log auditado de cada decisão de roteamento

**Consequências.**
- Positivas: resiliência real; lojista não fica refém de fornecedor único.
- Negativas: precisa manter N integrações em pé; teste de fallback tem que ser regular (caos engineering leve).

---

## ADR-023 — Pagamento entregue no próprio canal (PIX QR + link cartão)

**Status:** Aceito

**Contexto.** Fricção mata venda. Hoje lojista manda "passa o PIX da loja", cliente sai do WhatsApp, abre banco, copia, cola, volta, manda comprovante. **Cada passo perde cliente.**

**Decisão.** Pagamento é gerado e entregue dentro da conversa:

- Agente fecha pedido → sistema gera cobrança no gateway (MP, PagBank, Asaas — ADR-022)
- Envia ao cliente, dentro da mesma conversa:
  - **PIX:** QR Code como imagem + código copia-e-cola + valor + validade
  - **Cartão:** link de checkout (gateway hospeda; PCI nosso problema = zero)
  - **Boleto:** linha digitável + PDF, se requisitado
- Webhook de confirmação → agente avisa proativamente: "Pagamento confirmado! ✨ Vou separar e mandar o código de rastreio assim que postar."
- Sem confirmação em X horas → lembrete suave, depois cancela reserva de estoque
- Reembolso (devolução) usa o mesmo gateway; cliente recebe confirmação no canal

**Consequências.**
- Positivas: conversão maior; reconciliação automática; experiência integrada.
- Negativas: depende de gateways manterem APIs estáveis; taxa do gateway é repassada ou absorvida (decisão comercial do lojista, configurável).

---

## ADR-024 — MCP Server: catálogo agregado exposto a terceiros (rede B2B)

**Status:** Aceito *(decisão estratégica de longo prazo — implementar na Fase 2)*

**Contexto.** Insight do time: o sistema acumula catálogos enriquecidos de N lojas. Esses catálogos podem ser **expostos como rede de atacado** — outras lojas (ou agentes IA delas) buscam produtos, fazem cotações em grosso, compram diretamente. Não existe nada parecido no mercado brasileiro.

**Decisão.** Construir um **MCP Server** (Model Context Protocol — protocolo aberto Anthropic) que expõe o catálogo agregado como ferramentas consumíveis por qualquer cliente compatível (incluindo Claude Desktop, outros agentes IA, e — circular elegante — instâncias do próprio sistema atuando como compradoras).

**Ferramentas MCP expostas:**

```
search_products(query, filtros)      → busca semântica no catálogo agregado
get_product(id)                      → detalhe completo, mídia
check_availability(sku, qtd)         → estoque atacado em tempo real
request_quote(itens, qtd, prazo)     → cotação ao(s) fornecedor(es)
place_wholesale_order(quote_id)      → fecha pedido em grosso
track_wholesale_order(order_id)      → status logístico
list_categories / list_styles        → taxonomia
```

**Modelo:**
- Lojista opta por **expor parte ou todo seu catálogo** ao marketplace B2B (preço atacado configurável; mínimo de quantidade; região atendida)
- Compradora (outra loja) consome via MCP — seja humano via Claude Desktop, seja agente automatizado
- Plataforma cobra **comissão por transação B2B** — nova fonte de receita, distinta da assinatura SaaS
- **Efeito de rede direto:** mais lojas vendedoras → mais oferta → mais lojas compradoras → mais valor pra todas → moat real e crescente
- Identidade, reputação e histórico transacional por participante alimentam ranking e trust score

**Consequências.**
- Positivas: posicionamento único no mercado; pivô natural pra marketplace se a economia favorecer; defensibilidade via efeito de rede.
- Negativas: complexidade fiscal de B2B (substituição tributária, NFe entre empresas, ICMS interestadual); precisa massa crítica de catálogo antes de fazer sentido; modera disputas entre participantes.

**Pergunta aberta:** modelo fiscal — somos marketplace (faturamos comissão) ou facilitador (lojas faturam direto entre si)? Cada um tem implicação tributária e jurídica diferente. Consultar contador antes da Fase 2.

---

## ADR-025 — Princípio operacional: automação total por default

**Status:** Aceito

**Contexto.** "Tudo deve ser automatizado" foi declarado como princípio pelo time. Vira regra de design.

**Decisão.**

- **Default de toda ação automatizável: executar sem intervenção humana**
- Lojista configura **limites e exceções**, não permissões caso-a-caso:
  - Auto-aprovar reposição até R$ X por pedido
  - Auto-pagar fornecedor até R$ Y desde que cotação tenha N propostas
  - Auto-cancelar pedido se cliente pedir e estiver na janela legal
  - Auto-reembolsar devolução de até R$ Z se motivo for padrão
- **Toda ação automatizada é auditável** (log imutável, replay possível) e **reversível** quando tecnicamente possível
- Acima dos limites → notifica humano com sugestão pré-formada (1 clique aprova)
- **Cada decisão automatizada explica-se** ("cotação aceita porque: preço 12% abaixo da média + fornecedor com 98% de pontualidade nos últimos 6 pedidos")

**Consequências.**
- Positivas: produtividade massiva; lojista escala sem aumentar time.
- Negativas: erros automatizados acontecem em escala; mitigação por limites conservadores no início + auditoria + cultura de revisão de exceções.

---

## ADR-026 — Múltiplas personas de agente (separação de domínios)

**Status:** Aceito

**Contexto.** Vender pra cliente final e negociar com fornecedor são tarefas com tom, objetivo e contexto distintos. Misturar num único agente degrada ambos.

**Decisão.** Três personas de agente, cada uma com system prompt e conjunto de tools próprios, mas compartilhando memória e dados:

| Persona | Interage com | Objetivo | Tom |
|---|---|---|---|
| **Maya — Vendas** | Cliente final (WhatsApp/IG) | Consultiva, conversão, fidelização | Acolhedor, sugestivo, brand voice da lojista |
| **Bia — Compras** | Fornecedor | Negociação, cotação, fechamento | Profissional, objetivo, foco em prazo/preço |
| **Lia — Pós-venda** | Cliente após entrega | Acompanhar, satisfazer, recomprar, lidar com devolução | Cuidadoso, resolutivo, empático |

- Nomes/personas customizáveis por tenant
- Memória compartilhada via núcleo (uma cliente que comprou e devolveu é a mesma cliente quando voltar)
- **Orquestrador** decide qual persona entra em cada contexto

**Consequências.**
- Positivas: cada agente é melhor no que faz; prompts mais curtos e focados (= mais barato e mais preciso).
- Negativas: handoff entre personas precisa ser cuidadoso pra não ser percebido pelo cliente final.

---

## ADR-027 — Integração bancária para conciliação e pagamento de fornecedores

**Status:** Proposto *(validar viabilidade técnica — Pix Automático/Open Finance está evoluindo)*

**Contexto.** Pra pagar fornecedor automaticamente (ADR-021), o sistema precisa **executar PIX**, não só receber. Hoje isso é o gargalo: bancos brasileiros têm APIs limitadas, e dar acesso a chave PIX de envio é sensível.

**Decisão tentativa.**

- **Curto prazo:** sistema gera a ordem de pagamento (valor, chave PIX, descrição) e entrega ao lojista pra confirmar no app do banco. Friccão reduzida ao mínimo (deep-link, QR Code).
- **Médio prazo:** integração via **Pix Automático** (regulamentação BACEN evoluindo) ou **APIs bancárias diretas** (Inter, Banco do Brasil, Itaú, Bradesco têm APIs em diferentes maturidades) com OAuth do lojista
- **Open Finance:** integrar pra leitura de extrato → conciliação automática (entrada de cliente, saída pra fornecedor) → fechamento contábil
- Provider abstrato pra trocar quando APIs evoluírem

**Consequências.**
- Positivas: fechamento real do ciclo financeiro; conciliação 100% automatizada.
- Negativas: regulatório/técnico ainda imaturo; risco de fraude se mal feito → exige limites duros e dupla confirmação acima de X.

**Perguntas abertas:** qual banco priorizar como primeiro integrado? Quem do time fica responsável por compliance bancário (KYC, prevenção fraude)?

---

## ADR-028 — Anúncios pagos no Facebook e Instagram com IA (funil fechado)

**Status:** Aceito *(implementar em duas ondas — básico na Fase 1, otimização autônoma na Fase 2)*

**Contexto.** Atender bem é metade da equação; **trazer o cliente** é a outra. Hoje o lojista contrata agência (R$ 1500–5000/mês + verba) ou tenta sozinho no Gerenciador de Anúncios — gasta mal, mede pior, não aproveita os dados de conversa/venda que o próprio sistema gera. Como temos dados de primeira parte ricos (perfil enriquecido, conversas, pedidos, devoluções, NPS), conseguimos **anúncios drasticamente mais eficientes que qualquer ferramenta externa** — porque nenhuma delas tem esses dados.

**Decisão.** Construir módulo de **Mídia Paga Autônoma**, nova persona de agente (**Theo — Mídia**), integrado via **Meta Marketing API** + **Meta Conversions API** + **Catalog API**.

### 1. Capacidades

**Criação e gestão de campanhas:**
- Criar campanhas, conjuntos de anúncios e anúncios programaticamente
- Tipos suportados: tráfego, mensagens (**Click-to-WhatsApp Ads e Click-to-Direct**), vendas (Advantage+ Shopping), reconhecimento, conversão (catálogo dinâmico)
- Orçamento diário/total, agendamento, segmentação, regras de pausa

**Públicos automatizados (a partir do nosso CRM):**
- **Custom Audiences** sincronizados via API (clientes que compraram, que abandonaram conversa, que devolveram, que tiveram NPS alto)
- **Públicos por estágio do funil**: "perguntou e não comprou em 7d", "comprou 1x", "comprou 3x+", "ticket alto"
- **Públicos por perfil enriquecido**: "estilo evangélico + tamanho M+", "comprou festa nos últimos 90d"
- **Lookalike Audiences** geradas a partir dos melhores clientes (LTV alto, NPS alto, baixa devolução)
- **Exclusão automática**: quem já comprou recentemente, quem está em atendimento ativo

**Catálogo de produtos sincronizado:**
- Catálogo enriquecido (ADR-006) sincronizado com **Meta Commerce Catalog** automaticamente
- Atualizações em tempo real (preço, estoque, novos produtos) — produto sem estoque sai dos anúncios na hora
- Habilita **Advantage+ Shopping** e **Dynamic Ads** (anúncios personalizados por usuário automaticamente pelo Meta)

**Click-to-WhatsApp / Click-to-Direct (peça-chave):**
- Anúncios que abrem direto a conversa com a Maya — cliente nem passa pelo site
- Maya recebe contexto: produto do anúncio, criativo clicado, jornada anterior
- **Atribuição direta**: sistema sabe exatamente qual anúncio gerou qual venda (closed loop perfeito)

**Conversions API (atribuição server-side):**
- Cada evento relevante (lead, conversa iniciada, pedido criado, pagamento, devolução) enviado ao Meta via Conversions API
- Otimização do algoritmo do Meta com dados de **conversão real** (não só pixel de site)
- Performance significativamente melhor que concorrentes que só usam pixel/Tag Manager
- Compatível com privacy (iOS 14+, cookies third-party em decadência)

**Criativo gerado por IA:**
- **Copy** (headline, descrição, CTA): Claude gera variações baseadas em produto + brand voice da lojista + cliente-alvo
- **Imagens**: integração com modelo de imagem (Imagen, Flux, Ideogram via API) para variações de fundo, contexto, lifestyle
- **Vídeos curtos**: para Reels/Stories, geração assistida (usa fotos do produto + template + trilha) — explorar Runway/Pika/Luma na Fase 2
- **A/B/n test automático**: roda variações, pausa as ruins, escala as boas
- Lojista pode subir criativo próprio também — IA só sugere/complementa

**Otimização contínua (Fase 2):**
- Theo monitora ROAS, CPA, CTR, frequência por anúncio
- Decisões automatizadas dentro de limites do lojista:
  - Aumentar orçamento de anúncios com ROAS > X
  - Pausar anúncios com CPA acima do alvo após N conversões
  - Refrescar criativo quando frequência > Y
  - Realocar verba entre campanhas
- Reporta semanalmente em linguagem natural: *"Esta semana movi R$ 340 do anúncio 'Vestidos Festa V2' (ROAS 1.8) para 'Conjuntos Evangélicos Lookalike' (ROAS 4.3). Recomendo aumentar verba total em R$ 200/dia — projeto +R$ 1.800 de vendas/semana."*

### 2. Diferencial competitivo

Nenhum concorrente (ManyChat, ChatGuru, Olist, Take Blip, agências) consegue isso porque:
- Não têm o catálogo enriquecido (ADR-006)
- Não têm o perfil enriquecido do cliente (ADR-007)
- Não têm o histórico conversacional ligado à venda
- Tratam ads, atendimento e pós-venda como sistemas separados

**Tese de venda:** *"Substituímos sua agência de R$ 3.000/mês, gastamos sua verba melhor, e o anúncio entrega direto no chat onde a Maya converte. Você paga uma mensalidade só."*

### 3. Modelo comercial

- Plano básico inclui criação/gestão de campanhas até X de verba/mês
- Acima disso: % sobre verba gerenciada (1–3%, abaixo do mercado de agência)
- Verba do Meta paga direto pelo lojista (não passamos no nosso CNPJ — evita complicação fiscal e de fluxo de caixa)
- Alternativa: cobrar por conversão atribuída (CPA) — explorar na Fase 2

**Consequências.**
- Positivas: ticket médio do SaaS muito maior; defensibilidade reforçada (mais um lugar onde os dados de primeira parte importam); funil fechado mensurável ponta-a-ponta = case de venda devastador.
- Negativas: aprovação de Meta Marketing API tem requisitos (Business verification, App Review específico — semanas); orçamento mal otimizado queima dinheiro do cliente em escala = risco reputacional alto; criativo gerado por IA precisa supervisão (marca, direitos de imagem); custo de geração de imagem/vídeo IA não é trivial.

**Mitigações específicas:**
- **Limites duros** de gasto por dia/campanha (ADR-025)
- **Modo "supervisionado"** padrão (lojista aprova antes de subir); modo autônomo só após N campanhas bem-sucedidas
- **Banco de criativos aprovados** por lojista — IA só varia dentro do aprovado
- **Disclaimer claro de IA-gerado** onde Meta exigir
- **Aprovação de Meta App separada** pra escopo de Ads (não bloqueia ADR-001)

**Perguntas abertas:**
- Validação Meta Marketing API + Conversions API + Catalog: tem requisitos formais (Business verification estendida, possivelmente Tech Provider partnership). Quem inicia esse processo? Quanto tempo?
- Geração de imagem: provedor padrão? Limites de direitos autorais (fotos de modelo, ambientes)?
- Para Click-to-WhatsApp Ads: integração com nossa conta WhatsApp Cloud já está homologada para receber clicks de ads? Verificar.

---

## ADR-029 — Fundação Hub Advisor: produto multi-segmento + Mercadológica (rede de fornecedores e pesquisa de preços)

**Status:** Aceito *(decisão de fundação — reposiciona o produto; supersede o escopo "varejo de moda" da v1.0; implementação faseada)*

**Contexto.** O produto nasceu mirando varejo de moda feminina ("The Pop 7"), mas o núcleo construído — atendimento conversacional omnichannel com IA, venda consultiva, estoque, compras, pós-venda, mídia paga e rede B2B — **não tem nada de específico de moda**. É infraestrutura de comércio autônomo que serve farmácia, papelaria, autopeças, materiais de construção, mercearia, pet shop, qualquer loja. Manter a marca e o discurso presos a um nicho limita o mercado endereçável sem nenhum ganho técnico. Em paralelo, identificamos uma lacuna de alto valor na ponta de **suprimentos**: hoje o lojista cota preço com fornecedores de forma manual, dispersa (WhatsApp solto, e-mail, telefone), sem comparar de forma estruturada nem registrar a pesquisa. Já temos um padrão maduro e testado dessa função no app irmão **`C:\ple`** (módulo "Mercadológica" — pesquisa de preços com convites por token, captura inbound por e-mail/formulário, extração de proposta por IA e consolidação estatística). Vamos **portar e adaptar esse padrão** para o varejo privado.

**Decisão.**

### 1. Identidade do produto: **Hub Advisor**

Renomear o produto de "The Pop 7" para **Hub Advisor** e reposicioná-lo como **plataforma multi-segmento** ("recebe todo tipo de loja"). "The Pop 7" passa a ser apenas **uma loja** (um tenant) dentro da plataforma, como qualquer outra (ex.: "Lisianto"). O posicionamento permanece: **hub autônomo que atua em todas as pontas do negócio** — só que agnóstico de vertical.

### 2. Núcleo preservado

Tudo o que já existe continua e é a função primordial: **atendimento pelas redes sociais via robô de IA** (WhatsApp, Instagram, Facebook Messenger e canais futuros — ver ADR-001/015), **venda consultiva**, **controle de estoque**, **compras**, **pós-venda**, **fiscal/logística/pagamento**, **mídia paga** (ADR-028) e **rede B2B** (ADR-024). Nenhuma capacidade é removida; o catálogo enriquecido (ADR-006) e o perfil do cliente (ADR-007) deixam de ser modelados em termos de "moda" (medidas, modéstia) e passam a ter **atributos por segmento configuráveis por tenant**.

### 3. Nova função: **Mercadológica / Rede de Fornecedores** (portada de `C:\ple`)

Função de **pesquisa de preços estruturada**, no estilo da pesquisa mercadológica de licitação, adaptada ao comércio privado. Duas faces:

**a) Cadastro e oferta de preços (lado do fornecedor).**
- Fornecedores se **cadastram** (self-service ou cadastrados pela loja): nome, CNPJ/CPF, e-mail, telefone, UF/município, categorias que atende.
- Cada fornecedor mantém uma **tabela de preços / catálogo de oferta** (itens × preço × validade × condições). É a "vitrine de preços" que a loja consulta.
- Flag **`compartilhavel`** (opt-in): fornecedor aceita aparecer no **pool regional cross-tenant** — várias lojas se beneficiam do mesmo cadastro (efeito de rede, alinhado a ADR-024).

**b) Pesquisa de preços / RFQ (lado da loja).**
- A loja inicia uma **pesquisa (campanha de cotação)** para um item/lista, definindo **prazo** e **método de estimativa** (média / mediana / menor preço).
- Seleciona **fornecedores cadastrados** e/ou informa **fornecedores NÃO cadastrados** (e-mail/WhatsApp ad-hoc). Para estes, o sistema **envia o pedido de cotação** com um **link público tokenizado** — o fornecedor responde sem precisar de conta.
- **Captura de respostas (inbound) multicanal**, espelhando o padrão do `C:\ple`:
  - **E-mail** com *plus-addressing* (`cotacao+<token>@dominio`) → roteado a um handler que casa o token ao convite.
  - **Formulário web público** em `/cotacao/<token>`.
  - **WhatsApp** (Meta Cloud API, ADR-001) — o fornecedor responde no chat e a IA captura.
- **Extração por IA** (Claude, padrão do extrator de `C:\ple`): de e-mail livre, PDF, planilha ou imagem, extrai **valor + detalhes** (validade, prazo de entrega, frete CIF/FOB, condição de pagamento, marca/modelo). Cai para regex de moeda quando trivial, IA quando ambíguo.
- **Consolidação e mapa comparativo**: calcula média, mediana, menor/maior, desvio-padrão, coeficiente de variação; descarta outliers (inexequível / excessivamente elevado) por fator configurável; aplica o método escolhido e devolve a **estimativa**. Gera o **mapa de preços** (planilha comparativa fornecedor × item) — o coração da mercadológica.
- **Cobrança automática (reenvio)**: convites sem resposta após o prazo são reenviados até N tentativas (cron), depois marcados "sem resposta".
- **Aprovação humana opcional**: cotações capturadas por IA/inbound entram **pendentes** para revisão antes de entrar na consolidação (auditável; reprovação é soft-delete com motivo).
- **Painel de monitoramento**: campanhas por status, convites por estado, vencidos, resumo por campanha.
- **Diferença de contexto vs. `C:\ple`**: aqui é varejo **privado**, então **removemos a camada de conformidade pública** (IN SEGES 65/2021, selos CEIS/CNEP/SICAF, gov.br). A validação de fornecedor fica opcional e simples (situação cadastral CNPJ via BrasilAPI). O **motor de consolidação, convites tokenizados, captura inbound e extração por IA são portados praticamente como estão**.

### 4. Posicionamento frente aos ADRs de fornecedor já existentes

- **ADR-021 (Bia — automação do ciclo com fornecedores):** negociação/reposição **proativa** com fornecedores conhecidos (ponto de pedido → cotação → fechamento). Continua.
- **ADR-024 (MCP B2B):** catálogo agregado exposto a terceiros (rede de **atacado**, loja-vende-para-loja). Continua.
- **ADR-029 (Mercadológica — NOVO):** **pesquisa de preços estruturada e marketplace de fornecedores** (fornecedor oferta preço; loja faz "licitação privada" comparando ofertas, inclusive de não cadastrados). É a função de **suprimentos sob demanda**, complementar à reposição automática da Bia.
- **Persona:** fica sob o domínio de **suprimentos da Bia** (ADR-026), como módulo "Mercadológica" — sem criar nova persona, evitando sprawl.

### 5. Rebrand técnico (escopo, execução faseada)

`@thepop/*` → `@hubadvisor/*` (≈86 imports, 10 pacotes); chaves de storage `thepop7_*` → `hubadvisor_*`; evento DOM `thepop7:unauthorized`; slug default; textos de UI e docs; e-mails de exemplo. **Não é bloqueante** — é refactor mecânico que pode rodar numa janela dedicada; o branding visível ao usuário (nome da loja) já é dinâmico por tenant (ver redesign recente), então o rebrand de pacotes é higiene interna.

**Consequências.**
- Positivas: mercado endereçável muito maior (qualquer varejo, não só moda); a Mercadológica é uma função de **alto valor percebido e baixo custo de aquisição** (fornecedor entra de graça, vira efeito de rede); reaproveita padrão **já validado** em produção no `C:\ple` (risco técnico baixo); fecha o ciclo de suprimentos junto com ADR-021/024.
- Negativas: rebrand técnico toca muitos arquivos (risco de regressão se feito sem cuidado); a Mercadológica adiciona superfície nova (captura inbound de e-mail, formulário público tokenizado, fila de aprovação) com seus próprios vetores de abuso/spam; "qualquer segmento" exige tornar configurável o que hoje é específico de moda (catálogo/perfil) — trabalho de generalização.

**Mitigações.**
- Rebrand em **PR isolado e mecânico** (busca-substituição + build verde), separado de features.
- Mercadológica reaproveita o esquema de **token único por convite** + **rate-limit** no formulário público; aprovação humana por default para inbound até ganhar confiança.
- Generalização do catálogo/perfil via **atributos por segmento** (JSON configurável por tenant) — não quebra os tenants de moda existentes.

**Perguntas abertas.**
- Provedor de e-mail transacional + inbound routing (no `C:\ple` é Resend + Cloudflare Email Routing) — adotar o mesmo? Domínio de recebimento de cotações?
- Armazenamento de anexos de proposta (no `C:\ple` é Cloudflare R2) — reusar ou usar storage já previsto na stack?
- Monetização da rede de fornecedores: gratuito para fornecedor sempre? Cobrar destaque/lead? (alinhar com ADR-024).
- Ordem de execução: Mercadológica como Fase 2.x antes ou depois do rebrand técnico completo?

---

## ADR-019 — O que NÃO vamos construir (decisão consciente)

**Status:** Aceito

Lista anti-escopo, revisitar trimestralmente:

- ❌ NFe (PlugNotas resolve)
- ❌ Gateway de pagamento próprio (Mercado Pago/Asaas)
- ❌ Plataforma de e-commerce própria (integramos com Tray/Bling/Nuvemshop)
- ❌ ERP completo (integramos com Bling/Tiny/Omie)
- ❌ Sistema de auth próprio (Clerk/WorkOS)
- ❌ BI/dashboards genéricos (relatórios focados embutidos)
- ❌ App mobile próprio (PWA do painel resolve fase 1)
- ❌ Modelo de IA próprio / fine-tuning de LLM (Claude com prompt caching + RAG resolve)

---

## ADR-020 — Riscos e mitigações

**Status:** Aceito

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Meta muda regras / aumenta preço de mensagem | Média | Alto | Manter abstração de canal; preparar arquitetura pra adicionar Telegram/RCS se necessário |
| Custo de Claude estoura | Média | Médio | Caching obrigatório; Haiku pra tudo que não exige Sonnet; limite por tenant |
| Alucinação causa problema legal (preço errado, prazo errado) | Média | Alto | Guardrails determinísticos; agente só afirma fato que veio de tool; auditoria |
| ERP do cliente fora do ar | Alta | Médio | Cache local de catálogo + degradação graceful ("estou confirmando estoque, te aviso em minutos") |
| Concorrente grande copia | Alta | Médio | Velocidade, foco em nicho (moda), catálogo enriquecido como switching cost, **rede B2B via MCP (ADR-024) como moat de longo prazo** |
| Fornecedor não responde WhatsApp/email (cotação automatizada falha) | Alta | Médio | Cadeia de fornecedores; fallback pra humano; aprendizado de qual fornecedor é "automatizável" |
| Automação executa ação errada em escala (ADR-025) | Média | Alto | Limites conservadores; auditoria; reversibilidade; cultura de revisão semanal de decisões automatizadas |
| Integração bancária pra pagar fornecedor falha/fraude (ADR-027) | Média | Crítico | Limites duros; dupla confirmação acima de X; integrar bancos com APIs maduras primeiro; seguro de cyber |
| Marketplace B2B (MCP) tem problemas fiscais entre tenants | Média | Alto | Modelo fiscal validado com contador antes da Fase 2; contratos claros entre participantes |
| Mídia paga autônoma (ADR-028) queima verba do lojista | Média | Crítico | Modo supervisionado por default; limites duros de gasto; modo autônomo só após histórico bom; alertas em tempo real |
| Aprovação Meta Marketing API demora ou é negada | Média | Alto | Iniciar processo no dia 1 da Fase 1 (não bloqueia atendimento, mas bloqueia ADR-028); plano B: integração via Business Manager manual para clientes iniciais |
| Criativo gerado por IA infringe direitos (imagem de modelo, marca) | Média | Alto | Curadoria humana inicial; banco de criativos aprovados por lojista; disclaimer onde Meta exigir; uso de modelos com licença comercial clara |
| Lojista não preenche catálogo enriquecido | Alta | Alto | Sugestão IA no onboarding (faz 90% do trabalho); UX de revisão em batch |
| LGPD / vazamento | Baixa | Crítico | ADR-013; pen-test; cofre de segredos; criptografia |

---

## Pergunta em aberto pro próximo passo

Antes de escrever uma linha de código, três coisas precisam estar resolvidas:

1. **Conta Meta Business verificada** com WhatsApp Business Platform e Instagram com permissões de Direct (processo de aprovação Meta) — começar ontem
2. **Acesso de produção a 1 ERP** (Bling do The Pop 7) e 1 emissor NFe (PlugNotas) — viabiliza a fase 0
3. **Definição do nicho exato no go-to-market**: "moda feminina BR R$ 50–200 ticket" é diferente de "lingerie" é diferente de "moda evangélica". Cada um muda atributos do catálogo, templates, parceiros.

Resolvidos esses três, a Fase 0 começa.

---

*Documento vivo. Revisar a cada decisão arquitetural relevante e ao final de cada fase.*
