import "dotenv/config";
import { createJudgeService } from "./services/openaiJudge.ts";
import { buildServer } from "./http/server.ts";

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-5-nano";
const mock = process.env.JUDGE_MOCK === "1" || !apiKey;

const judgeService = createJudgeService({ apiKey, model, mock });
const app = buildServer(judgeService);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Love Judge API listening on http://localhost:${port} (model=${model}, mock=${mock})`);
});
