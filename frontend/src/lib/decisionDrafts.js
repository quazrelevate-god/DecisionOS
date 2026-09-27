/* PILOT-2 B · A draft is the decision's own state, not this device's memory.
 *
 * "Save as draft" promises something saved. The DECISION always was — Dex
 * writes it the moment it finishes reading — but the MARK lived in one
 * browser's localStorage (ASK-36, lib/deferredDecisions, when the button said
 * "Later" and meant "I looked at this here"). So a draft saved on the laptop
 * was not a draft on the phone, and a cleared browser or a private window lost
 * it. The client's words were "so people can understand the yellow means
 * draft" — that is the decision's state, for everyone who looks at it.
 *
 * It is a field on the decision now (`draft`, POST/DELETE /decisions/:id/draft,
 * services/decision_flow.set_draft). This file is what the screens talk to:
 *
 *   * the truth is `decision.draft` off the server — the Desk's cards carry it,
 *     and so does GET /decisions/:id;
 *   * `pending` here is only the gap between the tap and the next fetch, so the
 *     row goes yellow under the founder's finger rather than a poll later. It
 *     is memory, not storage: nothing survives a reload, because after a reload
 *     the server's answer is the one that matters;
 *   * deciding clears the flag server-side, in the same write as the status.
 *
 * ONE-TIME CARRY-OVER. Drafts already sitting in someone's localStorage are
 * posted to the server the first time they open the app after this ships, and
 * the old key is then removed. Nobody loses a draft in the switch.
 */
import api from "./api";

const OLD_KEY = "dos_deferred_decisions";

/* id -> true while we are waiting for the server to agree. */
const pending = new Map();
const listeners = new Set();
const announce = () => listeners.forEach((fn) => fn(snapshot()));

function snapshot() {
  return Object.fromEntries(pending);
}

/** Subscribe to the optimistic layer. Returns the unsubscribe. */
export function subscribeDrafts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function draftOverrides() {
  return snapshot();
}

/**
 * Is this decision a draft? The server's answer, unless a tap of ours is still
 * in the air.
 * @param {object|null} decision  anything carrying `draft` (a Desk card, a decision)
 * @param {object} overrides      what subscribeDrafts last handed you
 */
export function isDraft(decision, overrides = snapshot()) {
  const id = decision?.id || decision?.target_id;
  if (id && Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return !!decision?.draft;
}

async function flip(id, draft) {
  if (!id) return false;
  pending.set(id, draft);
  announce();
  try {
    if (draft) await api.post(`/decisions/${id}/draft`);
    else await api.delete(`/decisions/${id}/draft`);
    return true;
  } catch (e) {
    // The server said no (already decided, or not this person's to decide).
    // Drop the optimistic mark so the screen goes back to the truth.
    pending.delete(id);
    announce();
    throw e;
  }
}

/** Save as draft. Resolves once the server has it. */
export const saveAsDraft = (id) => flip(id, true);

/** Take the mark off without deciding. */
export const clearDraft = (id) => flip(id, false);

/**
 * Forget our optimistic answer for an id once the server's has caught up (the
 * next fetch carries `draft`), or when the decision has been decided — the
 * server clears the flag in the same write as the status.
 */
export function settleDraft(id) {
  if (id && pending.delete(id)) announce();
}

/** The one-time carry-over. Safe to call on every start; it does nothing after
 *  the first time, and a failure leaves the old list in place to try again. */
export async function carryOverLocalDrafts() {
  let ids = [];
  try {
    const raw = JSON.parse(localStorage.getItem(OLD_KEY) || "[]");
    ids = Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [];
  } catch { return; }            // private window, blocked storage: nothing to carry
  if (!ids.length) {
    try { localStorage.removeItem(OLD_KEY); } catch { /* nothing to clean */ }
    return;
  }
  const results = await Promise.allSettled(ids.map((id) => api.post(`/decisions/${id}/draft`)));
  // A 409 (already decided) or 404 is as good as done — that id is not a draft
  // any more either way. Only a real failure (offline, 500) keeps the list.
  const stuck = results.some((r) => r.status === "rejected"
    && ![404, 409, 403].includes(r.reason?.response?.status));
  if (!stuck) {
    try { localStorage.removeItem(OLD_KEY); } catch { /* it will be tried again */ }
  }
}
