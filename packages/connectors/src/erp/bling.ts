import type { ErpConnector, ErpProduct, ErpOrderInput } from "../types.js";

// Bling ERP v3 (ADR-004) — alternativa à Tray, selecionável por env
// (ERP_PROVIDER=bling) ou por loja (token no onboarding OAuth).
//
// Docs: https://developer.bling.com.br/  (REST v3, base api.bling.com.br/Api/v3)
//
// Auth: OAuth2 Authorization Code → access_token (renovável). Diferente da Tray,
// o token vai no header `Authorization: Bearer {token}` (não em query param) e a
// base é fixa. O token por loja é provisionado no onboarding; este connector
// assume o token já emitido (injetado por loja ou via env BLING_ACCESS_TOKEN).
//
// Convenção da casa (igual Tray): leitura implementada e guardada por credencial;
// o mapeamento Bling→ErpProduct (`mapBlingProduct`) e o corpo do pedido
// (`buildBlingOrderPayload`) são funções puras, testáveis sem rede. A forma exata
// do POST de pedido pode precisar de ajuste fino contra a loja real (contato.id),
// por isso o mapper de pedido é isolado e validado por estrutura.

const BLING_BASE = "https://api.bling.com.br/Api/v3";

// Formato cru de um produto na Bling v3 (campos relevantes; a API devolve mais).
export type BlingRawProduct = {
  id: number | string;
  nome: string;
  codigo?: string;              // SKU
  preco?: string | number;
  precoCusto?: string | number;
  descricaoCurta?: string;
  descricao?: string;
  formato?: string;             // "S" simples | "E" com variações (pai) | "V" variação
  gtin?: string;                // EAN/GTIN
  estoque?: { saldoVirtualTotal?: string | number; saldoFisicoTotal?: string | number } | string | number;
  midia?: {
    imagens?: {
      externas?: Array<{ link?: string }>;
      internas?: Array<{ link?: string; linkMiniatura?: string }>;
    };
  };
  // Variações: na v3 cada variação é um produto com `variacao.nome` no formato
  // "Cor:Azul;Tamanho:M". A listagem pode trazer o array embutido no pai.
  variacoes?: Array<{
    id?: number | string;
    nome?: string;
    codigo?: string;
    preco?: string | number;
    gtin?: string;
    estoque?: { saldoVirtualTotal?: string | number } | string | number;
    variacao?: { nome?: string };
  }>;
};

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Saldo de estoque tolerante ao formato (objeto {saldoVirtualTotal} ou número). */
function stockOf(estoque: BlingRawProduct["estoque"]): number {
  if (estoque == null) return 0;
  if (typeof estoque === "object") return num(estoque.saldoVirtualTotal ?? (estoque as any).saldoFisicoTotal);
  return num(estoque);
}

/** Extrai cor/tamanho de "Cor:Azul;Tamanho:M" (rótulos da variação Bling). */
function parseVariacaoNome(nome?: string): { color?: string; size?: string } {
  if (!nome) return {};
  let color: string | undefined;
  let size: string | undefined;
  for (const part of nome.split(/[;,]/)) {
    const [rawK, ...rest] = part.split(":");
    const k = (rawK ?? "").trim().toLowerCase();
    const val = rest.join(":").trim();
    if (!val) continue;
    if (/cor|color/.test(k)) color = val;
    else if (/tam|size|tamanho/.test(k)) size = val;
  }
  return { color, size };
}

/** Mapeia um produto cru da Bling v3 para o nosso `ErpProduct` (função pura). */
export function mapBlingProduct(raw: BlingRawProduct): ErpProduct {
  const variants = (raw.variacoes ?? []).map((v) => {
    const { color, size } = parseVariacaoNome(v.variacao?.nome ?? v.nome);
    const barcode = v.gtin;
    return {
      sku: String(v.codigo ?? v.id ?? raw.codigo ?? raw.id),
      color,
      size,
      stock: stockOf(v.estoque),
      ...(barcode ? { barcode } : {}),
    };
  });

  // Produto simples (sem variações): trata o próprio produto como 1 variante.
  if (variants.length === 0) {
    const barcode = raw.gtin;
    variants.push({
      sku: String(raw.codigo ?? raw.id),
      color: undefined,
      size: undefined,
      stock: stockOf(raw.estoque),
      ...(barcode ? { barcode } : {}),
    });
  }

  const imgs = raw.midia?.imagens;
  const photos = [
    ...(imgs?.externas ?? []).map((i) => i.link),
    ...(imgs?.internas ?? []).map((i) => i.link),
  ].filter((u): u is string => !!u);

  return {
    externalId: String(raw.id),
    name: raw.nome,
    description: raw.descricaoCurta ?? raw.descricao,
    priceBRL: num(raw.preco),
    costBRL: raw.precoCusto != null ? num(raw.precoCusto) : undefined,
    variants,
    photos,
  };
}

/**
 * Monta o corpo do POST /pedidos/vendas da Bling v3 a partir do nosso
 * `ErpOrderInput` (função pura, testável). A Bling aninha o cliente em `contato`
 * e os itens em `itens` (usamos `codigo` = nosso SKU). Em produção a Bling pode
 * exigir `contato.id` (contato pré-cadastrado) — o ajuste fino fica isolado aqui.
 */
export function buildBlingOrderPayload(order: ErpOrderInput): Record<string, unknown> {
  const addr = order.shippingAddress ?? {};
  return {
    contato: {
      nome: order.contactName ?? "Cliente",
      ...(order.contactPhone ? { telefone: order.contactPhone } : {}),
      ...(addr.cpf || addr.documento ? { numeroDocumento: addr.cpf ?? addr.documento } : {}),
    },
    itens: order.items.map((it) => ({
      codigo: it.sku,
      descricao: it.sku,
      quantidade: it.quantity,
      valor: it.unitPriceBRL,
    })),
    total: order.totalBRL,
    transporte: {
      etiqueta: {
        nome: order.contactName ?? undefined,
        cep: order.shippingZip,
        endereco: addr.address ?? addr.street ?? undefined,
        numero: addr.number ?? undefined,
        complemento: addr.complement ?? undefined,
        bairro: addr.neighborhood ?? addr.district ?? undefined,
        municipio: addr.city ?? undefined,
        uf: addr.state ?? addr.uf ?? undefined,
      },
    },
  };
}

export class BlingErp implements ErpConnector {
  private readonly token: string;
  private readonly baseUrl: string;

  // Credencial injetada (token por loja, do onboarding OAuth) tem prioridade
  // sobre o env (atalho de dev).
  constructor(creds?: { accessToken?: string; baseUrl?: string }) {
    this.token = creds?.accessToken ?? process.env.BLING_ACCESS_TOKEN ?? "";
    this.baseUrl = creds?.baseUrl ?? process.env.BLING_API_URL ?? BLING_BASE;
  }

  private assertCreds() {
    if (!this.token) throw new Error("BlingErp: falta BLING_ACCESS_TOKEN (token OAuth da loja)");
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    this.assertCreds();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) throw new Error(`Bling ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async listProducts(opts?: { limit?: number; updatedSince?: Date }): Promise<ErpProduct[]> {
    const params: Record<string, string | number> = { pagina: 1, limite: opts?.limit ?? 100 };
    if (opts?.updatedSince) params.dataAlteracaoInicial = opts.updatedSince.toISOString().slice(0, 10);
    const data = await this.get<{ data?: BlingRawProduct[] }>("/produtos", params);
    return (data.data ?? []).map(mapBlingProduct);
  }

  async getProduct(externalId: string): Promise<ErpProduct | null> {
    try {
      const data = await this.get<{ data?: BlingRawProduct }>(`/produtos/${externalId}`);
      return data.data ? mapBlingProduct(data.data) : null;
    } catch {
      return null;
    }
  }

  async getStock(sku: string): Promise<number> {
    // Bling indexa saldo por id de produto; como recebemos SKU, varremos o
    // catálogo e somamos a variante correspondente (mesma estratégia da Tray).
    const products = await this.listProducts({ limit: 200 });
    for (const p of products) {
      const v = p.variants.find((x) => x.sku === sku);
      if (v) return v.stock;
    }
    return 0;
  }

  private async send<T>(method: "POST" | "PATCH" | "PUT", path: string, body: unknown): Promise<T> {
    this.assertCreds();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Bling ${method} ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async createOrder(order: ErpOrderInput): Promise<{ externalId: string }> {
    const payload = buildBlingOrderPayload(order);
    const data = await this.send<{ data?: { id?: number | string } }>("POST", "/pedidos/vendas", payload);
    const id = data.data?.id;
    if (id == null) throw new Error("Bling /pedidos/vendas: resposta sem id do pedido");
    return { externalId: String(id) };
  }

  async cancelOrder(externalId: string, _reason: string): Promise<void> {
    // Cancelamento na Bling = mudar a situação do pedido para "cancelado".
    // O id da situação varia por conta; configurável via env (default 12 = cancelado).
    const idSituacao = Number(process.env.BLING_CANCEL_SITUACAO_ID ?? 12);
    await this.send("PATCH", `/pedidos/vendas/${externalId}/situacoes/${idSituacao}`, {});
  }
}
