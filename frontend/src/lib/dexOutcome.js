// ASK-33 — THE CAPTURE OUTCOME ADAPTER, and the words for it.
//
// A capture has three endings (docs/DECISION_DESK_PLAN.md 1.4, 5.1, 5.2): a
// decision is ready, there was nothing to decide, or it failed. The Desk's Dex
// well (Phase 3) and the phone's sheet (Phase 4) both render them from THIS
// module, so the two surfaces can never print two different sentences for the
// same ending.
//
// FIELD NAMES — THE ONE PLACE TO CHANGE. CONFIRMED against the backend on
// 2026-09-16 by reading the pipeline rather than waiting on an answer
// (routers/voice_notes.py GET /voice-notes/{id} returns the note document
// itself, minus _id and audio_path; services/voice.py process_voice_note writes
// the endings; services/ai_consent.py raises the consent refusal inside
// services/ai/llm_limits.guarded_llm, which wraps every LLM turn). No mismatch
// with what this module reads — see docs/ASK-33_Dex_Decide_Desk.md, "The note's
// shape, confirmed". A followed note ends as:
//   status "done"   + outcome "decision"          + decision_id + execution_summary
//   status "done"   + outcome "nothing_to_decide" + summary (Dex's read of what was said)
//   status "failed" + error — str(exception); an AI-consent refusal carries the
//                     code "ai_consent_required" (services/ai_consent.py)
// useDexCapture's follow() copies those onto `understanding` as status, outcome,
// decisionId, decision, said and error — and reports a done note with no
// decision as status "nothing". If a field is renamed, change readNote() below
// and nothing else.
import { proposalCounts, executionSummaryCounts, proposalCreatesText } from "./decisionProposal";

export const AI_CONSENT_CODE = "ai_consent_required";

/* THE LINK, AND THE SCREEN IT NEEDED.
   ASK-33.1 took the link off because Settings had no AI-consent section, and a
   link to a screen that does not exist is worse than no link. RBAC P1 (efbdf83,
   merged 2026-09-16) built that screen — Settings › Business › AI processing,
   reading and writing /tenant/ai-consent — so the link is back on, pointing
   where lib/api.js's own 451 toast now points. */
export const AI_CONSENT_HREF = "/settings?tab=business#ai-consent";

export const OUTCOME_COPY = {
  ready: (who, creates) => `Decision ready for ${who}${creates ? ` · ${creates}` : ""}`,
  nothing: "Nothing to decide in that",
  consent: "AI is off for this company — an owner has to turn on AI consent before Dex can read anything",
  consentLink: "Open Settings",
  failed: (reason) => (reason ? `That didn't go through: ${reason}` : "That didn't go through. Please try again."),
  slow: "Still working on it. It will show up in Decisions on the Desk.",
  // ASK-33 Phase 4 — a Retry pressed while Dex is still reading another capture.
  retryWait: "Dex is still reading your last one — retry once it's done.",
  // ASK-33.1 — and a capture sent while it is still reading the last one.
  stillReading: "Dex is still reading your last one — send this when it's done.",
};

// The statuses useDexCapture's follow() ends a note on.
export const ENDING_STATUSES = ["done", "nothing", "failed", "slow"];

function readNote(u) {
  return {
    status: u?.status || null,
    outcome: u?.outcome || null,
    decisionId: u?.decisionId || null,
    decision: u?.decision || null,
    answer: u?.said || null,
    error: u?.error ?? null,
  };
}

/** Why a capture failed, in the founder's words. */
export function failureReason(error) {
  const raw = typeof error === "string" ? error : error ? JSON.stringify(error) : "";
  if (raw.includes(AI_CONSENT_CODE)) {
    return { code: AI_CONSENT_CODE, message: OUTCOME_COPY.consent, href: AI_CONSENT_HREF, linkLabel: OUTCOME_COPY.consentLink };
  }
  return { code: "other", message: OUTCOME_COPY.failed(raw.trim()), href: null, linkLabel: null };
}

/**
 * The ending a followed note reached, or null while it is still on its way.
 * @returns {null
 *   | {kind: "ready", decisionId: string, decision: object|null}
 *   | {kind: "nothing", answer: string|null}
 *   | {kind: "failed", code: string, message: string, href: string|null, linkLabel: string|null}
 *   | {kind: "slow"}}
 */
export function captureOutcome(understanding) {
  const n = readNote(understanding);
  if (!n.status) return null;
  if (n.status === "failed") return { kind: "failed", ...failureReason(n.error) };
  if (n.status === "slow") return { kind: "slow" };
  if (n.status === "nothing" || (n.status === "done" && (n.outcome === "nothing_to_decide" || !n.decisionId))) {
    return { kind: "nothing", answer: n.answer };
  }
  if (n.status === "done") return { kind: "ready", decisionId: n.decisionId, decision: n.decision };
  return null;
}

/** Who a ready decision waits on, for "Decision ready for …". */
export function readyFor(decision, userId) {
  if (decision?.approver_id && decision.approver_id === userId) return "you";
  return decision?.approver_name || "an owner";
}

/** What a ready decision creates: its proposal's counts, or — for a decision
 *  captured before proposals existed — the execution_summary stored on it. */
export function decisionCounts(decision) {
  return decision?.proposal
    ? proposalCounts(decision.proposal)
    : executionSummaryCounts(decision?.execution_summary);
}

/** Plan 5.1 — "Decision ready for Sunita Rao · 2 tasks, 1 workflow". ONE
 *  builder for the Desk well, the phone's sheet and the toast. */
export function readyLine(decision, userId) {
  return OUTCOME_COPY.ready(readyFor(decision, userId), proposalCreatesText(decisionCounts(decision)));
}

/** ASK-33 Phase 4 — is this capture hook still following a note to its ending?
 *  useDexCapture follows ONE note at a time: a new follow() retires the note it
 *  was on. Starting another while this is true would leave that note unpolled
 *  and its ending unreported. */
export function isReading(dex) {
  const s = dex?.understanding?.status;
  return !!s && !ENDING_STATUSES.includes(s);
}
