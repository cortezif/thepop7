// Código de barras (EAN-13 / GTIN-13) — lógica pura, sem dependências.
//
// Estratégia (decisão 2026-05-29): usar o GTIN que vier da Tray/CPlug quando
// existir; gerar INTERNO só pro que faltar. Códigos internos usam prefixo
// restrito "2" (GS1 reserva 02/20-29 pra uso interno/in-store), que não colide
// com GTIN registrado na GS1 — não vale pra venda fora da loja, mas serve pra
// controle interno (estoque, picking, devolução, etiqueta).

/** Dígito verificador EAN-13 a partir dos 12 primeiros dígitos. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error("ean13CheckDigit: precisa de 12 dígitos");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3; // pos ímpar (1-based) peso 1, par peso 3
  }
  return (10 - (sum % 10)) % 10;
}

/** Valida um EAN-13 completo (13 dígitos + verificador correto). */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code.charCodeAt(12) - 48;
}

/**
 * Gera um EAN-13 interno a partir de um sequencial (1..99_999_999_999).
 * Formato: "2" (prefixo interno) + sequencial com 11 dígitos + verificador.
 */
export function generateInternalEan13(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 99_999_999_999) {
    throw new Error("generateInternalEan13: seq fora do intervalo (1..99999999999)");
  }
  const first12 = "2" + String(seq).padStart(11, "0");
  return first12 + String(ean13CheckDigit(first12));
}

/** Normaliza um código vindo do ERP (tira espaços/traços); "" se vazio. */
export function normalizeBarcode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\s-]/g, "").trim();
}

/**
 * Decide o código de uma variante: usa o do ERP se for um EAN-13 válido;
 * senão gera um interno pelo sequencial. Retorna { barcode, generated }.
 */
export function resolveBarcode(
  erpBarcode: string | null | undefined,
  nextSeq: number
): { barcode: string; generated: boolean } {
  const norm = normalizeBarcode(erpBarcode);
  if (isValidEan13(norm)) return { barcode: norm, generated: false };
  return { barcode: generateInternalEan13(nextSeq), generated: true };
}
