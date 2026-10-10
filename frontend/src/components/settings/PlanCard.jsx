import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import api, { formatApiError } from "../../lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { STORE_BUILD } from "../../lib/storeBuild";

/* Audit B-04 (2026-10-08) — PLAN, SEATS AND THE AI ALLOWANCE, IN ONE PLACE.
   The card said "Trial · ends 22 Oct 2026 · 1 of 10 seats used" and nothing
   else: no way to move to a plan, nothing about what the date means, and no
   sign of the month's AI allowance — the owner found out it existed when Dex
   stopped answering. Now it carries all three, from GET /tenant/plan (which
   reports the allowance and when it starts again), and "Choose a plan" leads
   to checkout (Razorpay, through POST /billing/checkout). Where online payment
   is not switched on yet, the same button writes to us instead, so the owner
   always has a next step. */

const SUPPORT = "support@decisionos.biz";

const dayLabel = (iso) => (iso
  ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })
  : "");
// Plain digits in Indian grouping (3,00,000) — "22.9K of 3L" mixed two shorthands.
const compact = (n) => (n == null ? "" : Math.round(n).toLocaleString("en-IN"));
const planName = (key) => (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");

function Bar({ pct, warn }) {
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900/[0.07]" aria-hidden="true">
      <div className={`h-full rounded-full ${pct >= 90 || warn ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-neutral-900"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function trialLine(p) {
  if (p.key !== "trial") return null;
  const left = p.trial_days_left;
  if (p.trial_expired || (left != null && left < 0)) {
    return `Your trial ended on ${dayLabel(p.trial_ends_at)}.${STORE_BUILD ? "" : " Choose a plan to keep going."}`;
  }
  const when = p.trial_ends_at ? dayLabel(p.trial_ends_at) : "";
  const count = left == null ? "" : left === 0 ? "Last day of your trial" : `${left} day${left === 1 ? "" : "s"} left in your trial`;
  return `${count}${when ? ` — it ends ${when}` : ""}.${STORE_BUILD ? "" : " Choose a plan before then to carry on without a break."}`;
}

export function PlanCard() {
  const { tenant } = useAuth();
  const [open, setOpen] = useState(false);
  const planQ = useQuery({ queryKey: ["tenant-plan"], queryFn: () => api.get("/tenant/plan").then((r) => r.data) });
  const p = planQ.data;
  const limit = p?.seat_limit;
  const seatPct = limit ? Math.round(((p?.seats_used || 0) / limit) * 100) : 0;
  const ai = p?.ai_allowance;
  const aiPct = ai?.cap ? Math.round((ai.used / ai.cap) * 100) : 0;
  const trial = p && trialLine(p);
  const paidTop = p && ["business", "enterprise", "grandfathered"].includes(p.key);

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-plan-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Plan and seats</h2>
          {p && !planQ.isError && (
            <p className="mt-1 text-sm"><span className="font-semibold" data-testid="plan-name">{planName(p.key)}</span>
            </p>
          )}
        </div>
        {/* PLAY PAYMENTS (2026-10-09) — not in the store build: a plan is a
            digital subscription, and inside a Play app it may only be sold
            through Play billing (lib/storeBuild). The website keeps it. */}
        {p && !paidTop && !STORE_BUILD && (
          <button type="button" onClick={() => setOpen(true)} data-testid="plan-upgrade"
            className="h-10 shrink-0 rounded-pill bg-kr-ink px-5 text-sm font-medium text-white">
            Choose a plan
          </button>
        )}
      </div>

      {planQ.isLoading ? <div className="ds-skeleton mt-4 h-24 rounded-xl" aria-hidden="true" />
        : planQ.isError || !p ? <p className="mt-3 text-sm text-muted-foreground">Couldn&rsquo;t load your plan.</p> : (
        <div className="mt-4 space-y-5">
          {trial && <p className="text-sm text-muted-foreground" data-testid="plan-trial-line">{trial}</p>}

          <div>
            <p className="text-sm tabular-nums" data-testid="plan-seats">
              {p.seats_used} {limit ? `of ${limit}` : ""} seat{p.seats_used === 1 && !limit ? "" : "s"} used{limit ? "" : " · no seat limit"}
              {p.seats_invited ? <span className="text-muted-foreground"> · {p.seats_invited} still to accept an invite</span> : null}
            </p>
            {limit ? <Bar pct={seatPct} /> : null}
          </div>

          <div data-testid="plan-ai">
            {ai?.cap ? (
              <>
                <p className="text-sm tabular-nums">
                  AI this month: <span className="font-semibold">{Math.min(100, aiPct)}%</span> of your allowance used
                  <span className="text-muted-foreground"> · {compact(ai.used)} of {compact(ai.cap)} units · starts again {dayLabel(ai.resets_on)}</span>
                </p>
                <Bar pct={aiPct} warn={ai.over} />
                {(ai.over || aiPct >= 90) && (
                  <p className="mt-2 text-xs text-rose-700" data-testid="plan-ai-warning">
                    {ai.over ? `The allowance is used up. Dex, bill reading and Ask stop until ${dayLabel(ai.resets_on)}${STORE_BUILD ? "." : " — or choose a bigger plan."}`
                      : `Nearly used up. When it runs out, Dex, bill reading and Ask stop until ${dayLabel(ai.resets_on)}.`}
                  </p>
                )}
              </>
            ) : ai ? (
              <p className="text-sm text-muted-foreground">AI this month: no limit on your plan.</p>
            ) : null}
          </div>
        </div>
      )}

      {p && !STORE_BUILD && <UpgradeDialog open={open} onOpenChange={setOpen} current={p.key}
        configured={!!p.billing_configured} company={tenant?.name || tenant?.company_name || ""} />}
    </div>
  );
}

function UpgradeDialog({ open, onOpenChange, current, configured, company }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const plansQ = useQuery({
    queryKey: ["billing-plans"],
    queryFn: () => api.get("/billing/plans").then((r) => r.data?.plans || []),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  const mailto = (plan) => `mailto:${SUPPORT}?subject=${encodeURIComponent(`Move ${company || "our company"} to the ${planName(plan)} plan`)}`;

  const choose = async (key) => {
    setBusy(key); setError("");
    try {
      const { data } = await api.post("/billing/checkout", {
        plan_key: key, return_to: `${window.location.origin}/settings?tab=workspace`,
      });
      window.location.href = data.redirect_url;
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || "Couldn't open checkout. Nothing has been charged — try again.");
      setBusy("");
    }
  };

  const plans = (plansQ.data || []).filter((pl) => pl.key !== "grandfathered");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="plan-upgrade-dialog">
        <DialogHeader>
          <DialogTitle>Choose a plan</DialogTitle>
          <DialogDescription>
            {configured ? "You pay securely through Razorpay. Your team, work and data stay exactly as they are."
              : `Online payment isn't switched on yet. Pick a plan and we'll move you over by email (${SUPPORT}) — your team, work and data stay as they are.`}
          </DialogDescription>
        </DialogHeader>
        {plansQ.isLoading ? <div className="ds-skeleton h-40 rounded-xl" aria-hidden="true" /> : (
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((pl) => {
              const tokens = pl.quotas?.llm_tokens_total;
              const here = pl.key === current;
              return (
                <div key={pl.key} className="flex flex-col rounded-2xl bg-white/70 p-4 ring-1 ring-inset ring-slate-900/[0.08]" data-testid={`plan-option-${pl.key}`}>
                  <p className="font-semibold">{pl.name}</p>
                  <p className="mt-1 text-sm tabular-nums">{pl.price_inr_paise ? `₹${(pl.price_inr_paise / 100).toLocaleString("en-IN")} / month` : "Talk to us"}</p>
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
                    <li>{pl.seat_limit ? `Up to ${pl.seat_limit} people` : "Any number of people"}</li>
                    <li>{tokens ? `${compact(tokens)} AI units a month` : "No AI limit"}</li>
                    {pl.features?.whatsapp && <li>WhatsApp</li>}
                  </ul>
                  {here ? (
                    <p className="mt-3 text-center text-xs font-medium text-muted-foreground">Your plan</p>
                  ) : configured && !pl.is_talk_to_sales ? (
                    <button type="button" disabled={!!busy} onClick={() => choose(pl.key)} data-testid={`plan-choose-${pl.key}`}
                      className="mt-3 h-9 rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50">
                      {busy === pl.key ? "Opening…" : `Choose ${pl.name}`}
                    </button>
                  ) : (
                    <a href={mailto(pl.key)} data-testid={`plan-email-${pl.key}`}
                      className="mt-3 grid h-9 place-items-center rounded-pill text-sm font-medium ring-1 ring-inset ring-slate-900/20 hover:bg-white">
                      Email us
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
