// Extracted from Ingest.js in Sprint 4 E2-30 (2026-08-15) so Ingest.js
// can be retired. Rendered by Ledger.js on the Finance hero after an
// upload -- lets the user review + edit the AI-extracted records before
// filing them into the ledger.
import { useState } from "react";
import { toast } from "sonner";
import {
  Trash, CheckCircle, Receipt, UsersThree,
  CurrencyCircleDollar, ListChecks, Sparkle, ArrowsLeftRight,
  WarningCircle, Eye,
} from "@phosphor-icons/react";

import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { lex } from "../../lib/lexicon";
import { Chip, EmptyState } from "../../components/common";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "../../components/ui/dialog";

const inp = "w-full border border-black px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:shadow-brutal-sm bg-white";

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

function SelectField({ label, value, onChange, options, optLabels }) {
  const LB = optLabels || OPT_LABELS;
  return (
    <label className="block">
      <span className="label-mono text-muted-foreground text-[10px]">{label}</span>
      <select className={inp} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {!options.includes(value) && <option value={value || ""}>{value || "—"}</option>}
        {options.map((o) => <option key={o} value={o}>{LB[o] || o}</option>)}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="label-mono text-muted-foreground text-[10px]">{label}</span>
      <input className={inp} value={value ?? ""} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
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
      <button type="button" data-testid={testid} onClick={view} title="View attachment"
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-black px-3 py-1.5 hover:bg-brand-ink hover:text-white transition-colors">
        <Eye size={14} weight="bold" /> View
      </button>
      {isImage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="border border-black rounded-none max-w-3xl p-2" data-testid={`${testid}-lightbox`}>
            <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight text-sm truncate">{filename || "Attachment"}</DialogTitle></DialogHeader>
            <img src={src} alt="attachment" className="w-full h-auto max-h-[80vh] object-contain" />
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
    <div className="card-brutal p-5 mb-8" data-testid="ingest-review-panel">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkle size={18} weight="fill" className="text-brand-red" />
            <span className="font-heading font-black uppercase tracking-tight text-lg">Review extracted data</span>
          </div>
          <p className="text-sm text-muted-foreground">{ingestion.summary || ingestion.filename}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {ingestion.doc_type && <Chip value={ingestion.doc_type} className="bg-brand-blue text-white" />}
            {ingestion.entity && <Chip value={ingestion.entity} className="bg-brand-blue text-white" />}
            {ingestion.confidence != null && (
              <span className="label-mono text-muted-foreground">confidence {Math.round(ingestion.confidence * 100)}%</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <FilePreview fileUrl={ingestion.file_url} kind={ingestion.kind} filename={ingestion.filename} testid="ingest-review-view-file" />
          <button data-testid="ingest-cancel-button" onClick={onCancel} className="px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-black/5 transition-colors">
            Discard
          </button>
          <button data-testid="ingest-file-button" disabled={filing || total === 0} onClick={fileIt}
            className="flex items-center gap-2 bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50">
            <CheckCircle size={16} weight="bold" /> {filing ? "Filing…" : "File it"}
          </button>
        </div>
      </div>

      {total === 0 && <EmptyState title="Nothing detected" hint="The AI couldn't pull structured records from this file." />}

      {total > 0 && (
        <div className="border-l-4 border-brand-red bg-brand-paper p-3 mb-5 flex items-start gap-2" data-testid="ingest-direction-banner">
          <ArrowsLeftRight size={18} weight="bold" className="text-brand-red shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold uppercase tracking-tight">{hint.label}</p>
            <p className="text-xs text-muted-foreground">{hint.desc} Use the dropdowns below to flip a party between <b>{L.customer_singular.toLowerCase()}</b> and <b>{L.vendor_singular.toLowerCase()}</b>, or the invoice between <b>sales</b> and <b>purchase</b>, before filing.</p>
          </div>
        </div>
      )}

      {ownHits.length > 0 && (
        <div className="border border-black bg-brand-yellow p-3 mb-5 flex items-start gap-2" data-testid="ingest-owncompany-warning">
          <WarningCircle size={18} weight="bold" className="shrink-0 mt-0.5" />
          <p className="text-xs font-semibold">Heads up: “{ownHits[0]}” looks like <b>your own company</b>, so it will be skipped and not saved as a contact. Only the other party is filed.</p>
        </div>
      )}

      {/* Contacts */}
      {(records.contacts || []).length > 0 && (
        <div className="mb-5" data-testid="review-contacts">
          <p className="label-mono text-brand-red mb-2 flex items-center gap-1"><UsersThree size={14} weight="bold" /> {L.customer_plural} & {L.vendor_plural} ({records.contacts.length})</p>
          <div className="space-y-2">
            {records.contacts.map((c, i) => (
              <div key={c._key} className={`border p-3 grid grid-cols-2 md:grid-cols-4 gap-2 relative ${isOwnCompany(c.name, ownNorm) ? "border-brand-yellow bg-brand-yellow/20" : "border-black/20"}`} data-testid={`review-contact-${i}`}>
                <SelectField label="Type" value={c.type} onChange={(v) => setItem("contacts", i, "type", v)} options={CONTACT_TYPE_OPTS} optLabels={optLabels} />
                <Field label="Name" value={c.name} onChange={(v) => setItem("contacts", i, "name", v)} />
                <Field label="Phone" value={c.phone} onChange={(v) => setItem("contacts", i, "phone", v)} />
                <Field label="Email" value={c.email} onChange={(v) => setItem("contacts", i, "email", v)} />
                <button onClick={() => removeItem("contacts", i)} data-testid={`remove-contact-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-black bg-white hover:bg-brand-red hover:text-white transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoices */}
      {(records.invoices || []).length > 0 && (
        <div className="mb-5" data-testid="review-invoices">
          <p className="label-mono text-brand-red mb-2 flex items-center gap-1"><Receipt size={14} weight="bold" /> Invoices & Bills ({records.invoices.length})</p>
          <div className="space-y-2">
            {records.invoices.map((inv, i) => {
              const isPurchase = inv.type === "purchase_bill";
              const pt = (inv.purchase_type || "").toLowerCase();
              const needsBucket = isPurchase && !PURCHASE_TYPE_OPTS.includes(pt);
              return (
              <div key={inv._key} className={`border p-3 grid grid-cols-2 md:grid-cols-6 gap-2 relative ${needsBucket ? "border-brand-red border-2 bg-brand-red/5" : "border-black/20"}`} data-testid={`review-invoice-${i}`}>
                <SelectField label="Type" value={inv.type} onChange={(v) => setItem("invoices", i, "type", v)} options={INVOICE_TYPE_OPTS} />
                {isPurchase && (
                  <label className="block" data-testid={`review-invoice-bucket-${i}`}>
                    <span className="label-mono text-muted-foreground text-[10px]">Book as {needsBucket && <span className="text-brand-red">• pick one</span>}</span>
                    <select className={`${inp} ${needsBucket ? "ring-2 ring-brand-red" : ""}`} value={pt}
                      data-testid={`review-invoice-bucket-select-${i}`}
                      onChange={(e) => setItem("invoices", i, "purchase_type", e.target.value)}>
                      <option value="">Choose…</option>
                      {PURCHASE_TYPE_OPTS.map((o) => <option key={o} value={o}>{OPT_LABELS[o]}</option>)}
                    </select>
                  </label>
                )}
                <Field label="Number" value={inv.number} onChange={(v) => setItem("invoices", i, "number", v)} />
                <Field label="Party" value={inv.contact_name} onChange={(v) => setItem("invoices", i, "contact_name", v)} />
                <Field label="Amount" value={inv.amount} onChange={(v) => setItem("invoices", i, "amount", v)} />
                <Field label="Due date" value={inv.due_date} onChange={(v) => setItem("invoices", i, "due_date", v)} />
                <button onClick={() => removeItem("invoices", i)} data-testid={`remove-invoice-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-black bg-white hover:bg-brand-red hover:text-white transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Payments */}
      {(records.payments || []).length > 0 && (
        <div className="mb-5" data-testid="review-payments">
          <p className="label-mono text-brand-red mb-2 flex items-center gap-1"><CurrencyCircleDollar size={14} weight="bold" /> Payments ({records.payments.length})</p>
          <div className="space-y-2">
            {records.payments.map((p, i) => (
              <div key={p._key} className="border border-black/20 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 relative" data-testid={`review-payment-${i}`}>
                <SelectField label="Direction" value={p.direction} onChange={(v) => setItem("payments", i, "direction", v)} options={DIRECTION_OPTS} />
                <Field label="Amount" value={p.amount} onChange={(v) => setItem("payments", i, "amount", v)} />
                <Field label="Party" value={p.contact_name} onChange={(v) => setItem("payments", i, "contact_name", v)} />
                <Field label="Method" value={p.method} onChange={(v) => setItem("payments", i, "method", v)} />
                <Field label="Reference" value={p.reference} onChange={(v) => setItem("payments", i, "reference", v)} />
                <button onClick={() => removeItem("payments", i)} data-testid={`remove-payment-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-black bg-white hover:bg-brand-red hover:text-white transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {(records.tasks || []).length > 0 && (
        <div className="mb-1" data-testid="review-tasks">
          <p className="label-mono text-brand-red mb-2 flex items-center gap-1"><ListChecks size={14} weight="bold" /> Follow-up tasks ({records.tasks.length})</p>
          <div className="space-y-2">
            {records.tasks.map((t, i) => (
              <div key={t._key} className="border border-black/20 p-3 flex items-center gap-2 relative" data-testid={`review-task-${i}`}>
                <input className={inp} value={t.title ?? ""} onChange={(e) => setItem("tasks", i, "title", e.target.value)} />
                <button onClick={() => removeItem("tasks", i)} data-testid={`remove-task-${i}`} className="shrink-0 w-8 h-8 flex items-center justify-center border border-black bg-white hover:bg-brand-red hover:text-white transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-4">Currency: {currency}. Edit or remove anything above, then File it to save into your Company Brain.</p>
    </div>
  );
}
