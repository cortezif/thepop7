import type { ErpConnector, ErpProduct, ErpOrderInput } from "../types.js";

// Omie ERP (ADR-004). Diferente de Tray/Bling (REST), a Omie é JSON-RPC: cada
// chamada é um POST para a URL do recurso com corpo
//   { call: "Metodo", app_key, app_secret, param: [ {...} ] }
// e a auth (app_key/app_secret) vai NO CORPO — não há OAuth nem header.
//
// Docs: https://developer.omie.com.br/  (ex.: /api/v1/geral/produtos/ ListarProdutos)
//
// Convenção da casa: leitura implementada e guardada por credencial; mapper puro
// (`mapOmieProduct`) e envelope (`buildOmieRequest`) testáveis sem rede. A escrita
// de pedido (IncluirPedido) exige cliente pré-cadastrado (codigo_cliente) — o
// payload é isolado (`buildOmieOrderPayload`) e validado por estrutura.

const OMIE_BASE = "https://app.omie.com.br/api/v1";

// Produto cru da Omie (campos relevantes de ListarProdutos/ConsultarProduto).
export type OmieRawProduct = {
  codigo_produto?: number | string; // id interno Omie
  codigo?: string;                  // SKU/código
  descricao?: string;
  valor_unitario?: number | string;
  descr_detalhada?: string;
  ean?: string;
  imagens?: Array<{ url_imagem?: string }>;
};

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Envelope JSON-RPC da Omie (pura). */
export function buildOmieRequest(call: string, param: Record<string, unknown>, creds: { appKey: string; appSecret: string }): Record<string, unknown> {
  return { call, app_key: creds.appKey, app_secret: creds.appSecret, param: [param] };
}

/** Mapeia um produto cru da Omie para o nosso `ErpProduct` (pura). A Omie não tem
 *  variantes na mesma estrutura — tratamos cada produto como 1 variante (sku=codigo). */
export function mapOmieProduct(raw: OmieRawProduct): ErpProduct {
  const sku = String(raw.codigo ?? raw.codigo_produto ?? "");
  const barcode = raw.ean && String(raw.ean).trim() ? String(raw.ean) : undefined;
  const photos = (raw.imagens ?? []).map((i) => i.url_imagem).filter((u): u is string => !!u);
  return {
    externalId: String(raw.codigo_produto ?? raw.codigo ?? ""),
    name: raw.descricao ?? sku,
    description: raw.descr_detalhada,
    priceBRL: num(raw.valor_unitario),
    variants: [{ sku, color: undefined, size: undefined, stock: 0, ...(barcode ? { barcode } : {}) }],
    photos,
  };
}

/** Corpo do IncluirPedido (pura). Estrutura mínima; em produção exige
 *  codigo_cliente (cliente pré-cadastrado na Omie) — ajuste fino isolado aqui. */
export function buildOmieOrderPayload(order: ErpOrderInput): Record<string, unknown> {
  return {
    cabecalho: {
      codigo_cliente: 0, // a resolver na homologação (cliente Omie)
      etapa: "10",
      codigo_parcela: "000",
    },
    det: order.items.map((it, i) => ({
      ide: { codigo_item_integracao: `${i + 1}` },
      produto: { codigo: it.sku, quantidade: it.quantity, valor_unitario: it.unitPriceBRL },
    })),
    informacoes_adicionais: { codigo_categoria: "1.01.01", numero_pedido_cliente: order.shippingZip },
  };
}

export class OmieErp implements ErpConnector {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;

  constructor(creds?: { appKey?: string; appSecret?: string; baseUrl?: string }) {
    this.appKey = creds?.appKey ?? process.env.OMIE_APP_KEY ?? "";
    this.appSecret = creds?.appSecret ?? process.env.OMIE_APP_SECRET ?? "";
    this.baseUrl = creds?.baseUrl ?? process.env.OMIE_API_URL ?? OMIE_BASE;
  }

  private assertCreds() {
    if (!this.appKey || !this.appSecret) throw new Error("OmieErp: faltam OMIE_APP_KEY/OMIE_APP_SECRET");
  }

  /** POST JSON-RPC para um recurso (ex.: "/geral/produtos/"). */
  private async call<T>(resource: string, method: string, param: Record<string, unknown>): Promise<T> {
    this.assertCreds();
    const res = await fetch(`${this.baseUrl}${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify(buildOmieRequest(method, param, { appKey: this.appKey, appSecret: this.appSecret })),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.faultstring) throw new Error(`Omie ${method} ${res.status}: ${json?.faultstring ?? JSON.stringify(json)}`);
    return json as T;
  }

  async listProducts(opts?: { limit?: number }): Promise<ErpProduct[]> {
    const data = await this.call<{ produto_servico_cadastro?: OmieRawProduct[] }>(
      "/geral/produtos/", "ListarProdutos",
      { pagina: 1, registros_por_pagina: opts?.limit ?? 50, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N" },
    );
    return (data.produto_servico_cadastro ?? []).map(mapOmieProduct);
  }

  async getProduct(externalId: string): Promise<ErpProduct | null> {
    try {
      const data = await this.call<OmieRawProduct>("/geral/produtos/", "ConsultarProduto", { codigo_produto: Number(externalId) || externalId });
      return data && (data.codigo || data.codigo_produto) ? mapOmieProduct(data) : null;
    } catch {
      return null;
    }
  }

  async getStock(sku: string): Promise<number> {
    // ListarProdutos não traz saldo; busca o produto e consulta a posição de estoque.
    const products = await this.listProducts({ limit: 200 });
    const prod = products.find((p) => p.variants.some((v) => v.sku === sku));
    if (!prod) return 0;
    try {
      const pos = await this.call<{ listaSaldo?: Array<{ saldo?: number }> }>(
        "/estoque/consulta/", "ObterEstoqueProduto", { codigo_local_estoque: 0, id_prod: Number(prod.externalId) || prod.externalId },
      );
      return num(pos?.listaSaldo?.[0]?.saldo);
    } catch {
      return 0;
    }
  }

  async createOrder(order: ErpOrderInput): Promise<{ externalId: string }> {
    const data = await this.call<{ codigo_pedido?: number | string }>("/produtos/pedido/", "IncluirPedido", buildOmieOrderPayload(order));
    const id = data?.codigo_pedido;
    if (id == null) throw new Error("Omie IncluirPedido: resposta sem codigo_pedido");
    return { externalId: String(id) };
  }

  async cancelOrder(externalId: string, _reason: string): Promise<void> {
    await this.call("/produtos/pedido/", "CancelarPedido", { codigo_pedido: Number(externalId) || externalId });
  }
}
