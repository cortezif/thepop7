/**
 * Detecção de alucinação (ADR-014): sinaliza pra revisão quando a resposta do
 * agente AFIRMA um fato que só deveria vir de uma tool (preço, disponibilidade)
 * sem ter chamado a tool correspondente naquela volta. Heurística conservadora
 * (preço e estoque — as regras de ouro mais sensíveis) pra evitar falso-positivo.
 */
export type ReviewResult = { flagged: boolean; reasons: string[] };

export function detectHallucination(replyText: string | undefined, toolNames: string[]): ReviewResult {
  const reasons: string[] = [];
  const t = (replyText ?? "").toLowerCase();
  const called = (n: string) => toolNames.includes(n);

  const productTool =
    called("buscar_produto") || called("verificar_estoque") || called("criar_pedido") ||
    called("consultar_frete") || called("status_pedido");

  // Citou um valor em R$ (ou "X,XX reais") sem ter consultado produto/frete/pedido.
  const mentionsPrice = /r\$\s*\d|\d+[.,]\d{2}\s*(reais|conto)/.test(t);
  if (mentionsPrice && !productTool) {
    reasons.push("citou valor sem consultar produto/frete/pedido");
  }

  // Afirmou disponibilidade/estoque sem verificar.
  const mentionsStock = /(em estoque|dispon[ií]ve|temos\s+\d+|últimas?\s+\d+|esgotad|acabou o estoque)/.test(t);
  if (mentionsStock && !(called("verificar_estoque") || called("buscar_produto"))) {
    reasons.push("afirmou disponibilidade/estoque sem verificar");
  }

  return { flagged: reasons.length > 0, reasons };
}
