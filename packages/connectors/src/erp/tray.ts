import type { ErpConnector, ErpProduct, ErpOrderInput } from "../types.js";

// Tray Commerce (plataforma de e-commerce usada pela loja) — ADR-004.
// É o ERP/catálogo alternativo ao Bling, selecionável por env (ERP_PROVIDER=tray).
//
// Docs: https://developer.tray.com.br/  (Tray Commerce API, REST + OAuth)
//
// Auth: cada loja autoriza o app e recebe um access_token (renovável via
// refresh_token). Aqui consumimos o token já emitido por loja:
//   TRAY_API_URL      ex.: https://minhaloja.commercesuite.com.br/web_api
//   TRAY_ACCESS_TOKEN  token de acesso da loja
// O fluxo OAuth (consumer_key/secret + code -> access_token/refresh) roda no
// onboarding do tenant; este connector assume o token já provisionado.
//
// Convenção da casa (igual Bling/MercadoPago): leitura implementada e guardada
// por credencial; escrita (createOrder/cancelOrder) documentada como stub até
// validarmos contra a loja real. O mapeamento Tray->ErpProduct é função pura
// (`mapTrayProduct`), testável sem rede.

// Formato cru de um produto na Tray (campos relevantes; a API devolve mais).
export type TrayRawProduct = {
  id: number | string;
  name: string;
  description?: string;
  price?: string | number;
  cost_price?: string | number;
  reference?: string; // SKU "pai"
  stock?: string | number;
  ProductImage?: Array<{ https?: string; http?: string }>;
  Variant?: Array<{
    Variant?: {
      id?: number | string;
      sku?: string;
      stock?: string | number;
      // atributos da variante (cor/tamanho) vêm em SkuValue/ValuesVariant
      ValuesVariant?: Array<{ type?: string; value?: string }>;
    };
  }>;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Extrai cor/tamanho dos atributos de variante da Tray (heurística por rótulo). */
function variantAttrs(values?: Array<{ type?: string; value?: string }>) {
  let color: string | undefined;
  let size: string | undefined;
  for (const v of values ?? []) {
    const t = (v.type ?? "").toLowerCase();
    if (/cor|color/.test(t)) color = v.value;
    else if (/tam|size|tamanho/.test(t)) size = v.value;
  }
  return { color, size };
}

/** Mapeia um produto cru da Tray para o nosso `ErpProduct` (função pura). */
export function mapTrayProduct(raw: TrayRawProduct): ErpProduct {
  const variants = (raw.Variant ?? [])
    .map((w) => w.Variant)
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => {
      const { color, size } = variantAttrs(v.ValuesVariant);
      return {
        sku: String(v.sku ?? raw.reference ?? raw.id),
        color,
        size,
        stock: num(v.stock),
      };
    });

  // Produto sem variantes cadastradas: trata o próprio produto como 1 variante.
  if (variants.length === 0) {
    variants.push({
      sku: String(raw.reference ?? raw.id),
      color: undefined,
      size: undefined,
      stock: num(raw.stock),
    });
  }

  const photos = (raw.ProductImage ?? [])
    .map((img) => img.https ?? img.http)
    .filter((u): u is string => !!u);

  return {
    externalId: String(raw.id),
    name: raw.name,
    description: raw.description,
    priceBRL: num(raw.price),
    costBRL: raw.cost_price != null ? num(raw.cost_price) : undefined,
    variants,
    photos,
  };
}

/**
 * Monta o corpo do POST /orders da Tray a partir do nosso `ErpOrderInput`
 * (função pura, testável). A Tray aninha tudo em `Order`; os itens vão em
 * `ProductsSold` (usamos `reference` = nosso SKU). Campos de endereço/frete
 * mapeados do `shippingAddress`. A forma exata pode precisar de ajuste fino
 * contra a loja real — por isso o mapper é isolado e testado por estrutura.
 */
export function buildTrayOrderPayload(order: ErpOrderInput): Record<string, unknown> {
  const addr = order.shippingAddress ?? {};
  return {
    Order: {
      Customer: {
        name: order.contactName ?? "Cliente",
        cellphone: order.contactPhone ?? undefined,
        cpf: addr.cpf ?? undefined,
      },
      ProductsSold: order.items.map((it) => ({
        ProductsSold: {
          reference: it.sku,
          quantity: it.quantity,
          price: it.unitPriceBRL,
        },
      })),
      total: order.totalBRL,
      zip_code: order.shippingZip,
      address: addr.address ?? addr.street ?? undefined,
      number: addr.number ?? undefined,
      complement: addr.complement ?? undefined,
      neighborhood: addr.neighborhood ?? addr.district ?? undefined,
      city: addr.city ?? undefined,
      state: addr.state ?? addr.uf ?? undefined,
    },
  };
}

export class TrayErp implements ErpConnector {
  private readonly baseUrl: string;
  private readonly token: string;

  // Credencial pode vir injetada (token por loja, vindo do onboarding OAuth) ou
  // do env (atalho de dev). Injetada tem prioridade.
  constructor(creds?: { apiUrl?: string; accessToken?: string }) {
    this.baseUrl = creds?.apiUrl ?? process.env.TRAY_API_URL ?? "";
    this.token = creds?.accessToken ?? process.env.TRAY_ACCESS_TOKEN ?? "";
  }

  private assertCreds() {
    if (!this.baseUrl || !this.token) {
      throw new Error("TrayErp: faltam TRAY_API_URL e/ou TRAY_ACCESS_TOKEN");
    }
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    this.assertCreds();
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("access_token", this.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Tray ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async listProducts(opts?: { limit?: number; updatedSince?: Date }): Promise<ErpProduct[]> {
    const params: Record<string, string | number> = { limit: opts?.limit ?? 50 };
    if (opts?.updatedSince) params.modified = opts.updatedSince.toISOString().slice(0, 10);
    const data = await this.get<{ Products?: Array<{ Product: TrayRawProduct }> }>("/products", params);
    return (data.Products ?? []).map((w) => mapTrayProduct(w.Product));
  }

  async getProduct(externalId: string): Promise<ErpProduct | null> {
    try {
      const data = await this.get<{ Product?: TrayRawProduct }>(`/products/${externalId}`);
      return data.Product ? mapTrayProduct(data.Product) : null;
    } catch {
      return null;
    }
  }

  async getStock(sku: string): Promise<number> {
    // A Tray não tem lookup direto por SKU; varre o catálogo e soma a variante.
    const products = await this.listProducts({ limit: 200 });
    for (const p of products) {
      const v = p.variants.find((x) => x.sku === sku);
      if (v) return v.stock;
    }
    return 0;
  }

  private async send<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
    this.assertCreds();
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("access_token", this.token);
    const res = await fetch(url.toString(), {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Tray ${method} ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async createOrder(order: ErpOrderInput): Promise<{ externalId: string }> {
    const payload = buildTrayOrderPayload(order);
    // A Tray devolve o id do pedido criado (campo varia: id / Order.id).
    const data = await this.send<{ id?: number | string; Order?: { id?: number | string } }>(
      "POST", "/orders", payload,
    );
    const id = data.id ?? data.Order?.id;
    if (id == null) throw new Error("Tray /orders: resposta sem id do pedido");
    return { externalId: String(id) };
  }

  async cancelOrder(externalId: string, reason: string): Promise<void> {
    // Cancelamento na Tray = atualização de status do pedido (status "canceled").
    await this.send("PUT", `/orders/${externalId}`, {
      Order: { status: "canceled", cancel_reason: reason },
    });
  }
}
