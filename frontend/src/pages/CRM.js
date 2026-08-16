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

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { hasPerm } from "../lib/perms";
import { lex } from "../lib/lexicon";
import { PageHeader, Chip, EmptyState, SkeletonGrid } from "../components/common";
import { typeLabel } from "../lib/format";
import api from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import CRMMobile from "./mobile/CRMMobile";
import { toast } from "sonner";
import {
  Plus, MagnifyingGlass, PencilSimple, Trash, Phone, EnvelopeSimple,
  MapPin, Eye, AddressBook, Truck, UsersFour, Warning as WarningIcon,
  ArrowsDownUp, CurrencyInr, Clock, UploadSimple,
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "../components/ui/dialog";

const CUSTOMER_TYPES = ["customer", "dealer"];
const VENDOR_TYPES = ["vendor"];
const STATUSES = ["lead", "active", "inactive"];

// Epic 2 Sprint 1 (E2-03): lifecycle stages. Enum differs by contact
// type -- customers travel a sales funnel; suppliers travel a
// procurement journey. Colours below are the visual cue on the card
// so founder can spot at-risk / on-hold instantly.
const CUSTOMER_STAGES = [
  { key: "lead", label: "Lead", cls: "bg-black/10 text-black" },
  { key: "qualified", label: "Qualified", cls: "bg-brand-blue/20 text-brand-blue" },
  { key: "active", label: "Active", cls: "bg-brand-green/20 text-brand-green" },
  { key: "at_risk", label: "At Risk", cls: "bg-brand-red/20 text-brand-red" },
  { key: "churned", label: "Churned", cls: "bg-black/30 text-white" },
];
const SUPPLIER_STAGES = [
  { key: "prospect", label: "Prospect", cls: "bg-black/10 text-black" },
  { key: "active", label: "Active", cls: "bg-brand-green/20 text-brand-green" },
  { key: "preferred", label: "Preferred", cls: "bg-brand-yellow text-black" },
  { key: "on_hold", label: "On Hold", cls: "bg-brand-red/20 text-brand-red" },
  { key: "retired", label: "Retired", cls: "bg-black/30 text-white" },
];
function stagesForType(t) {
  if (VENDOR_TYPES.includes(t)) return SUPPLIER_STAGES;
  return CUSTOMER_STAGES;
}
function stageMeta(type, stage) {
  if (!stage) return null;
  return stagesForType(type).find((s) => s.key === stage) || null;
}
const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";

// Epic 2 Sprint 8 (E2-70): sort options for the CRM card grid. Founder
// scans a lot of cards at once -- sorting by name (default), most-
// recently-touched, outstanding balance desc, or last touched lets
// them find who to call today without scrolling.
const SORT_OPTIONS = [
  { key: "name", label: "Name A-Z" },
  { key: "recent", label: "Recently added" },
  { key: "outstanding", label: "Outstanding (highest)" },
  { key: "touched", label: "Last touched (oldest)" },
];

// Epic 2 Sprint 8 (E2-71): render "3 days ago" style timestamp from a
// UTC ISO string. Small helper -- kept inline because it's the only
// place that needs this style in the CRM card grid.
function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!then || Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 0) return null;
  return days;
}

function touchedLabel(days) {
  if (days == null) return null;
  if (days === 0) return "Touched today";
  if (days === 1) return "Touched yesterday";
  if (days < 30) return `Touched ${days} days ago`;
  if (days < 365) return `Touched ${Math.floor(days / 30)}mo ago`;
  return `Touched ${Math.floor(days / 365)}y ago`;
}

// Epic 2 Sprint 8 (E2-67): Rs 4,80,000 style Indian formatting so the
// outstanding pill reads the way an Indian owner writes numbers.
function formatIndianCurrency(n) {
  if (n == null || Number.isNaN(n)) return null;
  if (n < 1) return null; // hide sub-rupee noise
  const rounded = Math.round(n);
  if (rounded < 1000) return `Rs ${rounded}`;
  // Indian grouping: last three digits, then pairs.
  const s = String(rounded);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `Rs ${grouped},${last3}`;
}

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
  const blank = { type: defaultType || "customer", name: "", company: "", phone: "", email: "", address: "", tax_id: "", tags: "", status: "lead", assigned_id: "", notes: "", birthday: "", lifecycle_stage: "" };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openChange = (o) => {
    setOpen(o);
    if (o) {
      setForm(initial
        ? { ...initial, tags: (initial.tags || []).join(", "), assigned_id: initial.assigned_id || "", company: initial.company || "", phone: initial.phone || "", email: initial.email || "", address: initial.address || "", tax_id: initial.tax_id || "", notes: initial.notes || "", birthday: initial.birthday || "", lifecycle_stage: initial.lifecycle_stage || "" }
        : { ...blank, type: defaultType || "customer" });
    }
  };

  // E2-03: reset stage when type changes so we never end up with a
  // 'churned' supplier (invalid combo).
  const changeType = (e) => {
    const t = e.target.value;
    const valid = new Set(stagesForType(t).map((s) => s.key));
    setForm((f) => ({ ...f, type: t, lifecycle_stage: valid.has(f.lifecycle_stage) ? f.lifecycle_stage : "" }));
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    const payload = {
      type: form.type, name: form.name, company: form.company, phone: form.phone, email: form.email,
      address: form.address, tax_id: form.tax_id, status: form.status,
      assigned_id: form.assigned_id || null, notes: form.notes, birthday: form.birthday,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      lifecycle_stage: form.lifecycle_stage || "",  // E2-03
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
          <select className={inp} value={form.type} onChange={changeType} data-testid="crm-contact-type">
            {["customer", "dealer", "vendor"].map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <select className={inp} value={form.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* E2-03: lifecycle_stage select. Options change with type. */}
          <select
            className={`${inp} col-span-2`}
            value={form.lifecycle_stage || ""}
            onChange={set("lifecycle_stage")}
            data-testid="crm-contact-lifecycle"
          >
            <option value="">Lifecycle stage — unset</option>
            {stagesForType(form.type).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
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
  // MPWA-10: rebuilt below lg (§8); desktop tree untouched.
  const isMobile = useIsMobile();
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const L = lex(tenant);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Epic 2 Sprint 6.5 (E2-52): `?complaint=open` deep-link from the
  // Desk Trends card 'Complaints' row lands here with the complaints
  // filter chip pre-selected.
  const [searchParams] = useSearchParams();
  const complaintParam = searchParams.get("complaint");

  const [scope, setScope] = useState(complaintParam === "open" ? "complaints" : "all"); // all | customers | suppliers | mine | complaints
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  // Epic 2 Sprint 8 (E2-70): sort state persists via URL param so a
  // deep-link to /crm?sort=outstanding lands on the same view.
  const [sort, setSort] = useState(searchParams.get("sort") || "name");

  const canManage = user?.role === "owner" || user?.role === "sales";
  const can360 = hasPerm(user, "finance");

  const { data, isLoading } = useQuery({
    queryKey: ["crm-contacts", status, q],
    queryFn: () => api.get(`/contacts?type=&status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data),
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  // Epic 2 Sprint 6.5 (E2-52) + Sprint 8 (E2-69): always fetch open
  // complaints so we can (a) filter to 'With complaints', (b) render
  // the red complaint dot on any card with N>=1 open complaints.
  const { data: openComplaints } = useQuery({
    queryKey: ["complaints-open"],
    queryFn: () => api.get("/complaints?status=open").then((r) => r.data),
  });
  // Epic 2 Sprint 8 (E2-67): per-contact outstanding totals for the
  // Rs pill on each card. Server aggregates so we don't ship every
  // invoice to the client.
  const { data: outstandingMap } = useQuery({
    queryKey: ["crm-outstanding"],
    queryFn: () => api.get("/crm/outstanding").then((r) => r.data),
    staleTime: 30_000,  // this doesn't change second-to-second
  });

  // Epic 2 Sprint 8 (E2-69): {contact_id: N open complaints}
  const complaintCountByContact = useMemo(() => {
    const map = {};
    (openComplaints || []).forEach((c) => {
      if (c.customer_id) map[c.customer_id] = (map[c.customer_id] || 0) + 1;
    });
    return map;
  }, [openComplaints]);

  useEffect(() => {
    if (complaintParam === "open") setScope("complaints");
  }, [complaintParam]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-contacts"] });

  // Epic 2 Sprint 8 (E2-72): bulk CSV/XLSX import for contacts. The
  // extraction pipeline is already wired end-to-end -- POST /ingest/csv
  // runs the AI mapper, creates an `ingestion` in status='review', and
  // auto-adds it to the inbox. All we do here is give founders a fast
  // entry point from CRM and drop them at the existing Review UI.
  const canImport = hasPerm(user, "data_input");
  const csvInputRef = useRef(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const onCsvChosen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";  // let the user re-pick the same file later
    setCsvBusy(true);
    const label = toast.loading(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: ing } = await api.post("/ingest/csv", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const rows = ing.row_count ?? 0;
      const detected = (ing.records?.contacts || []).length;
      toast.success(
        `${rows} row${rows === 1 ? "" : "s"} read${detected ? ` · ${detected} contact${detected === 1 ? "" : "s"} detected` : ""} — opening Inbox for review`,
        { id: label }
      );
      navigate("/finance?tab=inbox");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not read the file", { id: label });
    } finally {
      setCsvBusy(false);
    }
  };

  // Epic 2 Sprint 8 (E2-68): per-scope counts for the chip labels.
  // Computed off the FULL list (not scope-filtered) so numbers match
  // however the founder is currently filtered.
  const scopeCounts = useMemo(() => {
    const list = data || [];
    return {
      all: list.length,
      customers: list.filter((c) => CUSTOMER_TYPES.includes(c.type)).length,
      suppliers: list.filter((c) => VENDOR_TYPES.includes(c.type)).length,
      mine: list.filter((c) => c.assigned_id === user?.id).length,
      complaints: (openComplaints || []).filter((c) => c.customer_id).length,
    };
  }, [data, user?.id, openComplaints]);

  const contacts = useMemo(() => {
    let list = data || [];
    if (scope === "customers") list = list.filter((c) => CUSTOMER_TYPES.includes(c.type));
    else if (scope === "suppliers") list = list.filter((c) => VENDOR_TYPES.includes(c.type));
    else if (scope === "mine") list = list.filter((c) => c.assigned_id === user?.id);
    else if (scope === "complaints") {
      const cids = new Set((openComplaints || []).map((c) => c.customer_id).filter(Boolean));
      list = list.filter((c) => cids.has(c.id));
    }
    // Epic 2 Sprint 8 (E2-70): sort AFTER filter so the user sees
    // the biggest debtor (say) inside the current scope.
    const outMap = outstandingMap || {};
    const sorted = [...list];
    if (sort === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sort === "recent") {
      sorted.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    } else if (sort === "outstanding") {
      sorted.sort((a, b) => {
        const oa = outMap[a.id] || {};
        const ob = outMap[b.id] || {};
        const va = (oa.receivables || 0) + (oa.payables || 0);
        const vb = (ob.receivables || 0) + (ob.payables || 0);
        return vb - va;
      });
    } else if (sort === "touched") {
      // Oldest first -- these are the relationships going cold.
      sorted.sort((a, b) => String(a.updated_at || a.created_at || "")
        .localeCompare(String(b.updated_at || b.created_at || "")));
    }
    return sorted;
  }, [data, scope, user?.id, openComplaints, sort, outstandingMap]);

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

  // Epic 2 Sprint 8 (E2-68): every chip label carries its live count so
  // the founder scans "Customers 12 / Suppliers 8 / With Complaints 3"
  // without opening each chip to check.
  const SCOPES = [
    { key: "all", label: t("crm.all"), icon: UsersFour, count: scopeCounts.all },
    { key: "customers", label: L.customer_plural, icon: AddressBook, count: scopeCounts.customers },
    { key: "suppliers", label: L.vendor_plural, icon: Truck, count: scopeCounts.suppliers },
    { key: "mine", label: t("crm.mine"), icon: null, count: scopeCounts.mine },
    { key: "complaints", label: "With Complaints", icon: WarningIcon, count: scopeCounts.complaints },
  ];

  if (isMobile) return <CRMMobile />;

  return (
    <div>
      <PageHeader
        eyebrow={t("crm.eyebrow", { customers: L.customer_plural.toLowerCase(), suppliers: L.vendor_plural.toLowerCase() })}
        title={t("crm.title")}
      >
        {(canManage || canImport) && (
          <div className="flex flex-wrap gap-2">
            {canManage && (
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
            )}
            {canManage && (
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
            )}
            {/* E2-72: bulk CSV / XLSX import. Perm gate matches the
                backend endpoint (data_input) so we don't surface a
                button that would 403. */}
            {canImport && (
              <>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={onCsvChosen}
                  className="hidden"
                  data-testid="crm-import-csv-input"
                />
                <button
                  onClick={() => csvInputRef.current?.click()}
                  disabled={csvBusy}
                  data-testid="crm-import-csv"
                  title="Bulk-import contacts from CSV or Excel. The AI reads the columns; you review + file in the Finance inbox."
                  className="flex items-center gap-2 bg-white text-black px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50"
                >
                  <UploadSimple size={16} weight="bold" /> {csvBusy ? "Uploading…" : "Import CSV"}
                </button>
              </>
            )}
          </div>
        )}
      </PageHeader>

      {/* Filter chips + search + sort */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <div className="flex border border-black overflow-x-auto" data-testid="crm-scope-chips">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              data-testid={`crm-scope-${s.key}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border-r border-black last:border-r-0 transition-colors ${scope === s.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}
            >
              {s.icon && <s.icon size={16} weight="bold" />}
              <span>{s.label}</span>
              {/* E2-68: live count per chip -- always render (0 is signal too) */}
              <span
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                  scope === s.key ? "bg-white/20 text-white" : "bg-black/10 text-black"
                }`}
                data-testid={`crm-scope-count-${s.key}`}
              >
                {s.count}
              </span>
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
        {/* E2-70: sort dropdown. Default = name A-Z. */}
        <div className="flex items-center border border-black bg-white px-3">
          <ArrowsDownUp size={16} weight="bold" className="text-muted-foreground" />
          <select
            data-testid="crm-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="py-2 px-2 text-sm font-mono focus:outline-none bg-transparent"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Card grid */}
      {/* E2-14: skeleton while first page loads so the header/chips
          don't jump when data lands. */}
      {isLoading && !data && <SkeletonGrid count={6} lines={3} />}
      {/* E2-13: empty state carries a specific CTA a fresh tenant can act on. */}
      {!isLoading && contacts.length === 0 && (
        <EmptyState
          testid="crm-empty"
          title={t("crm.empty_title")}
          hint={canManage ? t("crm.empty_hint_manage") : t("crm.empty_hint")}
          ctaLabel={canManage ? `+ Add your first ${L.customer_singular.toLowerCase()}` : null}
          onCta={canManage ? () => document.querySelector('[data-testid="crm-add-customer"]')?.click() : null}
          secondary={canImport ? "or click Import CSV to bulk-add" : null}
        />
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {contacts.map((c) => {
          const isCustomer = CUSTOMER_TYPES.includes(c.type);
          // Epic 2 Sprint 8 (E2-67 / E2-69 / E2-71): per-card derived data.
          const outstanding = outstandingMap?.[c.id];
          const receivablesTxt = formatIndianCurrency(outstanding?.receivables || 0);
          const payablesTxt = formatIndianCurrency(outstanding?.payables || 0);
          const complaintCount = complaintCountByContact[c.id] || 0;
          const touched = touchedLabel(daysSince(c.updated_at || c.created_at));
          return (
            <div
              key={c.id}
              data-testid={`crm-card-${c.id}`}
              className="card-brutal p-5 shadow-hover cursor-pointer relative"
              onClick={() => can360 && navigate(`/contacts/${c.id}`)}
            >
              {/* E2-69: red dot when this customer has open complaints. */}
              {complaintCount > 0 && (
                <div
                  data-testid={`crm-complaint-dot-${c.id}`}
                  title={`${complaintCount} open complaint${complaintCount === 1 ? "" : "s"}`}
                  className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 flex items-center justify-center bg-brand-red text-white text-[11px] font-bold border border-black shadow-brutal-sm"
                >
                  {complaintCount}
                </div>
              )}
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
                  {/* E2-03: lifecycle stage chip. Only renders when set. */}
                  {stageMeta(c.type, c.lifecycle_stage) && (
                    <Chip
                      value={stageMeta(c.type, c.lifecycle_stage).label}
                      className={stageMeta(c.type, c.lifecycle_stage).cls}
                      data-testid={`crm-stage-${c.id}`}
                    />
                  )}
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
              {/* E2-67: outstanding pill. Only renders when there's an
                  actual number to show -- keeps healthy cards clean. */}
              {(receivablesTxt || payablesTxt) && (
                <div className="mt-3 flex flex-wrap items-center gap-2" data-testid={`crm-outstanding-${c.id}`}>
                  {receivablesTxt && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-1 border border-black bg-brand-red/10 text-brand-red text-xs font-mono font-bold"
                      title="They owe you (unpaid customer invoices)"
                    >
                      <CurrencyInr size={12} weight="bold" /> {receivablesTxt} owed
                    </span>
                  )}
                  {payablesTxt && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-1 border border-black bg-brand-yellow/40 text-black text-xs font-mono font-bold"
                      title="You owe them (unpaid supplier bills)"
                    >
                      <CurrencyInr size={12} weight="bold" /> {payablesTxt} to pay
                    </span>
                  )}
                  {outstanding?.oldest_days != null && outstanding.oldest_days > 30 && (
                    <span className="text-[11px] text-brand-red font-mono">
                      · oldest {outstanding.oldest_days}d
                    </span>
                  )}
                </div>
              )}
              {/* E2-71: last-touched hint so relationships going cold surface. */}
              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                {c.assigned_id && users && (
                  <span>Owner: {users.find((u) => u.id === c.assigned_id)?.name || "—"}</span>
                )}
                {touched && (
                  <span
                    className="flex items-center gap-1 font-mono normal-case tracking-normal"
                    data-testid={`crm-touched-${c.id}`}
                  >
                    <Clock size={12} weight="bold" /> {touched}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
