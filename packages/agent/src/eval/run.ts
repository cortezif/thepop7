import { runAgentTurn } from "../agent.js";
import type { AgentConfig, ConversationContext } from "../types.js";
import type { ProviderModel } from "../providers.js";
import { makeMockTools } from "./mock-tools.js";
import { SCENARIOS, DEFAULT_CONFIG, type CheckResult } from "./scenarios.js";
import { judgeReply, JUDGE_BAR, type JudgeVerdict } from "./judge.js";

/**
 * maya-eval — gate de qualidade das respostas da Maya.
 *
 * Roda cenários canônicos pelo agente real (com tools mock determinísticas),
 * aplica asserções de comportamento e, se habilitado, um juiz-LLM de tom.
 * Sai com código !=0 se a taxa de aprovação ficar abaixo do limite (gate de CI).
 *
 * Uso:  node --import tsx src/eval/run.ts [--no-judge] [--threshold=0.8] [--only=<id>]
 */

const args = process.argv.slice(2);
const NO_JUDGE = args.includes("--no-judge") || !process.env.ANTHROPIC_API_KEY;
const THRESHOLD = Number((args.find((a) => a.startsWith("--threshold=")) ?? "").split("=")[1] || 0.8);
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").split("=")[1];

// Cascade fixa em Anthropic-só → resultados comparáveis (sem cair pra Groq/Ollama).
const EVAL_CASCADE: ProviderModel[] = [
  { provider: "anthropic", model: "claude-sonnet-4-6", costWeight: 3, label: "Sonnet 4.6" },
];

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

type ScenarioReport = {
  id: string;
  guards: string;
  checks: CheckResult[];
  judge?: JudgeVerdict;
  reply: string;
  toolNames: string[];
  costBRL: number;
  passed: boolean;
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(C.red("ANTHROPIC_API_KEY ausente — o agente não roda sem ela. Abortando."));
    process.exit(2);
  }

  const scenarios = ONLY ? SCENARIOS.filter((s) => s.id === ONLY) : SCENARIOS;
  if (!scenarios.length) {
    console.error(C.red(`Nenhum cenário com id="${ONLY}".`));
    process.exit(2);
  }

  console.log(C.bold(`\n maya-eval — ${scenarios.length} cenário(s) · juiz=${NO_JUDGE ? "off" : "on"} · gate=${(THRESHOLD * 100).toFixed(0)}%\n`));

  const reports: ScenarioReport[] = [];

  for (const sc of scenarios) {
    const { tools, trace } = makeMockTools();
    const config: AgentConfig = { ...DEFAULT_CONFIG, ...sc.config };
    const context: ConversationContext = {
      conversationId: `eval-${sc.id}`,
      channel: "manual",
      contactProfile: {},
      recentMessages: [],
      ...sc.context,
    };

    let turn;
    try {
      turn = await runAgentTurn(config, context, sc.userMessage, tools, EVAL_CASCADE);
    } catch (e: any) {
      reports.push({
        id: sc.id, guards: sc.guards, checks: [{ ok: false, label: "execução do agente", detail: e?.message ?? String(e) }],
        reply: "", toolNames: [], costBRL: 0, passed: false,
      });
      continue;
    }

    // Check universal: toda volta precisa de uma resposta textual não-vazia.
    const checks = [
      { ok: !!turn.replyText?.trim(), label: "produziu uma resposta não-vazia", detail: turn.replyText?.trim() ? undefined : "agente terminou sem texto" },
      ...sc.checks(turn, trace),
    ];
    let judge: JudgeVerdict | undefined;
    if (!NO_JUDGE && sc.judgeRubric) {
      judge = await judgeReply({ userMessage: sc.userMessage, reply: turn.replyText ?? "", rubric: sc.judgeRubric });
    }

    // GATE = asserções determinísticas (estáveis). O juiz-LLM é estocástico, então
    // entra só como métrica de qualidade reportada — não bloqueia o gate.
    const checksOk = checks.every((c) => c.ok);
    reports.push({
      id: sc.id,
      guards: sc.guards,
      checks,
      judge,
      reply: turn.replyText ?? "",
      toolNames: trace.map((t) => t.name),
      costBRL: turn.llmUsage.estimatedCostBRL,
      passed: checksOk,
    });
  }

  // ---- relatório ----
  let totalCost = 0;
  for (const r of reports) {
    totalCost += r.costBRL;
    const head = r.passed ? C.green("PASS") : C.red("FAIL");
    console.log(`${head}  ${C.bold(r.id)}  ${C.dim(r.guards)}`);
    for (const c of r.checks) {
      const mark = c.ok ? C.green("  ✓") : C.red("  ✗");
      console.log(`${mark} ${c.label}${c.detail ? C.dim(" — " + c.detail) : ""}`);
    }
    if (r.judge) {
      // ✓ acima da barra de qualidade, ~ aceitável mas abaixo da barra, ✗ abaixo do piso (defeito)
      const jm = !r.judge.pass ? C.red("  ✗") : r.judge.score >= JUDGE_BAR ? C.green("  ✓") : C.yellow("  ~");
      console.log(`${jm} juiz: ${r.judge.score.toFixed(2)} ${C.dim("— " + r.judge.reason)}`);
    }
    console.log(C.dim(`    tools: [${r.toolNames.join(", ") || "—"}]`));
    console.log(C.dim(`    reply: ${r.reply.slice(0, 160).replace(/\n/g, " ")}${r.reply.length > 160 ? "…" : ""}`));
    console.log();
  }

  const passed = reports.filter((r) => r.passed).length;
  const rate = passed / reports.length;
  const judged = reports.filter((r) => r.judge);
  const avgJudge = judged.length ? judged.reduce((a, r) => a + r.judge!.score, 0) / judged.length : null;
  const judgeStr = avgJudge !== null ? ` · qualidade média ${avgJudge.toFixed(2)}` : "";
  const line = `${passed}/${reports.length} cenários passaram (${(rate * 100).toFixed(0)}%)${judgeStr} · custo ~R$${Math.max(0, totalCost).toFixed(4)}`;
  console.log(C.bold(rate >= THRESHOLD ? C.green(` ${line} — GATE OK\n`) : C.red(` ${line} — GATE REPROVADO (limite ${(THRESHOLD * 100).toFixed(0)}%)\n`)));

  process.exit(rate >= THRESHOLD ? 0 : 1);
}

main().catch((e) => {
  console.error(C.red("maya-eval falhou: "), e);
  process.exit(2);
});
