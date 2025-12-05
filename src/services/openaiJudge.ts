import OpenAI from "openai";
import type {
  Evidence,
  JudgeService,
  JudgeServiceInput,
  Verdict,
} from "../domain/types.ts";

interface JudgeDeps {
  apiKey?: string;
  model?: string;
  mock?: boolean;
}

function defaultVerdict(input: JudgeServiceInput): Verdict {
  const totalWords = input.statements.reduce((acc, s) => acc + s.narrative.split(/\s+/).length, 0) || 1;
  const aWords =
    input.statements
      .filter((s) => s.side === "A")
      .reduce((acc, s) => acc + s.narrative.split(/\s+/).length, 0) || totalWords / 2;
  const partyA_pct = Math.round((aWords / totalWords) * 100);
  const partyB_pct = 100 - partyA_pct;
  return {
    hearing_id: input.hearingId,
    score: { partyA_pct, partyB_pct, confidence: 0.3 },
    summary: "Mocked verdict: replace with real OpenAI call.",
    reasoning: {
      facts: "Mock mode used because no OpenAI API key provided.",
      fairness_checks: ["Mock mode only approximates percentages."],
      emotion_considerations: "Not evaluated in mock mode.",
      assumptions: [],
      missing_info: [],
    },
    advice: {
      together: ["Share key feelings calmly and set a time to revisit the issue."],
      forA: ["Acknowledge B的压力并用“我感受”句式表达需求。"],
      forB: ["主动确认 A 的核心诉求，并提出一个小的让步行动。"],
    },
    created_at: new Date().toISOString(),
  };
}

function buildPrompt(input: JudgeServiceInput) {
  const evidence: Evidence[] = input.evidence ?? [];
  return [
    "你是一位中立的关系调解法官。先基于事实，再评估情绪/外部压力。输出 JSON，百分比总和 100。",
    "不要逐字复述或引用攻击性用语，用中性语言提炼情绪和诉求，避免二次伤害。",
    "输出字段：score.partyA_pct, score.partyB_pct (0-100), score.confidence(0-1), summary, reasoning{facts, fairness_checks[], emotion_considerations, assumptions[], missing_info[]}, advice{together[], forA[], forB[]}.",
    `案件主题: ${input.topic}`,
    `双方: ${input.parties
      .map((p) => `${p.side}${p.name ? `(${p.name})` : ""}${p.baseline_state ? ` baseline:${p.baseline_state}` : ""}`)
      .join("; ")}`,
    "陈述:",
    ...input.statements.map(
      (s) =>
        `${s.side}: 事实="${s.narrative}" 感受="${s.feelings ?? ""}" 背景="${s.context ?? ""}" 诉求="${(s.requests ?? []).join(",")}"`,
    ),
    "证据:",
    ...evidence.map((e) => `${e.side} ${e.type} ${e.title ?? ""} ${e.content_or_url}`),
    "规则: 不要进行道德审判；保持理性；明确缺失信息；如有推断列出假设；用中文简洁表达。",
  ].join("\n");
}

export function createJudgeService(deps: JudgeDeps): JudgeService {
  const model = deps.model ?? "gpt-5-nano";
  const useMock = deps.mock || !deps.apiKey;
  const client = deps.apiKey ? new OpenAI({ apiKey: deps.apiKey }) : null;

  return {
    async judge(input: JudgeServiceInput): Promise<Verdict> {
      if (useMock || !client) {
        return defaultVerdict(input);
      }

      const prompt = buildPrompt(input);

      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are an impartial relationship dispute judge who outputs strict JSON only." },
          { role: "user", content: prompt },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("No completion returned from OpenAI");
      }

      const parsed = JSON.parse(raw);
      const partyA_pct = Math.min(100, Math.max(0, Number(parsed.score?.partyA_pct ?? 0)));
      const partyB_pct = Math.min(100, Math.max(0, Number(parsed.score?.partyB_pct ?? 0)));
      const confidence = Math.min(1, Math.max(0, Number(parsed.score?.confidence ?? 0)));

      const verdict: Verdict = {
        hearing_id: input.hearingId,
        score: { partyA_pct, partyB_pct, confidence },
        summary: parsed.summary ?? "",
        reasoning: {
          facts: parsed.reasoning?.facts ?? "",
          fairness_checks: parsed.reasoning?.fairness_checks ?? [],
          emotion_considerations: parsed.reasoning?.emotion_considerations ?? "",
          assumptions: parsed.reasoning?.assumptions ?? [],
          missing_info: parsed.reasoning?.missing_info ?? [],
        },
        advice: {
          together: parsed.advice?.together ?? [],
          forA: parsed.advice?.forA ?? [],
          forB: parsed.advice?.forB ?? [],
        },
        raw_agent_payload: completion,
        created_at: new Date().toISOString(),
      };
      return verdict;
    },
  };
}
