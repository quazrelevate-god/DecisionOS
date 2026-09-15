// Extracted from Ingest.js in Sprint 4 E2-30 (2026-08-15) so Ingest.js
// can be retired. Rendered by Ledger.js on the Finance hero after an
// upload -- lets the user review + edit the AI-extracted records before
// filing them into the ledger.
//
// 2026-09-14 — on the Finance glass: a white glass card, tinted notices, our
// own dropdowns for every choice (party type, invoice type, direction, the
// purchase bucket), ink for File it. Logic and data-testids are unchanged.
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  ArrowsLeftRight, CheckCircle, CurrencyCircleDollar, Eye, ListChecks, Receipt, Sparkle, Trash, UsersThree, WarningCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { lex } from "../../lib/lexicon";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { GlassSelect } from "../../components/karma/GlassSelect";
import { DRAWER_FIELD, INK_PILL } from "../../components/karma/glass";
import { CARD, EmptyNote, SHEET_CONTENT, SMALL_PILL, SheetHead, Tag } from "./financeKit";

const INPUT = cn(DRAWER_FIELD, "h-10 rounded-xl px-3 py-0 text-sm");
const LABEL = "mb-1 block text-[11px] font-medium text-slate-500";
const GROUP = "mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800";
const ROW = "relative grid gap-2.5 rounded-2xl bg-white/70 p-3 pr-12 ring-1 ring-inset ring-slate-900/[0.05]";

const EMPTY = { contacts: [], invoices: [], payments: [], tasks: [] };
const CONTACT_TYPE_OPTS = ["customer", "vendor", "dealer"];
const INVOICE_TYPE_OPTS = ["sales_invoice", "purchase_bill"];
const DIRECTION_OPTS = ["in", "out"];
const PURCHASE_TYPE_OPTS = ["expense", "asset", "inventory"];

const DOC_HINT = {
  sales_invoice: { label: "Sales Invoice", desc: "Money a CUSTOMER owes you. The other party is your customer." },
  purchase_bill: { label: "Purchase Bill", desc: "Money you owe a SUPPLIER. The other party is your supplier." },
  payment: { label: "Payment", desc: "A payment record. 'In' = you received money; 'Out' = you paid." },
  purchase_order: { label: "Purchase Order", desc: "An order you placed with a supplier." },
  other: { label: "Document", desc: "Review the detected records below before filing." },
};

const CO_SUFFIXES = ["private limited", "pvt ltd", "pvt", "private ltd", "limited", "ltd", "llp", "inc", "corporation", "corp", "co", "company", "technologies", "enterprises", "industries", "traders"];
const normCo = (s) => {
  let t = String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  while (t.length && CO_SUFFIXES.includes(t[t.length - 1])) t.pop();
  return t.join(" ").trim();
};
const isOwnCompany = (name, ownNorm) => {
  const n = normCo(name);
  return !!ownNorm && !!n && (n === ownNorm || n.includes(ownNorm) || ownNorm.includes(n));
};

const OPT_LABELS = {
  customer: "Customer", vendor: "Supplier", dealer: "Dealer",
  sales_invoice: "Sales invoice", purchase_bill: "Purchase bill",
  in: "Received (in)", out: "Paid (out)",
  expense: "Expense", asset: "Asset", inventory: "Inventory",
};

function SelectField({ label, value, onChange, options, optLabels, testid, placeholder, highlight }) {
  const id = useId();
  const LB = optLabels || OPT_LABELS;
  const opts = [
    // A value the AI returned that isn't a known option stays visible and selectable.
    ...(value && !options.includes(value) ? [{ value, label: value }] : []),
    ...options.map((o) => ({ value: o, label: LB[o] || o })),
  ];
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <GlassSelect id={id} variant="field" testid={testid} ariaLabel={label} value={value ?? ""} onChange={onChange}
        options={opts} placeholder={placeholder || "—"} triggerClassName={cn(INPUT, highlight && "ring-2 ring-amber-400")} />
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <input id={id} className={INPUT} value={value ?? ""} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function RemoveButton({ onClick, label, testid, inline = false }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid} aria-label={label}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300",
        !inline && "absolute right-2 top-2",
      )}>
      <Trash size={14} aria-hidden="true" />
    </button>
  );
}

function FilePreview({ fileUrl, kind, filename, testid }) {
  const [open, setOpen] = useState(false);
  if (!fileUrl) return null;
  const src = `${process.env.REACT_APP_BACKEND_URL}${fileUrl}`;
  const isImage = kind === "image" || /\.(png|jpe?g|webp|gif)$/i.test(filename || "");
  const view = () => { if (isImage) setOpen(true); else window.open(src, "_blank", "noopener"); };
  return (
    <>
      <button type="button" data-testid={testid} onClick={view} title="View attachment" className={cn(SMALL_PILL, "h-10")}>
        <Eye size={14} weight="bold" aria-hidden="true" /> View
      </button>
      {isImage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className={cn(SHEET_CONTENT, "max-w-3xl")} data-testid={`${testid}-lightbox`}>
            <SheetHead title={filename || "Attachment"} onClose={() => setOpen(false)} />
            <div className="px-6 pb-6">
              <img src={src} alt={filename || "attachment"} className="h-auto max-h-[calc(75dvh/var(--ui-scale,1))] w-full rounded-2xl object-contain" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const withKeys = (recs) => {
  const out = { ...EMPTY, ...(recs || {}) };
  ["contacts", "invoices", "payments", "tasks"].forEach((b) => {
    out[b] = (out[b] || []).map((it) => (it._key ? it : { ...it, _key: `${b}-${Math.random().toString(36).slice(2, 9)}` }));
  });
  return out;
};

export default function ReviewPanel({ ingestion, onFiled, onCancel }) {
  const { tenant } = useAuth();
  const L = lex(tenant);
  const optLabels = { ...OPT_LABELS, customer: L.customer_singular, vendor: L.vendor_singular };
  const currency = tenant?.currency || "INR";
  const ownNorm = normCo(tenant?.name);
  const [records, setRecords] = useState(() => withKeys(ingestion.records));
  const [filing, setFiling] = useState(false);
  const hint = DOC_HINT[ingestion.doc_type] || DOC_HINT.other;
  const ownHits = [
    ...(records.contacts || []).map((c) => c.name),
    ...(records.invoices || []).map((i) => i.contact_name),
    ...(records.payments || []).map((p) => p.contact_name),
  ].filter((n) => isOwnCompany(n, ownNorm));

  const setItem = (bucket, idx, key, val) => {
    setRecords((r) => {
      const list = [...(r[bucket] || [])];
      list[idx] = { ...list[idx], [key]: val };
      return { ...r, [bucket]: list };
    });
  };
  const removeItem = (bucket, idx) => {
    setRecords((r) => ({ ...r, [bucket]: (r[bucket] || []).filter((_, i) => i !== idx) }));
  };

  const total =
    (records.contacts?.length || 0) +
    (records.invoices?.length || 0) +
    (records.payments?.length || 0) +
    (records.tasks?.length || 0);

  const fileIt = async () => {
    const unclassified = (records.invoices || []).some(
      (inv) => inv.type === "purchase_bill" && !PURCHASE_TYPE_OPTS.includes((inv.purchase_type || "").toLowerCase()));
    if (unclassified) {
      toast.error("Classify each purchase bill as Expense, Asset or Inventory before filing.");
      return;
    }
    setFiling(true);
    try {
      const clean = {};
      Object.keys(records).forEach((b) => { clean[b] = (records[b] || []).map(({ _key, ...rest }) => rest); });
      const { data } = await api.post(`/ingest/${ingestion.id}/commit`, { records: clean });
      const c = data.created;
      toast.success(`Filed: ${c.contacts} contacts · ${c.invoices} invoices · ${c.payments} payments · ${c.tasks} tasks`);
      onFiled();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setFiling(false);
    }
  };

  return (
    <section className={`p-5 sm:p-6 ${CARD}`} data-testid="ingest-review-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,hsl(40_100%_96%),hsl(24_100%_93%))] text-orange-500 ring-1 ring-inset ring-orange-100">
            <Sparkle size={20} weight="fill" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Review extracted data</h2>
            <p className="text-sm text-slate-500">{ingestion.summary || ingestion.filename}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {ingestion.doc_type && <Tag>{String(ingestion.doc_type).replace(/_/g, " ")}</Tag>}
              {ingestion.entity && <Tag>{String(ingestion.entity).replace(/_/g, " ")}</Tag>}
              {ingestion.confidence != null && (
                <span className="text-xs text-slate-500">confidence {Math.round(ingestion.confidence * 100)}%</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilePreview fileUrl={ingestion.file_url} kind={ingestion.kind} filename={ingestion.filename} testid="ingest-review-view-file" />
          <button type="button" data-testid="ingest-cancel-button" onClick={onCancel} className={cn(SMALL_PILL, "h-10 px-4 text-sm")}>
            Discard
          </button>
          <button type="button" data-testid="ingest-file-button" disabled={filing || total === 0} onClick={fileIt}
            className={`flex h-10 items-center gap-2 rounded-pill px-5 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            <CheckCircle size={16} weight="bold" aria-hidden="true" /> {filing ? "Filing…" : "File it"}
          </button>
        </div>
      </div>

      {total === 0 && <EmptyNote title="Nothing detected" hint="The AI couldn't pull structured records from this file." />}

      {total > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-sky-50/80 p-3.5 ring-1 ring-inset ring-sky-100" data-testid="ingest-direction-banner">
          <ArrowsLeftRight size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-sky-700" />
          <div>
            <p className="text-sm font-medium text-slate-900">{hint.label}</p>
            <p className="text-xs leading-relaxed text-slate-600">
              {hint.desc} Use the dropdowns below to flip a party between <b>{L.customer_singular.toLowerCase()}</b> and{" "}
              <b>{L.vendor_singular.toLowerCase()}</b>, or the invoice between <b>sales</b> and <b>purchase</b>, before filing.
            </p>
          </div>
        </div>
      )}

      {ownHits.length > 0 && (
        <div className="mt-3 flex items-start gap-3 rounded-2xl bg-amber-50/85 p-3.5 ring-1 ring-inset ring-amber-100" data-testid="ingest-owncompany-warning">
          <WarningCircle size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-xs font-medium leading-relaxed text-amber-900">
            Heads up: “{ownHits[0]}” looks like <b>your own company</b>, so it will be skipped and not saved as a contact. Only the other party is filed.
          </p>
        </div>
      )}

      {(records.contacts || []).length > 0 && (
        <div className="mt-5" data-testid="review-contacts">
          <p className={GROUP}>
            <UsersThree size={16} aria-hidden="true" /> {L.customer_plural} & {L.vendor_plural} <Tag>{records.contacts.length}</Tag>
          </p>
          <div className="space-y-2">
            {records.contacts.map((c, i) => (
              <div key={c._key} data-testid={`review-contact-${i}`}
                className={cn(ROW, "grid-cols-2 md:grid-cols-4", isOwnCompany(c.name, ownNorm) && "bg-amber-50/70 ring-amber-200")}>
                <SelectField label="Type" value={c.type} onChange={(v) => setItem("contacts", i, "type", v)} options={CONTACT_TYPE_OPTS} optLabels={optLabels} />
                <Field label="Name" value={c.name} onChange={(v) => setItem("contacts", i, "name", v)} />
                <Field label="Phone" value={c.phone} onChange={(v) => setItem("contacts", i, "phone", v)} />
                <Field label="Email" value={c.email} onChange={(v) => setItem("contacts", i, "email", v)} />
                <RemoveButton onClick={() => removeItem("contacts", i)} testid={`remove-contact-${i}`} label="Remove contact" />
              </div>
            ))}
          </div>
        </div>
      )}

      {(records.invoices || []).length > 0 && (
        <div className="mt-5" data-testid="review-invoices">
          <p className={GROUP}><Receipt size={16} aria-hidden="true" /> Invoices & bills <Tag>{records.invoices.length}</Tag></p>
          <div className="space-y-2">
            {records.invoices.map((inv, i) => {
              const isPurchase = inv.type === "purchase_bill";
              const pt = (inv.purchase_type || "").toLowerCase();
              const needsBucket = isPurchase && !PURCHASE_TYPE_OPTS.includes(pt);
              return (
                <div key={inv._key} data-testid={`review-invoice-${i}`}
                  className={cn(ROW, "grid-cols-2 md:grid-cols-6", needsBucket && "bg-amber-50/70 ring-2 ring-amber-400")}>
                  <SelectField label="Type" value={inv.type} onChange={(v) => setItem("invoices", i, "type", v)} options={INVOICE_TYPE_OPTS} />
                  {isPurchase && (
                    <div data-testid={`review-invoice-bucket-${i}`} className="min-w-0">
                      <SelectField
                        label={needsBucket ? "Book as · pick one" : "Book as"}
                        value={pt} onChange={(v) => setItem("invoices", i, "purchase_type", v)}
                        options={PURCHASE_TYPE_OPTS} placeholder="Choose…" highlight={needsBucket}
                        testid={`review-invoice-bucket-select-${i}`} />
                    </div>
                  )}
                  <Field label="Number" value={inv.number} onChange={(v) => setItem("invoices", i, "number", v)} />
                  <Field label="Party" value={inv.contact_name} onChange={(v) => setItem("invoices", i, "contact_name", v)} />
                  <Field label="Amount" value={inv.amount} onChange={(v) => setItem("invoices", i, "amount", v)} />
                  <Field label="Due date" value={inv.due_date} onChange={(v) => setItem("invoices", i, "due_date", v)} />
                  <RemoveButton onClick={() => removeItem("invoices", i)} testid={`remove-invoice-${i}`} label="Remove invoice" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(records.payments || []).length > 0 && (
        <div className="mt-5" data-testid="review-payments">
          <p className={GROUP}><CurrencyCircleDollar size={16} aria-hidden="true" /> Payments <Tag>{records.payments.length}</Tag></p>
          <div className="space-y-2">
            {records.payments.map((p, i) => (
              <div key={p._key} data-testid={`review-payment-${i}`} className={cn(ROW, "grid-cols-2 md:grid-cols-5")}>
                <SelectField label="Direction" value={p.direction} onChange={(v) => setItem("payments", i, "direction", v)} options={DIRECTION_OPTS} />
                <Field label="Amount" value={p.amount} onChange={(v) => setItem("payments", i, "amount", v)} />
                <Field label="Party" value={p.contact_name} onChange={(v) => setItem("payments", i, "contact_name", v)} />
                <Field label="Method" value={p.method} onChange={(v) => setItem("payments", i, "method", v)} />
                <Field label="Reference" value={p.reference} onChange={(v) => setItem("payments", i, "reference", v)} />
                <RemoveButton onClick={() => removeItem("payments", i)} testid={`remove-payment-${i}`} label="Remove payment" />
              </div>
            ))}
          </div>
        </div>
      )}

      {(records.tasks || []).length > 0 && (
        <div className="mt-5" data-testid="review-tasks">
          <p className={GROUP}><ListChecks size={16} aria-hidden="true" /> Follow-up tasks <Tag>{records.tasks.length}</Tag></p>
          <div className="space-y-2">
            {records.tasks.map((t, i) => (
              <div key={t._key} data-testid={`review-task-${i}`} className="flex items-center gap-2 rounded-2xl bg-white/70 p-2 pl-3 ring-1 ring-inset ring-slate-900/[0.05]">
                <input className={INPUT} aria-label={`Task ${i + 1}`} value={t.title ?? ""} onChange={(e) => setItem("tasks", i, "title", e.target.value)} />
                <RemoveButton inline onClick={() => removeItem("tasks", i)} testid={`remove-task-${i}`} label="Remove task" />
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">Currency: {currency}. Edit or remove anything above, then File it to save into your Company Brain.</p>
    </section>
  );
}
