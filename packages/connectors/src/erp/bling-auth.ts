// Fluxo OAuth2 do Bling v3 (ADR-004) — Authorization Code.
//
// Visão geral (https://developer.bling.com.br/aplicativos#fluxo-de-autoriza%C3%A7%C3%A3o):
//  1. O lojista abre a URL de autorização (response_type=code, client_id, state).
//     O redirect_uri é o registrado no app Bling; o Bling volta com ?code=&state=.
//  2. Troca do code por tokens: POST /oauth/token (grant_type=authorization_code)
//     com Basic auth (base64 client_id:client_secret) → { access_token,
//     refresh_token, expires_in }.
//  3. Renovação: POST /oauth/token (grant_type=refresh_token), mesmo Basic auth.
//
// Diferente da Tray (token em query param), o Bling usa Bearer na API e Basic no
// endpoint de token. As funções de parsing são puras (testáveis sem rede).

const OAUTH_BASE = process.env.BLING_OAUTH_URL ?? "https://www.bling.com.br/Api/v3/oauth";

export type BlingTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // segundos
};

/** Mapeia a resposta crua do /oauth/token do Bling para tokens normalizados (pura). */
export function parseBlingTokenResponse(raw: Record<string, unknown>): BlingTokens {
  const accessToken = String(raw.access_token ?? "");
  if (!accessToken) {
    const msg = (raw.error_description ?? raw.error ?? raw.message ?? "resposta sem access_token") as string;
    throw new Error(`Bling auth falhou: ${msg}`);
  }
  return {
    accessToken,
    refreshToken: String(raw.refresh_token ?? ""),
    expiresIn: Number(raw.expires_in) || 21600, // Bling: 6h por padrão
  };
}

/** URL que o lojista abre pra autorizar o app (passo 1). */
export function buildBlingAuthorizeUrl(opts: {
  clientId: string;
  state: string;        // slug do tenant
  redirectUri?: string; // opcional (o Bling usa o registrado no app)
}): string {
  const u = new URL(`${OAUTH_BASE}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("state", opts.state);
  if (opts.redirectUri) u.searchParams.set("redirect_uri", opts.redirectUri);
  return u.toString();
}

async function tokenRequest(
  params: Record<string, string>,
  creds: { clientId: string; clientSecret: string },
): Promise<BlingTokens> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams(params),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Bling /oauth/token ${res.status}: ${JSON.stringify(json)}`);
  return parseBlingTokenResponse(json);
}

/** Passo 2: troca o `code` por tokens. */
export async function exchangeBlingCode(opts: {
  code: string;
  creds: { clientId: string; clientSecret: string };
  redirectUri?: string;
}): Promise<BlingTokens> {
  const params: Record<string, string> = { grant_type: "authorization_code", code: opts.code };
  if (opts.redirectUri) params.redirect_uri = opts.redirectUri;
  return tokenRequest(params, opts.creds);
}

/** Passo 3: renova o access_token usando o refresh_token. */
export async function refreshBlingToken(
  refreshToken: string,
  creds: { clientId: string; clientSecret: string },
): Promise<BlingTokens> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, creds);
  // No refresh o Bling pode não reenviar o refresh_token — preserva o atual.
  return { ...tokens, refreshToken: tokens.refreshToken || refreshToken };
}
