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
import { toast } from "sonner";
import {
  Plus, MagnifyingGlass, PencilSimple, Trash, Phone, EnvelopeSimple,
  MapPin, Eye, AddressBook, Truck, UsersFour, Warning as WarningIcon,
  ArrowsDownUp, CurrencyInr, Clock, UploadSimple,
  SlidersHorizontal,  // KR-14.14 · mobile filter icon
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";

const CUSTOMER_TYPES = ["customer", "dealer"];
const VENDOR_TYPES = ["vendor"];
const STATUSES = ["lead", "active", "inactive"];

// Epic 2 Sprint 1 (E2-03): lifecycle stages. Enum differs by contact
// type -- customers travel a sales funnel; suppliers travel a
// procurement journey. Colours below are the visual cue on the card
// so founder can spot at-risk / on-hold instantly.
// RD-3 (2026-08-17): lifecycle chips re-tinted onto the semantic ramp.
// Was a mix of black/10, black/30-on-white, brand-blue/20, brand-green/20
// and solid brand-yellow — five different colour systems in two arrays, and
// `brand-green` is not even a defined token (it rendered as nothing).
// Now every stage is a tint + darker-text pair, and colour tracks meaning:
// neutral for "not started", success for healthy, danger for at-risk,
// caution for on-hold, muted-strikethrough-adjacent for ended.
const CUSTOMER_STAGES = [
  { key: "lead", label: "Lead", cls: "bg-nm-sunken text-muted-foreground" },
  { key: "qualified", label: "Qualified", cls: "border-[0.5px] border-kr-ink text-foreground" },
  { key: "active", label: "Active", cls: "bg-kr-ink text-white" },
  { key: "at_risk", label: "At Risk", cls: "border-[0.5px] border-kr-accent text-kr-accent" },
  { key: "churned", label: "Churned", cls: "bg-nm-sunken text-muted-foreground" },
];
const SUPPLIER_STAGES = [
  { key: "prospect", label: "Prospect", cls: "bg-nm-sunken text-muted-foreground" },
  { key: "active", label: "Active", cls: "bg-kr-ink text-white" },
  { key: "preferred", label: "Preferred", cls: "border-[0.5px] border-kr-ink text-foreground" },
  { key: "on_hold", label: "On Hold", cls: "border-[0.5px] border-kr-ink/55 text-foreground/70" },
  { key: "retired", label: "Retired", cls: "bg-nm-sunken text-muted-foreground" },
];
function stagesForType(t) {
  if (VENDOR_TYPES.includes(t)) return SUPPLIER_STAGES;
  return CUSTOMER_STAGES;
}
function stageMeta(type, stage) {
  if (!stage) return null;
  return stagesForType(type).find((s) => s.key === stage) || null;
}
// RD-3: form inputs lose the mono face and the hard frame. Mono in a text
// field made every form read as a config file; the reference uses the UI
// grotesque in inputs and reserves mono for rendered data.
const inp = "w-full nm-field px-3 py-2 text-sm";

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
        <button data-testid={`crm-log-complaint-${contact.id}`} title="Log complaint" className="w-8 h-8 flex items-center justify-center nm-btn text-muted-foreground transition-shadow hover:text-foreground">!</button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40">
        <DialogHeader><DialogTitle className="font-display text-xl">Log complaint — {contact.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <textarea data-testid="crm-complaint-text" className={inp} rows={3} placeholder="What went wrong?" value={text} onChange={(e) => setText(e.target.value)} />
          <select className={inp} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {["low", "medium", "high"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <DialogFooter>
          <button data-testid="crm-complaint-save" onClick={save} className="kr-lift rounded-pill bg-kr-ink px-5 py-2.5 text-sm font-medium text-white">Log complaint</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// U7-07 (2026-08-17): dialog polished for the "add contact" flow.
// Was: 10 fields in a raw 2-col grid, `type` and `status` selects
// on top, name buried in row 4. Now: segmented Type control (only
// on new), name auto-focused, sectioned layout (Identity → Contact
// → Classification), and everything the owner rarely fills on
// first-touch (GSTIN, address, tags, owner, notes) hidden behind
// a "More details" toggle. Editing an existing contact expands the
// advanced section by default so nothing looks missing.
function CrmContactDialog({ trigger, initial, onSaved, users, defaultType }) {
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const blank = { type: defaultType || "customer", name: "", company: "", phone: "", email: "", address: "", tax_id: "", tags: "", status: "lead", assigned_id: "", notes: "", birthday: "", lifecycle_stage: "" };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openChange = (o) => {
    setOpen(o);
    if (o) {
      setForm(initial
        ? { ...initial, tags: (initial.tags || []).join(", "), assigned_id: initial.assigned_id || "", company: initial.company || "", phone: initial.phone || "", email: initial.email || "", address: initial.address || "", tax_id: initial.tax_id || "", notes: initial.notes || "", birthday: initial.birthday || "", lifecycle_stage: initial.lifecycle_stage || "" }
        : { ...blank, type: defaultType || "customer" });
      // Expand advanced when editing (details may already exist);
      // collapse when creating fresh (name + phone is enough to start).
      setShowAdvanced(!!initial);
    }
  };

  // E2-03: reset stage when type changes so we never end up with a
  // 'churned' supplier (invalid combo).
  const applyType = (t) => {
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

  const TYPE_TABS = [
    { key: "customer", label: typeLabel("customer") },
    { key: "dealer", label: typeLabel("dealer") },
    { key: "vendor", label: typeLabel("vendor") },
  ];

  const dialogTitle = initial
    ? `Edit ${initial.name}`
    : `New ${typeLabel(form.type).toLowerCase()}`;

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-w-xl" data-testid="crm-contact-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Type — segmented control; only shown when creating. Editing
              locks the type since changing it silently resets lifecycle. */}
          {!initial && (
            <div>
              <p className="label-mono text-muted-foreground mb-2">Type</p>
              <div className="flex nm-tile" data-testid="crm-contact-type">
                {TYPE_TABS.map((tab, i) => {
                  const active = form.type === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => applyType(tab.key)}
                      data-testid={`crm-contact-type-${tab.key}`}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        active ? "bg-kr-ink text-white" : "nm-btn"
                      } ${i < TYPE_TABS.length - 1 ? "border-r border-nm-edge/40" : ""}`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Identity */}
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">Identity</p>
            <input
              className={inp}
              placeholder="Name *"
              value={form.name}
              onChange={set("name")}
              data-testid="crm-contact-name"
              autoFocus
            />
            <input
              className={inp}
              placeholder="Company (optional)"
              value={form.company}
              onChange={set("company")}
            />
          </div>

          {/* Contact */}
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">Contact</p>
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Phone" value={form.phone} onChange={set("phone")} />
              <input className={inp} placeholder="Email" value={form.email} onChange={set("email")} />
            </div>
          </div>

          {/* Classification: status + lifecycle stage */}
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">Classification</p>
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={form.status} onChange={set("status")}>
                {STATUSES.map((s) => <option key={s} value={s}>Status · {s}</option>)}
              </select>
              <select
                className={inp}
                value={form.lifecycle_stage || ""}
                onChange={set("lifecycle_stage")}
                data-testid="crm-contact-lifecycle"
              >
                <option value="">Stage · unset</option>
                {stagesForType(form.type).map((s) => (
                  <option key={s.key} value={s.key}>Stage · {s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Advanced — collapsed by default when creating */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
              data-testid="crm-contact-advanced-toggle"
            >
              <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>▸</span>
              More details {showAdvanced ? "" : "· GSTIN, address, tags, owner, notes"}
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-2 pl-2 border-l-2 border-nm-edge/40">
                <input className={inp} placeholder="GSTIN / Tax ID" value={form.tax_id} onChange={set("tax_id")} />
                <input className={inp} placeholder="Address" value={form.address} onChange={set("address")} />
                <input className={inp} placeholder="Tags (comma separated)" value={form.tags} onChange={set("tags")} />
                {users && users.length > 0 && (
                  <select className={inp} value={form.assigned_id} onChange={set("assigned_id")}>
                    <option value="">Owner — unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>Owner · {u.name}</option>)}
                  </select>
                )}
                <textarea className={inp} rows={2} placeholder="Notes" value={form.notes} onChange={set("notes")} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            data-testid="crm-contact-save"
            className="kr-lift rounded-pill bg-kr-ink px-5 py-2.5 text-sm font-medium text-white transition-all"
          >
            {initial ? "Save changes" : "Add contact"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// U7-07 (2026-08-17): dropdown menu for the "+ Add contact" pill.
// Was: <details>/<summary> with cramped `label-mono` subtitles that
// read as jumbled uppercase labels ("BUYER / RETAIL, ACCOUNT / DEALER").
// Now: proper controlled menu with icons per option, wider (300px),
// normal-case helper text, subtle hover, and a divider before Import
// to separate "create new" from "bulk import". Closes via a full-
// viewport backdrop click, Escape, and after any option is picked.
// Backdrop pattern (not document.mousedown) avoids a race with React
// 18 Strict Mode's dev-only double-invocation of effect setup, which
// was closing the menu on the same click that opened it.
function AddContactMenu({ canManage, canImport, csvBusy, onImport, customerLabel, vendorLabel }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = (fn) => () => {
    setOpen(false);
    // Give React a tick to unmount the popover before we click the
    // hidden dialog trigger — avoids the Radix focus-scope colliding
    // with our closing menu.
    setTimeout(fn, 0);
  };

  return (
    <div className="relative" data-testid="crm-add-menu">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="kr-lift relative z-40 flex items-center gap-2 rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-semibold text-white transition-all"
      >
        <Plus size={16} weight="bold" /> Add contact
        <span className={`text-white/70 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <>
          {/* Backdrop — catches any outside click and closes the menu.
              Fully transparent, sits below the menu (z-30) and below
              the toggle (z-40) so re-clicking the toggle also closes. */}
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="kr-bento absolute left-0 top-full z-30 mt-2 min-w-[300px] p-1"
          >
          {canManage && (
            <button
              type="button"
              role="menuitem"
              onClick={pick(() => document.querySelector('[data-testid="crm-add-customer"]')?.click())}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-accent border-b border-nm-edge/40 transition-colors"
            >
              <div className="w-9 h-9 flex items-center justify-center nm-inset text-primary shrink-0">
                <AddressBook size={16} weight="bold" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm leading-tight">New {customerLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Buyer, retail account, or dealer</p>
              </div>
            </button>
          )}
          {canManage && (
            <button
              type="button"
              role="menuitem"
              onClick={pick(() => document.querySelector('[data-testid="crm-add-supplier"]')?.click())}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-accent transition-colors ${canImport ? "border-b border-nm-edge/40" : ""}`}
            >
              <div className="w-9 h-9 flex items-center justify-center nm-inset text-foreground shrink-0">
                <Truck size={16} weight="bold" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm leading-tight">New {vendorLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Supplier, vendor, or raw-material source</p>
              </div>
            </button>
          )}
          {canImport && (
            <button
              type="button"
              role="menuitem"
              onClick={pick(onImport)}
              disabled={csvBusy}
              data-testid="crm-import-csv"
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <div className="w-9 h-9 flex items-center justify-center nm-inset text-foreground shrink-0">
                <UploadSimple size={16} weight="bold" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm leading-tight">{csvBusy ? "Uploading…" : "Import from spreadsheet"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Bulk-add via CSV or Excel</p>
              </div>
            </button>
          )}
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main CRM page
// -----------------------------------------------------------------------------
export default function CRM() {
  // MPWA-10: rebuilt below lg (§8); desktop tree untouched.
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const L = lex(tenant);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // U7-07 (2026-08-17): scope simplified to Buyers | Suppliers only.
  // Founder ask: 'remove all section, just Buyer / suppliers enough'.
  // Killed 'all', 'mine', 'complaints' scopes. Complaints visible via
  // the red pill on each card (already shipped in Batch 1) so users
  // still spot them without a dedicated tab. Default scope = customers
  // (buyers) since that's the primary business focus for most tenants.
  const [searchParams] = useSearchParams();

  const [scope, setScope] = useState("customers"); // customers | suppliers
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

  // U7-07: was a useEffect that force-flipped scope to 'complaints' when
  // Desk Trends deep-linked here with ?complaint=open. Complaints scope
  // no longer exists; the red pill on each card is the visual signal
  // (already shipped in Batch 1). Deep-link kept working -- lands on
  // Buyers with all cards visible; users spot the red pills.

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
    // U7-07: only customers/suppliers scopes now. Others removed.
    if (scope === "customers") list = list.filter((c) => CUSTOMER_TYPES.includes(c.type));
    else if (scope === "suppliers") list = list.filter((c) => VENDOR_TYPES.includes(c.type));
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

  // U7-07 (2026-08-17): only 2 scopes -- Buyers, Suppliers. Founder ask:
  // 'remove all section, just Buyer / suppliers enough'. Counts still
  // shown next to labels for one-glance scan. Complaints visible via
  // the red pill on each card (Batch 1); no dedicated scope for it.
  const SCOPES = [
    { key: "customers", label: L.customer_plural, icon: AddressBook, count: scopeCounts.customers },
    { key: "suppliers", label: L.vendor_plural, icon: Truck, count: scopeCounts.suppliers },
  ];


  return (
    <div>
      <header className="mb-5 flex flex-col gap-4 lg:mb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          {/* KR-14.14 — eyebrow is hidden on mobile per the reference. */}
          <p className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:block">{t("crm.eyebrow", { customers: L.customer_plural.toLowerCase(), suppliers: L.vendor_plural.toLowerCase() })}</p>
          <h1 className="font-display text-3xl sm:text-4xl lg:mt-1.5">{t("crm.title")}</h1>
        </div>
        {/* U7-07 (2026-08-17): three equal-weight header CTAs (Add
            Buyer / Add Supplier / Import CSV) collapsed to ONE primary
            "+ Add contact" with a small popover menu. Founder ask:
            HRM-minimalism -- one primary action, secondary paths tucked.
            Hidden input for CSV lives once at the page root and is
            triggered from the menu item. */}
        {(canManage || canImport) && (
          <div className="flex items-center gap-2">
            {canImport && (
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={onCsvChosen}
                className="hidden"
                data-testid="crm-import-csv-input"
              />
            )}
            <CrmContactDialog
              users={users}
              defaultType="customer"
              onSaved={refresh}
              trigger={
                <button data-testid="crm-add-customer" className="hidden" aria-hidden="true" />
              }
            />
            <CrmContactDialog
              users={users}
              defaultType="vendor"
              onSaved={refresh}
              trigger={
                <button data-testid="crm-add-supplier" className="hidden" aria-hidden="true" />
              }
            />
            <AddContactMenu
              canManage={canManage}
              canImport={canImport}
              csvBusy={csvBusy}
              onImport={() => csvInputRef.current?.click()}
              customerLabel={L.customer_singular}
              vendorLabel={L.vendor_singular}
            />
          </div>
        )}
      </header>

      {/* KR-14.14 · MOBILE — full-width search + sliders filter circle
          (opens a dropdown with the status/sort selects). Followed by a
          segmented [Buyers | Suppliers] pill. Hidden from lg up where the
          desktop layout below takes over. */}
      <div className="mb-4 flex items-center gap-2 lg:hidden">
        <div className="relative flex-1">
          <MagnifyingGlass size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            data-testid="crm-search-mobile"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("crm.search_ph")}
            className="h-11 w-full rounded-pill border border-nm-edge/40 bg-white/70 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-kr-ink/20"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="crm-mobile-filter"
              aria-label={t("crm.filter", "Filter")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
              <SlidersHorizontal size={18} weight="regular" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="min-w-[13rem]">
            <DropdownMenuLabel>{t("crm.all_statuses")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setStatus("")}
              className={`justify-between ${status === "" ? "font-medium" : ""}`}>
              <span>{t("crm.all_statuses")}</span>
            </DropdownMenuItem>
            {STATUSES.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => setStatus(s)}
                className={`justify-between capitalize ${status === s ? "font-medium" : ""}`}>
                <span>{s}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort</DropdownMenuLabel>
            {SORT_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.key} onSelect={() => setSort(o.key)}
                className={`justify-between ${sort === o.key ? "font-medium" : ""}`}>
                <span>{o.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* KR-14.14 · MOBILE — Buyers | Suppliers as a single segmented pill,
          the active half filled ink. Hidden from lg up. */}
      {/* KM-5 — Buyers | Suppliers as a neumorphic segmented bar. Was a
          welded pair of hairline pills with a solid ink fill on the active
          one; every other page-level "pick one of these two" control in the
          app is now a .kr-pressed track with a raised .kr-pop segment, and
          this was the last one still painting selection as a fill.
          No transition utility — the segments swap between an outset and an
          inset shadow pair, which do not interpolate. */}
      <div className="kr-pressed mb-4 flex items-center gap-1 rounded-pill p-1 lg:hidden"
           role="group" aria-label="Contact type" data-testid="crm-scope-mobile">
        {SCOPES.map((s) => {
          const active = scope === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setScope(s.key)}
              aria-pressed={active}
              data-testid={`crm-scope-mobile-${s.key}`}
              className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-pill text-sm ${
                active ? "kr-pop font-semibold text-foreground" : "text-foreground/60"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* U7-07 (2026-08-17): HRM-style segmented tabs -- Buyers | Suppliers.
          KR-14.14 — DESKTOP ONLY (hidden below lg); the mobile scope pill
          above renders the same choice. */}
      <div className="mb-5 hidden lg:block" data-testid="crm-scope-chips">
        <div className="flex border-b border-nm-edge/40">
          {SCOPES.map((s) => {
            const active = scope === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                data-testid={`crm-scope-${s.key}`}
                className={`flex h-9 items-center gap-2 rounded-pill border-[0.5px] px-4 text-sm ${active ? "border-kr-ink font-medium text-foreground" : "border-kr-ink/55 text-foreground/65 hover:text-foreground/85"}`}
              >
                {s.icon && <s.icon size={16} weight={active ? "fill" : "regular"} />}
                <span>{s.label}</span>
                <span
                  className="min-w-[18px] rounded-pill px-1 py-0.5 text-center font-mono text-[11px] tabular-nums opacity-65"
                  data-testid={`crm-scope-count-${s.key}`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter strip — DESKTOP ONLY (hidden below lg). Mobile uses the
          search-and-sliders row above. */}
      <div className="mb-5 hidden flex-wrap items-center gap-2 lg:flex">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            data-testid="crm-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("crm.search_ph")}
            className="nm-field w-full py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          data-testid="crm-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="nm-field px-3 py-2 text-sm capitalize"
        >
          <option value="">{t("crm.all_statuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="nm-field flex items-center pl-3">
          <ArrowsDownUp size={14} className="text-muted-foreground" />
          <select
            data-testid="crm-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="py-2 pl-2 pr-3 text-sm focus:outline-none bg-transparent"
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
        {contacts.map((c) => {
          const isCustomer = CUSTOMER_TYPES.includes(c.type);
          // Epic 2 Sprint 8 (E2-67 / E2-69 / E2-71): per-card derived data.
          const outstanding = outstandingMap?.[c.id];
          const receivablesTxt = formatIndianCurrency(outstanding?.receivables || 0);
          const payablesTxt = formatIndianCurrency(outstanding?.payables || 0);
          const complaintCount = complaintCountByContact[c.id] || 0;
          const touched = touchedLabel(daysSince(c.updated_at || c.created_at));
          // U7-07 (2026-08-17): card density fix. Was 11+ elements per card
          // (5 chips + 4 action icons + 3 contact lines + owner + outstanding
          // + touched + red badge). Now: name + one type chip + status dot
          // + one key signal + touched. Chip row max 2 (type + lifecycle).
          // Contact info + tags + all actions move to the profile page --
          // card face is scan-only. Whole card click goes to profile
          // (kills redundant 360° icon). Owner is a subtle line at bottom.
          // Lexicon-consistent: uses L.customer_singular / L.vendor_singular
          // so "BUYER"/"SUPPLIER" matches the tenant lexicon on both the
          // scope chip and the card.
          // RD-3: the .toUpperCase() was baked into the DATA, not the CSS, so
          // the chip stayed shouting after the stylesheet went sentence case.
          // Lexicon values arrive already capitalised ("Buyer" / "Supplier").
          const typeChipLabel = isCustomer
            ? L.customer_singular
            : L.vendor_singular;
          const stage = stageMeta(c.type, c.lifecycle_stage);
          const statusDot =
            c.status === "active" ? "bg-foreground/70"
            : c.status === "lead" ? "bg-foreground/35"
            : "bg-neutral-400";
          const ownerName = c.assigned_id && users
            ? users.find((u) => u.id === c.assigned_id)?.name
            : null;
          const isOverdue = outstanding?.oldest_days != null && outstanding.oldest_days > 30;

          // The card's one "key signal" -- pick the most urgent piece of
          // information to surface, don't stack them all.
          let keySignal = null;
          if (complaintCount > 0) {
            keySignal = {
              icon: WarningIcon,
              text: `${complaintCount} open complaint${complaintCount === 1 ? "" : "s"}`,
              tone: "text-kr-accent",
            };
          } else if (receivablesTxt) {
            keySignal = {
              icon: CurrencyInr,
              text: `${receivablesTxt} owed${isOverdue ? ` · oldest ${outstanding.oldest_days}d` : ""}`,
              tone: isOverdue ? "text-kr-accent" : "text-muted-foreground",
            };
          } else if (payablesTxt) {
            keySignal = {
              icon: CurrencyInr,
              text: `${payablesTxt} to pay`,
              tone: "text-muted-foreground",
            };
          }

          return (
            <button
              type="button"
              key={c.id}
              data-testid={`crm-card-${c.id}`}
              onClick={() => can360 && navigate(`/contacts/${c.id}`)}
              disabled={!can360}
              /* RD-3: `flex flex-col` is load-bearing, not cosmetic. A bare
                 <button> centres its content in the box, so in a stretched
                 grid row any card missing the optional key-signal line had
                 its title pushed 16px below its neighbours'. Column flow
                 pins content to the top; the footer then takes mt-auto so
                 every card's meta row also lines up across the row. */
              /* KR-12 — .kr-bento, the same tile My Work's grid and the
                 workflow board are made of: glass wash + backdrop blur,
                 neumorphic raised light, and a real edge so the card reads
                 as separated from the steel-and-gold sky behind it. */
              className="kr-bento flex flex-col p-4 text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/40"
            >
              {/* Header: name + type + subtle status dot. Complaint red
                  dot sits inline next to name -- softer than the floating
                  corner badge that used to hover the card. */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm leading-snug flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`}
                      aria-hidden="true"
                      title={c.status}
                    />
                    <span className="truncate">{c.name}</span>
                    {complaintCount > 0 && (
                      <span
                        data-testid={`crm-complaint-dot-${c.id}`}
                        title={`${complaintCount} open complaint${complaintCount === 1 ? "" : "s"}`}
                        /* RD-3: 16px, not 18px. An 18px badge sits taller
                           than the title's line box and pushed this card's
                           heading ~10px below its neighbours' in the grid. */
                        className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-kr-accent px-1 text-[10px] font-semibold leading-none text-white"
                      >
                        {complaintCount}
                      </span>
                    )}
                  </p>
                  {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                </div>
                {/* KR-14.14 — mobile drops the type + stage chips and shows
                    a chevron instead (reference). Chips return from lg. */}
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground lg:hidden">
                  ›
                </span>
                <div className="hidden shrink-0 items-center gap-1 lg:flex">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${isCustomer ? "border-[0.5px] border-kr-ink/55 text-foreground/70" : "bg-nm-sunken text-muted-foreground"}`}
                    data-testid={`crm-type-chip-${c.id}`}
                  >
                    {typeChipLabel}
                  </span>
                  {stage && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${stage.cls}`}
                      data-testid={`crm-stage-${c.id}`}
                    >
                      {stage.label}
                    </span>
                  )}
                </div>
              </div>

              {/* One-line key signal -- complaints > receivables > payables.
                  Absent when the relationship is healthy, keeps those cards
                  clean. */}
              {keySignal && (
                <p
                  className={`mt-3 flex items-center gap-1.5 text-sm font-medium tabular-nums ${keySignal.tone}`}
                  data-testid={`crm-signal-${c.id}`}
                >
                  <keySignal.icon size={13} weight="bold" />
                  {keySignal.text}
                </p>
              )}

              {/* Footer meta: touched-ago + owner (if any). Small, muted,
                  right-aligned owner. */}
              <div className="mt-auto pt-3 border-t border-nm-edge/40 flex items-center justify-between text-xs text-muted-foreground">
                {touched && (
                  <span className="flex items-center gap-1" data-testid={`crm-touched-${c.id}`}>
                    <Clock size={11} weight="bold" /> {touched}
                  </span>
                )}
                {ownerName && (
                  <span className="truncate ml-2">Owner: {ownerName}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
