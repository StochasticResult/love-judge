# Love Judge

轻量版后端骨架，使用 Express + TypeScript + OpenAI（默认模型 `gpt-5-nano`）。判决调用可在无密钥时使用 mock 模式。

## 使用方式
1) 复制 `.env.example` 为 `.env`，填入你的 OpenAI API Key：  
   `OPENAI_API_KEY=sk-...`（如留空则自动启用 mock 判决）。
2) 安装依赖（需要网络）：
   ```bash
   npm install
   ```
3) 启动开发服务：
   ```bash
   npm run dev
   ```
   服务默认监听 `http://localhost:3000`。浏览器打开根路径即可使用前端界面。

## 关键接口
- 认证：`POST /auth/signup`（email/name/password），`POST /auth/login`（返回 Bearer token），`GET /me`。
- 好友：`POST /friends/:friendEmail` 添加好友。
- 聊天：`POST /chat/:peerId` 发送消息，`GET /chat/:peerId` 查看对话（持久存储）。
- 案件：
  - `POST /cases` 创建邀请（可带 `friend_email`，对方 24h 内接受/拒绝/忽略；忽略则过期）。仅需要标题/主题。
  - `POST /cases/:caseId/accept` / `POST /cases/:caseId/reject` 对方处理邀请。
  - `GET /cases` 列出当前用户参与的案件；`GET /cases/:caseId` 查看详情。
  - 接受后才能提交陈述：`POST /cases/:caseId/hearings`；判决 `POST /cases/:caseId/hearings/:hearingId/judge`；上诉 `POST /cases/:caseId/hearings/:hearingId/appeal`。
  - `GET /cases/:caseId/hearings/:hearingId/verdict` 查看判决。

前端：`public/index.html` 为 Apple Store 风格的单页，流程为「创建案件 → 提交双方陈述/证据 → 请求判决 → 上诉补充」。

API 结构与判决字段详见 `docs/backend-design.md`。判决输出会附加 `raw_agent_payload` 便于调试。
