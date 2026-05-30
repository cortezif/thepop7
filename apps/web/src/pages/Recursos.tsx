import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";

// Visão geral de TODOS os recursos do sistema, por área, com status e link pra
// tela onde cada um vive. Catálogo curado (não consulta API) — é a "vitrine" das
// funções pra qualquer pessoa enxergar tudo numa tela só.

type St = "ok" | "partial" | "blocked";
type Item = { label: string; status: St; note?: string };
type Area = { title: string; icon: string; to?: string; items: Item[] };

const AREAS: Area[] = [
  {
    title: "Atendimento e vendas (Maya)", icon: "🛒", to: "/inbox",
    items: [
      { label: "Conversa com o cliente (entende, responde, fecha venda)", status: "ok" },
      { label: "Cliente manda foto → acha peças parecidas", status: "ok" },
      { label: "Recomenda por estilo/ocasião/cor + margem e giro", status: "ok" },
      { label: "Recomenda tamanho pelas medidas do corpo", status: "ok" },
      { label: "Reserva a peça no estoque (com expiração)", status: "ok" },
      { label: "Calcula o frete", status: "ok" },
      { label: "Fecha o pedido ponta a ponta", status: "ok" },
      { label: "Atender no WhatsApp/Instagram reais", status: "blocked", note: "aprovação Meta" },
    ],
  },
  {
    title: "Pagamento", icon: "💳", to: "/pedidos",
    items: [
      { label: "Gera o PIX (copia-e-cola) na conversa", status: "ok" },
      { label: "Baixa o estoque quando o cliente paga", status: "ok" },
      { label: "Cobrança PIX real (Mercado Pago)", status: "blocked", note: "conta MP" },
      { label: "Confirmação automática de pagamento (webhook)", status: "blocked" },
    ],
  },
  {
    title: "Nota fiscal (NFe)", icon: "🧾", to: "/pedidos",
    items: [
      { label: "Emite a nota automaticamente quando o pedido é pago", status: "ok" },
      { label: "Coloca o código de barras (cEAN) na nota", status: "ok" },
      { label: "Mostra a nota + link do DANFE (PDF)", status: "ok" },
      { label: "Reemite a nota com um clique se falhar", status: "ok" },
      { label: "Alerta de notas pendentes no painel", status: "ok" },
      { label: "Manda o link da nota pro cliente (D+1)", status: "ok" },
      { label: "Emitir nota de verdade pelo CPlug", status: "blocked", note: "credencial CPlug" },
    ],
  },
  {
    title: "Estoque + código de barras", icon: "📦", to: "/estoque",
    items: [
      { label: "Cada peça (cor/tamanho) tem código de barras (EAN-13)", status: "ok" },
      { label: "Importa código da Tray; gera pros que faltam", status: "ok" },
      { label: "Bipou o código → mostra a peça e a foto", status: "ok" },
      { label: "Tem a foto → descobre o código (busca visual)", status: "ok" },
      { label: "Livro-caixa do estoque (toda entrada e saída)", status: "ok" },
      { label: "Recebimento de fornecedor (bipando)", status: "ok" },
      { label: "Saída por venda (varejo e atacado)", status: "ok" },
      { label: "Devolução que reentra no estoque (bipando)", status: "ok" },
      { label: "Ajuste/balanço e quebra/perda (bipando)", status: "ok" },
      { label: "Rastreabilidade: histórico e saldo de cada código", status: "ok" },
      { label: "Arquivo único de etiquetas (CSV e ZPL/Zebra)", status: "ok" },
      { label: "Conferência de envio (bipa os itens antes de despachar)", status: "ok", note: "na tela Pedidos" },
      { label: "Tela de inventário/contagem cíclica dedicada", status: "partial" },
    ],
  },
  {
    title: "Logística, envio e devolução", icon: "🚚", to: "/pedidos",
    items: [
      { label: "Ciclo do pedido (criado→pago→enviado→entregue)", status: "ok" },
      { label: "Conferência de separação por scan", status: "ok" },
      { label: "Devolução dentro do prazo legal (7 dias úteis)", status: "ok" },
      { label: "Recebimento da devolução → reentra estoque", status: "ok" },
      { label: "Cotação/etiqueta/rastreio reais (Melhor Envio)", status: "blocked" },
    ],
  },
  {
    title: "Pós-venda (Lia)", icon: "📨", to: "/pedidos",
    items: [
      { label: "Mensagens automáticas D+1, D+7, D+14, D+30", status: "ok" },
      { label: "Agendamento automático dessas mensagens", status: "ok" },
      { label: "Lembra troca, manda a nota, pede avaliação, sugere recompra", status: "ok" },
      { label: "Captura NPS (0–10) de produto e atendimento", status: "ok" },
      { label: "Respeita quem pediu pra não receber (LGPD)", status: "ok" },
    ],
  },
  {
    title: "Compras e fornecedores (Bia)", icon: "🏭", to: "/compras",
    items: [
      { label: "Reposição preditiva (avisa o que está acabando)", status: "ok" },
      { label: "Gera cotação e lê respostas em texto solto", status: "ok" },
      { label: "Ranqueia fornecedores (preço × prazo × relação)", status: "ok" },
      { label: "Sugere a mensagem de fechamento", status: "ok" },
      { label: "Conferência de recebimento da compra (bipando)", status: "ok" },
      { label: "Continua funcionando mesmo se a IA cair", status: "ok" },
      { label: "Pagar o fornecedor (PIX) sozinha", status: "blocked", note: "decisão + banco" },
    ],
  },
  {
    title: "Financeiro e relatórios", icon: "📊", to: "/",
    items: [
      { label: "Painel com métricas reais", status: "ok" },
      { label: "Margem real (receita − custo − taxa)", status: "ok" },
      { label: "Resultado de frete (cobrado − pago) na margem", status: "ok" },
      { label: "Funil de conversão", status: "ok" },
      { label: "Exportação contábil (CSV com nota, frete, margem)", status: "ok" },
      { label: "Margem por produto + alerta de item sem custo", status: "ok" },
      { label: "Alerta de orçamento de IA estourando", status: "ok" },
    ],
  },
  {
    title: "Cliente, identidade e memória", icon: "👤", to: "/settings",
    items: [
      { label: "Guarda perfil (medidas, estilo, cores) e aprende", status: "ok" },
      { label: "Lembra de conversas antigas do mesmo cliente", status: "ok" },
      { label: "Junta o mesmo cliente em canais diferentes", status: "ok" },
      { label: "Detecta cadastros duplicados (até por nome)", status: "ok" },
    ],
  },
  {
    title: "Atendimento humano (inbox)", icon: "🙋", to: "/inbox",
    items: [
      { label: "Caixa de entrada própria (lista, conversa, status)", status: "ok" },
      { label: "IA escala pro humano quando precisa", status: "ok" },
      { label: "Co-piloto 'Sugerir resposta' (humano revisa)", status: "ok" },
      { label: "Tags, notas internas e atribuição", status: "ok" },
    ],
  },
  {
    title: "Segurança e LGPD", icon: "🔒", to: "/settings",
    items: [
      { label: "Dados sensíveis (telefone/e-mail/CPF) criptografados", status: "ok" },
      { label: "Trilha de auditoria à prova de adulteração", status: "ok" },
      { label: "Exportar / apagar dados do cliente (LGPD)", status: "ok" },
      { label: "Esconde dados pessoais dos logs", status: "ok" },
      { label: "Retenção automática (anonimiza dados antigos)", status: "ok" },
      { label: "Cada loja só enxerga os próprios dados", status: "ok" },
    ],
  },
  {
    title: 'Controle / automação (o "juiz")', icon: "⚖️", to: "/settings",
    items: [
      { label: "Botão de pânico (desliga a IA → tudo pro humano)", status: "ok" },
      { label: "Limite de auto-aprovação (acima de X, humano confirma)", status: "ok" },
      { label: "Fila de aprovação de pedidos grandes", status: "ok" },
      { label: "Detector de 'invenção' da IA (marca pra revisão)", status: "ok" },
      { label: "Trava de orçamento (usa modelo mais barato)", status: "ok" },
    ],
  },
  {
    title: "Rede de atacado entre lojas (B2B)", icon: "🌐", to: "/catalog",
    items: [
      { label: "Expõe o catálogo pra outras lojas comprarem em grosso", status: "ok" },
      { label: "Loja escolhe o que expor, preço de atacado e mínimo", status: "ok" },
      { label: "Comprador busca, cota, fecha e acompanha (login por chave)", status: "ok" },
      { label: "Pedido de atacado baixa o estoque do vendedor", status: "ok" },
      { label: "Comissão da plataforma + painel de receita", status: "ok", note: "em /plataforma" },
      { label: "Nota fiscal entre empresas (B2B)", status: "blocked", note: "decisão contábil" },
    ],
  },
  {
    title: "Robustez / infraestrutura", icon: "🛠️",
    items: [
      { label: "Se a IA principal cair, usa outra (Claude→Gemini→Groq…)", status: "ok" },
      { label: "Se um serviço externo cair, usa o reserva (e volta sozinho)", status: "ok" },
      { label: "Multi-loja + cadastro self-service + login", status: "ok" },
      { label: "Estar no ar de verdade (Redis/worker/MCP na nuvem)", status: "partial" },
    ],
  },
];

const BADGE: Record<St, { dot: string; label: string; cls: string }> = {
  ok:      { dot: "🟢", label: "Pronto",  cls: "text-emerald-700" },
  partial: { dot: "🟡", label: "Parcial", cls: "text-amber-700" },
  blocked: { dot: "🔴", label: "Falta",   cls: "text-red-600" },
};

export function Recursos() {
  const all = AREAS.flatMap((a) => a.items);
  const count = (s: St) => all.filter((i) => i.status === s).length;

  return (
    <div className="mx-auto max-w-5xl p-10">
      <PageHeader eyebrow="VISÃO GERAL" title="Tudo o que o sistema faz" />

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Legend dot="🟢" label="Pronto (testado)" value={count("ok")} />
        <Legend dot="🟡" label="Parcial" value={count("partial")} />
        <Legend dot="🔴" label="Falta (conta/decisão externa)" value={count("blocked")} />
        <span className="ml-auto text-muted-foreground">{all.length} recursos no total</span>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
        {AREAS.map((area) => (
          <section key={area.title} className="rounded-lg border border-border bg-background p-5">
            <div className="flex items-center gap-2">
              <span className="text-lg">{area.icon}</span>
              <h2 className="font-serif text-base font-bold">{area.title}</h2>
              {area.to && (
                <Link to={area.to} className="ml-auto text-xs text-muted-foreground underline hover:text-foreground">
                  abrir tela →
                </Link>
              )}
            </div>
            <ul className="mt-3 space-y-1.5">
              {area.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span title={BADGE[it.status].label}>{BADGE[it.status].dot}</span>
                  <span className={it.status === "blocked" ? "text-muted-foreground" : ""}>
                    {it.label}
                    {it.note && <span className="ml-1 text-xs text-muted-foreground">({it.note})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        🟢 já funciona com dados/contas simuladas (laboratório). 🔴 depende de credenciais externas
        (Meta, Tray, CPlug, Mercado Pago) ou de decisão contábil — quando chegarem, é só configurar.
      </p>
    </div>
  );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1">
      {dot} <b>{value}</b> <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
