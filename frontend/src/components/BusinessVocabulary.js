import { useState } from "react";
import { RegenerateWithAi } from "./RegenerateWithAi";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { lex } from "../lib/lexicon";
import { toast } from "sonner";
import { Translate, FloppyDisk } from "@phosphor-icons/react";

// 2026-10-05 — the glass field the rest of Settings uses.
const inp = "w-full rounded-2xl bg-white/80 px-3 py-2 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";

// WE-02 (2026-08-16): WF_KEYS + workflow pipelines editor removed. The
// three labels were a dead output; pipeline labels are edited via the
// Operating Model editor (Operations tab) which is the single source of
// truth per Epic 5 spec.
// Audit B-02 (2026-10-08): the six "task type / department labels" are gone
// from this card too. Nothing read them (a dead output, like the workflow
// labels above), and next to the teams they were a second department list
// with different names. Departments are the teams: Settings › Team & access.

function Row({ label, hint, value, onChange, testid }) {
  return (
    <label className="block">
      <span className="label-mono text-muted-foreground">{label}</span>
      <input data-testid={testid} className={`${inp} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function BusinessVocabulary() {
  const { tenant, refreshTenant } = useAuth();
  const [form, setForm] = useState(() => lex(tenant));
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  const setField = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  // WE-02: setWf removed alongside the workflow-vocab editor block.

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch("/tenant/lexicon", { lexicon: form });
      // A cleared word is saved as the default; show what was saved, not a blank.
      setForm(lex(data));
      if (refreshTenant) await refreshTenant();
      toast.success("Vocabulary saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegen(true);
    try {
      const { data } = await api.post("/tenant/lexicon/regenerate");
      setForm(lex(data));
      if (refreshTenant) await refreshTenant();
      toast.success("AI regenerated your vocabulary");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Could not regenerate");
    } finally {
      setRegen(false);
    }
  };

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-vocabulary-card">
      <div className="flex items-center gap-2 mb-1">
        <Translate size={20} weight="bold" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Business Vocabulary</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The words DecisionOS uses across the app, tailored to <span className="font-semibold">{tenant?.industry || "your industry"}</span>. Edit them to match how your team talks, or let AI regenerate from your industry.
      </p>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Row label="Customer (singular)" testid="vocab-customer-singular" value={form.customer_singular} onChange={(v) => setField("customer_singular", v)} />
          <Row label="Customers (plural)" testid="vocab-customer-plural" value={form.customer_plural} onChange={(v) => setField("customer_plural", v)} />
          <Row label="Vendor (singular)" testid="vocab-vendor-singular" value={form.vendor_singular} onChange={(v) => setField("vendor_singular", v)} />
          <Row label="Vendors (plural)" testid="vocab-vendor-plural" value={form.vendor_plural} onChange={(v) => setField("vendor_plural", v)} />
        </div>

        {/* WE-02 (2026-08-16): "Workflow pipelines" editor removed.
             Pipeline labels + stages are edited via the Operating Model
             editor (see OperatingModelEditor.js). */}

      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="vocab-save"
          className="flex h-11 items-center gap-2 rounded-pill bg-kr-ink px-5 text-sm font-medium text-white transition-all hover:brightness-125 disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Vocabulary"}
        </button>
        <RegenerateWithAi onConfirm={regenerate} busy={regen} testid="vocab-regenerate"
          replaces="your customer and vendor words" />
      </div>
    </div>
  );
}
