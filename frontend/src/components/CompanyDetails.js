import { useState, useEffect, useRef } from "react";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { toast } from "sonner";
import { Buildings, Package, Plus, Trash, Copy, WhatsappLogo } from "@phosphor-icons/react";
import { DRAWER_FIELD, GLASS_PILL, INK_PILL } from "./karma/glass";

/* 2026-10-05 — the company and only the company.
 *
 * This card used to hold four things with three save buttons: the company's
 * details and products, the WhatsApp workspace code, the TEAMS and their access,
 * and free-standing TASK TEMPLATES. Teams moved to Settings › Team & access
 * (components/settings/TeamsCard), task templates to Settings › Operations
 * (components/settings/TaskTemplatesCard). It was also the last card on the old
 * square-bordered style, beside rounded glass cards on the same page. */
const FIELD_LABEL = "text-xs font-medium text-slate-600";
const uid = () => Math.random().toString(36).slice(2, 9);
const FIELDS = [
  { key: "name", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "company_size", label: "Team size" },
  { key: "phone", label: "Company mobile" },
  // 2026-09-20 — where support and receipts for THIS company go. Not a sign-in:
  // a founder running two companies may use one address for both.
  { key: "support_email", label: "Company email (support & receipts)" },
  { key: "region", label: "Region" },
  { key: "gst", label: "GST / Tax ID" },
  { key: "branches", label: "Branches" },
];

export function CompanyDetails() {
  const { tenant, user, refreshTenant } = useAuth();
  const canManage = hasPerm(user, "team_manage");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [products, setProducts] = useState([]);

  // 2026-09-20 (Settings audit) — re-read from the tenant only while nothing
  // here is unsaved, so another card's save cannot wipe what is being typed.
  const dirty = useRef({ company: false });
  useEffect(() => {
    if (!tenant || dirty.current.company) return;
    setForm({
      name: tenant.name || "", industry: tenant.industry || "", company_size: tenant.company_size || "",
      phone: tenant.phone || "", region: tenant.region || "", gst: tenant.gst || "",
      support_email: tenant.support_email || "", branches: tenant.branches || "",
    });
    setProducts((tenant.products || []).map((p) => ({ name: p.name || "", description: p.description || "", _key: uid() })));
  }, [tenant]);

  const touch = () => { dirty.current.company = true; };
  const setField = (k, v) => { touch(); setForm((f) => ({ ...f, [k]: v })); };
  const addProduct = () => { touch(); setProducts((p) => [...p, { name: "", description: "", _key: uid() }]); };
  const setProduct = (i, k, v) => { touch(); setProducts((p) => p.map((it, idx) => (idx === i ? { ...it, [k]: v } : it))); };
  const removeProduct = (i) => { touch(); setProducts((p) => p.filter((_, idx) => idx !== i)); };

  const save = async () => {
    if (!form.name?.trim()) return toast.error("Company name is required");
    // A product with a description but no name used to vanish on save,
    // description and all. Say so instead.
    if (products.some((p) => !p.name.trim() && p.description.trim())) {
      return toast.error("Give every product a name, or remove the empty row");
    }
    setSaving(true);
    try {
      await api.patch("/tenant", {
        ...form,
        products: products.filter((p) => p.name.trim()).map(({ _key, ...r }) => r),
      });
      dirty.current.company = false;
      await refreshTenant();
      toast.success("Company details saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't save the company details");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-company-card">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Buildings size={18} weight="bold" className="text-muted-foreground" aria-hidden="true" /> Company details
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {canManage ? "Your company's profile and what it sells." : "Your company's profile. Someone who manages the team can change it."}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === "name" ? "sm:col-span-2" : ""}>
            <label htmlFor={`company-field-${f.key}`} className={FIELD_LABEL}>{f.label}</label>
            <input id={`company-field-${f.key}`} data-testid={`company-field-${f.key}`} className={`${DRAWER_FIELD} mt-1`} value={form[f.key] || ""}
              disabled={!canManage} onChange={(e) => setField(f.key, e.target.value)} placeholder={canManage ? f.label : "—"} />
          </div>
        ))}
      </div>

      {canManage && tenant?.id && (
        <div className="mt-5 rounded-2xl bg-slate-900/[0.03] p-3.5 ring-1 ring-inset ring-slate-900/[0.05]" data-testid="workspace-id-block">
          {/* U7-11.1 (2026-08-17): what it is, when to share it, who needs it —
              no developer language on an owner's screen. */}
          <p className={`${FIELD_LABEL} flex items-center gap-1.5`}>
            <WhatsappLogo size={14} weight="bold" className="text-green-600" aria-hidden="true" /> WhatsApp workspace code
          </p>
          <div className="mt-1.5 flex gap-2">
            <input data-testid="workspace-id-value" aria-label="WhatsApp workspace code" readOnly value={tenant.id}
              className={`${DRAWER_FIELD} cursor-text font-mono text-xs`} onFocus={(e) => e.target.select()} />
            <button type="button" data-testid="workspace-id-copy"
              onClick={() => { navigator.clipboard?.writeText(tenant.id); toast.success("Workspace code copied"); }}
              className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-slate-700 hover:bg-white ${GLASS_PILL}`}>
              <Copy size={14} weight="bold" aria-hidden="true" /> Copy
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Share this with your WhatsApp integrator or support so messages from unknown numbers land in this workspace. You don&rsquo;t need to touch it day-to-day.
          </p>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Package size={16} weight="bold" className="text-muted-foreground" aria-hidden="true" /> Products &amp; services
          </h3>
          {canManage && (
            <button type="button" onClick={addProduct} data-testid="company-add-product"
              className={`inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-slate-700 hover:bg-white ${GLASS_PILL}`}>
              <Plus size={12} weight="bold" aria-hidden="true" /> Add
            </button>
          )}
        </div>
        {products.length === 0 && <p className="text-sm text-muted-foreground">No products or services yet.</p>}
        <div className="space-y-2">
          {products.map((p, i) => (
            <div key={p._key || i} data-testid={`company-product-${i}`}
              className="flex items-start gap-2 rounded-2xl bg-white/60 p-2.5 ring-1 ring-inset ring-slate-900/[0.06]">
              <div className="flex-1 space-y-2">
                <input data-testid={`company-product-name-${i}`} aria-label="Product name" className={DRAWER_FIELD} value={p.name} disabled={!canManage}
                  onChange={(e) => setProduct(i, "name", e.target.value)} placeholder="Name" />
                <input data-testid={`company-product-desc-${i}`} aria-label="Product description" className={DRAWER_FIELD} value={p.description} disabled={!canManage}
                  onChange={(e) => setProduct(i, "description", e.target.value)} placeholder="Short description" />
              </div>
              {canManage && (
                <button type="button" onClick={() => removeProduct(i)} data-testid={`company-product-remove-${i}`}
                  aria-label={`Remove ${p.name || "product"}`} title="Remove"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600">
                  <Trash size={15} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="mt-6 flex justify-end">
          <button type="button" data-testid="company-save-button" onClick={save} disabled={saving}
            className={`inline-flex h-11 items-center rounded-pill px-5 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            {saving ? "Saving…" : "Save company details"}
          </button>
        </div>
      )}
    </div>
  );
}

export default CompanyDetails;
