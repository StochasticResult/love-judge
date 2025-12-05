export type PartySide = "A" | "B";

export interface Party {
  side: PartySide;
  name?: string;
  baseline_state?: string;
}

export interface Case {
  id: string;
  topic: string;
  relationship_context?: string;
  parties: Party[];
  status:
    | "pending_acceptance"
    | "draft"
    | "pending_judgement"
    | "decided"
    | "appealed"
    | "expired"
    | "closed";
  created_at: string;
  owner_id?: string;
  participant_ids?: string[];
  invited_user_id?: string;
  expires_at?: string; // invitation expiry
  acceptance?: "pending" | "accepted" | "rejected" | "expired";
}

export interface Hearing {
  id: string;
  case_id: string;
  round: number;
  status: "submitted" | "judged";
  created_at: string;
}

export interface Statement {
  hearing_id: string;
  side: PartySide;
  narrative: string;
  feelings?: string;
  context?: string;
  requests?: string[];
  created_at: string;
}

export interface Evidence {
  id: string;
  hearing_id: string;
  side: PartySide;
  type: "text" | "link" | "image" | "other";
  title?: string;
  content_or_url: string;
  notes?: string;
  created_at: string;
}

export interface Verdict {
  hearing_id: string;
  score: { partyA_pct: number; partyB_pct: number; confidence: number };
  summary: string;
  reasoning: {
    facts: string;
    fairness_checks: string[];
    emotion_considerations: string;
    assumptions: string[];
    missing_info: string[];
  };
  advice: {
    together: string[];
    forA: string[];
    forB: string[];
  };
  raw_agent_payload?: unknown;
  created_at: string;
}

export interface JudgeServiceInput {
  caseId: string;
  hearingId: string;
  topic: string;
  parties: Party[];
  statements: Array<{
    side: PartySide;
    narrative: string;
    feelings?: string;
    context?: string;
    requests?: string[];
  }>;
  evidence: Evidence[];
}

export interface JudgeService {
  judge(input: JudgeServiceInput): Promise<Verdict>;
}

export interface ChatMessage {
  id: string;
  from_user_id: string;
  to_user_id: string;
  content: string;
  created_at: string;
}
