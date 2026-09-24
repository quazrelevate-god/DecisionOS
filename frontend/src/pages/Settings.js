import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { hasPerm, PERMISSIONS } from "../lib/perms";
import { PageHeader } from "../components/common";
import { CompanyDetails } from "../components/CompanyDetails";
import { GlassSelect } from "../components/karma/GlassSelect";
import { BusinessVocabulary } from "../components/BusinessVocabulary";
import { OperatingModelEditor } from "../components/OperatingModelEditor";
// ASK-8 (2026-09-12): Leave Approvers by Department moves from
// pages/Leave.js gear icon to Settings › Operations, alongside pipelines
// and approval gates. useQuery hook + tenant/users data needed to drive
// the config.
import { ApproverConfig } from "./Leave";
import { useQuery } from "@tanstack/react-query";
import { FinanceCategoriesEditor } from "../components/FinanceCategoriesEditor";
import { ProfileForm, ChangePasswordForm } from "../components/ProfileDialog";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CurrencyCircleDollar, ShieldCheck, FloppyDisk, Info, UserCircle, Translate, Lock, Buildings, FlowArrow, User, SignOut } from "@phosphor-icons/react";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
const inp = "w-full nm-field px-3 py-2 text-sm";

function LanguageCard() {
  const { t } = useTranslation();
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-language-card">
      <div className="flex items-center gap-2 mb-1">
        <Translate size={20} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-base font-medium">{t("settings.language_title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.language_desc")}</p>
      <LanguageSwitcher variant="inline" />
    </div>
  );
}

function ProfileCard() {
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-profile-card">
      <div className="flex items-center gap-2 mb-1">
        <UserCircle size={20} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Your Profile</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Your personal details, sign-in and WhatsApp routing.</p>
      <ProfileForm />
    </div>
  );
}

function SecurityCard() {
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-security-card">
      <div className="flex items-center gap-2 mb-1">
        <Lock size={20} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Password & Security</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Change the password you use to sign in.</p>
      <ChangePasswordForm />
    </div>
  );
}

// WE-04 (2026-08-16): Money & Approvals card lifted out of the Settings
// component so the Money tab can render just this + FinanceCategoriesEditor.
// State is local -- no shared context needed.
function MoneyAndApprovalsCard() {
  const { tenant, refreshTenant } = useAuth();
  const [threshold, setThreshold] = useState(String(tenant?.high_value_threshold ?? 50000));
  const [signoff, setSignoff] = useState(!!tenant?.require_owner_signoff);
  const [currency, setCurrency] = useState(tenant?.currency || "INR");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const t = parseFloat(threshold);
    if (isNaN(t) || t < 0) return toast.error("Enter a valid amount");
    setSaving(true);
    try {
      await api.patch("/tenant/settings", { high_value_threshold: t, require_owner_signoff: signoff, currency });
      if (refreshTenant) await refreshTenant();
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-money-card">
      <div className="flex items-center gap-2 mb-1">
        <CurrencyCircleDollar size={20} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        {/* U7-11.1 (2026-08-17): match the uppercase / extrabold
            header treatment used by every other card in Settings. Was
            lowercase-looking and read as a sub-heading, not a card
            title. */}
        <h2 className="text-base font-medium">Money & Approvals</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Controls how incoming invoices & payments (WhatsApp / uploads) are flagged and approved.</p>

      <div className="space-y-5">
        <div>
          <label className="label-mono text-muted-foreground">Default currency</label>
          <GlassSelect variant="field" testid="settings-currency" ariaLabel="Currency"
            value={currency} onChange={setCurrency}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            triggerClassName={`${inp} mt-1 max-w-[200px]`} />
        </div>

        <div>
          <label className="label-mono text-muted-foreground">High-value threshold ({currency})</label>
          <input data-testid="settings-threshold" type="number" min="0" step="1000" className={`${inp} mt-1 max-w-[260px]`}
            value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
            <Info size={13} weight="bold" className="mt-0.5 shrink-0" />
            <span>Payments/invoices at or above this amount are flagged <span className="font-semibold">"verify before approving"</span> in the Review Queue.</span>
          </p>
        </div>

        <button type="button" onClick={() => setSignoff(!signoff)} data-testid="settings-signoff-toggle"
          className="nm-inset flex w-full items-start gap-3 p-3.5 text-left transition-colors">
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-kr-outline ${signoff ? "bg-kr-ink text-white" : "bg-nm-raised"}`}>
            {signoff && <ShieldCheck size={13} weight="bold" />}
          </span>
          <span>
            <span className="text-sm font-semibold block">Require owner sign-off above threshold</span>
            <span className="text-xs text-muted-foreground">When on, high-value payments are routed to the owner for approval (finance still sees them). When off, finance handles them directly with a verify flag.</span>
          </span>
        </button>
      </div>

      <button onClick={save} disabled={saving} data-testid="settings-save"
        className="kr-lift mt-6 flex items-center gap-2 rounded-pill bg-kr-ink px-5 py-2.5 text-sm font-medium text-white transition-all disabled:opacity-60">
        <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

// WE-04: 4-tab layout per Epic 5 spec deck slide 12. Each tab is a
// coherent surface -- edits inside one tab don't reach out to another,
// so the user can stay put while completing a task. "Operations" is
// the one place workflow config lives (WE-02 killed the two ghost
// surfaces that used to share the concept).
// U7-11.1 (2026-08-17): tab descriptions rewritten to match what each
// tab actually contains.
//   - Business: removed the "operational tasks" bullet -- that section
//     was renamed "Rules & templates" in CompanyDetails to stop
//     colliding with the OPERATIONS tab. Vocabulary stays.
//   - Account: dropped "sessions" -- there is no sessions surface yet.
//     Owner ask this pass: "check which are things missing out and
//     which things can be optimized" -- a promised control that
//     doesn't exist is worse than not mentioning it.
/* ASK-8 (2026-09-12): Settings-side wrapper for the leave-approver
   configuration. The underlying ApproverConfig ships from pages/Leave
   .js -- this wrapper's job is to source roleOptions + members and to
   gate the whole card on team_manage. Non-managers see nothing at all;
   people who can manage the team see the config on the Operations
   tab. */
function LeaveApproversCard() {
  const { user, tenant } = useAuth();
  const canManage = hasPerm(user, "team_manage");
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
    enabled: canManage,
  });
  if (!canManage) return null;
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];
  return (
    <ApproverConfig roleOptions={roleOptions} members={usersQ.data || []} />
  );
}

/* RBAC P1 (2026-09-15) — AI processing consent. The "AI is off" message sent
   people to Settings, but there was nothing here. Everyone sees whether it's
   on; only an owner turns it on or off (the server holds the same rule). */
function AiConsentCard() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  useEffect(() => {
    // A late answer from an earlier mount must not overwrite a fresher one
    // (dev StrictMode mounts twice; a slow read could land after a click).
    let live = true;
    api.get("/tenant/ai-consent")
      .then((r) => { if (live) setS(r.data); })
      .catch(() => { if (live) setS({ error: true }); });
    return () => { live = false; };
  }, []);
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
  const grant = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/tenant/ai-consent", { version: s?.current_version, acknowledged: true });
      setS(data);
      toast.success("AI processing is on");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't turn AI processing on");
    } finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete("/tenant/ai-consent");
      setS(data);
      setConfirmOff(false);
      toast.success("AI processing is off");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't turn AI processing off");
    } finally { setBusy(false); }
  };
  const on = !!s?.active;
  const pill = "kr-pop flex h-11 shrink-0 items-center justify-center rounded-pill px-4 text-sm font-medium text-foreground disabled:opacity-50";
  return (
    <div id="ai-consent" className="kr-bento scroll-mt-24 p-5 sm:p-6" data-testid="settings-ai-consent-card">
      <h2 className="text-base font-medium">AI processing</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Dex, reading voice notes and documents, and AI suggestions send the text involved to DecisionOS&rsquo;s AI providers.
        They stay off until an owner agrees.
      </p>
      {!s ? (
        <div className="ds-skeleton mt-4 h-12 rounded-xl" aria-hidden="true" />
      ) : s.error ? (
        <p className="mt-4 text-sm text-muted-foreground">Couldn&rsquo;t load whether AI processing is on.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-semibold" data-testid="ai-consent-status">
              {on ? "On" : s.needs_reconsent ? "Needs agreeing to again" : "Off"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {on ? `Agreed by ${s.granted_by_email || "an owner"} on ${day(s.granted_at)}.`
                : s.needs_reconsent ? `The terms changed (v${s.current_version}) since they were agreed.`
                : s.revoked_at ? `Turned off on ${day(s.revoked_at)}.`
                : "Nobody has agreed yet."}
            </p>
          </div>
          {!isOwner ? (
            <p className="text-xs text-muted-foreground">Only an owner can change this.</p>
          ) : on ? (
            confirmOff ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={revoke} disabled={busy} data-testid="ai-consent-off-confirm"
                  className="flex h-11 items-center rounded-pill bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? "Turning off…" : "Turn off AI"}
                </button>
                <button type="button" onClick={() => setConfirmOff(false)} disabled={busy} className={pill}>Keep it on</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmOff(true)} data-testid="ai-consent-off" className={pill}>Turn off</button>
            )
          ) : (
            <button type="button" onClick={grant} disabled={busy} data-testid="ai-consent-on"
              className="flex h-11 shrink-0 items-center justify-center rounded-pill bg-kr-ink px-4 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Turning on…" : "Agree and turn on"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const PILL = "kr-pop flex h-11 shrink-0 items-center justify-center rounded-pill px-4 text-sm font-medium text-foreground disabled:opacity-50";
const INK = "flex h-11 shrink-0 items-center justify-center rounded-pill bg-kr-ink px-4 text-sm font-medium text-white disabled:opacity-50";
const FIELD = "w-full rounded-2xl bg-white/80 px-4 py-2.5 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
const dayLabel = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/* A GET that ignores an answer from an earlier mount (dev StrictMode, slow reads). */
function useLoad(path) {
  const [data, setData] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api.get(path).then((r) => { if (live) setData(r.data); }).catch(() => { if (live) setData({ error: true }); });
    return () => { live = false; };
  }, [path, n]);
  return [data, () => setN((x) => x + 1), setData];
}

/* RBAC P2 (2026-09-16) — "approve on my behalf while I'm away". While the dates
   are on, the person picked approves tasks and decides decisions that wait on
   you, sees them in Approvals and on the Desk, and is told when they arrive. */
function DelegationCard() {
  const { user } = useAuth();
  const [state, reload] = useLoad("/me/acting-as");
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const blank = { delegate_user_id: "", from_date: "", to_date: "", reason: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const people = (usersQ.data || []).filter((m) => m.id !== user?.id && m.invite_status !== "pending");
  const today = new Date().toISOString().slice(0, 10);
  const ac = state?.acting_as;
  const save = async () => {
    if (!form.delegate_user_id || !form.from_date || !form.to_date) { toast.error("Pick who, and your first and last day away"); return; }
    if (form.to_date < form.from_date) { toast.error("The last day can't be before the first"); return; }
    setBusy(true);
    try {
      await api.post("/me/acting-as", form);
      toast.success("Your approvals are handed over for those days");
      setForm(blank);
      reload();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't hand over your approvals");
    } finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await api.delete("/me/acting-as");
      toast.success("You're handling your own approvals again");
      reload();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't stop the hand-over");
    } finally { setBusy(false); }
  };
  const who = ac && (people.find((m) => m.id === ac.delegate_user_id)?.name || ac.delegate_name || "Someone");
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-delegation-card">
      <h2 className="text-base font-medium">While you&rsquo;re away</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Hand your approvals to someone for a few days. They can approve tasks and decide decisions that wait on you, and they&rsquo;re told when new ones arrive.
      </p>
      {!state ? (
        <div className="ds-skeleton mt-4 h-12 rounded-xl" aria-hidden="true" />
      ) : state.error ? (
        <p className="mt-4 text-sm text-muted-foreground">Couldn&rsquo;t load your hand-over.</p>
      ) : ac?.delegate_user_id ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm" data-testid="delegation-status">
            <span className="font-semibold">{who}</span> {state.active_now ? "is handling" : "will handle"} your approvals, {dayLabel(ac.from)} – {dayLabel(ac.to)}.
          </p>
          <button type="button" onClick={clear} disabled={busy} data-testid="delegation-clear" className={PILL}>Stop handing over</button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <GlassSelect testid="delegation-person" ariaLabel="Who handles your approvals" variant="field" triggerClassName={FIELD}
            value={form.delegate_user_id} onChange={(v) => setForm({ ...form, delegate_user_id: v })}
            options={[{ value: "", label: "Pick who handles your approvals" }, ...people.map((m) => ({ value: m.id, label: m.name }))]} />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">First day away
              <input type="date" min={today} value={form.from_date} data-testid="delegation-from"
                onChange={(e) => setForm({ ...form, from_date: e.target.value })} className={`${FIELD} mt-1`} />
            </label>
            <label className="text-xs text-muted-foreground">Last day away
              <input type="date" min={form.from_date || today} value={form.to_date} data-testid="delegation-to"
                onChange={(e) => setForm({ ...form, to_date: e.target.value })} className={`${FIELD} mt-1`} />
            </label>
          </div>
          <button type="button" onClick={save} disabled={busy} data-testid="delegation-save" className={INK}>
            {busy ? "Saving…" : "Hand over approvals"}
          </button>
        </div>
      )}
    </div>
  );
}

/* RBAC P2 (2026-09-16) — overdue work: when the doer's manager, then the owner,
   hears about a late task, and whether owners also get the alert by email. */
function EscalationCard() {
  const { tenant, refreshTenant } = useAuth();
  const [manager, setManager] = useState(String(tenant?.followup_manager_days || 2));
  const [owner, setOwner] = useState(String(tenant?.followup_owner_days || 4));
  // D2 — the warning BEFORE the date. Bills have had one for a year; tasks
  // said nothing until the day they were already late.
  const [warn, setWarn] = useState(String(tenant?.due_soon_days ?? 2));
  const [email, setEmail] = useState(tenant?.owner_alert_email !== false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const m = parseInt(manager, 10);
    const o = parseInt(owner, 10);
    if (!(m >= 1 && m <= 30) || !(o >= 1 && o <= 60)) { toast.error("Use 1 to 30 days for the manager and 1 to 60 for the owner"); return; }
    if (o <= m) { toast.error("The owner should hear after the manager"); return; }
    const w = parseInt(warn, 10);
    if (!(w >= 0 && w <= 14)) { toast.error("Use 0 to 14 days of warning before a task is due"); return; }
    setBusy(true);
    try {
      await api.patch("/tenant/settings", { followup_manager_days: m, followup_owner_days: o, due_soon_days: w, owner_alert_email: email });
      if (refreshTenant) await refreshTenant();
      toast.success("Overdue work settings saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't save");
    } finally { setBusy(false); }
  };
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-escalation-card">
      <h2 className="text-base font-medium">Deadlines</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The people on a task hear before it&rsquo;s due, again the day it&rsquo;s due and the day after.
        Then it goes up, one step at a time.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Warn the people on a task
          <span className="mt-1 flex items-center gap-2">
            <input type="number" min={0} max={14} value={warn} onChange={(e) => setWarn(e.target.value)}
              data-testid="due-soon-days" className={`${FIELD} w-24`} /> days before it&rsquo;s due
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">0 turns the early warning off.</span>
        </label>
        <label className="text-sm">Tell their manager after
          <span className="mt-1 flex items-center gap-2">
            <input type="number" min={1} max={30} value={manager} onChange={(e) => setManager(e.target.value)}
              data-testid="escalation-manager-days" className={`${FIELD} w-24`} /> days late
          </span>
        </label>
        <label className="text-sm">Tell the owner after
          <span className="mt-1 flex items-center gap-2">
            <input type="number" min={1} max={60} value={owner} onChange={(e) => setOwner(e.target.value)}
              data-testid="escalation-owner-days" className={`${FIELD} w-24`} /> days late
          </span>
        </label>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} data-testid="escalation-owner-email"
          className="mt-0.5 h-4 w-4 accent-neutral-900" />
        <span>Also email owners when a task reaches them <span className="block text-xs text-muted-foreground">They always get it in the app.</span></span>
      </label>
      <button type="button" onClick={save} disabled={busy} data-testid="escalation-save" className={`${INK} mt-4`}>
        {busy ? "Saving…" : "Save overdue work"}
      </button>
    </div>
  );
}

/* RBAC P2 (2026-09-16) — Workspace tab, owner only: what the backend already
   had but no screen showed. */
function PlanSeatsCard() {
  const [p] = useLoad("/tenant/plan");
  const limit = p?.seat_limit;
  const pct = limit ? Math.min(100, Math.round(((p?.seats_used || 0) / limit) * 100)) : 0;
  const name = p?.key ? p.key.charAt(0).toUpperCase() + p.key.slice(1) : "";
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-plan-card">
      <h2 className="text-base font-medium">Plan and seats</h2>
      {!p ? <div className="ds-skeleton mt-4 h-12 rounded-xl" aria-hidden="true" />
        : p.error ? <p className="mt-3 text-sm text-muted-foreground">Couldn&rsquo;t load your plan.</p> : (
        <div className="mt-3 space-y-3">
          <p className="text-sm"><span className="font-semibold" data-testid="plan-name">{name}</span>
            {p.trial_ends_at && <span className="text-muted-foreground"> · {p.trial_expired ? "trial ended" : `trial ends ${dayLabel(p.trial_ends_at)}`}</span>}
          </p>
          <div>
            <p className="text-sm tabular-nums" data-testid="plan-seats">
              {p.seats_used} {limit ? `of ${limit}` : ""} seat{p.seats_used === 1 && !limit ? "" : "s"} used{limit ? "" : " · no seat limit"}
            </p>
            {limit ? (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900/[0.07]" aria-hidden="true">
                <div className={`h-full rounded-full ${pct >= 90 ? "bg-rose-500" : "bg-neutral-900"}`} style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function AiKeysCard() {
  const [data, reload, setData] = useLoad("/tenant/ai-keys");
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = data?.providers || [];
  const label = (p) => ({ anthropic: "Anthropic (Claude)", openai: "OpenAI", gemini: "Google Gemini", google: "Google", sarvam: "Sarvam (speech)" }[p]
    || p.charAt(0).toUpperCase() + p.slice(1));
  const save = async (provider) => {
    setBusy(true);
    try {
      const { data: out } = await api.patch(`/tenant/ai-keys/${provider}`, { key: value });
      setData(out);
      setEditing(null);
      setValue("");
      toast.success(`${label(provider)} key saved`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't save the key");
    } finally { setBusy(false); }
  };
  const remove = async (provider) => {
    setBusy(true);
    try {
      const { data: out } = await api.delete(`/tenant/ai-keys/${provider}`);
      setData(out);
      toast.success(`Back to DecisionOS's ${label(provider)} key`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't remove the key");
      reload();
    } finally { setBusy(false); }
  };
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-ai-keys-card">
      <h2 className="text-base font-medium">AI keys</h2>
      <p className="mt-1 text-xs text-muted-foreground">Use your company&rsquo;s own AI accounts instead of DecisionOS&rsquo;s. Keys are stored for your company only and never shown in full.</p>
      {!data ? <div className="ds-skeleton mt-4 h-16 rounded-xl" aria-hidden="true" />
        : data.error ? <p className="mt-3 text-sm text-muted-foreground">Couldn&rsquo;t load the AI keys.</p> : (
        <ul className="mt-4 divide-y divide-slate-900/[0.06]">
          {rows.map((r) => (
            <li key={r.provider} className="py-3" data-testid={`ai-key-${r.provider}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label(r.provider)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.has_tenant_key ? `Your key ${r.masked}` : r.source === "platform" ? "Using DecisionOS's key" : "Not set"}
                  </p>
                </div>
                {editing !== r.provider && (
                  <div className="flex gap-2">
                    <button type="button" className={PILL} disabled={busy} data-testid={`ai-key-edit-${r.provider}`}
                      onClick={() => { setEditing(r.provider); setValue(""); }}>{r.has_tenant_key ? "Replace" : "Add key"}</button>
                    {r.has_tenant_key && (
                      <button type="button" className={PILL} disabled={busy} onClick={() => remove(r.provider)}
                        data-testid={`ai-key-remove-${r.provider}`}>Remove</button>
                    )}
                  </div>
                )}
              </div>
              {editing === r.provider && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)}
                    placeholder={`Paste the ${label(r.provider)} key`} aria-label={`${label(r.provider)} key`}
                    data-testid={`ai-key-input-${r.provider}`} className={FIELD} />
                  <div className="flex gap-2">
                    <button type="button" className={INK} disabled={busy || value.trim().length < 8} onClick={() => save(r.provider)}
                      data-testid={`ai-key-save-${r.provider}`}>Save</button>
                    <button type="button" className={PILL} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerExclusionsCard() {
  const { tenant, refreshTenant } = useAuth();
  const [excl, setExcl] = useState(tenant?.owner_exclusions || []);
  const [busy, setBusy] = useState(false);
  const toggle = (k) => setExcl((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/tenant/owner-exclusions", { exclusions: excl });
      if (refreshTenant) await refreshTenant();
      toast.success(excl.length ? "Owners no longer see the areas you switched off" : "Owners see everything again");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't save");
    } finally { setBusy(false); }
  };
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-owner-exclusions-card">
      <h2 className="text-base font-medium">What owners can open</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every owner can open everything. Switch an area off to keep it from all owners, you included &mdash; for example a co-founder who shouldn&rsquo;t see finance. Manage team always stays on.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {PERMISSIONS.map((p) => {
          const locked = p.key === "team_manage";
          const on = locked || !excl.includes(p.key);
          return (
            <button key={p.key} type="button" aria-pressed={on} disabled={locked || busy} onClick={() => toggle(p.key)}
              data-testid={`owner-perm-${p.key}`}
              className={`flex min-h-10 items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-xs font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed ${on ? "bg-neutral-900 text-white ring-transparent" : "bg-white/80 text-slate-700 ring-slate-900/[0.06] hover:bg-white"} ${locked ? "opacity-70" : ""}`}>
              <span>{p.label}</span>
              <span className="text-[10px] uppercase tracking-wide">{on ? "On" : "Off"}</span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={save} disabled={busy} data-testid="owner-exclusions-save" className={`${INK} mt-4`}>
        {busy ? "Saving…" : "Save what owners can open"}
      </button>
    </div>
  );
}

function AuditLogCard() {
  const PAGE = 25;
  const [rows, setRows] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async (before) => {
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/audit-log?limit=${PAGE}${before ? `&before_ts=${encodeURIComponent(before)}` : ""}`);
      const got = data?.rows || [];
      setRows((r) => (before ? [...(r || []), ...got] : got));
      setDone(got.length < PAGE);
    } catch {
      setRows((r) => r || []);
      toast.error("Couldn't load the audit log");
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const what = (a) => (a || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-audit-card">
      <h2 className="text-base font-medium">Audit log</h2>
      <p className="mt-1 text-xs text-muted-foreground">Sign-ins, access changes, removals, AI consent and keys, newest first. It can&rsquo;t be edited.</p>
      {!rows ? <div className="ds-skeleton mt-4 h-24 rounded-xl" aria-hidden="true" /> : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm" data-testid="audit-table">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">What</th><th className="py-2 font-medium">Who</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/[0.06]">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted-foreground">{r.timestamp ? new Date(r.timestamp).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</td>
                  <td className="py-2 pr-3">{what(r.action)}</td>
                  <td className="py-2 text-muted-foreground">{r.actor_email || (r.actor_id ? "A member" : "System")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > 0 && !done && (
        <button type="button" className={`${PILL} mt-3`} disabled={busy} data-testid="audit-older"
          onClick={() => load(rows[rows.length - 1]?.timestamp)}>{busy ? "Loading…" : "Show older"}</button>
      )}
    </div>
  );
}

const TABS = [
  { key: "business", label: "Business", icon: Buildings,
    desc: "Company profile, products, roles, and the words your team uses." },
  { key: "operations", label: "Operations", icon: FlowArrow,
    desc: "Pipelines, stages, task templates and approval gates. The single source of truth for how work moves." },
  { key: "money", label: "Money", icon: CurrencyCircleDollar,
    desc: "High-value approval threshold, currency, and finance categories." },
  { key: "account", label: "Account", icon: User,
    desc: "Your language, look, profile, password, and who handles your approvals while you're away." },
  // RBAC P2 (2026-09-16): owner only.
  { key: "workspace", label: "Workspace", icon: ShieldCheck,
    desc: "Plan and seats, your own AI keys, what owners can open, and the audit log." },
];
const VALID_TAB_KEYS = new Set(TABS.map((t) => t.key));

/* KM-5 — Theme and Sign out moved here from the mobile "More" panel, on the
   founder's call: a nav menu is a list of PLACES, and a theme switch and a
   session-ending action are neither. ASK-33 Phase 5 (founder, 2026-09-16): the
   theme switch is gone altogether — the app is designed light-only, so the
   Appearance card had nothing left to offer. Account holds language, profile,
   password and session. */

function SignOutCard() {
  const { logout } = useAuth();
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-signout-card">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Session</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            You will need to sign in again on this device.
          </p>
        </div>
        {/* Not red: DS-1's own rule is that `danger` means money or a deadline
            at risk, "never chrome, borders, sign-out". Terminal is not
            alerting. */}
        <button type="button" onClick={() => { logout(); window.location.href = "/login"; }}
          data-testid="settings-signout"
          className="kr-pop flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-sm font-medium text-foreground">
          <SignOut size={15} weight="bold" aria-hidden="true" /> Sign out
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  // MPWA-11 (§8): rebuilt below lg as a row-list; desktop untouched. WE-04's
  // 8-cards-to-4-tabs restructure replaced this component wholesale, so the
  // mobile branch is re-applied on top of it rather than merged into it.
  const { user } = useAuth();
  const isOwner = user?.role === "owner" || hasPerm(user, "team_manage");
  // U7-11.1 (2026-08-17): persist active tab in URL. Was useState-only,
  // so reload / back-forward / deep-link all landed on Business. Owner
  // ask: fix the missing / optimizable bits -- deep-linking Settings
  // is a small one worth having (matches the Finance tab pattern).
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const initialTab = urlTab && VALID_TAB_KEYS.has(urlTab) ? urlTab : "business";
  const [tab, setTab] = useState(initialTab);
  const selectTab = (key) => {
    setTab(key);
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };
  // Keep local state in sync when the URL changes from outside (back /
  // forward buttons, external deep-link).
  useEffect(() => {
    if (urlTab && VALID_TAB_KEYS.has(urlTab) && urlTab !== tab) {
      setTab(urlTab);
    }
  }, [urlTab, tab]);
  // A link like /settings?tab=business#ai-consent lands on that card.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return undefined;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    return () => clearTimeout(timer);
  }, []);
  // The Workspace tab is the owner's; anyone else lands on Business.
  useEffect(() => {
    if (tab === "workspace" && user?.role !== "owner") setTab("business");
  }, [tab, user]);


  // Non-owner view stays a simple stack -- just Profile + Security.
  // No tabs needed for 2 sections; the tabbed layout is an owner-only
  // reorg of the workspace config.
  if (!isOwner) {
    return (
      <div>
      <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Account</p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">Settings</h1>
        </div>
        </header>
        <div className="max-w-2xl">
          {/* RBAC P2 (2026-09-16): Language for everyone, and the hand-over.
              The Appearance card went with the theme switch (ASK-33 Phase 5,
              2eed722: the app is light-only) — it was dropped from the owner's
              Account tab but left standing here, which threw "ThemeCard is not
              defined" and broke the whole page for everyone but an owner. */}
          <LanguageCard />
          <div className="mt-6"><ProfileCard /></div>
          <div className="mt-6"><AiConsentCard /></div>
          <div className="mt-6"><SecurityCard /></div>
          <div className="mt-6"><DelegationCard /></div>
          {/* Mobile PWA (2026-09-14) — Sign out, for everyone. KM-5 moved it
              out of the phone's More panel into Settings, but only the owner
              view rendered it, so on a phone a teammate could not sign out. */}
          <div className="mt-6"><SignOutCard /></div>
        </div>
      </div>
    );
  }

  const active = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <div>
      <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Account &amp; workspace</p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">Settings</h1>
        </div>
      </header>

      {/* KM-5 — a neumorphic segmented bar, not four hairline pills in a
          scroller. The founder's read is that Business / Operations / Money /
          Account looked misaligned, and it did: the pills were natural-width
          inside an overflow-x-auto that also carried `flex-wrap` on its
          parent, so the four sat ragged and the last one clipped at the
          gutter with nothing to say it had. Four equal segments in a
          .kr-pressed track cannot go ragged, and they cannot clip.
          Icons drop below lg — at ~78px a segment, an icon costs more label
          than it earns. No transition utility (outset/inset shadows). */}
      <div className="kr-pressed mb-5 flex items-center gap-1 rounded-pill p-1"
           role="tablist" aria-label="Settings sections" data-testid="settings-tabs">
        {TABS.filter((t) => t.key !== "workspace" || user?.role === "owner").map((t) => {
          const Icon = t.icon;
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              data-testid={`settings-tab-${t.key}`}
              aria-pressed={isActive}
              className={`flex h-10 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-pill px-1 text-xs lg:text-sm ${
                isActive ? "kr-pop font-semibold text-foreground" : "text-foreground/60"
              }`}
            >
              <Icon size={15} weight="regular" aria-hidden="true" className="hidden shrink-0 lg:block" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">{active.desc}</p>

      <div className="space-y-6 max-w-2xl" data-testid={`settings-panel-${tab}`}>
        {tab === "business" && (
          <>
            <AiConsentCard />
            <CompanyDetails />
            <BusinessVocabulary />
          </>
        )}

        {tab === "operations" && (
          <>
            <OperatingModelEditor />
            {/* ASK-8: Leave Approvers by Department, moved here from the
                gear on the retired Leave page. Sits alongside pipelines
                and approval gates -- the Operations tab's own
                description already covers "approval gates". Gated on
                team_manage: non-managers see nothing at all. */}
            <LeaveApproversCard />
            {user?.role === "owner" && <EscalationCard />}
          </>
        )}

        {tab === "money" && (
          <>
            {/* U7-11.1 (2026-08-17): approvals card promoted to top.
                Currency + high-value threshold are the controls the
                owner actually touches; the category editor is a long
                list they rarely re-order. Putting categories first
                buried the two decisions that matter for approvals. */}
            {/* RBAC P0 (2026-09-15): the server lets only an owner save this card,
                so Manage team without owner saw it and hit "Could not save". */}
            {user?.role === "owner" && <MoneyAndApprovalsCard />}
            <FinanceCategoriesEditor />
          </>
        )}

        {tab === "account" && (
          <>
            <LanguageCard />
            <ProfileCard />
            <SecurityCard />
            <DelegationCard />
            <SignOutCard />
          </>
        )}

        {tab === "workspace" && user?.role === "owner" && (
          <>
            <PlanSeatsCard />
            <AiKeysCard />
            <OwnerExclusionsCard />
            <AuditLogCard />
          </>
        )}
      </div>
    </div>
  );
}
