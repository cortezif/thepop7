import { runAgentTurn, type AgentConfig, type ConversationContext, type AgentToolImpl } from "@thepop/agent";
import { getErpConnector, getLogisticsConnector } from "@thepop/connectors";
import type { ContactProfileUpdate, ProductSummary } from "@thepop/shared";
import type { FastifyBaseLogger } from "fastify";

type DryRunDTO = {
  text: string;
  contactName?: string;
  recentMessages?: Array<{ direction: "in" | "out"; text: string }>;
};

/**
 * Modo dry-run: testa o agente SEM tocar no banco.
 * Útil pra validar Anthropic + tools antes de subir Docker/Postgres.
 * Tudo em memória; reservas e perfis viram log.
 */
export async function dryRunConversation(dto: DryRunDTO, log: FastifyBaseLogger) {
  const erp = getErpConnector();
  const logistics = getLogisticsConnector();
  const memProfile: Record<string, unknown> = {};
  const memReservations: Array<{ sku: string; expiraEm: string }> = [];

  const cfg: AgentConfig = {
    tenantId: "dry-run",
    persona: "Maya",
    tone: "Acolhedora, próxima, brasileira do dia a dia.",
    policies: { prazoDevolucao: 7, cancelamentoSemPostagem: true },
    storeName: "The Pop 7",
  };

  const ctx: ConversationContext = {
    conversationId: "dry-run-conv",
    channel: "manual",
    contactProfile: { name: dto.contactName, ...memProfile },
    recentMessages: dto.recentMessages ?? [],
  };

  const tools: AgentToolImpl = {
    async buscarProduto(query) {
      const products = await erp.listProducts();
      const results: ProductSummary[] = products.slice(0, 5).map((p) => ({
        id: p.externalId,
        name: p.name,
        priceBRL: p.priceBRL,
        variants: p.variants,
        mainPhoto: p.photos[0],
        styles: [],
        occasions: [],
      }));
      log.info({ query, count: results.length }, "[dry-run] tool:buscar_produto");
      return results;
    },
    async mostrarMidia(produtoId, tipo = "foto") {
      log.info({ produtoId, tipo }, "[dry-run] tool:mostrar_midia");
      return { enviado: true, descricao: `Mídia (${tipo}) do produto ${produtoId} enviada (dry-run).` };
    },
    async verificarEstoque(sku) {
      const disponivel = await erp.getStock(sku);
      log.info({ sku, disponivel }, "[dry-run] tool:verificar_estoque");
      return { disponivel, reservado: 0 };
    },
    async consultarFrete(cep, sku) {
      const quotes = await logistics.quote({
        fromZip: "01310-100",
        toZip: cep,
        items: [{ weightG: 500, widthCm: 30, heightCm: 5, lengthCm: 30, valueBRL: 200 }],
      });
      log.info({ cep, sku, count: quotes.length }, "[dry-run] tool:consultar_frete");
      return quotes.map((q) => ({ servico: `${q.carrier} ${q.service}`, precoBRL: q.priceBRL, prazoDias: q.deliveryDays }));
    },
    async atualizarPerfil(update: ContactProfileUpdate) {
      Object.assign(memProfile, update);
      log.info({ update }, "[dry-run] tool:atualizar_perfil");
    },
    async reservarItem(sku, ttlMinutos = 15) {
      const expiraEm = new Date(Date.now() + ttlMinutos * 60_000).toISOString();
      memReservations.push({ sku, expiraEm });
      log.info({ sku, ttlMinutos }, "[dry-run] tool:reservar_item");
      return { reservaId: "mem-" + memReservations.length, expiraEm };
    },
    async criarPedido(input) {
      log.info({ input }, "[dry-run] tool:criar_pedido");
      return {
        pedidoId: "dry-" + Date.now(),
        totalBRL: 0,
        pixCopiaCola: "00020126...MOCK...PIX (dry-run)",
        expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
    },
    async statusPedido(pedidoId) {
      log.info({ pedidoId }, "[dry-run] tool:status_pedido");
      return { id: pedidoId, status: "created", cancelable: true, returnable: false };
    },
    async cancelarPedido(pedidoId, motivo) {
      log.info({ pedidoId, motivo }, "[dry-run] tool:cancelar_pedido");
      return { ok: true };
    },
    async iniciarDevolucao(pedidoId, motivo) {
      log.info({ pedidoId, motivo }, "[dry-run] tool:iniciar_devolucao");
      return { ok: true, devolucaoId: "dry-ret-" + Date.now() };
    },
    async escalarParaHumano(motivo) {
      log.warn({ motivo }, "[dry-run] tool:escalar_para_humano");
      return { escalado: true };
    },
  };

  const turn = await runAgentTurn(cfg, ctx, dto.text, tools);
  return {
    mode: "dry-run",
    reply: turn.replyText,
    toolCalls: turn.toolCalls,
    cost: turn.llmUsage,
    profileMemorized: memProfile,
    reservationsMemorized: memReservations,
  };
}
