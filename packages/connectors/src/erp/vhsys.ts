import type { ErpConnector, ErpProduct, ErpOrderInput } from "../types.js";

// VHSYS ERP (ADR-004). REST v2, mas a auth é por PAR DE CHAVES nos headers
// (`access-token` + `secret-access-token`) — não há OAuth. A API é um add-on
// pago contratado na "Loja de Integração" da VHSYS.
//
// Docs: https://developers.vhsys.com.br/  (base https://api.vhsys.com/v2)
//
// Convenção da casa: leitura implementada e guardada por credencial; mapper puro
// (`mapVhsysProduct`) e corpo do pedido (`buildVhsysOrderPayload`) testáveis sem
// rede. O produto da VHSYS já traz `estoque_produto` na listagem (diferente da
// Omie). Escrita de pedido exige id_cliente — ajuste fino isolado no mapper.

const VHSYS_BASE = "https://api.vhsys.com/v2";

// Produto cru da VHSYS (campos relevantes de GET /produtos).
export type VhsysRawProduct = {
  id_produtos?: number | string;
  cod_produto?: string;        // SKU/código
  nome_produto?: string;
  preco_produto?: string | number;
  preco_custo_produto?: string | number;
  estoque_produto?: string | number;
  cod_barra_produto?: string;  // EAN/GTIN
  desc_produto?: string;
};

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Mapeia um produto cru da VHSYS para o nosso `ErpProduct` (pura). Sem variantes
 *  na estrutura → trata cada produto como 1 variante (sku = cod_produto). */
export function mapVhsysProduct(raw: VhsysRawProduct): ErpProduct {
  const sku = String(raw.cod_produto ?? raw.id_produtos ?? "");
  const barcode = raw.cod_barra_produto && String(raw.cod_barra_produto).trim() ? String(raw.cod_barra_produto) : undefined;
  return {
    externalId: String(raw.id_produtos ?? raw.cod_produto ?? ""),
    name: raw.nome_produto ?? sku,
    description: raw.desc_produto,
    priceBRL: num(raw.preco_produto),
    costBRL: raw.preco_custo_produto != null ? num(raw.preco_custo_produto) : undefined,
    variants: [{ sku, color: undefined, size: undefined, stock: num(raw.estoque_produto), ...(barcode ? { barcode } : {}) }],
    photos: [],
  };
}

/** Corpo do POST /pedidos (pura). Estrutura mínima; exige id_cliente em produção. */
export function buildVhsysOrderPayload(order: ErpOrderInput): Record<string, unknown> {
  return {
    id_cliente: 0, // a resolver na homologação (cliente VHSYS)
    status_pedido: "Aberto",
    valor_total: order.totalBRL,
    cep_endereco_pedido: order.shippingZip,
    produtos: order.items.map((it) => ({ cod_produto: it.sku, quantidade_produto: it.quantity, valor_produto: it.unitPriceBRL })),
  };
}

export class VhsysErp implements ErpConnector {
  private readonly accessToken: string;
  private readonly secretToken: string;
  private readonly baseUrl: string;

  constructor(creds?: { accessToken?: string; secretToken?: string; baseUrl?: string }) {
    this.accessToken = creds?.accessToken ?? process.env.VHSYS_ACCESS_TOKEN ?? "";
    this.secretToken = creds?.secretToken ?? process.env.VHSYS_SECRET_TOKEN ?? "";
    this.baseUrl = creds?.baseUrl ?? process.env.VHSYS_API_URL ?? VHSYS_BASE;
  }

  private assertCreds() {
    if (!this.accessToken || !this.secretToken) throw new Error("VhsysErp: faltam VHSYS_ACCESS_TOKEN/VHSYS_SECRET_TOKEN");
  }

  private headers(): Record<string, string> {
    return { "access-token": this.accessToken, "secret-access-token": this.secretToken, Accept: "application/json" };
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    this.assertCreds();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) throw new Error(`VHSYS ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async listProducts(opts?: { limit?: number }): Promise<ErpProduct[]> {
    const data = await this.get<{ data?: VhsysRawProduct[] }>("/produtos", { limit: opts?.limit ?? 50, page: 1 });
    return (data.data ?? []).map(mapVhsysProduct);
  }

  async getProduct(externalId: string): Promise<ErpProduct | null> {
    try {
      const data = await this.get<{ data?: VhsysRawProduct | VhsysRawProduct[] }>(`/produtos/${externalId}`);
      const raw = Array.isArray(data.data) ? data.data[0] : data.data;
      return raw ? mapVhsysProduct(raw) : null;
    } catch {
      return null;
    }
  }

  async getStock(sku: string): Promise<number> {
    // A VHSYS já traz o estoque na listagem — varre e devolve a variante.
    const products = await this.listProducts({ limit: 200 });
    for (const p of products) {
      const v = p.variants.find((x) => x.sku === sku);
      if (v) return v.stock;
    }
    return 0;
  }

  private async send<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
    this.assertCreds();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`VHSYS ${method} ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async createOrder(order: ErpOrderInput): Promise<{ externalId: string }> {
    const data = await this.send<{ data?: { id_pedidos?: number | string } }>("POST", "/pedidos", buildVhsysOrderPayload(order));
    const id = data?.data?.id_pedidos;
    if (id == null) throw new Error("VHSYS /pedidos: resposta sem id_pedidos");
    return { externalId: String(id) };
  }

  async cancelOrder(externalId: string, _reason: string): Promise<void> {
    await this.send("PUT", `/pedidos/${externalId}`, { status_pedido: "Cancelado" });
  }
}
