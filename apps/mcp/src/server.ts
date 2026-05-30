import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  searchWholesale, getWholesaleProduct, checkAvailability, listCategories,
  requestQuote, placeWholesaleOrder, trackWholesaleOrder,
} from "@thepop/b2b";

// MCP Server da rede de atacado B2B (ADR-024). Expõe o catálogo agregado das
// lojas (produtos com wholesaleEnabled) como ferramentas consumíveis por
// qualquer cliente MCP (Claude Desktop, outros agentes, ou instâncias do
// próprio sistema atuando como compradoras).

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/**
 * @param opts.buyerRef comprador autenticado (resolvido da API-key pelo main).
 *   Ausente = sessão anônima: as ferramentas de leitura funcionam (vitrine
 *   pública), mas cotação/pedido/rastreio são recusados.
 */
export function buildMcpServer(opts: { buyerRef?: string } = {}): McpServer {
  const server = new McpServer({ name: "thepop7-b2b", version: "0.1.0" });
  const buyerRef = opts.buyerRef;
  const requireBuyer = () => {
    if (!buyerRef) return json({ error: "não autenticado: configure MCP_BUYER_API_KEY de um comprador registrado" });
    return null;
  };

  server.registerTool("search_products", {
    title: "Buscar produtos no atacado",
    description: "Busca no catálogo agregado de atacado (texto + filtros de estilo/ocasião).",
    inputSchema: {
      query: z.string().optional(),
      styles: z.array(z.string()).optional(),
      occasions: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(50).optional(),
    },
  }, async ({ query, styles, occasions, limit }) => json(await searchWholesale(query, { styles, occasions, limit })));

  server.registerTool("get_product", {
    title: "Detalhe do produto",
    description: "Detalhe completo de um produto exposto no atacado (preço de atacado, variantes, mídia).",
    inputSchema: { productId: z.string() },
  }, async ({ productId }) => {
    const p = await getWholesaleProduct(productId);
    return p ? json(p) : json({ error: "produto não disponível no atacado" });
  });

  server.registerTool("check_availability", {
    title: "Conferir disponibilidade",
    description: "Estoque de atacado em tempo real para um produto/quantidade (respeita quantidade mínima).",
    inputSchema: { productId: z.string(), qty: z.number().int().positive(), sku: z.string().optional() },
  }, async ({ productId, qty, sku }) => json(await checkAvailability(productId, qty, sku)));

  server.registerTool("list_categories", {
    title: "Listar taxonomia",
    description: "Estilos e ocasiões disponíveis no catálogo de atacado.",
    inputSchema: {},
  }, async () => json(await listCategories()));

  server.registerTool("request_quote", {
    title: "Solicitar cotação",
    description: "Gera uma cotação de atacado para um conjunto de itens (valida quantidade mínima e estoque; itens de um único vendedor). Requer comprador autenticado.",
    inputSchema: {
      items: z.array(z.object({ productId: z.string(), qty: z.number().int().positive(), sku: z.string().optional() })).min(1),
    },
  }, async ({ items }) => requireBuyer() ?? json(await requestQuote(buyerRef!, items)));

  server.registerTool("place_wholesale_order", {
    title: "Fechar pedido de atacado",
    description: "Fecha o pedido B2B a partir de uma cotação aberta e válida. Requer comprador autenticado.",
    inputSchema: { quoteId: z.string() },
  }, async ({ quoteId }) => requireBuyer() ?? json(await placeWholesaleOrder(quoteId, buyerRef!)));

  server.registerTool("track_wholesale_order", {
    title: "Acompanhar pedido de atacado",
    description: "Status logístico de um pedido B2B. Requer comprador autenticado.",
    inputSchema: { orderId: z.string() },
  }, async ({ orderId }) => {
    const auth = requireBuyer(); if (auth) return auth;
    const t = await trackWholesaleOrder(orderId, buyerRef!);
    return t ? json(t) : json({ error: "pedido não encontrado" });
  });

  return server;
}

export const B2B_TOOL_NAMES = [
  "search_products", "get_product", "check_availability", "list_categories",
  "request_quote", "place_wholesale_order", "track_wholesale_order",
] as const;
