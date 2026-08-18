import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { lex } from "../lib/lexicon";
import { toast } from "sonner";
import { Translate, FloppyDisk, Sparkle } from "@phosphor-icons/react";

const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm font-mono bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";

// WE-02 (2026-08-16): WF_KEYS + workflow pipelines editor removed. The
// three labels were a dead output; pipeline labels are edited via the
// Operating Model editor (Operations tab) which is the single source of
// truth per Epic 5 spec.
const TT_KEYS = ["operational", "sales", "purchase", "production", "finance", "hr"];

function Row({ label, hint, value, onChange, testid }) {
  return (
    <label className="block">
      <span className="label-mono text-muted-foreground">{label}</span>
      <input data-testid={testid} className={`${inp} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
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
  const setTt = (k, v) => setForm((s) => ({ ...s, task_types: { ...s.task_types, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/tenant/lexicon", { lexicon: form });
      if (refreshTenant) await refreshTenant();
      toast.success("Vocabulary saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
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
      toast.error(e.response?.data?.detail || "Could not regenerate");
    } finally {
      setRegen(false);
    }
  };

  return (
    <div className="card-brutal p-5" data-testid="settings-vocabulary-card">
      <div className="flex items-center gap-2 mb-1">
        <Translate size={20} weight="bold" className="text-brand-600" />
        <h2 className="text-base font-medium">Business Vocabulary</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
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

        <div>
          <p className="label-mono text-brand-600 mb-2">Task type / department labels</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {TT_KEYS.map((k) => (
              <Row key={k} label={k} testid={`vocab-tt-${k}`} value={form.task_types[k]} onChange={(v) => setTt(k, v)} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="vocab-save"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-medium rounded-lg transition-all disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Vocabulary"}
        </button>
        <button onClick={regenerate} disabled={regen} data-testid="vocab-regenerate"
          className="flex items-center gap-2 border border-border px-5 py-2 text-sm font-medium rounded-lg hover:bg-accent transition-all disabled:opacity-60">
          <Sparkle size={16} weight="bold" /> {regen ? "Regenerating…" : "Regenerate with AI"}
        </button>
      </div>
    </div>
  );
}
