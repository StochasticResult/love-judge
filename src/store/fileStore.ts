import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import type {
  Case,
  ChatMessage,
  Evidence,
  Hearing,
  Party,
  Statement,
  Verdict,
} from "../domain/types.ts";
import bcrypt from "bcryptjs";

export interface User {
  id: string;
  email: string;
  name: string;
  password: string; // demo only; replace with hashed password in production
  friends: string[];
}

interface DataShape {
  users: User[];
  cases: Case[];
  hearings: Hearing[];
  statements: Statement[];
  evidence: Evidence[];
  verdicts: Verdict[];
  messages: ChatMessage[];
}

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "db.json");

function load(): DataShape {
  if (!existsSync(DATA_FILE)) {
    mkdirSync(DATA_DIR, { recursive: true });
    const initial: DataShape = {
      users: [],
    cases: [],
    hearings: [],
    statements: [],
    evidence: [],
    verdicts: [],
    messages: [],
  };
    writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
  const content = readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(content) as DataShape;
}

function save(data: DataShape) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

let cache: DataShape | null = null;
function getData(): DataShape {
  if (!cache) cache = load();
  return cache;
}

export function createUser(input: { email: string; name: string; password: string }): User {
  const data = getData();
  const exists = data.users.find((u) => u.email === input.email);
  if (exists) throw new Error("email_exists");
  const hashed = bcrypt.hashSync(input.password, 10);
  const user: User = { id: uuid(), email: input.email, name: input.name, password: hashed, friends: [] };
  data.users.push(user);
  save(data);
  return user;
}

export function findUserByEmail(email: string): User | undefined {
  return getData().users.find((u) => u.email === email);
}

export function findUserById(id: string): User | undefined {
  return getData().users.find((u) => u.id === id);
}

export function addFriend(userId: string, friendId: string) {
  const data = getData();
  const user = data.users.find((u) => u.id === userId);
  const friend = data.users.find((u) => u.id === friendId);
  if (!user || !friend) throw new Error("user_not_found");
  if (!user.friends.includes(friendId)) user.friends.push(friendId);
  if (!friend.friends.includes(userId)) friend.friends.push(userId);
  save(data);
}

export function createCase(input: {
  ownerId: string;
  topic: string;
  relationship_context?: string;
  parties?: Party[];
  participantIds?: string[];
  invitedUserId?: string;
}): Case {
  const data = getData();
  const now = new Date().toISOString();
  const id = uuid();
  const parties =
    input.parties && input.parties.length > 0
      ? input.parties
      : [
          { side: "A" as const },
          { side: "B" as const },
        ];
  const participants = input.participantIds && input.participantIds.length > 0
    ? Array.from(new Set([input.ownerId, ...input.participantIds]))
    : [input.ownerId];

  const expiresAt = input.invitedUserId ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined;

  const newCase: Case = {
    id,
    topic: input.topic,
    relationship_context: input.relationship_context,
    parties,
    status: input.invitedUserId ? "pending_acceptance" : "draft",
    created_at: now,
    owner_id: input.ownerId,
    participant_ids: participants,
    invited_user_id: input.invitedUserId,
    expires_at: expiresAt,
    acceptance: input.invitedUserId ? "pending" : "accepted",
  } as Case & { owner_id: string };
  data.cases.push(newCase);
  save(data);
  return newCase;
}

export function listCasesByUser(userId: string): Case[] {
  expireInvites();
  return getData().cases.filter((c) => (c as Case & { participant_ids?: string[] }).participant_ids?.includes(userId));
}

export function getCase(caseId: string): (Case & { owner_id?: string }) | undefined {
  expireInvites();
  return getData().cases.find((c) => c.id === caseId);
}

export function acceptCase(caseId: string, userId: string): Case {
  const data = getData();
  const found = data.cases.find((c) => c.id === caseId);
  if (!found) throw new Error("case_not_found");
  if (found.acceptance === "rejected") throw new Error("case_rejected");
  if (found.acceptance === "accepted") return found;
  if (found.expires_at && new Date(found.expires_at).getTime() < Date.now()) {
    found.acceptance = "expired";
    found.status = "expired";
    save(data);
    throw new Error("case_expired");
  }
  if (found.invited_user_id !== userId) throw new Error("forbidden");
  found.acceptance = "accepted";
  found.status = "draft";
  found.participant_ids = Array.from(new Set([...(found.participant_ids ?? []), userId]));
  save(data);
  return found;
}

export function rejectCase(caseId: string, userId: string): Case {
  const data = getData();
  const found = data.cases.find((c) => c.id === caseId);
  if (!found) throw new Error("case_not_found");
  if (found.invited_user_id !== userId) throw new Error("forbidden");
  found.acceptance = "rejected";
  found.status = "closed";
  save(data);
  return found;
}

export function createHearing(caseId: string, round: number): Hearing {
  const data = getData();
  const now = new Date().toISOString();
  const hearing: Hearing = { id: uuid(), case_id: caseId, round, status: "submitted", created_at: now };
  data.hearings.push(hearing);
  const caseItem = data.cases.find((c) => c.id === caseId);
  if (caseItem) (caseItem as Case & { status: string }).status = "pending_judgement";
  save(data);
  return hearing;
}

export function saveStatements(hearingId: string, statements: Statement[]): void {
  const data = getData();
  data.statements = data.statements.filter((s) => s.hearing_id !== hearingId).concat(statements);
  save(data);
}

export function saveEvidence(hearingId: string, evidence: Evidence[]): void {
  const data = getData();
  data.evidence = data.evidence.filter((e) => e.hearing_id !== hearingId).concat(evidence);
  save(data);
}

export function getHearing(hearingId: string): Hearing | undefined {
  return getData().hearings.find((h) => h.id === hearingId);
}

export function listHearings(caseId: string): Hearing[] {
  return getData().hearings.filter((h) => h.case_id === caseId);
}

export function getStatements(hearingId: string): Statement[] {
  return getData().statements.filter((s) => s.hearing_id === hearingId);
}

export function getEvidence(hearingId: string): Evidence[] {
  return getData().evidence.filter((e) => e.hearing_id === hearingId);
}

export function saveVerdict(verdict: Verdict): void {
  const data = getData();
  data.verdicts = data.verdicts.filter((v) => v.hearing_id !== verdict.hearing_id).concat(verdict);
  const hearing = data.hearings.find((h) => h.id === verdict.hearing_id);
  if (hearing) hearing.status = "judged";
  const caseItem = data.cases.find((c) => c.id === hearing?.case_id);
  if (caseItem) (caseItem as Case & { status: string }).status = "decided";
  save(data);
}

export function getVerdict(hearingId: string): Verdict | undefined {
  return getData().verdicts.find((v) => v.hearing_id === hearingId);
}

export function saveMessage(message: { from: string; to: string; content: string }): ChatMessage {
  const data = getData();
  const msg: ChatMessage = {
    id: uuid(),
    from_user_id: message.from,
    to_user_id: message.to,
    content: message.content,
    created_at: new Date().toISOString(),
  };
  data.messages.push(msg);
  save(data);
  return msg;
}

export function listMessages(userId: string, peerId: string): ChatMessage[] {
  return getData().messages
    .filter(
      (m) =>
        (m.from_user_id === userId && m.to_user_id === peerId) ||
        (m.from_user_id === peerId && m.to_user_id === userId),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function listMessagesPaged(userId: string, peerId: string, opts: { since?: string; limit?: number } = {}): ChatMessage[] {
  let msgs = listMessages(userId, peerId);
  if (opts.since) {
    msgs = msgs.filter((m) => m.created_at > opts.since!);
  }
  const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
  if (limit) {
    msgs = msgs.slice(-limit);
  }
  return msgs;
}

export function listConversations(userId: string): Array<{ peer_id: string; last_message?: ChatMessage }> {
  const data = getData();
  const peers = new Map<string, ChatMessage>();
  for (const m of data.messages) {
    if (m.from_user_id === userId) {
      peers.set(m.to_user_id, newer(peers.get(m.to_user_id), m));
    } else if (m.to_user_id === userId) {
      peers.set(m.from_user_id, newer(peers.get(m.from_user_id), m));
    }
  }
  return Array.from(peers.entries()).map(([peer_id, last_message]) => ({ peer_id, last_message }));
}

function newer(a: ChatMessage | undefined, b: ChatMessage): ChatMessage {
  if (!a) return b;
  return a.created_at > b.created_at ? a : b;
}

function expireInvites() {
  const data = getData();
  let mutated = false;
  const now = Date.now();
  for (const c of data.cases) {
    if (c.acceptance === "pending" && c.expires_at && new Date(c.expires_at).getTime() < now) {
      c.acceptance = "expired";
      c.status = "expired";
      mutated = true;
    }
  }
  if (mutated) save(data);
}
