import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { toast } from "sonner";
import { Tag, FloppyDisk, Sparkle, Plus, Trash } from "@phosphor-icons/react";

let _uid = 0;
const uid = () => `fc${Date.now()}_${_uid++}`;

const withUids = (list) => (list || []).map((c) => ({ _uid: uid(), label: c }));
const fromTenant = (tenant) => {
  const fc = tenant?.finance_categories || {};
  return { expense: withUids(fc.expense || []), asset: withUids(fc.asset || []) };
};

function CategoryGroup({ title, items, onSet, onAdd, onDel, testid }) {
  return (
    <div data-testid={testid}>
      <p className="text-label uppercase text-primary-text mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((c, i) => (
          <div key={c._uid} className="flex items-center gap-1 border border-hairline rounded-md pl-2 pr-1 py-1" data-testid={`${testid}-item-${i}`}>
            <input className="bg-transparent text-sm w-32 focus:outline-none" value={c.label}
              data-testid={`${testid}-input-${i}`}
              onChange={(e) => onSet(i, e.target.value)} />
            <button onClick={() => onDel(i)} title="Remove" className="text-text-secondary hover:text-destructive-text">
              <Trash size={13} weight="bold" />
            </button>
          </div>
        ))}
        <button onClick={onAdd} data-testid={`${testid}-add`} className="flex items-center gap-1 text-sm font-semibold text-primary-text hover:underline px-2 py-1">
          <Plus size={13} weight="bold" /> Add
        </button>
      </div>
    </div>
  );
}

export function FinanceCategoriesEditor() {
  const { tenant, refreshTenant } = useAuth();
  const [cats, setCats] = useState(() => fromTenant(tenant));
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  const setItem = (group, i, label) => setCats((c) => {
    const list = [...c[group]];
    list[i] = { ...list[i], label };
    return { ...c, [group]: list };
  });
  const addItem = (group) => setCats((c) => ({ ...c, [group]: [...c[group], { _uid: uid(), label: "" }] }));
  const delItem = (group, i) => setCats((c) => ({ ...c, [group]: c[group].filter((_, x) => x !== i) }));

  const toPayload = () => ({
    expense: cats.expense.map((c) => c.label.trim()).filter(Boolean),
    asset: cats.asset.map((c) => c.label.trim()).filter(Boolean),
  });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch("/tenant/finance-categories", { finance_categories: toPayload() });
      setCats(fromTenant(data));
      if (refreshTenant) await refreshTenant();
      toast.success("Finance categories saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };
  const regenerate = async () => {
    setRegen(true);
    try {
      const { data } = await api.post("/tenant/finance-categories/regenerate");
      setCats(fromTenant(data));
      if (refreshTenant) await refreshTenant();
      toast.success("AI regenerated your finance categories");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not regenerate");
    } finally { setRegen(false); }
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface p-5" data-testid="settings-finance-categories-card">
      <div className="flex items-center gap-2 mb-1">
        <Tag size={20} weight="bold" className="text-primary-text" />
        <h2 className="text-lg font-extrabold uppercase tracking-tight">Finance Categories</h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        The buckets your Expenses and Assets are filed under — AI-generated for <span className="font-semibold">{tenant?.industry || "your industry"}</span>. Edit them or let AI regenerate. “Other” is always kept.
      </p>

      <div className="space-y-5">
        <CategoryGroup title="Expense categories" items={cats.expense} testid="fc-expense"
          onSet={(i, v) => setItem("expense", i, v)} onAdd={() => addItem("expense")} onDel={(i) => delItem("expense", i)} />
        <CategoryGroup title="Asset categories" items={cats.asset} testid="fc-asset"
          onSet={(i, v) => setItem("asset", i, v)} onAdd={() => addItem("asset")} onDel={(i) => delItem("asset", i)} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="fc-save"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:shadow-xs transition-all disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Categories"}
        </button>
        <button onClick={regenerate} disabled={regen} data-testid="fc-regenerate"
          className="flex items-center gap-2 border border-hairline px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:bg-surface-hover transition-all disabled:opacity-60">
          <Sparkle size={16} weight="bold" /> {regen ? "Regenerating…" : "Regenerate with AI"}
        </button>
      </div>
    </div>
  );
}
