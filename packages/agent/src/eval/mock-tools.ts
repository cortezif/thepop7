import type { AgentToolImpl } from "../types.js";
import type { ProductSummary, ContactProfileUpdate } from "@hubadvisor/shared";

/**
 * Catálogo-fake determinístico para o maya-eval. Não toca rede nem banco.
 * SKUs no formato {PROD}-{TAM}-{COR} batem com o que o prompt espera.
 */
const CATALOG: ProductSummary[] = [
  {
    id: "VEST-FESTA-001",
    name: "Vestido Longo Festa Marsala",
    priceBRL: 289.9,
    variants: [
      { sku: "VEST-FESTA-001-P-MARSALA", color: "marsala", size: "P", stock: 3 },
      { sku: "VEST-FESTA-001-M-MARSALA", color: "marsala", size: "M", stock: 5 },
      { sku: "VEST-FESTA-001-G-MARSALA", color: "marsala", size: "G", stock: 0 },
    ],
    mainPhoto: "https://cdn.example/vest-festa-001.jpg",
    styles: ["elegante", "festa"],
    occasions: ["festa", "casamento"],
  },
  {
    id: "CONJ-FESTA-002",
    name: "Conjunto Cropped + Saia Festa Preto",
    priceBRL: 324.0,
    variants: [
      { sku: "CONJ-FESTA-002-P-PRETO", color: "preto", size: "P", stock: 4 },
      { sku: "CONJ-FESTA-002-M-PRETO", color: "preto", size: "M", stock: 2 },
    ],
    mainPhoto: "https://cdn.example/conj-festa-002.jpg",
    styles: ["moderno", "festa"],
    occasions: ["festa", "balada"],
  },
  {
    id: "BL-DIA-010",
    name: "Blusa Algodão Manga Curta Off-White",
    priceBRL: 89.9,
    variants: [
      { sku: "BL-DIA-010-M-OFFWHITE", color: "off-white", size: "M", stock: 10 },
      { sku: "BL-DIA-010-G-OFFWHITE", color: "off-white", size: "G", stock: 7 },
    ],
    mainPhoto: "https://cdn.example/bl-dia-010.jpg",
    styles: ["básico", "casual"],
    occasions: ["dia a dia", "trabalho"],
  },
];

function findVariant(sku: string) {
  for (const p of CATALOG) {
    const v = p.variants.find((vv) => vv.sku === sku);
    if (v) return { product: p, variant: v };
  }
  return null;
}

export type ToolCallTrace = { name: string; input: unknown };

/**
 * Tools determinísticas + trilha de chamadas. A trilha alimenta as asserções
 * de comportamento dos cenários (ex: "buscou produto antes de criar pedido").
 */
export function makeMockTools(): { tools: AgentToolImpl; trace: ToolCallTrace[]; profile: Record<string, unknown> } {
  const trace: ToolCallTrace[] = [];
  const profile: Record<string, unknown> = {};
  const log = (name: string, input: unknown) => trace.push({ name, input });

  const tools: AgentToolImpl = {
    async buscarProduto(query) {
      log("buscar_produto", query);
      let res = CATALOG;
      if (query.ocasiao?.length) {
        res = res.filter((p) => p.occasions.some((o) => query.ocasiao!.some((q) => o.includes(q.toLowerCase()))));
      }
      if (query.precoMax) res = res.filter((p) => p.priceBRL <= query.precoMax!);
      return (res.length ? res : CATALOG).slice(0, 5);
    },
    async mostrarMidia(produtoId, tipo = "foto") {
      log("mostrar_midia", { produtoId, tipo });
      return { enviado: true, descricao: `Mídia (${tipo}) de ${produtoId}.` };
    },
    async verificarEstoque(sku) {
      log("verificar_estoque", { sku });
      const f = findVariant(sku);
      return { disponivel: f?.variant.stock ?? 0, reservado: 0 };
    },
    async consultarFrete(cep, sku) {
      log("consultar_frete", { cep, sku });
      return [
        { servico: "Correios PAC", precoBRL: 24.9, prazoDias: 7 },
        { servico: "Correios SEDEX", precoBRL: 39.9, prazoDias: 3 },
      ];
    },
    async atualizarPerfil(update: ContactProfileUpdate) {
      log("atualizar_perfil", update);
      Object.assign(profile, update);
    },
    async reservarItem(sku, ttlMinutos = 15) {
      log("reservar_item", { sku, ttlMinutos });
      return { reservaId: "mock-res-1", expiraEm: new Date(Date.now() + ttlMinutos * 60_000).toISOString() };
    },
    async criarPedido(input) {
      log("criar_pedido", input);
      const total = input.itens.reduce((acc, it) => {
        const f = findVariant(it.sku);
        return acc + (f?.product.priceBRL ?? 0) * it.quantidade;
      }, 0) + 24.9;
      return {
        pedidoId: "mock-ped-1",
        totalBRL: Number(total.toFixed(2)),
        pixCopiaCola: "00020126MOCKPIXCOPIAECOLA5204000053039865802BR6304ABCD",
        expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
    },
    async statusPedido(pedidoId) {
      log("status_pedido", { pedidoId });
      // Pedidos "entregues" (id contém 'entregue') já podem ser devolvidos;
      // os demais estão em 'created' (canceláveis, ainda não postados).
      const entregue = /entregue|delivered/i.test(pedidoId);
      return entregue
        ? { id: pedidoId, status: "delivered", cancelable: false, returnable: true, rastreio: "BR123", entregueEm: "2026-05-25" }
        : { id: pedidoId, status: "created", cancelable: true, returnable: false, rastreio: null };
    },
    async cancelarPedido(pedidoId, motivo) {
      log("cancelar_pedido", { pedidoId, motivo });
      return { ok: true };
    },
    async iniciarDevolucao(pedidoId, motivo) {
      log("iniciar_devolucao", { pedidoId, motivo });
      return { ok: true, devolucaoId: "mock-dev-1" };
    },
    async escalarParaHumano(motivo) {
      log("escalar_para_humano", { motivo });
      return { escalado: true };
    },
  };

  return { tools, trace, profile };
}

export { CATALOG };
