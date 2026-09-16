// Epic 2 Sprint A — E2-02 CRM shell. The relationship page at /crm: buyers and
// suppliers (employees moved to /team, E2-01). A card opens the 360° profile
// at /contacts/:id.
//
// 2026-09-14, founder — revamped end to end on the founder's reference (its
// background excluded, and without the cards' ⋮ menus):
//   * a title with one line under it, and the Add contact menu beside it;
//   * one control row — Buyers | Suppliers with counts, search, status, sort,
//     and a grid / list switch;
//   * glass cards: tinted initials, name and company, a type chip, the ONE
//     signal that matters (open complaints, then money owed, then money to
//     pay), when the relationship was last touched and who owns it;
//   * pages of 12 cards (20 rows in the list);
//   * the New buyer / New supplier window on the glass sheet.
// Every dropdown is GlassSelect. The Add contact menu is a Radix menu in a
// portal: the old hand-rolled popover hung off the right-hand button inside
// the frosted sticky header, so it ran off the screen edge and was clipped,
// and its click-away layer covered only the header.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { hasPerm } from "../lib/perms";
import { lex } from "../lib/lexicon";
import { SkeletonGrid, StickyHeader } from "../components/common";
import { inr, money } from "../lib/format";
import api from "../lib/api";
import { toast } from "sonner";
import {
  AddressBook, ArrowsDownUp, CaretDown, CaretLeft, CaretRight, Clock, Coins, CurrencyInr, Funnel,
  ListBullets, MagnifyingGlass, Plus, SquaresFour, Storefront, Truck, UploadSimple, Warning, X,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  CHIP, QUIET_CHIP, DRAWER_FIELD, DRAWER_LABEL, DRAWER_TRACK, GLASS_ICON_BTN,
  GLASS_MENU, GLASS_MENU_ITEM, GLASS_PILL, GLASS_SHEET, INK_PILL,
} from "../components/karma/glass";
import { GlassSelect } from "../components/karma/GlassSelect";
import { cn } from "@/lib/utils";

const CUSTOMER_TYPES = ["customer", "dealer"];
const VENDOR_TYPES = ["vendor"];
const STATUSES = [
  { key: "lead", label: "Lead" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

// E2-03: lifecycle stages. Customers travel a sales funnel, suppliers a
// procurement journey. Each stage is a card chip tone (components/karma/glass
// CHIP): neutral for not started or ended, emerald for healthy, rose for at
// risk, amber for on hold.
const CUSTOMER_STAGES = [
  { key: "lead", label: "Lead", tone: QUIET_CHIP },
  { key: "qualified", label: "Qualified", tone: "bg-sky-50 text-sky-700 ring-sky-100" },
  { key: "active", label: "Active", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  { key: "at_risk", label: "At Risk", tone: "bg-rose-50 text-rose-700 ring-rose-100" },
  { key: "churned", label: "Churned", tone: "bg-stone-100 text-stone-600 ring-stone-200/70" },
];
const SUPPLIER_STAGES = [
  { key: "prospect", label: "Prospect", tone: QUIET_CHIP },
  { key: "active", label: "Active", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  { key: "preferred", label: "Preferred", tone: "bg-violet-50 text-violet-700 ring-violet-100" },
  { key: "on_hold", label: "On Hold", tone: "bg-amber-50 text-amber-800 ring-amber-100" },
  { key: "retired", label: "Retired", tone: "bg-stone-100 text-stone-600 ring-stone-200/70" },
];
const stagesForType = (t) => (VENDOR_TYPES.includes(t) ? SUPPLIER_STAGES : CUSTOMER_STAGES);
const stageMeta = (type, stage) => (stage ? stagesForType(type).find((s) => s.key === stage) || null : null);

// E2-70: sorting. Name by default; newest first; the biggest balance first; or
// the relationships going cold first.
const SORT_OPTIONS = [
  { key: "name", label: "Name A–Z" },
  { key: "recent", label: "Recently added" },
  { key: "outstanding", label: "Outstanding (highest)" },
  { key: "touched", label: "Last touched (oldest)" },
];

const VIEW_KEY = "crm.view";
const PAGE_SIZE = { grid: 12, list: 20 };

// The card and list surface: white glass lifted off the page.
const CARD = "rounded-[1.4rem] bg-white/80 ring-1 ring-inset ring-white shadow-[0_12px_32px_-16px_hsl(230_20%_25%/0.25),0_1px_2px_hsl(230_20%_25%/0.06)] backdrop-blur-xl";
const SHEET = `gap-5 rounded-[1.75rem] p-6 sm:rounded-[1.75rem] [&>button.absolute]:hidden ${GLASS_SHEET}`;
// The New contact window's fields: the drawer's glass field a size down, so
// three sit in a row and the whole window fits a laptop screen unscrolled.
const FIELD = cn(DRAWER_FIELD, "h-11 py-0 text-sm");
const NOTES_FIELD = cn(DRAWER_FIELD, "resize-none py-2.5 text-sm");

// E2-71: "3 days ago" from a UTC ISO string.
function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!then || Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  return days < 0 ? null : days;
}
function touchedLabel(days) {
  if (days == null) return null;
  if (days === 0) return "Touched today";
  if (days === 1) return "Touched yesterday";
  if (days < 30) return `Touched ${days} days ago`;
  if (days < 365) return `Touched ${Math.floor(days / 30)}mo ago`;
  return `Touched ${Math.floor(days / 365)}y ago`;
}

// E2-67: Indian grouping for rupees (₹4,00,000), the tenant's own currency
// otherwise; sub-unit balances are noise and stay hidden.
function formatAmount(n, currency) {
  const v = Number(n);
  if (n == null || Number.isNaN(v) || v < 1) return null;
  return !currency || currency === "INR" ? inr(v) : money(Math.round(v), currency);
}

// A contact's initials on a soft tint picked from their name, so a face keeps
// its colour from visit to visit.
const AVATAR_TINTS = [
  "bg-emerald-100 text-emerald-800", "bg-sky-100 text-sky-800", "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800", "bg-orange-100 text-orange-800", "bg-lime-100 text-lime-800",
  "bg-slate-200 text-slate-700",
];
function tintFor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
function initialsOf(name) {
  const parts = String(name || "").replace(/[_.-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function Initials({ name, small = false }) {
  return (
    <span aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${small ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm"} ${tintFor(name)}`}>
      {initialsOf(name)}
    </span>
  );
}

/* The card's one signal — the most urgent thing about the relationship, never
   a stack of them: open complaints, then money they owe (amber once the oldest
   invoice passes 30 days), then money owed to them. */
const SIGNAL_TONE = {
  danger: "bg-rose-50 text-rose-700 ring-rose-100",
  warn: "bg-orange-50 text-orange-700 ring-orange-100",
  quiet: "bg-slate-500/[0.07] text-slate-600 ring-slate-500/10",
};
function signalFor(complaints, outstanding, currency) {
  if (complaints > 0) {
    return { tone: "danger", icon: Warning, text: `${complaints} open complaint${complaints === 1 ? "" : "s"}` };
  }
  const moneyIcon = !currency || currency === "INR" ? CurrencyInr : Coins;
  const owed = formatAmount(outstanding?.receivables, currency);
  if (owed) {
    const overdue = outstanding?.oldest_days != null && outstanding.oldest_days > 30;
    return overdue
      ? { tone: "warn", icon: Coins, text: `${owed} owed · oldest ${outstanding.oldest_days}d` }
      : { tone: "quiet", icon: moneyIcon, text: `${owed} owed` };
  }
  const due = formatAmount(outstanding?.payables, currency);
  return due ? { tone: "quiet", icon: moneyIcon, text: `${due} to pay` } : null;
}

function SignalPill({ id, signal, compact = false }) {
  const Icon = signal.icon;
  return (
    <p data-testid={`crm-signal-${id}`}
      className={`flex min-w-0 items-center gap-2 rounded-xl font-medium tabular-nums ring-1 ring-inset ${compact ? "px-2.5 py-1.5 text-xs" : "mt-3 px-3 py-2 text-[13px]"} ${SIGNAL_TONE[signal.tone]}`}>
      <Icon size={compact ? 13 : 14} weight="bold" aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{signal.text}</span>
      {!compact && signal.tone !== "quiet" && <CaretRight size={12} weight="bold" aria-hidden="true" className="shrink-0 opacity-70" />}
    </p>
  );
}

function ContactCard({ c, info, onOpen, canOpen }) {
  return (
    <button
      type="button"
      data-testid={`crm-card-${c.id}`}
      onClick={onOpen}
      disabled={!canOpen}
      className={`flex flex-col p-4 text-left sm:min-h-[9.5rem] transition-[transform,box-shadow] duration-200 enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_18px_40px_-18px_hsl(230_20%_25%/0.32),0_1px_2px_hsl(230_20%_25%/0.06)] disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 motion-reduce:transition-none ${CARD}`}
    >
      <div className="flex w-full items-start gap-3">
        <Initials name={c.name} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[15px] font-semibold text-slate-900">{c.name}</p>
          {c.company && <p className="truncate text-xs text-slate-500">{c.company}</p>}
        </div>
        <span data-testid={`crm-type-chip-${c.id}`} className={`mt-0.5 ${CHIP} ${QUIET_CHIP}`}>{info.typeChip}</span>
      </div>
      {info.signal && <SignalPill id={c.id} signal={info.signal} />}
      <div className="mt-auto flex w-full items-center justify-between gap-3 pt-3 text-xs text-slate-500">
        {info.touched ? (
          <span className="flex min-w-0 items-center gap-1.5" data-testid={`crm-touched-${c.id}`}>
            <Clock size={13} aria-hidden="true" className="shrink-0" /> <span className="truncate">{info.touched}</span>
          </span>
        ) : <span />}
        {info.ownerName && <span className="truncate" data-testid={`crm-owner-${c.id}`}>Owner: {info.ownerName}</span>}
      </div>
    </button>
  );
}

// The list's column template, shared by its header and every row.
const LIST_COLS = "lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1.9fr)_minmax(0,1.1fr)_minmax(0,1fr)]";

function ContactRow({ c, info, onOpen, canOpen }) {
  return (
    <li>
      <button
        type="button"
        data-testid={`crm-row-${c.id}`}
        onClick={onOpen}
        disabled={!canOpen}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/80 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 lg:gap-4 ${LIST_COLS}`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Initials name={c.name} small />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900">{c.name}</span>
            {c.company && <span className="block truncate text-xs text-slate-500">{c.company}</span>}
          </span>
        </span>
        <span className="hidden flex-wrap items-center gap-1 lg:flex">
          <span className={`${CHIP} ${QUIET_CHIP}`}>{info.typeChip}</span>
          {info.stage && <span data-testid={`crm-stage-${c.id}`} className={`${CHIP} ${info.stage.tone}`}>{info.stage.label}</span>}
        </span>
        <span className="hidden min-w-0 lg:block">
          {info.signal ? <SignalPill id={c.id} signal={info.signal} compact /> : <span className="text-xs text-slate-400">—</span>}
        </span>
        <span className="hidden truncate text-xs text-slate-600 lg:block">{info.ownerName || "—"}</span>
        <span className="text-right text-xs text-slate-500">{info.touched?.replace(/^Touched /, "") || "—"}</span>
      </button>
    </li>
  );
}

function ViewToggle({ view, onChange }) {
  const options = [["grid", SquaresFour, "Grid view"], ["list", ListBullets, "List view"]];
  return (
    <div role="group" aria-label="Layout" data-testid="crm-view-toggle"
      className={`hidden shrink-0 items-center gap-1 rounded-pill p-1 sm:flex ${DRAWER_TRACK}`}>
      {options.map(([key, Icon, label]) => {
        const on = view === key;
        return (
          <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={on} aria-label={label} title={label}
            data-testid={`crm-view-${key}`}
            className={`grid h-10 w-10 place-items-center rounded-pill transition-colors ${on ? `${GLASS_PILL} text-slate-900` : "text-slate-500 hover:text-slate-800"}`}>
            <Icon size={18} weight={on ? "fill" : "regular"} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function Pager({ page, pages, total, pageSize, onPage }) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => first + i);
  return (
    <nav aria-label="Pages" data-testid="crm-pager" className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500" data-testid="crm-pager-range">{from}–{to} of {total}</p>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"
          data-testid="crm-page-prev" className={GLASS_ICON_BTN}>
          <CaretLeft size={15} weight="bold" aria-hidden="true" />
        </button>
        {numbers.map((n) => (
          <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}
            data-testid={`crm-page-${n}`}
            className={`h-11 min-w-11 rounded-pill px-3 text-sm font-medium tabular-nums transition-colors ${n === page ? INK_PILL : `${GLASS_PILL} text-slate-700 hover:bg-white`}`}>
            {n}
          </button>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"
          data-testid="crm-page-next" className={GLASS_ICON_BTN}>
          <CaretRight size={15} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/* U7-07 — one primary "Add contact" with the ways to add behind it. A Radix
   menu, portalled and collision-aware, aligned to the button's right edge so
   it opens back into the page. Modal, Radix's default: measured here, the
   non-modal mode did not close on an outside click, while the modal one closes
   on an outside click and on Escape. The dialog opens a tick after the menu has
   closed, so the menu handing focus back does not fight the dialog's trap. */
function AddContactMenu({ canManage, canImport, csvBusy, onPick, customerLabel, vendorLabel }) {
  const [open, setOpen] = useState(false);
  const item = (key, Icon, title, hint, testid, disabled = false) => (
    <DropdownMenuItem key={key} disabled={disabled} data-testid={testid} onSelect={() => onPick(key)}
      className={`${GLASS_MENU_ITEM} items-start gap-3 px-3 py-2.5`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900/[0.05] text-slate-700 ring-1 ring-inset ring-slate-900/[0.04]">
        <Icon size={18} weight="regular" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500">{hint}</span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid="crm-add-menu" aria-label="Add contact"
          className={`flex h-11 shrink-0 items-center gap-2 rounded-pill px-3.5 text-sm font-medium sm:h-12 sm:px-5 ${INK_PILL}`}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          <span className="hidden sm:inline">Add contact</span>
          <CaretDown size={12} weight="bold" aria-hidden="true"
            className={`hidden opacity-70 transition-transform duration-200 motion-reduce:transition-none sm:block ${open ? "rotate-180" : ""}`} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12}
        className={`${GLASS_MENU} w-[min(20rem,calc(100vw-1.5rem))] p-1.5`} data-testid="crm-add-menu-list">
        {canManage && item("customer", AddressBook, `New ${customerLabel}`, "A retail account, a regular buyer or a dealer", "crm-add-customer")}
        {canManage && item("vendor", Truck, `New ${vendorLabel}`, "A supplier, vendor or raw-material source", "crm-add-supplier")}
        {canManage && canImport && <DropdownMenuSeparator className="mx-2 my-1 h-px bg-slate-900/[0.06]" />}
        {canImport && item("import", UploadSimple, csvBusy ? "Uploading…" : "Import from spreadsheet", "Bulk-add via CSV or Excel", "crm-import-csv", csvBusy)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TYPE_META = {
  customer: { icon: AddressBook, hint: "Someone who buys from you — a retail account or a regular." },
  dealer: { icon: Storefront, hint: "A dealer or distributor who resells what you sell." },
  vendor: { icon: Truck, hint: "Someone you buy from — a supplier or a raw-material source." },
};
const blankContact = (type) => ({
  type, name: "", company: "", phone: "", email: "", address: "", tax_id: "", tags: "",
  status: "lead", assigned_id: "", notes: "", lifecycle_stage: "",
});

function Field({ label, htmlFor, required = false, wide = false, hint, children }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-slate-600">
          {label}{required && <span className="text-rose-600"> *</span>}
        </label>
      ) : (
        <p className="mb-1.5 text-xs font-medium text-slate-600">{label}</p>
      )}
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function FormSection({ label, children }) {
  return (
    <section>
      <p className={DRAWER_LABEL}>{label}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/* U7-07 → 2026-09-14 — the New buyer / New supplier window on the glass sheet.
   Opened with a type (`type`); the switch inside can still change it, and a
   stage that does not exist for the new type is cleared (E2-03 — never a
   "churned" supplier). Everything shows at once, in sections: who they are,
   how to reach them, where they stand, the rest. */
function CrmContactDialog({ type, onClose, onSaved, users, labels }) {
  const [form, setForm] = useState(() => blankContact(type || "customer"));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (type) setForm(blankContact(type)); }, [type]);

  const set = (key) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [key]: v })); };
  const applyType = (t) => {
    const valid = new Set(stagesForType(t).map((s) => s.key));
    setForm((f) => ({ ...f, type: t, lifecycle_stage: valid.has(f.lifecycle_stage) ? f.lifecycle_stage : "" }));
  };
  const typeName = labels[form.type] || "Contact";
  const Icon = TYPE_META[form.type]?.icon || AddressBook;

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      await api.post("/contacts", {
        type: form.type, name: form.name.trim(), company: form.company, phone: form.phone, email: form.email,
        address: form.address, tax_id: form.tax_id, status: form.status,
        assigned_id: form.assigned_id || null, notes: form.notes, birthday: "",
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        lifecycle_stage: form.lifecycle_stage || "",
      });
      toast.success(`${typeName} added`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!type} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="crm-contact-dialog" className={`max-h-[calc(90dvh/var(--ui-scale,1))] max-w-3xl overflow-y-auto ${SHEET}`}>
        <div className="flex items-start gap-3.5">
          <span aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/85 text-slate-700 ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_6px_16px_-8px_hsl(216_30%_25%/0.35)]">
            <Icon size={22} weight="regular" />
          </span>
          <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
            <DialogTitle className="text-lg font-semibold text-neutral-900">New {typeName.toLowerCase()}</DialogTitle>
            <DialogDescription className="text-sm text-neutral-600">{TYPE_META[form.type]?.hint}</DialogDescription>
          </DialogHeader>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" data-testid="crm-contact-close" className={GLASS_ICON_BTN}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div role="group" aria-label="Contact type" data-testid="crm-contact-type" className={`flex gap-1 rounded-pill p-1 ${DRAWER_TRACK}`}>
          {["customer", "dealer", "vendor"].map((key) => {
            const on = form.type === key;
            const TypeIcon = TYPE_META[key].icon;
            return (
              <button key={key} type="button" onClick={() => applyType(key)} aria-pressed={on} data-testid={`crm-contact-type-${key}`}
                className={`flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-2 text-sm font-medium ${on ? `${GLASS_PILL} text-slate-900` : "text-slate-500 hover:text-slate-800"}`}>
                <TypeIcon size={15} weight={on ? "fill" : "regular"} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{labels[key]}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          <FormSection label="Who they are">
            <Field label="Name" htmlFor="crm-contact-name" required>
              <input id="crm-contact-name" data-testid="crm-contact-name" autoFocus className={FIELD}
                placeholder={form.type === "vendor" ? "e.g. Surat Yarn Mills" : "e.g. Anand Fabrics"} value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Company" htmlFor="crm-contact-company">
              <input id="crm-contact-company" data-testid="crm-contact-company" className={FIELD}
                placeholder="Registered name (optional)" value={form.company} onChange={set("company")} />
            </Field>
            <Field label="Phone" htmlFor="crm-contact-phone">
              <input id="crm-contact-phone" data-testid="crm-contact-phone" type="tel" inputMode="tel" className={FIELD}
                placeholder="+91 98765 43210" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="Email" htmlFor="crm-contact-email">
              <input id="crm-contact-email" data-testid="crm-contact-email" type="email" className={FIELD}
                placeholder="name@company.com" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="GSTIN / Tax ID" htmlFor="crm-contact-tax">
              <input id="crm-contact-tax" data-testid="crm-contact-tax" className={FIELD}
                placeholder="22AAAAA0000A1Z5" value={form.tax_id} onChange={set("tax_id")} />
            </Field>
            <Field label="Tags" htmlFor="crm-contact-tags">
              <input id="crm-contact-tags" data-testid="crm-contact-tags" className={FIELD}
                placeholder="Comma separated, e.g. wholesale" value={form.tags} onChange={set("tags")} />
            </Field>
          </FormSection>

          <FormSection label="Where they stand">
            <Field label="Status">
              <GlassSelect testid="crm-contact-status" ariaLabel="Status" value={form.status} triggerClassName="h-11 text-sm"
                onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                options={STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
            </Field>
            <Field label="Stage">
              <GlassSelect testid="crm-contact-lifecycle" ariaLabel="Lifecycle stage" value={form.lifecycle_stage} triggerClassName="h-11 text-sm"
                onChange={(v) => setForm((f) => ({ ...f, lifecycle_stage: v }))}
                options={[{ value: "", label: "Not set" }, ...stagesForType(form.type).map((s) => ({ value: s.key, label: s.label }))]} />
            </Field>
            {users && users.length > 0 && (
              <Field label="Owner">
                <GlassSelect testid="crm-contact-owner" ariaLabel="Owner" value={form.assigned_id} triggerClassName="h-11 text-sm"
                  onChange={(v) => setForm((f) => ({ ...f, assigned_id: v }))}
                  options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
              </Field>
            )}
          </FormSection>

          <FormSection label="More">
            <Field label="Address" htmlFor="crm-contact-address" wide>
              <input id="crm-contact-address" data-testid="crm-contact-address" className={FIELD}
                placeholder="Street, city, PIN" value={form.address} onChange={set("address")} />
            </Field>
            <Field label="Notes" htmlFor="crm-contact-notes" wide>
              <textarea id="crm-contact-notes" data-testid="crm-contact-notes" rows={2} className={NOTES_FIELD}
                placeholder="Anything worth remembering about them" value={form.notes} onChange={set("notes")} />
            </Field>
          </FormSection>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} data-testid="crm-contact-cancel"
            className={`h-11 rounded-pill px-5 text-sm font-medium text-neutral-800 transition-colors hover:bg-white disabled:opacity-40 ${GLASS_PILL}`}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} data-testid="crm-contact-save"
            className={`h-11 rounded-pill px-6 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            {busy ? "Adding…" : `Add ${typeName.toLowerCase()}`}
          </button>
        </div>
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
  const currency = tenant?.currency;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // U7-07: two scopes, Buyers and Suppliers. Complaints show on the cards.
  const [scope, setScope] = useState("customers"); // customers | suppliers
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  // E2-70: a deep link like /crm?sort=outstanding lands on that order.
  const [sort, setSort] = useState(() => (SORT_OPTIONS.some((o) => o.key === searchParams.get("sort")) ? searchParams.get("sort") : "name"));
  // Grid or list is a per-viewer convenience, remembered in this browser.
  const [view, setViewState] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
  };
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(null); // "customer" | "vendor" while the New window is open

  // RBAC P1 (2026-09-15): People access, not the role name (the server's rule).
  const canManage = hasPerm(user, "people");
  const can360 = hasPerm(user, "finance");
  const canImport = hasPerm(user, "data_input");

  const { data, isLoading } = useQuery({
    queryKey: ["crm-contacts", status, q],
    queryFn: () => api.get(`/contacts?type=&status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data),
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  // E2-52 / E2-69: open complaints, counted per contact for the red signal.
  const { data: openComplaints } = useQuery({
    queryKey: ["complaints-open"],
    queryFn: () => api.get("/complaints?status=open").then((r) => r.data),
  });
  // E2-67: per-contact balances, aggregated on the server.
  const { data: outstandingMap } = useQuery({
    queryKey: ["crm-outstanding"],
    queryFn: () => api.get("/crm/outstanding").then((r) => r.data),
    staleTime: 30_000,
  });

  const complaintCountByContact = useMemo(() => {
    const map = {};
    (openComplaints || []).forEach((c) => {
      if (c.customer_id) map[c.customer_id] = (map[c.customer_id] || 0) + 1;
    });
    return map;
  }, [openComplaints]);
  const userName = useMemo(() => Object.fromEntries((users || []).map((u) => [u.id, u.name])), [users]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["crm-contacts"] });

  // E2-72: bulk CSV/XLSX import. POST /ingest/csv runs the AI mapper and puts
  // the ingestion in the inbox for review; this is only the entry point.
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
      const { data: ing } = await api.post("/ingest/csv", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const rows = ing.row_count ?? 0;
      const detected = (ing.records?.contacts || []).length;
      toast.success(
        `${rows} row${rows === 1 ? "" : "s"} read${detected ? ` · ${detected} contact${detected === 1 ? "" : "s"} detected` : ""} — opening Inbox for review`,
        { id: label },
      );
      navigate("/finance?tab=inbox");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not read the file", { id: label });
    } finally {
      setCsvBusy(false);
    }
  };

  const pickAdd = (key) => {
    // A tick later: the menu closes and hands focus back first.
    if (key === "import") setTimeout(() => csvInputRef.current?.click(), 0);
    else setTimeout(() => setAdding(key), 0);
  };

  // E2-68: counts come off the whole list, so they hold whichever scope is on.
  const scopeCounts = useMemo(() => {
    const list = data || [];
    return {
      customers: list.filter((c) => CUSTOMER_TYPES.includes(c.type)).length,
      suppliers: list.filter((c) => VENDOR_TYPES.includes(c.type)).length,
    };
  }, [data]);

  const contacts = useMemo(() => {
    const list = (data || []).filter((c) => (scope === "suppliers" ? VENDOR_TYPES : CUSTOMER_TYPES).includes(c.type));
    const outMap = outstandingMap || {};
    const sorted = [...list];
    if (sort === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sort === "recent") {
      sorted.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    } else if (sort === "outstanding") {
      const total = (c) => (outMap[c.id]?.receivables || 0) + (outMap[c.id]?.payables || 0);
      sorted.sort((a, b) => total(b) - total(a));
    } else if (sort === "touched") {
      sorted.sort((a, b) => String(a.updated_at || a.created_at || "").localeCompare(String(b.updated_at || b.created_at || "")));
    }
    return sorted;
  }, [data, scope, sort, outstandingMap]);

  // Any change to what is listed starts again from the first page.
  useEffect(() => { setPage(1); }, [scope, status, q, sort, view]);
  const pageSize = PAGE_SIZE[view];
  const pages = Math.max(1, Math.ceil(contacts.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = contacts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const describe = (c) => ({
    typeChip: CUSTOMER_TYPES.includes(c.type) ? L.customer_singular : L.vendor_singular,
    stage: stageMeta(c.type, c.lifecycle_stage),
    signal: signalFor(complaintCountByContact[c.id] || 0, outstandingMap?.[c.id], currency),
    touched: touchedLabel(daysSince(c.updated_at || c.created_at)),
    ownerName: c.assigned_id ? userName[c.assigned_id] : null,
  });
  const openProfile = (c) => () => { if (can360) navigate(`/contacts/${c.id}`); };

  const SCOPES = [
    { key: "customers", label: L.customer_plural, icon: AddressBook, count: scopeCounts.customers },
    { key: "suppliers", label: L.vendor_plural, icon: Truck, count: scopeCounts.suppliers },
  ];
  const scopeLabel = SCOPES.find((s) => s.key === scope)?.label || "";
  const filtering = !!q || !!status;
  const typeLabels = { customer: L.customer_singular, dealer: "Dealer", vendor: L.vendor_singular };

  return (
    <div data-testid="crm-page">
      {canImport && (
        <input ref={csvInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={onCsvChosen}
          className="hidden" data-testid="crm-import-csv-input" />
      )}
      <CrmContactDialog type={adding} onClose={() => setAdding(null)} onSaved={refresh} users={users} labels={typeLabels} />

      {/* KM-27 — the controls pin with the title: they act ON the list, so
          they are the last things to scroll away. */}
      <StickyHeader className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl">{t("crm.title")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base" data-testid="crm-subtitle">
              {t("crm.subtitle", {
                customers: L.customer_plural.toLowerCase(),
                suppliers: L.vendor_plural.toLowerCase(),
                defaultValue: "Manage your {{customers}} and {{suppliers}} in one place.",
              })}
            </p>
          </div>
          {(canManage || canImport) && (
            <AddContactMenu canManage={canManage} canImport={canImport} csvBusy={csvBusy} onPick={pickAdd}
              customerLabel={L.customer_singular} vendorLabel={L.vendor_singular} />
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:mt-6 lg:flex-row lg:items-center" data-testid="crm-controls">
          <div role="group" aria-label="Contact type" data-testid="crm-scope-chips"
            className={`flex shrink-0 items-center gap-1 rounded-pill p-1 ${DRAWER_TRACK}`}>
            {SCOPES.map((s) => {
              const on = scope === s.key;
              return (
                <button key={s.key} type="button" onClick={() => setScope(s.key)} aria-pressed={on} data-testid={`crm-scope-${s.key}`}
                  className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium transition-colors lg:flex-none ${on ? INK_PILL : "text-slate-600 hover:text-slate-900"}`}>
                  <s.icon size={16} weight={on ? "fill" : "regular"} aria-hidden="true" />
                  <span>{s.label}</span>
                  <span data-testid={`crm-scope-count-${s.key}`}
                    className={`min-w-[1.5rem] rounded-pill px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-white/20 text-white" : "bg-slate-900/[0.06] text-slate-600"}`}>
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={`relative flex h-12 min-w-0 flex-1 items-center rounded-pill ${GLASS_PILL}`}>
            <MagnifyingGlass size={17} weight="bold" aria-hidden="true" className="pointer-events-none absolute left-4 text-slate-500" />
            <input type="search" data-testid="crm-search" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); setQ(""); } }}
              placeholder={t("crm.search_ph")} aria-label={t("crm.search_ph")}
              className="h-full w-full min-w-0 rounded-pill bg-transparent pl-11 pr-11 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 [&::-webkit-search-cancel-button]:hidden" />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" data-testid="crm-search-clear"
                className="absolute right-2 grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-900">
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <GlassSelect testid="crm-status-filter" ariaLabel="Status" icon={Funnel} value={status} onChange={setStatus}
              options={[{ value: "", label: t("crm.all_statuses") }, ...STATUSES.map((s) => ({ value: s.key, label: s.label }))]}
              triggerClassName="h-12 min-w-0 flex-1 text-sm lg:w-44 lg:flex-none" />
            <GlassSelect testid="crm-sort" ariaLabel="Sort" icon={ArrowsDownUp} value={sort} onChange={setSort}
              options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
              triggerClassName="h-12 min-w-0 flex-1 text-sm lg:w-52 lg:flex-none" align="end" />
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>
      </StickyHeader>

      {isLoading && !data ? (
        <SkeletonGrid count={6} lines={3} />
      ) : contacts.length === 0 ? (
        <div className={`flex flex-col items-center px-6 py-12 text-center ${CARD}`} data-testid="crm-empty">
          <p className="text-base font-semibold text-slate-900">{filtering ? "No matches" : t("crm.empty_title")}</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            {filtering
              ? `No ${scopeLabel.toLowerCase()} match that search or status.`
              : canManage ? t("crm.empty_hint_manage") : t("crm.empty_hint")}
          </p>
          {filtering ? (
            <button type="button" onClick={() => { setQ(""); setStatus(""); }} data-testid="crm-clear-filters"
              className={`mt-5 h-11 rounded-pill px-5 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
              Clear search and status
            </button>
          ) : canManage && (
            <button type="button" onClick={() => setAdding(scope === "suppliers" ? "vendor" : "customer")} data-testid="crm-empty-add"
              className={`mt-5 flex h-11 items-center gap-2 rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
              <Plus size={15} weight="bold" aria-hidden="true" />
              Add your first {(scope === "suppliers" ? L.vendor_singular : L.customer_singular).toLowerCase()}
            </button>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-4" data-testid="crm-grid">
          {visible.map((c) => (
            <ContactCard key={c.id} c={c} info={describe(c)} onOpen={openProfile(c)} canOpen={can360} />
          ))}
        </div>
      ) : (
        <div className={`p-1.5 ${CARD}`} data-testid="crm-list">
          <div aria-hidden="true"
            className={`hidden gap-4 px-3 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 lg:grid ${LIST_COLS}`}>
            <span>Contact</span><span>Type</span><span>Needs attention</span><span>Owner</span><span className="text-right">Last touched</span>
          </div>
          <ul className="divide-y divide-slate-900/[0.05]">
            {visible.map((c) => (
              <ContactRow key={c.id} c={c} info={describe(c)} onOpen={openProfile(c)} canOpen={can360} />
            ))}
          </ul>
        </div>
      )}

      <Pager page={currentPage} pages={pages} total={contacts.length} pageSize={pageSize} onPage={setPage} />
    </div>
  );
}
