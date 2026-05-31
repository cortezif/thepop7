import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Carrega o .env do raiz do monorepo
const __dirname = dirname(fileURLToPath(import.meta.url));
// override: true — o shell pode ter ANTHROPIC_API_KEY="" (vazio); o .env vence.
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { buildApp } from "./app.js";
import { verifyAppDbRole } from "@hubadvisor/db";

const app = buildApp();

// Railway/PaaS injeta PORT; em dev usamos API_PORT (3001).
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);

// Hardening do RLS (ADR-002): valida o papel restrito uma vez no boot. Se estiver
// inutilizável, desliga com aviso (não quebra as requests). Não-fatal pro boot.
verifyAppDbRole(app.log).catch((e) => app.log.warn(e, "falha ao verificar APP_DB_ROLE"));

app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`API ouvindo em http://localhost:${port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
