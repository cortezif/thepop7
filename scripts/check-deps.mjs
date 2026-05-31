#!/usr/bin/env node
// Blindagem contra "dependência fantasma" (ADR-CI). Num monorepo com npm
// workspaces, o hoisting deixa um app importar um pacote que NÃO declarou no seu
// package.json — funciona local/Railway, mas quebra em build estrita (Vercel).
// Este script reprova qualquer import de pacote não declarado.
//
// Uso: node scripts/check-deps.mjs   (roda no `npm run lint` e deve rodar no CI)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => "node:" + m)]);

// Descobre os workspaces pelo package.json da raiz (campo "workspaces").
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const patterns = rootPkg.workspaces ?? [];
const wsDirs = [];
for (const p of patterns) {
  const base = p.replace(/\/\*$/, "");
  const abs = join(root, base);
  if (p.endsWith("/*")) {
    if (existsSync(abs)) for (const e of readdirSync(abs)) {
      if (existsSync(join(abs, e, "package.json"))) wsDirs.push(join(base, e));
    }
  } else if (existsSync(join(abs, "package.json"))) wsDirs.push(base);
}

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (/node_modules|dist|\.turbo|\.next/.test(p)) continue;
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx|mts|cts)$/.test(e)) out.push(p);
  }
  return out;
}

const pkgName = (spec) => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
const IMPORT_RE = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

let problems = 0;
for (const ws of wsDirs) {
  const pj = JSON.parse(readFileSync(join(root, ws, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pj.dependencies ?? {}),
    ...Object.keys(pj.devDependencies ?? {}),
    ...Object.keys(pj.peerDependencies ?? {}),
    ...Object.keys(pj.optionalDependencies ?? {}),
  ]);
  const srcDir = join(root, ws, "src");
  if (!existsSync(srcDir)) continue;
  const imported = new Set();
  for (const f of walk(srcDir)) {
    const code = readFileSync(f, "utf8");
    let m;
    while ((m = IMPORT_RE.exec(code))) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec || spec.startsWith(".")) continue;
      imported.add(pkgName(spec));
    }
  }
  const missing = [...imported].filter((n) => n !== pj.name && !builtins.has(n) && !declared.has(n));
  if (missing.length) {
    problems++;
    console.error(`✗ [${pj.name}] importa sem declarar: ${missing.join(", ")}`);
    console.error(`    → adicione em ${ws}/package.json e rode "npm install"`);
  }
}

if (problems) {
  console.error(`\n${problems} pacote(s) com dependência não declarada. Build estrita (Vercel) vai falhar.`);
  process.exit(1);
}
console.log("✓ check-deps: nenhum import de pacote não declarado.");
