// Epic 2 Sprint A — E2-02 CRM shell v1
//
// Unified relationship page at /crm that replaces the Customers +
// Suppliers tabs of the old /contacts People page. Employees are
// no longer part of this surface (moved to /team, E2-01).
//
// v1 responsibility:
//   * filter chips (All / Customers / Suppliers) + owner-scope
//     toggle ('My relationships')
//   * search bar (name, company, phone, email)
//   * card grid with quick actions (Add / Edit / Delete / Log
//     complaint / 360°)
//   * click a card → navigate to /contacts/:id (existing
//     ContactProfile 360° preserved untouched)
//
// Sprint B will bring the right-pane detail with the live
// workflow-engine feed, activity timeline, and lifecycle chip;
// that's E2-07 / E2-08 / E2-03 respectively.

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { hasPerm } from "../lib/perms";
import { lex } from "../lib/lexicon";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { typeLabel } from "../lib/format";
import api from "../lib/api";
import { toast } from "sonner";
import {
  Plus, MagnifyingGlass, PencilSimple, Trash, Phone, EnvelopeSimple,
  MapPin, Eye, AddressBook, Truck, UsersFour,
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "../components/ui/dialog";

const CUSTOMER_TYPES = ["customer", "dealer"];
const VENDOR_TYPES = ["vendor"];
const STATUSES = ["lead", "active", "inactive"];
const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";

// -----------------------------------------------------------------------------
// Dialogs (identical shape to the old ContactsPanel — kept inline so /crm has
// zero coupling to the old People page. When People.js is removed we don't
// break anything.)
// -----------------------------------------------------------------------------
function ComplaintDialog({ contact, onSaved }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState("medium");
  const save = async () => {
    if (!text.trim()) return toast.error("Describe the complaint");
    try {
      await api.post("/complaints", { customer_id: contact.id, text, severity });
      toast.success("Complaint logged");
      setText(""); setOpen(false); onSaved && onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid={`crm-log-complaint-${contact.id}`} title="Log complaint" className="w-8 h-8 flex items-center justify-center border border-black hover:bg-purple-600 hover:text-white transition-colors">!</button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">Log complaint — {contact.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <textarea data-testid="crm-complaint-text" className={inp} rows={3} placeholder="What went wrong?" value={text} onChange={(e) => setText(e.target.value)} />
          <select className={inp} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {["low", "medium", "high"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <DialogFooter>
          <button data-testid="crm-complaint-save" onClick={save} className="bg-purple-600 text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Log complaint</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CrmContactDialog({ trigger, initial, onSaved, users, defaultType }) {
  const [open, setOpen] = useState(false);
  const blank = { type: defaultType || "customer", name: "", company: "", phone: "", email: "", address: "", tax_id: "", tags: "", status: "lead", assigned_id: "", notes: "", birthday: "" };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openChange = (o) => {
    setOpen(o);
    if (o) {
      setForm(initial
        ? { ...initial, tags: (initial.tags || []).join(", "), assigned_id: initial.assigned_id || "", company: initial.company || "", phone: initial.phone || "", email: initial.email || "", address: initial.address || "", tax_id: initial.tax_id || "", notes: initial.notes || "", birthday: initial.birthday || "" }
        : { ...blank, type: defaultType || "customer" });
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    const payload = {
      type: form.type, name: form.name, company: form.company, phone: form.phone, email: form.email,
      address: form.address, tax_id: form.tax_id, status: form.status,
      assigned_id: form.assigned_id || null, notes: form.notes, birthday: form.birthday,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    };
    try {
      if (initial) await api.patch(`/contacts/${initial.id}`, payload);
      else await api.post("/contacts", payload);
      toast.success(initial ? "Contact updated" : "Contact added");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border border-black rounded-none max-w-lg" data-testid="crm-contact-dialog">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{initial ? "Edit" : "New"} contact</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.type} onChange={set("type")} data-testid="crm-contact-type">
            {["customer", "dealer", "vendor"].map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <select className={inp} value={form.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className={`${inp} col-span-2`} placeholder="Name *" value={form.name} onChange={set("name")} data-testid="crm-contact-name" />
          <input className={inp} placeholder="Company" value={form.company} onChange={set("company")} />
          <input className={inp} placeholder="Phone" value={form.phone} onChange={set("phone")} />
          <input className={inp} placeholder="Email" value={form.email} onChange={set("email")} />
          <input className={inp} placeholder="GSTIN / Tax ID" value={form.tax_id} onChange={set("tax_id")} />
          <input className={`${inp} col-span-2`} placeholder="Address" value={form.address} onChange={set("address")} />
          <input className={`${inp} col-span-2`} placeholder="Tags (comma separated)" value={form.tags} onChange={set("tags")} />
          {users && users.length > 0 && (
            <select className={`${inp} col-span-2`} value={form.assigned_id} onChange={set("assigned_id")}>
              <option value="">Owner — unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <textarea className={`${inp} col-span-2`} rows={2} placeholder="Notes" value={form.notes} onChange={set("notes")} />
        </div>
        <DialogFooter>
          <button onClick={save} data-testid="crm-contact-save" className="bg-brand-ink text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            {initial ? "Save changes" : "Add contact"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Main CRM page
// -----------------------------------------------------------------------------
export default function CRM() {
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const L = lex(tenant);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [scope, setScope] = useState("all"); // all | customers | suppliers | mine
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const canManage = user?.role === "owner" || user?.role === "sales";
  const can360 = hasPerm(user, "finance");

  const { data } = useQuery({
    queryKey: ["crm-contacts", status, q],
    queryFn: () => api.get(`/contacts?type=&status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data),
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-contacts"] });

  const contacts = useMemo(() => {
    let list = data || [];
    if (scope === "customers") list = list.filter((c) => CUSTOMER_TYPES.includes(c.type));
    else if (scope === "suppliers") list = list.filter((c) => VENDOR_TYPES.includes(c.type));
    else if (scope === "mine") list = list.filter((c) => c.assigned_id === user?.id);
    // "all" → no type filter
    return list;
  }, [data, scope, user?.id]);

  const remove = async (id) => {
    if (!window.confirm("Delete this contact permanently?")) return;
    try {
      await api.delete(`/contacts/${id}`);
      toast.success("Contact deleted");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  const SCOPES = [
    { key: "all", label: t("crm.all"), icon: UsersFour },
    { key: "customers", label: L.customer_plural, icon: AddressBook },
    { key: "suppliers", label: L.vendor_plural, icon: Truck },
    { key: "mine", label: t("crm.mine"), icon: null },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("crm.eyebrow", { customers: L.customer_plural.toLowerCase(), suppliers: L.vendor_plural.toLowerCase() })}
        title={t("crm.title")}
      >
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <CrmContactDialog
              users={users}
              defaultType="customer"
              onSaved={refresh}
              trigger={
                <button data-testid="crm-add-customer" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
                  <Plus size={16} weight="bold" /> {t("crm.add_customer", { name: L.customer_singular })}
                </button>
              }
            />
            <CrmContactDialog
              users={users}
              defaultType="vendor"
              onSaved={refresh}
              trigger={
                <button data-testid="crm-add-supplier" className="flex items-center gap-2 bg-brand-yellow text-black px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
                  <Plus size={16} weight="bold" /> {t("crm.add_supplier", { name: L.vendor_singular })}
                </button>
              }
            />
          </div>
        )}
      </PageHeader>

      {/* Filter chips + search */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <div className="flex border border-black overflow-x-auto" data-testid="crm-scope-chips">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              data-testid={`crm-scope-${s.key}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border-r border-black last:border-r-0 transition-colors ${scope === s.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}
            >
              {s.icon && <s.icon size={16} weight="bold" />} {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center border border-black bg-white px-3 flex-1 min-w-[200px]">
          <MagnifyingGlass size={16} weight="bold" className="text-muted-foreground" />
          <input
            data-testid="crm-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("crm.search_ph")}
            className="flex-1 py-2 px-2 text-sm font-mono focus:outline-none bg-transparent"
          />
        </div>
        <select
          data-testid="crm-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-black bg-white px-3 py-2 text-sm font-mono focus:outline-none"
        >
          <option value="">{t("crm.all_statuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Card grid */}
      {contacts.length === 0 && (
        <EmptyState
          title={t("crm.empty_title")}
          hint={canManage ? t("crm.empty_hint_manage") : t("crm.empty_hint")}
        />
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {contacts.map((c) => {
          const isCustomer = CUSTOMER_TYPES.includes(c.type);
          return (
            <div
              key={c.id}
              data-testid={`crm-card-${c.id}`}
              className="card-brutal p-5 shadow-hover cursor-pointer"
              onClick={() => can360 && navigate(`/contacts/${c.id}`)}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    value={typeLabel(c.type)}
                    className={isCustomer ? "bg-brand-blue text-white" : "bg-brand-yellow text-black"}
                  />
                  <Chip
                    value={c.status}
                    className={c.status === "active" ? "bg-brand-ink text-white" : c.status === "lead" ? "bg-brand-yellow text-black" : "bg-black/10 text-black"}
                  />
                  {(c.tags || []).slice(0, 2).map((tag) => (
                    <Chip key={tag} value={tag} className="bg-black/5 text-black" />
                  ))}
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {can360 && (
                    <button
                      data-testid={`crm-view-profile-${c.id}`}
                      onClick={() => navigate(`/contacts/${c.id}`)}
                      title="360° profile"
                      className="w-8 h-8 flex items-center justify-center border border-black hover:bg-brand-blue hover:text-white transition-colors"
                    >
                      <Eye size={14} weight="bold" />
                    </button>
                  )}
                  {canManage && (
                    <>
                      {isCustomer && <ComplaintDialog contact={c} onSaved={refresh} />}
                      <CrmContactDialog
                        users={users}
                        initial={c}
                        onSaved={refresh}
                        trigger={
                          <button data-testid={`crm-edit-${c.id}`} className="w-8 h-8 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors">
                            <PencilSimple size={14} weight="bold" />
                          </button>
                        }
                      />
                      <button
                        data-testid={`crm-delete-${c.id}`}
                        onClick={() => remove(c.id)}
                        className="w-8 h-8 flex items-center justify-center border border-black hover:bg-brand-red hover:text-white transition-colors"
                      >
                        <Trash size={14} weight="bold" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="font-heading font-bold text-lg leading-tight">{c.name}</p>
              {c.company && <p className="text-sm text-muted-foreground">{c.company}</p>}
              <div className="mt-3 space-y-1 text-sm">
                {c.phone && <p className="flex items-center gap-2"><Phone size={14} weight="bold" className="text-muted-foreground" /> {c.phone}</p>}
                {c.email && <p className="flex items-center gap-2 break-all"><EnvelopeSimple size={14} weight="bold" className="text-muted-foreground" /> {c.email}</p>}
                {c.address && <p className="flex items-center gap-2"><MapPin size={14} weight="bold" className="text-muted-foreground" /> {c.address}</p>}
              </div>
              {c.assigned_id && users && (
                <p className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Owner: {users.find((u) => u.id === c.assigned_id)?.name || "—"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
