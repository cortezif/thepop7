import type { FiscalConnector, NfeInput, NfeResult } from "../types.js";

// CPlug / ConnectPlug (gestão/PDV/fiscal usado pela loja) — emissor de NF-e/NFC-e/SAT.
// É o fiscal real da loja (≠ PlugNotas, que é só gateway de NF-e).
//
// Docs: https://manual.cplug.com.br/books/api-cplug · OpenAPI v3.0 https://cplug.redocly.app/openapi
//
// Auth (OAuth2 password grant): POST {base}/oauth/token com
//   { grant_type:"password", client_id, client_secret, username, password, scope:"*" }
// → access_token (Bearer). Credenciais liberadas pelo time da CPlug via chamado.
// Env: CPLUG_API_URL, CPLUG_CLIENT_ID, CPLUG_CLIENT_SECRET, CPLUG_STORE_USER, CPLUG_STORE_PASSWORD
//
// Emissão: POST {base}/api/v3/nfe com os dados da nota. A forma exata do corpo
// pode precisar de ajuste contra a loja real — por isso o mapper é isolado e
// testado por estrutura (`buildCplugNfePayload`).

type CplugTokenResponse = { access_token?: string; expires_in?: number };

type CplugNfeResponse = {
  // nomes prováveis; normalizados defensivamente em normalizeNfeResult
  number?: string | number;
  nfe_number?: string | number;
  xml_url?: string;
  xmlUrl?: string;
  pdf_url?: string;
  danfe_url?: string;
  pdfUrl?: string;
  Nfe?: { number?: string | number; xml_url?: string; pdf_url?: string };
};

/** Corpo do POST /api/v3/nfe a partir do nosso NfeInput (função pura, testável). */
export function buildCplugNfePayload(input: NfeInput): Record<string, unknown> {
  const a = input.customer.address ?? {};
  return {
    external_reference: input.orderId,
    customer: {
      name: input.customer.name,
      document: input.customer.document, // CPF/CNPJ
      email: input.customer.email ?? undefined,
      zip_code: a.zip ?? a.cep ?? undefined,
      address: a.address ?? a.street ?? undefined,
      number: a.number ?? undefined,
      complement: a.complement ?? undefined,
      neighborhood: a.neighborhood ?? a.district ?? undefined,
      city: a.city ?? undefined,
      state: a.state ?? a.uf ?? undefined,
    },
    items: input.items.map((it) => ({
      description: it.description,
      code: it.sku,
      ean: it.barcode || undefined,       // cEAN/cEANTrib na NF-e (GTIN)
      quantity: it.quantity,
      unit_price: it.unitPriceBRL,
      ncm: it.ncm ?? undefined,
      cfop: it.cfop ?? undefined,
    })),
    total: input.totalBRL,
  };
}

/** Normaliza a resposta da nota (campos variam) pro nosso NfeResult. */
export function normalizeNfeResult(r: CplugNfeResponse, orderId: string): NfeResult {
  const number = r.number ?? r.nfe_number ?? r.Nfe?.number;
  const xmlUrl = r.xml_url ?? r.xmlUrl ?? r.Nfe?.xml_url;
  const pdfUrl = r.pdf_url ?? r.danfe_url ?? r.pdfUrl ?? r.Nfe?.pdf_url;
  if (number == null) throw new Error(`CPlug NFe ${orderId}: resposta sem número da nota`);
  return { number: String(number), xmlUrl: xmlUrl ?? "", pdfUrl: pdfUrl ?? "" };
}

export class CplugFiscal implements FiscalConnector {
  private readonly baseUrl = (process.env.CPLUG_API_URL ?? "").replace(/\/$/, "");
  private readonly clientId = process.env.CPLUG_CLIENT_ID ?? "";
  private readonly clientSecret = process.env.CPLUG_CLIENT_SECRET ?? "";
  private readonly user = process.env.CPLUG_STORE_USER ?? "";
  private readonly password = process.env.CPLUG_STORE_PASSWORD ?? "";
  private token: string | null = null;

  private assertCreds() {
    if (!this.baseUrl || !this.clientId || !this.clientSecret || !this.user || !this.password) {
      throw new Error("CplugFiscal: faltam CPLUG_API_URL/CLIENT_ID/CLIENT_SECRET/STORE_USER/STORE_PASSWORD");
    }
  }

  /** OAuth2 password grant. Cacheia o token na instância. */
  private async authenticate(): Promise<string> {
    if (this.token) return this.token;
    this.assertCreds();
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "password",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username: this.user,
        password: this.password,
        scope: "*",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as CplugTokenResponse;
    if (!res.ok || !json.access_token) {
      throw new Error(`CPlug /oauth/token ${res.status}: ${JSON.stringify(json)}`);
    }
    this.token = json.access_token;
    return this.token;
  }

  async issueNfe(input: NfeInput): Promise<NfeResult> {
    const token = await this.authenticate();
    const payload = buildCplugNfePayload(input);
    const res = await fetch(`${this.baseUrl}/api/v3/nfe`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as CplugNfeResponse;
    if (!res.ok) throw new Error(`CPlug /api/v3/nfe ${res.status}: ${JSON.stringify(json)}`);
    return normalizeNfeResult(json, input.orderId);
  }
}
