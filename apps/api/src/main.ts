import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Carrega o .env do raiz do monorepo
const __dirname = dirname(fileURLToPath(import.meta.url));
// override: true — o shell pode ter ANTHROPIC_API_KEY="" (vazio); o .env vence.
loadEnv({ path: resolve(__dirname, "../../../.env"), override: true });

import { buildApp } from "./app.js";

const app = buildApp();

const port = Number(process.env.API_PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`API ouvindo em http://localhost:${port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
