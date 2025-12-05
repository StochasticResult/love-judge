# Love Judge 后端设计

> 目标：提供一套可插拔的 API，让前端把情侣争议的陈述、情绪和证据送入 AI，得到百分比分配的“谁更站理”判决，并支持多轮上诉。

## 核心原则
- 中立理性：先基于事实，再考虑情绪和压力背景，避免情绪偏见。
- 透明可追溯：所有输入、判决、理由、建议都持久化；每轮判决与上诉链路可查询。
- 可扩展：AI Agent 调用做成接口，可替换不同模型或服务商。
- 前后端解耦：REST/JSON 契约，前端不依赖具体模型细节。

## 域模型（逻辑层）
- **Case**：一次争议。字段：`id`, `topic`, `relationship_context`, `status`(`draft|pending_judgement|decided|appealed|closed`), `created_at`.
- **Party**：`side`(`A|B`), `name`(可选), `baseline_state`(近期压力/情绪背景)。
- **Hearing**：一轮审理（初次或上诉）。字段：`id`, `case_id`, `round`(1 起), `status`(`submitted|judged`), `created_at`.
- **Statement**：每轮每方的陈述。字段：`hearing_id`, `side`, `narrative`(事实叙述), `feelings`(情绪/感受), `context`(工作/生活压力), `requests`(诉求), `timestamps`.
- **Evidence**：支持文本/链接/图片占位。字段：`id`, `hearing_id`, `side`, `type`(`text|link|image|other`), `title`, `content_or_url`, `notes`.
- **Verdict**：AI 输出。字段：`hearing_id`, `score`(`partyA_pct`, `partyB_pct`, `confidence`), `summary`, `reasoning`(事实判断/公平性检查/情绪考量/缺失信息), `advice`(劝和建议、改进行动), `raw_agent_payload`.

## API 契约（建议）
- `POST /cases`
  - 入参：`topic`, `relationship_context`(可选), `parties`(可选 A/B 名字与 baseline_state)。
  - 出参：`case_id`, 初始 `status`.
- `GET /cases/:caseId`：返回 Case 概要与最新判决。
- `POST /cases/:caseId/hearings`
  - 作用：创建一轮审理（首轮或上诉），并提交双方陈述+证据。
  - 入参：`round`(可省略自动递增), `statements`(A/B), `evidence`(可空)。
  - 出参：`hearing_id`, `round`, `status=submitted`.
- `POST /cases/:caseId/hearings/:hearingId/judge`
  - 作用：调用 AI Agent 生成判决。
  - 入参：可追加 `additional_notes`(调参或裁决提示)。
  - 出参：`verdict` 结构（见下）。
- `GET /cases/:caseId/hearings/:hearingId/verdict`：查询指定轮判决。
- `POST /cases/:caseId/hearings/:hearingId/appeal`
  - 作用：发起上诉，自动创建下一轮 Hearing（round+1），允许附加证据/补充陈述。
  - 入参：`new_evidence`, `rebuttals`(双方补充)。
  - 出参：新 `hearing_id`, `round`.

### 判决返回结构（建议）
```json
{
  "hearing_id": "uuid",
  "score": { "partyA_pct": 40, "partyB_pct": 60, "confidence": 0.72 },
  "summary": "核心结论一句话",
  "reasoning": {
    "facts": "基于证据/时间线的事实判断",
    "fairness_checks": ["举证/自证责任", "陈述一致性/逻辑性"],
    "emotion_considerations": "对外部压力与过激情绪的影响评估",
    "assumptions": ["如有推断列出"],
    "missing_info": ["缺失或模糊点"]
  },
  "advice": {
    "reconciliation": ["劝和建议，具体可执行"],
    "boundaries": ["双方边界/改进行动"],
    "next_steps": ["若需上诉/补充的指引"]
  },
  "raw_agent_payload": {}
}
```

## AI Agent 接口抽象
- 提供一个 `JudgeService` 接口（伪码）：
```ts
interface JudgeService {
  judge(input: {
    caseId: string;
    hearingId: string;
    topic: string;
    parties: { side: "A" | "B"; name?: string; baseline_state?: string }[];
    statements: { side: "A" | "B"; narrative: string; feelings?: string; context?: string; requests?: string[] }[];
    evidence: Evidence[];
  }): Promise<Verdict>;
}
```
- 由调用方注入具体的 Agent 客户端（LLM/外部 API）。后端仅做格式化 prompt + 解析/验证输出。

### Prompt 设计要点
- 角色：客观公正的关系调解法官，先事实后情绪，避免道德审判。
- 要求：输出 JSON 且百分比总和 100；逐条列出事实依据、情绪影响、缺失信息与假设。
- 安全：对模型输出做 schema 验证（百分比区间 0-100，信心 0-1，字符串长度限制）。

示例指令（摘要）：
```
1) 你是中立的关系调解法官，判定谁更站理，先基于事实，再评估情绪/压力的影响。
2) 给出 A/B 的责任/合理性百分比（总和 100）与信心分。
3) 列出：事实依据、关键矛盾点、公平性检查、情绪/外部压力影响、缺失信息与假设。
4) 输出劝和建议，关注如何减少摩擦、改善沟通、未来预防。
5) 只输出 JSON，遵守指定 schema。
```

## 数据存储（建议）
- 轻量场景：PostgreSQL (cases/hearings/statements/evidence/verdicts)。
- 判决原文/模型原始输出可存 JSONB，便于审计。
- 若无持久化需求，可先用 SQLite/文件存储迭代。

## 流程
1) 创建 Case → round=1 的 Hearing，提交双方陈述/证据。
2) `judge` 调用 AI → 保存 Verdict。
3) 若有异议 → `appeal` 创建 round+1 → 重复步骤 2。
4) 允许查询历史每轮判决与理由链路。

## 非功能
- 日志：请求/响应审计（脱敏）。判决失败重试/降级（返回“需要人工复核”）。
- 限流与鉴权：简单 token / session。必要时为每个 Case 限制上诉次数或冷却时间。
- 监控：判决用时、失败率、schema 验证错误数。

## 目录建议
- `src/domain`（实体定义与用例）
- `src/http`（路由/DTO/验证）
- `src/services/ai`（Agent 适配层）
- `src/store`（仓储接口 + 实现）
- `tests`（schema 校验与端到端用例）
