import { getPrisma, withTenant } from "@hubadvisor/db";
import { getAdsConnector, metaAdsConfigured } from "@hubadvisor/connectors";
import { generateAdCreative } from "@hubadvisor/agent";

/* ============================================================================
   Mídia paga / Theo (ADR-028). Esqueleto: cria/gerencia campanhas Meta Ads
   (real quando há credencial; mock caso contrário), gera criativo por IA e
   sugere públicos a partir do CRM (primeira parte). Sobe sempre PAUSADA.
   ============================================================================ */

const num = (v: unknown) => (v == null ? 0 : Number(v));

export function adsStatus() {
  const configured = metaAdsConfigured();
  return {
    provider: "meta-ads" as const,
    connected: configured,
    status: configured ? "connected" : "disconnected",
    note: configured
      ? "Meta Marketing API configurada. Campanhas sobem reais (pausadas)."
      : "Configure META_ADS_ACCESS_TOKEN e META_AD_ACCOUNT_ID. Sem isso, opera em modo simulado.",
  };
}

/** Públicos sugeridos a partir dos dados de primeira parte (ADR-028 §públicos). */
export async function suggestAudiences(tenantId: string) {
  const prisma = getPrisma();
  const [compraram, conversaram, npsAlto] = await Promise.all([
    prisma.order.findMany({ where: { tenantId, status: { in: ["paid", "shipped", "delivered", "finalized", "in_transit", "out_for_delivery"] } }, select: { contactId: true } }),
    prisma.conversation.count({ where: { tenantId } }),
    prisma.npsResponse.count({ where: { tenantId, score: { gte: 9 } } }),
  ]);
  const compradoresUnicos = new Set(compraram.map((o) => o.contactId)).size;
  return [
    { key: "compradores", label: "Clientes que já compraram", size: compradoresUnicos, definition: { rule: "tem pedido pago" } },
    { key: "lookalike", label: "Semelhantes aos melhores clientes (lookalike)", size: compradoresUnicos, definition: { rule: "lookalike de compradores LTV alto" } },
    { key: "conversou_nao_comprou", label: "Conversou e não comprou", size: Math.max(0, conversaram - compradoresUnicos), definition: { rule: "tem conversa, sem pedido" } },
    { key: "promotores", label: "Promotores (NPS ≥ 9)", size: npsAlto, definition: { rule: "nps >= 9" } },
  ];
}

export async function listCampaigns(tenantId: string) {
  const prisma = getPrisma();
  const rows = await prisma.adCampaign.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return rows.map((c) => ({
    id: c.id, name: c.name, objective: c.objective, status: c.status,
    dailyBudgetBRL: num(c.dailyBudgetBRL), audience: c.audience, creative: c.creative,
    metrics: c.metrics, externalId: c.externalId, createdAt: c.createdAt.toISOString(),
  }));
}

export async function generateCreative(tenantId: string, input: {
  objective: string; productOrOffer: string; audienceLabel?: string;
}) {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return generateAdCreative({
    objective: input.objective,
    productOrOffer: input.productOrOffer,
    audienceLabel: input.audienceLabel,
    storeName: tenant?.name ?? "Loja",
    brandVoice: tenant?.agentTone ?? undefined,
    segment: tenant?.segment ?? undefined,
  });
}

export async function createCampaign(tenantId: string, input: {
  name: string; objective: "mensagens" | "trafego" | "vendas" | "reconhecimento";
  dailyBudgetBRL: number;
  audience?: { label?: string; definition?: Record<string, unknown> };
  creative?: { headline?: string; primaryText?: string; cta?: string; imageUrl?: string };
}) {
  const ads = getAdsConnector();
  let externalId: string | null = null;
  let status = "rascunho";
  try {
    const r = await ads.createCampaign(input);
    externalId = r.externalId; status = r.status; // "pausada"
  } catch (e: any) {
    // Falha no provedor não impede salvar o rascunho (degradação graciosa).
    status = "rascunho";
  }
  const c = await getPrisma().adCampaign.create({
    data: {
      tenantId, name: input.name, objective: input.objective, dailyBudgetBRL: input.dailyBudgetBRL,
      audience: (input.audience ?? null) as any, creative: (input.creative ?? null) as any,
      externalId, status,
    },
  });
  await withTenant(tenantId, async (tx) => {
    await tx.domainEvent.create({ data: { tenantId, type: "ad.campaign.created", aggregateType: "ad_campaign", aggregateId: c.id, payload: { name: input.name, externalId } as any, actor: "operator" } });
  });
  return { ok: true as const, id: c.id, externalId, status };
}

export async function setCampaignStatus(tenantId: string, id: string, status: "ativa" | "pausada") {
  const prisma = getPrisma();
  const c = await prisma.adCampaign.findFirst({ where: { id, tenantId } });
  if (!c) return { ok: false as const, reason: "campanha não encontrada" };
  if (c.externalId) {
    try { await getAdsConnector().setStatus(c.externalId, status); } catch { /* segue: atualiza local */ }
  }
  await prisma.adCampaign.update({ where: { id }, data: { status } });
  return { ok: true as const, status };
}

export async function refreshInsights(tenantId: string, id: string) {
  const prisma = getPrisma();
  const c = await prisma.adCampaign.findFirst({ where: { id, tenantId } });
  if (!c) return { ok: false as const, reason: "campanha não encontrada" };
  if (!c.externalId) return { ok: false as const, reason: "campanha sem id externo" };
  try {
    const ins = await getAdsConnector().getInsights(c.externalId);
    const metrics = { ...ins, updatedAt: new Date().toISOString() };
    await prisma.adCampaign.update({ where: { id }, data: { metrics: metrics as any } });
    return { ok: true as const, metrics };
  } catch (e: any) {
    return { ok: false as const, reason: e?.message ?? "falha ao buscar insights" };
  }
}
