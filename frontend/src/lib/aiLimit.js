/* The month's AI allowance is used up — said in words, with when it comes back.
 *
 * 2026-10-06 (Dex desktop pass): a company over its monthly allowance asked Dex
 * a question and read "AI service error. Please try again." The server had said
 * exactly what was wrong — a 402 with {code: "quota_exceeded", usage, cap} —
 * and the page threw it away, so the one thing the person was told to do
 * (try again) was the one thing that could not work until the 1st.
 *
 * Two refusals arrive as 402 from services/ai/llm_limits.guarded_llm:
 *   quota_exceeded      the plan's monthly AI allowance (tokens)
 *   ai_budget_exceeded  the company's own monthly AI spend budget
 * Both reset with the calendar month (services/quotas: UTC month).
 */
import { STORE_BUILD } from "./storeBuild";

export const AI_LIMIT_CODES = ["quota_exceeded", "ai_budget_exceeded"];

/* lib/api flattens a {code, message} detail to its sentence and keeps the
   object on detail_full (see its interceptor), so that is where the code is. */
function limitDetail(e) {
  const data = e?.response?.data || {};
  const d = data.detail_full || data.detail;
  return d && typeof d === "object" ? d : {};
}

export function isAiLimitError(e) {
  return e?.response?.status === 402 && AI_LIMIT_CODES.includes(limitDetail(e).code);
}

function resetDay(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return first.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

const n = (v) => Number(v || 0).toLocaleString();

export function aiLimitMessage(e, now = new Date()) {
  const d = limitDetail(e);
  const when = resetDay(now);
  if (d.code === "ai_budget_exceeded") {
    const spend = Number(d.spend_usd || 0).toFixed(2);
    const budget = Number(d.budget_usd || 0).toFixed(2);
    return `This month's AI budget is used up ($${spend} of $${budget}). Dex can answer again on ${when}.`;
  }
  // The store build says when it comes back and nothing about buying more
  // (lib/storeBuild — Play's Payments policy).
  return `This month's AI allowance is used up (${n(d.usage)} of ${n(d.cap)}). Dex can answer again on ${when}${STORE_BUILD ? "." : ", or straight away on a bigger plan."}`;
}
