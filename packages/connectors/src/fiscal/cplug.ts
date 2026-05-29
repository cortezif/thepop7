import type { FiscalConnector, NfeInput, NfeResult } from "../types.js";

// CPlug / ConnectPlug (gestão/PDV/fiscal usado pela loja) — emissor de NF-e/NFC-e/SAT.
// É o fiscal real da loja (≠ PlugNotas, que é só gateway de NF-e).
//
// Docs: https://manual.cplug.com.br/books/api-cplug
//   API atual: http://cdn.connectplug.com.br/apidoc/index.html
//   API v3.0 : https://cplug.redocly.app/openapi
//
// Auth (v3.0): Client ID + Secret + usuário/senha da loja. As credenciais são
// liberadas pelo time da CPlug via chamado (cadastram o integrador e vinculam a
// loja). Por isso pegamos tudo do env, provisionado no onboarding:
//   CPLUG_API_URL, CPLUG_CLIENT_ID, CPLUG_CLIENT_SECRET, CPLUG_STORE_USER, CPLUG_STORE_PASSWORD
//
// Modelo fiscal da CPlug: a NF-e/SAT é amarrada a uma VENDA já existente no
// CPlug (envia por e-mail / consulta a nota / atualiza SAT). Nosso `issueNfe`
// recebe um pedido nosso — então a implementação real precisará primeiro criar/
// casar a venda no CPlug e então emitir/consultar a nota. Documentado como stub
// (convenção da casa, igual PlugNotas) até validarmos com as credenciais reais.

export class CplugFiscal implements FiscalConnector {
  private readonly baseUrl = process.env.CPLUG_API_URL ?? "";
  private readonly clientId = process.env.CPLUG_CLIENT_ID ?? "";
  private readonly clientSecret = process.env.CPLUG_CLIENT_SECRET ?? "";

  private assertCreds() {
    if (!this.baseUrl || !this.clientId || !this.clientSecret) {
      throw new Error("CplugFiscal: faltam CPLUG_API_URL/CPLUG_CLIENT_ID/CPLUG_CLIENT_SECRET");
    }
  }

  async issueNfe(_input: NfeInput): Promise<NfeResult> {
    this.assertCreds();
    // TODO(real): autenticar (v3.0) → casar/criar venda no CPlug → emitir NF-e →
    // consultar nota (number/xml/pdf). Validar contra a loja antes de ligar.
    throw new Error("CplugFiscal.issueNfe not implemented — validar fluxo de venda+nota com a loja");
  }
}
