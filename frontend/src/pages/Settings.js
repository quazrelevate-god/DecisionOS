import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { hasPerm } from "../lib/perms";
import { useIsMobile } from "../hooks/useIsMobile";
import SettingsMobile from "./mobile/SettingsMobile";
import { PageHeader } from "../components/common";
import { CompanyDetails } from "../components/CompanyDetails";
import { BusinessVocabulary } from "../components/BusinessVocabulary";
import { OperatingModelEditor } from "../components/OperatingModelEditor";
import { FinanceCategoriesEditor } from "../components/FinanceCategoriesEditor";
import { ProfileForm, ChangePasswordForm } from "../components/ProfileDialog";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CurrencyCircleDollar, ShieldCheck, FloppyDisk, Info, UserCircle, Translate, Lock, Buildings, FlowArrow, User } from "@phosphor-icons/react";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm font-mono bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";

function LanguageCard() {
  const { t } = useTranslation();
  return (
    <div className="card-brutal p-5" data-testid="settings-language-card">
      <div className="flex items-center gap-2 mb-1">
        <Translate size={20} weight="bold" className="text-brand-600" />
        <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">{t("settings.language_title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.language_desc")}</p>
      <LanguageSwitcher variant="inline" />
    </div>
  );
}

function ProfileCard() {
  return (
    <div className="card-brutal p-5" data-testid="settings-profile-card">
      <div className="flex items-center gap-2 mb-1">
        <UserCircle size={20} weight="bold" className="text-brand-600" />
        <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">Your Profile</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Your personal details, sign-in and WhatsApp routing.</p>
      <ProfileForm />
    </div>
  );
}

function SecurityCard() {
  return (
    <div className="card-brutal p-5" data-testid="settings-security-card">
      <div className="flex items-center gap-2 mb-1">
        <Lock size={20} weight="bold" className="text-brand-600" />
        <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">Password & Security</h2>
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
    <div className="card-brutal p-5" data-testid="settings-money-card">
      <div className="flex items-center gap-2 mb-1">
        <CurrencyCircleDollar size={20} weight="bold" className="text-brand-600" />
        {/* U7-11.1 (2026-08-17): match the uppercase / extrabold
            header treatment used by every other card in Settings. Was
            lowercase-looking and read as a sub-heading, not a card
            title. */}
        <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">Money & Approvals</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Controls how incoming invoices & payments (WhatsApp / uploads) are flagged and approved.</p>

      <div className="space-y-5">
        <div>
          <label className="label-mono text-muted-foreground">Default currency</label>
          <select data-testid="settings-currency" className={`${inp} mt-1 max-w-[200px]`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          className="flex items-start gap-3 w-full text-left border border-border rounded-lg p-3 hover:bg-accent transition-colors">
          <span className={`w-5 h-5 shrink-0 mt-0.5 border border-border rounded flex items-center justify-center ${signoff ? "bg-brand-ink text-white" : "bg-card"}`}>
            {signoff && <ShieldCheck size={13} weight="bold" />}
          </span>
          <span>
            <span className="text-sm font-semibold block">Require owner sign-off above threshold</span>
            <span className="text-xs text-muted-foreground">When on, high-value payments are routed to the owner for approval (finance still sees them). When off, finance handles them directly with a verify flag.</span>
          </span>
        </button>
      </div>

      <button onClick={save} disabled={saving} data-testid="settings-save"
        className="mt-6 flex items-center gap-2 bg-brand-ink text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:shadow-brutal-sm transition-all disabled:opacity-60">
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
const TABS = [
  { key: "business", label: "Business", icon: Buildings,
    desc: "Company profile, products, roles, and the words your team uses." },
  { key: "operations", label: "Operations", icon: FlowArrow,
    desc: "Pipelines, stages, task templates and approval gates. The single source of truth for how work moves." },
  { key: "money", label: "Money", icon: CurrencyCircleDollar,
    desc: "High-value approval threshold, currency, and finance categories." },
  { key: "account", label: "Account", icon: User,
    desc: "Your language, profile and sign-in password." },
];
const VALID_TAB_KEYS = new Set(TABS.map((t) => t.key));

export default function Settings() {
  // MPWA-11 (§8): rebuilt below lg as a row-list; desktop untouched. WE-04's
  // 8-cards-to-4-tabs restructure replaced this component wholesale, so the
  // mobile branch is re-applied on top of it rather than merged into it.
  const isMobile = useIsMobile();
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

  if (isMobile) return <SettingsMobile />;

  // Non-owner view stays a simple stack -- just Profile + Security.
  // No tabs needed for 2 sections; the tabbed layout is an owner-only
  // reorg of the workspace config.
  if (!isOwner) {
    return (
      <div>
        <PageHeader eyebrow="Account" title="Settings" />
        <div className="max-w-2xl">
          <ProfileCard />
          <div className="mt-6"><SecurityCard /></div>
        </div>
      </div>
    );
  }

  const active = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <div>
      <PageHeader eyebrow="Account & workspace" title="Settings" />

      {/* Tab bar. Horizontal-scroll on narrow screens so the four
          chips don't clip. Active tab uses the brand-600 underline
          consistent with the rest of the app. */}
      <div className="border-b border-border mb-5" data-testid="settings-tabs">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => selectTab(t.key)}
                data-testid={`settings-tab-${t.key}`}
                aria-pressed={isActive}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold uppercase tracking-wider whitespace-nowrap transition-all border-b-2 ${
                  isActive
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={16} weight={isActive ? "bold" : "regular"} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">{active.desc}</p>

      <div className="space-y-6 max-w-2xl" data-testid={`settings-panel-${tab}`}>
        {tab === "business" && (
          <>
            <CompanyDetails />
            <BusinessVocabulary />
          </>
        )}

        {tab === "operations" && (
          <OperatingModelEditor />
        )}

        {tab === "money" && (
          <>
            {/* U7-11.1 (2026-08-17): approvals card promoted to top.
                Currency + high-value threshold are the controls the
                owner actually touches; the category editor is a long
                list they rarely re-order. Putting categories first
                buried the two decisions that matter for approvals. */}
            <MoneyAndApprovalsCard />
            <FinanceCategoriesEditor />
          </>
        )}

        {tab === "account" && (
          <>
            <LanguageCard />
            <ProfileCard />
            <SecurityCard />
          </>
        )}
      </div>
    </div>
  );
}
