import express, { type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { JudgeService } from "../domain/types.ts";
import {
  addFriend,
  createCase,
  createHearing,
  createUser,
  findUserByEmail,
  findUserById,
  getCase,
  getEvidence,
  getHearing,
  getStatements,
  getVerdict,
  listCasesByUser,
  listHearings,
  saveMessage,
  saveEvidence,
  saveStatements,
  saveVerdict,
  listMessagesPaged,
  listConversations,
  acceptCase,
  rejectCase,
} from "../store/fileStore.ts";

const partySchema = z.object({
  side: z.union([z.literal("A"), z.literal("B")]),
  name: z.string().optional(),
  baseline_state: z.string().optional(),
});

const statementSchema = z.object({
  side: z.union([z.literal("A"), z.literal("B")]),
  narrative: z.string().min(1),
  feelings: z.string().optional(),
  context: z.string().optional(),
  requests: z.array(z.string()).optional(),
});

const evidenceSchema = z.object({
  side: z.union([z.literal("A"), z.literal("B")]),
  type: z.union([
    z.literal("text"),
    z.literal("link"),
    z.literal("image"),
    z.literal("other"),
  ]),
  title: z.string().optional(),
  content_or_url: z.string().min(1),
  notes: z.string().optional(),
});

export function buildServer(judgeService: JudgeService) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static("public"));

  // --- auth & session (simple bearer token) ---
  const sessions = new Map<string, string>(); // token -> userId

  function authMiddleware(req: Request, res: Response, next: () => void) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token || !sessions.has(token)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    (req as Request & { userId: string }).userId = sessions.get(token)!;
    return next();
  }

  function uuidToken() {
    return uuidv4();
  }

  app.post("/auth/signup", (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(1),
      password: z.string().min(4),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const user = createUser(parsed.data);
      const token = uuidToken();
      sessions.set(token, user.id);
      return res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      if ((err as Error).message === "email_exists") {
        return res.status(409).json({ error: "email_exists" });
      }
      return res.status(500).json({ error: "signup_failed" });
    }
  });

  app.post("/auth/login", (req, res) => {
    const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const user = findUserByEmail(parsed.data.email);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password)) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const token = uuidToken();
    sessions.set(token, user.id);
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.get("/me", authMiddleware, (req, res) => {
    const user = findUserById((req as Request & { userId: string }).userId);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    return res.json({ user: { id: user.id, email: user.email, name: user.name, friends: user.friends } });
  });

  app.get("/friends", authMiddleware, (req, res) => {
    const me = findUserById((req as Request & { userId: string }).userId);
    if (!me) return res.status(404).json({ error: "user_not_found" });
    const friends = (me.friends || [])
      .map((id) => findUserById(id))
      .filter(Boolean)
      .map((u) => ({ id: u!.id, email: u!.email, name: u!.name }));
    return res.json({ friends });
  });

  app.get("/users/lookup", authMiddleware, (req, res) => {
    const email = (req.query.email as string | undefined)?.trim();
    if (!email) return res.status(400).json({ error: "email_required" });
    const user = findUserByEmail(email);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    return res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  app.get("/conversations", authMiddleware, (req, res) => {
    const me = (req as Request & { userId: string }).userId;
    const convs = listConversations(me).map((c) => {
      const peer = findUserById(c.peer_id);
      return {
        peer: peer ? { id: peer.id, name: peer.name, email: peer.email } : { id: c.peer_id },
        last_message: c.last_message,
      };
    });
    return res.json({ conversations: convs });
  });

  app.post("/friends/:friendEmail", authMiddleware, (req, res) => {
    const me = findUserById((req as Request & { userId: string }).userId);
    if (!me) return res.status(404).json({ error: "user_not_found" });
    const friend = findUserByEmail(req.params.friendEmail);
    if (!friend) return res.status(404).json({ error: "friend_not_found" });
    addFriend(me.id, friend.id);
    return res.json({ ok: true });
  });

  function assertParticipant(req: Request, caseItem: { participant_ids?: string[] }, res: Response) {
    const userId = (req as Request & { userId?: string }).userId;
    if (!caseItem.participant_ids?.includes(userId ?? "")) {
      res.status(403).json({ error: "forbidden" });
      return false;
    }
    return true;
  }

  app.get("/cases", authMiddleware, (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const cases = listCasesByUser(userId).map((c) => ({
      id: c.id,
      topic: c.topic,
      status: c.status,
      created_at: c.created_at,
      acceptance: c.acceptance,
      expires_at: c.expires_at,
    }));
    return res.json({ cases });
  });

  app.post("/cases", authMiddleware, (req, res) => {
    const schema = z.object({
      topic: z.string().min(1),
      relationship_context: z.string().optional(),
      parties: z.array(partySchema).optional(),
      friend_email: z.string().email().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const userId = (req as Request & { userId: string }).userId;
    let participantIds: string[] | undefined;
    let invitedUserId: string | undefined;
    if (parsed.data.friend_email) {
      const friend = findUserByEmail(parsed.data.friend_email);
      if (!friend) return res.status(404).json({ error: "friend_not_found" });
      participantIds = [friend.id];
      invitedUserId = friend.id;
    }

    const newCase = createCase({ ...parsed.data, ownerId: userId, participantIds, invitedUserId });
    return res.status(201).json(newCase);
  });

  app.get("/cases/:caseId", authMiddleware, (req, res) => {
    const caseItem = getCase(req.params.caseId);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found" });
    }
    if (!assertParticipant(req, caseItem, res)) return;
    const hearings = listHearings(caseItem.id);
    const latest = hearings.sort((a, b) => b.round - a.round)[0];
    const verdict = latest ? getVerdict(latest.id) : undefined;
    return res.json({ case: caseItem, latest_hearing: latest, latest_verdict: verdict });
  });

  app.post("/cases/:caseId/hearings", authMiddleware, (req, res) => {
    const caseItem = getCase(req.params.caseId);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found" });
    }
    if (!assertParticipant(req, caseItem, res)) return;
    if (caseItem.acceptance && caseItem.acceptance !== "accepted") {
      return res.status(400).json({ error: "case_not_accepted" });
    }
    const schema = z.object({
      round: z.number().int().positive().optional(),
      statements: z.array(statementSchema).min(1),
      evidence: z.array(evidenceSchema).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const hearings = listHearings(caseItem.id);
    const nextRound =
      parsed.data.round ??
      (hearings.length === 0 ? 1 : Math.max(...hearings.map((h) => h.round)) + 1);

    const hearing = createHearing(caseItem.id, nextRound);
    const now = new Date().toISOString();
    saveStatements(
      hearing.id,
      parsed.data.statements.map((s) => ({ ...s, hearing_id: hearing.id, created_at: now })),
    );
    saveEvidence(hearing.id, (parsed.data.evidence ?? []).map((e) => ({
      ...e,
      id: randomUUID(),
      hearing_id: hearing.id,
      created_at: now,
    })));
    return res.status(201).json({ hearing });
  });

  app.post("/cases/:caseId/accept", authMiddleware, (req, res) => {
    try {
      const caseItem = acceptCase(req.params.caseId, (req as Request & { userId: string }).userId);
      return res.json(caseItem);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "case_not_found") return res.status(404).json({ error: msg });
      if (msg === "case_expired") return res.status(410).json({ error: msg });
      if (msg === "forbidden") return res.status(403).json({ error: msg });
      if (msg === "case_rejected") return res.status(409).json({ error: msg });
      return res.status(400).json({ error: msg });
    }
  });

  app.post("/cases/:caseId/reject", authMiddleware, (req, res) => {
    try {
      const caseItem = rejectCase(req.params.caseId, (req as Request & { userId: string }).userId);
      return res.json(caseItem);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "case_not_found") return res.status(404).json({ error: msg });
      if (msg === "forbidden") return res.status(403).json({ error: msg });
      return res.status(400).json({ error: msg });
    }
  });

  app.post("/cases/:caseId/hearings/:hearingId/judge", authMiddleware, async (req: Request, res: Response) => {
    const caseItem = getCase(req.params.caseId);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found" });
    }
    if (!assertParticipant(req, caseItem, res)) return;
    const hearing = getHearing(req.params.hearingId);
    if (!hearing || hearing.case_id !== caseItem.id) {
      return res.status(404).json({ error: "Hearing not found" });
    }

    try {
      const statements = getStatements(hearing.id);
      const evidence = getEvidence(hearing.id);
      const verdict = await judgeService.judge({
        caseId: caseItem.id,
        hearingId: hearing.id,
        topic: caseItem.topic,
        parties: caseItem.parties,
        statements,
        evidence,
      });
      saveVerdict(verdict);
      return res.json({ verdict });
    } catch (err) {
      const error = err as Error;
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/cases/:caseId/hearings/:hearingId/verdict", authMiddleware, (req, res) => {
    const caseItem = getCase(req.params.caseId);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found" });
    }
    if (!assertParticipant(req, caseItem, res)) return;
    const hearing = getHearing(req.params.hearingId);
    if (!hearing || hearing.case_id !== caseItem.id) {
      return res.status(404).json({ error: "Hearing not found" });
    }
    const verdict = getVerdict(hearing.id);
    if (!verdict) {
      return res.status(404).json({ error: "Verdict not found" });
    }
    return res.json({ verdict });
  });

  app.post("/cases/:caseId/hearings/:hearingId/appeal", authMiddleware, (req, res) => {
    const caseItem = getCase(req.params.caseId);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found" });
    }
    if (!assertParticipant(req, caseItem, res)) return;
    const hearing = getHearing(req.params.hearingId);
    if (!hearing || hearing.case_id !== caseItem.id) {
      return res.status(404).json({ error: "Hearing not found" });
    }

    const schema = z.object({
      statements: z.array(statementSchema).optional(),
      evidence: z.array(evidenceSchema).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const hearings = listHearings(caseItem.id);
    const nextRound = Math.max(...hearings.map((h) => h.round)) + 1;
    const next = createHearing(caseItem.id, nextRound);
    const now = new Date().toISOString();

    if (parsed.data.statements) {
      saveStatements(
        next.id,
        parsed.data.statements.map((s) => ({ ...s, hearing_id: next.id, created_at: now })),
      );
    }
    if (parsed.data.evidence) {
      saveEvidence(next.id, parsed.data.evidence.map((e) => ({
        ...e,
        id: randomUUID(),
        hearing_id: next.id,
        created_at: now,
      })));
    }
    caseItem.status = "appealed";
    updateCase(caseItem);
    return res.status(201).json({ hearing: next });
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // --- chat ---
  app.post("/chat/:peerId", authMiddleware, (req, res) => {
    const schema = z.object({ content: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const me = (req as Request & { userId: string }).userId;
    const peer = findUserById(req.params.peerId);
    if (!peer) return res.status(404).json({ error: "peer_not_found" });
    const msg = saveMessage({ from: me, to: peer.id, content: parsed.data.content.slice(0, 4000) });
    return res.status(201).json({ message: msg });
  });

  app.get("/chat/:peerId", authMiddleware, (req, res) => {
    const me = (req as Request & { userId: string }).userId;
    const peer = findUserById(req.params.peerId);
    if (!peer) return res.status(404).json({ error: "peer_not_found" });
    const since = (req.query.since as string | undefined) || undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const messages = listMessagesPaged(me, peer.id, { since, limit });
    return res.json({ messages });
  });

  return app;
}
