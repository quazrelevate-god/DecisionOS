/* Signup, saved as it goes (2026-09-17).
 *
 * A founder who closed the tab half-way through had to start again: the backend
 * has had a draft store since FIX-001-D — create, resume, patch, and /register
 * merges it — and the wizard never called any of it.
 *
 * What is saved: what they typed. What is NEVER saved: the password. The store
 * refuses it by design (services/auth/onboarding_drafts.py), so a resumed
 * signup asks for that one field again and nothing else.
 *
 * Every call here is best-effort. Saving is a convenience; it must never stand
 * between a founder and their workspace, so a failure is swallowed and the
 * wizard carries on exactly as it did before drafts existed.
 */
import api from "./api";

const KEY = "dos_signup_draft";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;   // private window, or storage disabled: signup still works
  }
}

function write(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch (e) {
    /* nothing to do — the wizard works without resume */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) { /* ignore */ }
}

/** The draft this browser is holding, or null. */
export function currentDraft() {
  const d = read();
  return d && d.id && d.token ? d : null;
}

/**
 * Resume the saved signup, or start a new draft.
 * @returns {Promise<{id: string, token: string, stepData: object}>}
 *          `stepData` is {} for a fresh draft.
 */
export async function startOrResume(email) {
  const held = currentDraft();
  if (held) {
    try {
      const { data } = await api.get(`/onboarding/draft/${held.id}`, {
        headers: { "X-Draft-Token": held.token },
      });
      // A draft that was already turned into a workspace is finished with.
      if (data && !data.completed_at) {
        return { id: held.id, token: held.token, stepData: data.step_data || {} };
      }
    } catch (e) {
      // 404 (gone), 410 (expired), 401 (token no longer valid) — all mean the
      // same thing to a founder: there is nothing to come back to.
    }
    clearDraft();
  }
  try {
    const { data } = await api.post("/onboarding/draft", { email: email || null });
    const fresh = { id: data.draft_id, token: data.draft_token };
    write(fresh);
    return { ...fresh, stepData: {} };
  } catch (e) {
    return { id: null, token: null, stepData: {} };   // carry on without saving
  }
}

/** Save one step. `step` is one of about | scale | software | team | os_blueprint. */
export async function saveStep(step, data) {
  const held = currentDraft();
  if (!held) return false;
  try {
    await api.patch(`/onboarding/draft/${held.id}`, { step, data },
                    { headers: { "X-Draft-Token": held.token } });
    return true;
  } catch (e) {
    // A draft that vanished (expired, or already completed in another tab)
    // must not keep throwing at every step.
    if (e?.response?.status === 404) clearDraft();
    return false;
  }
}

/** What the wizard restores a returning founder from. */
export function formFromDraft(stepData) {
  const about = (stepData && stepData.about) || {};
  const scale = (stepData && stepData.scale) || {};
  return {
    company_name: about.company_name || "",
    name: about.name || "",
    email: about.email || "",
    phone: about.phone || "",
    // 2026-09-19 — the proof that number was confirmed by a texted code, so a
    // founder who comes back doesn't get texted again (until it lapses).
    phone_token: about.phone_token || "",
    phone_verified_norm: about.phone_verified_norm || "",
    phone_token_expires_at: about.phone_token_expires_at || "",
    support_email: about.support_email || "",
    industry: about.industry || "",
    description: about.description || "",
    team_size: scale.team_size || "",
    // Never stored, always asked again.
    password: "",
  };
}

/** True when there is enough saved to be worth offering a resume. */
export function hasSavedAnswers(stepData) {
  const about = (stepData && stepData.about) || {};
  /* B25 (2026-09-29) — a confirmed mobile counts. Somebody who answered the
     number and the code and then closed the app had "saved answers" by any
     human reckoning, and this said no: the resume was not offered, the draft
     was left behind, and the next visit texted them a second code for a number
     they had already proved. */
  return Boolean(about.company_name || about.name || about.email
    || about.phone_verified_norm || about.phone_token);
}

/* B05 (2026-09-29) — WHAT THE SCAN FOUND, AND HOW FAR THEY GOT.
   Both used to live only in React state, so killing the app anywhere after the
   first screen threw away the website scan (the slowest, most expensive step
   in the whole wizard) and the interview along with it. */

/** What the website step established, as the interview and the build read it. */
export function worldFromDraft(stepData) {
  const w = (stepData && stepData.world) || null;
  if (!w || !(w.industry || w.description || w.website_summary)) return null;
  return {
    industry: w.industry || "",
    business_model: w.business_model || "",
    description: w.description || "",
    website_summary: w.website_summary || "",
    products: Array.isArray(w.products) ? w.products : [],
  };
}

/** How far the founder got: the phase, and the interview it belongs to. */
export function progressFromDraft(stepData) {
  const p = (stepData && stepData.progress) || {};
  return {
    phase: p.phase || "",
    sessionId: p.session_id || "",
    languageCode: p.language_code || "",
  };
}
