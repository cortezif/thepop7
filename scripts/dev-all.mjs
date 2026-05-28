#!/usr/bin/env node
/**
 * Sobe api + worker + web simultaneamente, em processos filhos.
 * Saída colorida por app. Ctrl+C derruba todos.
 *
 * Uso:  node scripts/dev-all.mjs
 * Pré-requisito: `npm run bootstrap` (uma vez, pra setar DB).
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const PROCS = [
  { name: "api",    cmd: "npm", args: ["--workspace", "@thepop/api",    "run", "dev"], color: "\x1b[35m" }, // magenta
  { name: "worker", cmd: "npm", args: ["--workspace", "@thepop/worker", "run", "dev"], color: "\x1b[33m" }, // yellow
  { name: "web",    cmd: "npm", args: ["--workspace", "@thepop/web",    "run", "dev"], color: "\x1b[36m" }, // cyan
];

const RESET = "\x1b[0m";

const children = PROCS.map((p) => {
  const child = spawn(p.cmd, p.args, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${p.color}[${p.name.padEnd(6)}]${RESET}`;
  child.stdout.on("data", (d) => process.stdout.write(d.toString().split("\n").map((l) => l && `${prefix} ${l}`).join("\n") + "\n"));
  child.stderr.on("data", (d) => process.stderr.write(d.toString().split("\n").map((l) => l && `${prefix} ${l}`).join("\n") + "\n"));
  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
    children.forEach((c) => c !== child && !c.killed && c.kill());
  });
  return child;
});

function shutdown() {
  console.log("\nencerrando...");
  children.forEach((c) => c.kill());
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
