// MPWA-11 · /settings — mobile.
//
// The desktop page stacks eight editors in one column: 7,981px tall at 390px,
// with 8 native <select> elements in the scroll path and 50 elements spilling
// past the right edge. §8: "becomes a row-list, one screen per section. Nobody
// edits an operating model on a phone; they check one value."
//
// So the default screen is an index of rows, and a section only renders when he
// asks for it. HONEST LIMITATION: the sections themselves reuse the existing
// desktop editor components, so opening Operating Model or Vocabulary still
// shows desktop-density controls inside the sheet. Making each of those genuinely
// thumb-native is a bigger piece of work than this slice, and putting them
// behind a tap is the change that matters — he is not editing an operating model
// on a phone, and the index is what he actually opens.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Buildings, BookOpen, Sliders, Receipt, Translate, UserCircle, Lock,
  CurrencyCircleDollar, CaretRight, FloppyDisk, Info, ShieldCheck, UserPlus,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { inr } from "../../lib/format";
import {
  AccessSheet, BottomSheet, InviteSheet, SheetSelect, useTeamData,
} from "../../components/mobile";
import { CompanyDetails } from "../../components/CompanyDetails";
import { BusinessVocabulary } from "../../components/BusinessVocabulary";
import { OperatingModelEditor } from "../../components/OperatingModelEditor";
import { FinanceCategoriesEditor } from "../../components/FinanceCategoriesEditor";
import { ProfileForm, ChangePasswordForm } from "../../components/ProfileDialog";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"].map((c) => ({
  value: c,
  label: c,
}));

export default function SettingsMobile() {
  const { t } = useTranslation();
  const { tenant, user, refreshTenant } = useAuth();
  const [open, setOpen] = useState(null);
  // Adding a teammate moved here from Ops. Ops reads the team; creating one is
  // configuration, which is what this screen is.
  const { members, canManageTeam, roleOptions, refresh } = useTeamData();
  const [addOpen, setAddOpen] = useState(false);
  const [invite, setInvite] = useState(null);

  const [currency, setCurrency] = useState(tenant?.currency || "INR");
  const [threshold, setThreshold] = useState(String(tenant?.high_value_threshold ?? 50000));
  const [signoff, setSignoff] = useState(!!tenant?.require_owner_signoff);
  const [saving, setSaving] = useState(false);

  const saveMoney = async () => {
    setSaving(true);
    try {
      await api.patch("/tenant/settings", {
        currency,
        high_value_threshold: Number(threshold) || 0,
        require_owner_signoff: signoff,
      });
      toast.success("Saved");
      if (refreshTenant) await refreshTenant();
      setOpen(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that");
    } finally {
      setSaving(false);
    }
  };

  // §8's section list. `value` is the one thing he came to check, shown on the
  // row so the common case needs no tap at all.
  const SECTIONS = [
    { key: "company", label: "Company", icon: Buildings, value: tenant?.name, body: <CompanyDetails /> },
    // `action` rather than `body`: this row opens the AccessSheet directly.
    // Routing it through the section sheet would nest a BottomSheet inside a
    // BottomSheet, which traps focus and gives the form two headers.
    ...(canManageTeam
      ? [{
          key: "add-member",
          label: "Add team member",
          icon: UserPlus,
          value: `${members.length} ${members.length === 1 ? "person" : "people"} on the team`,
          action: () => setAddOpen(true),
        }]
      : []),
    { key: "money", label: "Money & approvals", icon: CurrencyCircleDollar,
      value: `Owner approves above ${inr(Number(threshold) || 0)}`, body: null },
    { key: "vocabulary", label: "Your words for things", icon: BookOpen, body: <BusinessVocabulary /> },
    { key: "operating", label: "How work flows", icon: Sliders, body: <OperatingModelEditor /> },
    { key: "categories", label: "Money categories", icon: Receipt, body: <FinanceCategoriesEditor /> },
    { key: "language", label: t("settings.language_title", "Language"), icon: Translate,
      value: { en: "English", hi: "हिन्दी", ta: "தமிழ்" }[user?.language] || "English",
      body: <LanguageSwitcher variant="inline" /> },
    { key: "profile", label: "Your profile", icon: UserCircle, value: user?.name, body: <ProfileForm /> },
    { key: "security", label: "Password", icon: Lock, body: <ChangePasswordForm /> },
  ];

  const section = SECTIONS.find((s) => s.key === open);

  return (
    <div data-testid="settings-mobile">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">{tenant?.name}</p>

      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" data-testid="settings-rows">
        {SECTIONS.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => (s.action ? s.action() : setOpen(s.key))}
              data-testid={`settings-row-${s.key}`}
              className="flex w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-accent"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              <s.icon size={22} weight="regular" aria-hidden="true" className="shrink-0 text-neutral-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-semibold">{s.label}</span>
                {s.value && (
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">{s.value}</span>
                )}
              </span>
              <CaretRight size={20} weight="bold" aria-hidden="true" className="shrink-0 text-neutral-400" />
            </button>
          </li>
        ))}
      </ul>

      <BottomSheet
        open={!!open}
        onClose={() => setOpen(null)}
        size="full"
        title={section?.label || ""}
        data-testid="settings-sheet"
        footer={
          open === "money" ? (
            <button
              type="button"
              onClick={saveMoney}
              disabled={saving}
              data-testid="settings-save"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              <FloppyDisk size={18} weight="bold" /> {saving ? "Saving…" : "Save"}
            </button>
          ) : null
        }
      >
        {open === "money" ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                Currency
              </p>
              <SheetSelect
                label="Currency"
                value={currency}
                options={CURRENCIES}
                onChange={(e) => setCurrency(e.target.value)}
                data-testid="settings-currency"
              />
            </div>
            <div>
              <p className="mb-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                You approve anything at or above
              </p>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1000"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                data-testid="settings-threshold"
                aria-label="High value threshold"
                className="w-full rounded-xl border border-input bg-card px-3 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ minHeight: "var(--control-h-base)" }}
              />
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info size={16} weight="bold" className="mt-0.5 shrink-0" />
                {/* §5.4: what it does for him, not which queue it routes to. */}
                Anything at or above {inr(Number(threshold) || 0)} comes to you with
                the amount on the button and a few seconds to undo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSignoff((v) => !v)}
              data-testid="settings-signoff-toggle"
              aria-pressed={signoff}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border border-border ${
                  signoff ? "bg-primary text-primary-foreground" : "bg-card"
                }`}
              >
                {signoff && <ShieldCheck size={15} weight="bold" />}
              </span>
              <span>
                <span className="block text-sm font-semibold">Only you can approve those</span>
                <span className="block text-sm text-muted-foreground">
                  When off, finance can handle them and you still see the flag.
                </span>
              </span>
            </button>
          </div>
        ) : (
          section?.body
        )}
      </BottomSheet>

      {/* Same sheet the Ops member card opens for editing access — in "add"
          mode here because no `initial` is passed. A new member with a phone
          comes back with an invite token, which opens the link sheet. */}
      <AccessSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initial={null}
        roleOptions={roleOptions}
        members={members}
        onSaved={refresh}
        onInvite={setInvite}
      />
      <InviteSheet info={invite} onClose={() => setInvite(null)} />
    </div>
  );
}
