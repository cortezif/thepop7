// Fluxo OAuth da Tray Commerce (ADR-004) — troca de `code` por access_token.
//
// Visão geral do fluxo (https://developer.tray.com.br):
//  1. O lojista instala/autoriza o app na loja dele. A Tray redireciona pro
//     nosso callback com `?code=...&api_address=https://loja.commercesuite.com.br/web_api`.
//  2. Trocamos o code por tokens: POST {api_address}/auth com consumer_key/secret/code
//     → { access_token, refresh_token, store_id, date_expiration_* }.
//  3. Renovação: GET {api_address}/auth?refresh_token=... → novo access_token.
//
// As funções de parsing são puras (testáveis sem rede); as de rede só montam a
// requisição e delegam o parsing.

export type TrayTokens = {
  accessToken: string;
  refreshToken: string;
  storeId?: string;
  apiAddress?: string;
  accessExpiresAt?: Date;
  refreshExpiresAt?: Date;
};

/** Datas da Tray vêm como "YYYY-MM-DD HH:MM:SS" (sem timezone). */
export function parseTrayDate(s: unknown): Date | undefined {
  if (typeof s !== "string" || !s.trim()) return undefined;
  // Normaliza "2024-01-01 12:00:00" → ISO "2024-01-01T12:00:00".
  const iso = s.trim().replace(" ", "T");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Mapeia a resposta crua do /auth da Tray para tokens normalizados (pura). */
export function parseTrayTokenResponse(raw: Record<string, unknown>): TrayTokens {
  const accessToken = String(raw.access_token ?? "");
  const refreshToken = String(raw.refresh_token ?? "");
  if (!accessToken) {
    const msg = (raw.message ?? raw.error ?? "resposta sem access_token") as string;
    throw new Error(`Tray auth falhou: ${msg}`);
  }
  return {
    accessToken,
    refreshToken,
    storeId: raw.store_id != null ? String(raw.store_id) : undefined,
    apiAddress: typeof raw.api_address === "string" ? raw.api_address : undefined,
    accessExpiresAt: parseTrayDate(raw.date_expiration_access_token),
    refreshExpiresAt: parseTrayDate(raw.date_expiration_refresh_token),
  };
}

/**
 * URL que o lojista abre pra autorizar o app (passo 1). Após autorizar, a Tray
 * redireciona pro nosso `callbackUrl` com `code` + `api_address`.
 *
 * IMPORTANTE: a autorização (que gera o `code`) é em `{dominio_da_loja}/auth.php`
 * — NÃO em `{api}/web_api/auth` (esse é o endpoint de token/refresh; chamá-lo no
 * GET retorna "The field refresh_token is required"). Por isso removemos o
 * sufixo `/web_api` do apiAddress para chegar no domínio da loja.
 */
export function buildTrayAuthorizeUrl(opts: {
  apiAddress: string;       // web_api da loja (ex.: https://loja.com.br/web_api)
  consumerKey: string;
  callbackUrl: string;
}): string {
  const storeBase = opts.apiAddress.replace(/\/$/, "").replace(/\/web_api$/i, "");
  const u = new URL(`${storeBase}/auth.php`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("consumer_key", opts.consumerKey);
  u.searchParams.set("callback", opts.callbackUrl);
  return u.toString();
}

/** Passo 2: troca o `code` por tokens. */
export async function exchangeTrayCode(opts: {
  apiAddress: string;
  consumerKey: string;
  consumerSecret: string;
  code: string;
}): Promise<TrayTokens> {
  const base = opts.apiAddress.replace(/\/$/, "");
  const body = new URLSearchParams({
    consumer_key: opts.consumerKey,
    consumer_secret: opts.consumerSecret,
    code: opts.code,
  });
  const res = await fetch(`${base}/auth`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Tray /auth ${res.status}: ${JSON.stringify(json)}`);
  return { ...parseTrayTokenResponse(json), apiAddress: base };
}

/** Passo 3: renova o access_token usando o refresh_token. */
export async function refreshTrayToken(opts: {
  apiAddress: string;
  refreshToken: string;
}): Promise<TrayTokens> {
  const base = opts.apiAddress.replace(/\/$/, "");
  const u = new URL(`${base}/auth`);
  u.searchParams.set("refresh_token", opts.refreshToken);
  const res = await fetch(u.toString(), { method: "GET" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Tray refresh ${res.status}: ${JSON.stringify(json)}`);
  // No refresh a Tray pode não reenviar o refresh_token — preserva o atual.
  const parsed = parseTrayTokenResponse({ refresh_token: opts.refreshToken, ...json });
  return { ...parsed, apiAddress: base };
}
