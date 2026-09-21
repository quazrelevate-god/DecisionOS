import { useState } from "react";
import { RegenerateWithAi } from "./RegenerateWithAi";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { userPerms } from "../lib/perms";
import { toast } from "sonner";
import { Tag, FloppyDisk, Plus, X } from "@phosphor-icons/react";
import { GLASS_PILL } from "./karma/glass";

/* PILOT-1 F — the Settings side of finance categories, on the current design
 * system. It was the last card in Settings still on the retired kit:
 * label-mono captions, hairline nm-edge boxes around bare inputs, a brand-blue
 * "Add" link and a square ink button. Now: the kr-bento card its neighbours
 * use, plain labels, each category an .nm-field pill with a 44px remove, a
 * glass "Add", and the ink Save pill.
 *
 * Who may change what, unchanged on the server and now said on the screen:
 * renaming and removing need Manage Team (PATCH /tenant/finance-categories);
 * anyone with Finance access can ADD one — from the category list on the
 * expense and asset forms (POST /ledger/categories). Someone without Manage
 * Team sees the lists and is told where to add, instead of an editor whose
 * Save would be refused.
 */
let _uid = 0;
const uid = () => `fc${Date.now()}_${_uid++}`;

const withUids = (list) => (list || []).map((c) => ({ _uid: uid(), label: c }));
const fromTenant = (tenant) => {
  const fc = tenant?.finance_categories || {};
  return { expense: withUids(fc.expense || []), asset: withUids(fc.asset || []) };
};

const LABEL = "mb-2.5 block text-sm font-medium text-slate-700";

function CategoryGroup({ title, items, onSet, onAdd, onDel, testid, canEdit }) {
  return (
    <div data-testid={testid}>
      <p className={LABEL}>{title}</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((c, i) => (
          <li key={c._uid} data-testid={`${testid}-item-${i}`}
            className="nm-field flex h-11 min-w-0 items-center gap-0.5 rounded-pill pl-4 pr-0.5">
            {canEdit ? (
              <>
                <input className="w-32 min-w-0 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                  value={c.label} placeholder="Category name" aria-label={`Category ${i + 1}`}
                  data-testid={`${testid}-input-${i}`}
                  onChange={(e) => onSet(i, e.target.value)} />
                <button type="button" onClick={() => onDel(i)} aria-label={`Remove ${c.label || "this category"}`} title="Remove"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:text-kr-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40">
                  <X size={14} weight="bold" aria-hidden="true" />
                </button>
              </>
            ) : (
              <span className="pr-3.5 text-sm text-slate-700" data-testid={`${testid}-label-${i}`}>{c.label}</span>
            )}
          </li>
        ))}
        {canEdit && (
          <li>
            <button type="button" onClick={onAdd} data-testid={`${testid}-add`}
              className={`flex h-11 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 ${GLASS_PILL}`}>
              <Plus size={14} weight="bold" aria-hidden="true" /> Add
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

export function FinanceCategoriesEditor() {
  const { user, tenant, refreshTenant } = useAuth();
  const canEdit = user?.role === "owner" || userPerms(user).includes("team_manage");
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
      toast.error(formatApiError(e.response?.data?.detail) || "Could not save");
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
      toast.error(formatApiError(e.response?.data?.detail) || "Could not regenerate");
    } finally { setRegen(false); }
  };

  return (
    <div className="kr-bento p-5 lg:p-6" data-testid="settings-finance-categories-card">
      <div className="mb-1 flex items-center gap-2">
        <Tag size={20} weight="bold" aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-base font-medium">Finance categories</h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        The buckets your expenses and assets are filed under — set up for{" "}
        <span className="font-medium text-foreground">{tenant?.industry || "your industry"}</span>. “Other” is always kept.
        {" "}Anyone with Finance access can add one from the category list while adding an expense or asset.
      </p>

      <div className="space-y-6">
        <CategoryGroup title="Expense categories" items={cats.expense} testid="fc-expense" canEdit={canEdit}
          onSet={(i, v) => setItem("expense", i, v)} onAdd={() => addItem("expense")} onDel={(i) => delItem("expense", i)} />
        <CategoryGroup title="Asset categories" items={cats.asset} testid="fc-asset" canEdit={canEdit}
          onSet={(i, v) => setItem("asset", i, v)} onAdd={() => addItem("asset")} onDel={(i) => delItem("asset", i)} />
      </div>

      {canEdit ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={save} disabled={saving} data-testid="fc-save"
            className="kr-lift flex h-11 items-center gap-2 rounded-pill bg-kr-ink px-5 text-sm font-medium text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 disabled:opacity-60">
            <FloppyDisk size={16} weight="bold" aria-hidden="true" /> {saving ? "Saving…" : "Save categories"}
          </button>
          <RegenerateWithAi onConfirm={regenerate} busy={regen} testid="fc-regenerate"
            replaces="your expense and asset categories" />
        </div>
      ) : (
        <p className="mt-5 text-xs text-muted-foreground" data-testid="fc-readonly-note">
          Renaming or removing a category needs Manage Team — ask the owner.
        </p>
      )}
    </div>
  );
}
