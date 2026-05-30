import type { AdsConnector, AdCampaignInput, AdInsights } from "../types.js";

// Meta Marketing API (ADR-028 — Theo). Requer META_ADS_ACCESS_TOKEN +
// META_AD_ACCOUNT_ID (act_xxxxx). Sem credencial, a factory usa o mock.
// Docs: https://developers.facebook.com/docs/marketing-apis

const GRAPH = "https://graph.facebook.com/v18.0";

const OBJECTIVE_MAP: Record<AdCampaignInput["objective"], string> = {
  mensagens: "OUTCOME_ENGAGEMENT",
  trafego: "OUTCOME_TRAFFIC",
  vendas: "OUTCOME_SALES",
  reconhecimento: "OUTCOME_AWARENESS",
};

export function metaAdsConfigured(): boolean {
  return !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

export class MetaAds implements AdsConnector {
  private token = process.env.META_ADS_ACCESS_TOKEN ?? "";
  private account = process.env.META_AD_ACCOUNT_ID ?? "";

  async createCampaign(input: AdCampaignInput): Promise<{ externalId: string; status: string }> {
    if (!metaAdsConfigured()) throw new Error("META_ADS_ACCESS_TOKEN/META_AD_ACCOUNT_ID não configurados");
    const res = await fetch(`${GRAPH}/${this.account}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        objective: OBJECTIVE_MAP[input.objective],
        status: "PAUSED", // sobe pausada; ativação é explícita
        special_ad_categories: [],
        daily_budget: Math.round(input.dailyBudgetBRL * 100), // centavos
        access_token: this.token,
      }),
    });
    if (!res.ok) throw new Error(`MetaAds.createCampaign ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    return { externalId: String(data.id), status: "pausada" };
  }

  async setStatus(externalId: string, status: "ativa" | "pausada"): Promise<{ ok: boolean }> {
    if (!metaAdsConfigured()) throw new Error("Meta Ads não configurado");
    const res = await fetch(`${GRAPH}/${externalId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status === "ativa" ? "ACTIVE" : "PAUSED", access_token: this.token }),
    });
    return { ok: res.ok };
  }

  async getInsights(externalId: string): Promise<AdInsights> {
    if (!metaAdsConfigured()) throw new Error("Meta Ads não configurado");
    const fields = "impressions,clicks,spend,actions,ctr";
    const res = await fetch(`${GRAPH}/${externalId}/insights?fields=${fields}&access_token=${this.token}`);
    if (!res.ok) throw new Error(`MetaAds.getInsights ${res.status}`);
    const data: any = await res.json();
    const row = data?.data?.[0] ?? {};
    const conversions = Number((row.actions ?? []).find((a: any) => /purchase|lead|messaging/.test(a.action_type))?.value ?? 0);
    const spend = Number(row.spend ?? 0);
    return {
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      spendBRL: spend,
      conversions,
      ctr: Number(row.ctr ?? 0) / 100,
      roas: 0, // calculado fora (precisa receita atribuída)
    };
  }
}

/** Mock determinístico — exibe a tela com números plausíveis sem credencial. */
export class MockAds implements AdsConnector {
  async createCampaign(_input: AdCampaignInput): Promise<{ externalId: string; status: string }> {
    return { externalId: "mock-camp-" + _input.name.toLowerCase().replace(/\W+/g, "-").slice(0, 20), status: "pausada" };
  }
  async setStatus(_externalId: string, _status: "ativa" | "pausada"): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async getInsights(externalId: string): Promise<AdInsights> {
    // pseudo-aleatório estável a partir do id (sem Math.random)
    let h = 0; for (let i = 0; i < externalId.length; i++) h = (h * 31 + externalId.charCodeAt(i)) >>> 0;
    const impressions = 1000 + (h % 9000);
    const clicks = Math.round(impressions * (0.01 + (h % 30) / 1000));
    const spendBRL = Math.round((10 + (h % 90)) * 100) / 100;
    const conversions = Math.round(clicks * (0.03 + (h % 10) / 100));
    const revenue = conversions * (120 + (h % 200));
    return {
      impressions, clicks, spendBRL, conversions,
      ctr: clicks / impressions,
      roas: spendBRL > 0 ? Math.round((revenue / spendBRL) * 100) / 100 : 0,
    };
  }
}
