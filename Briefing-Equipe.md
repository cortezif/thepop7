# Briefing — Hub Advisor (produto SaaS)

> **Rebrand (ADR-029):** o produto chama-se **Hub Advisor** e atende qualquer segmento. "The Pop 7" passou a ser a **loja-piloto** (tenant #1) — as menções abaixo a "The Pop 7" referem-se a essa loja, não ao produto.

**Para:** Thoyama, Iatagan
**De:** Cortez
**Data:** 27/05/2026
**Documento técnico completo:** `ADR-Sistema.md`

---

## O que estamos construindo

Não é um chatbot. É um **hub autônomo de comércio** que age por todas as pontas do negócio de uma loja de moda — clientes, fornecedores, transportadores, bancos, fisco, anúncios pagos e até outras lojas (atacado). Tudo orquestrado por IA, com mesmo dataset, sem rigidez de bot.

**Tese de mercado:** ManyChat, ChatGuru, Olist e similares entregam bot engessado. Agências de tráfego cobram caro e otimizam mal. ERPs não conversam com cliente. **Ninguém junta tudo.** Nós juntamos.

**Plano:** validar no The Pop 7 → vender pro Brasil todo.

---

## O ciclo fechado que o sistema executa sozinho

```
ANÚNCIO no FB/IG  →  cliente clica  →  cai na conversa com IA
       ▲                                          │
       │                                          ▼
RECOMPRA / lookalike                       Maya conversa, entende
       ▲                                  perfil, sugere, vende
       │                                          │
   NPS + satisfação                               ▼
       ▲                                  Pagamento PIX/cartão
       │                                  no próprio chat
   Lia pós-venda  ◀──  entrega  ◀── transportadora  ◀── separação
                                                          │
                                  Bia compras repõe ──────┘
                                  estoque no fornecedor
```

Em paralelo: emite NFe, controla estoque, faz cotação multi-fornecedor, paga PIX, concilia banco, gera relatórios.

---

## Três personas de IA

| Quem | Fala com | Faz |
|---|---|---|
| **Maya** | Cliente final (WhatsApp + Instagram) | Vende consultivamente, lembra a cliente, sugere com base em perfil |
| **Bia** | Fornecedores | Pede cotação, negocia, fecha pedido, paga PIX |
| **Lia** | Cliente pós-entrega | Acompanha, lida com devolução, faz NPS, reativa pra recompra |
| **Theo** | Meta Ads (FB/IG) | Cria anúncio, escolhe público, otimiza verba, reporta ROAS |

Memória compartilhada — uma cliente que comprou e devolveu é a mesma quando voltar.

---

## O moat (por que vamos ganhar e segurar)

1. **Dados de primeira parte ricos** (perfil enriquecido + conversas + pedidos + devoluções + NPS) que ninguém mais tem.
2. **Catálogo enriquecido** (estilo, ocasião, modéstia, medidas reais) — switching cost alto.
3. **Funil fechado**: anúncio → conversa → venda → recompra com mesma IA e mesmo dataset = anúncio mais barato + conversão mais alta que qualquer concorrente.
4. **Rede B2B via MCP** (Fase 2): outras lojas se conectam ao nosso catálogo agregado e compram em grosso — efeito de rede crescente.
5. **Tudo via APIs oficiais Meta** — zero risco de ban, defensável comercialmente.

---

## Princípios não-negociáveis

- **APIs oficiais Meta apenas** (WhatsApp Cloud + Instagram Graph + Marketing API). Z-API e similares estão fora.
- **Multi-tenant desde o dia 1.**
- **Automação total por default** — humano só em exceção, com limites configuráveis.
- **Cadeia de substitutos** pra todo serviço externo crítico (se transportadora 1 cai, vai pra 2; se gateway 1 cai, vai pra 2).
- **Núcleo próprio + orquestração de externos** — não reinventamos NFe, gateway de pagamento ou ERP. Usamos PlugNotas, Mercado Pago, Bling.

---

## Fases

| Fase | Tempo | Entrega |
|---|---|---|
| **0 — Laboratório** | 4–8 semanas | Roda no The Pop 7 com escopo mínimo. Validamos ROI real. |
| **1 — MVP vendável** | 3 meses | Painel multi-tenant, onboarding, 3 lojistas pagantes. Inclui Theo (mídia paga) básico. |
| **2 — Ciclo completo** | 3 meses | Inbox humano embutido, identidade cross-canal, ADR-028 otimização autônoma, B2B via MCP iniciado. |
| **3 — Escala** | contínuo | Mais plataformas, white-label, marketplace B2B operando. |

**Total realista: 7–9 meses até produto sólido vendável.** Com 2 devs sêniores + Cortez (produto/vendas) + Thoyama/Iatagan (operação/validação).

---

## Decisões que dependem de vocês (Thoyama e Iatagan)

Pra cada item, **a resposta de vocês determina o que construímos**. Não precisa ser definitivo — é pra começarmos com hipótese realista.

### Sobre fornecedores
1. **Fornecedores moda BR (25 de Março, Brás, Goiânia, Caruaru) negociam por WhatsApp formal?** Que % ainda exige ligação?
2. **Lead time típico do fornecedor**, e quanto varia? Tem sazonalidade pesada (datas)?
3. **Trabalhamos com fornecedor único ou rotacionamos?** Cotação multi só faz sentido se há rotação real.
4. **Quem cadastra o fornecedor no sistema** — Thoyama? Modelo de onboarding?

### Sobre o catálogo
5. **Quem preenche os atributos enriquecidos** (estilo, ocasião, decote, transparência, medidas reais por tamanho)? Proposta: IA sugere a partir de foto + descrição, vocês revisam em batch.
6. **Quais estilos do nicho** importam realmente? (moderno, evangélico, festa, fitness…) — definir taxonomia.

### Sobre operação
7. **Limite de auto-aprovação de reposição** (até R$ X, sistema faz sozinho).
8. **Política de devolução padrão** (prazo, quem paga frete, condições) — vai pra máquina de estados.
9. **Tom de voz da Maya** — alguém precisa decidir como ela "fala" representando o The Pop 7.

### Sobre mídia paga
10. **Verba mensal típica que o The Pop 7 gasta hoje com anúncios?** (ou está zerado?)
11. **Tem agência hoje, ou vai direto no Gerenciador?**
12. **Banco de fotos/criativos próprios** — vocês têm material profissional ou usamos IA + fotos do catálogo?

### Sobre nicho de venda
13. **Vendemos pra "moda feminina em geral" ou focamos sub-nicho** (evangélica, festa, fitness, plus size)? Foco define connector, parceiros, criativo, tudo. **Esta é a decisão mais importante das treze.**

---

## Bloqueios externos pra destravar já

- **Conta Meta Business verificada** (WhatsApp Cloud + Instagram + futura Marketing API). Iniciar processo hoje — leva 2–4 semanas.
- **Acesso a 1 ERP** (sugestão: Bling com a conta do The Pop 7) + cadastro PlugNotas pra NFe.
- **Conta Mercado Pago + PagBank de teste** pra integração de pagamento.

---

## Riscos que estamos assumindo conscientes

- Construir tudo isso é **9 meses de trabalho sério**, não 1 mês.
- **Custo de IA** pode escalar se não controlado (mitigado por caching, modelo certo pra cada tarefa, limites por tenant).
- **Automação em escala erra em escala** — limites conservadores no início.
- **Concorrente grande pode copiar** — nossa defesa é velocidade, foco em moda BR, e rede B2B (que tem efeito de rede).
- **Mídia paga autônoma** pode queimar verba do lojista se mal feito — modo supervisionado obrigatório no começo.

---

## Próximo passo proposto

1. **Vocês respondem** as 13 decisões acima (ou as que conseguirem agora — não precisa ser tudo de uma vez).
2. **Cortez** inicia processo de Meta Business verification e abre contas técnicas.
3. **Definimos data** de início da Fase 0 (laboratório no The Pop 7).

Anotem ideias novas a qualquer hora — o ADR é documento vivo.
