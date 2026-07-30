import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { lex } from "../lib/lexicon";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { money, timeAgo } from "../lib/format";
import { CaptureReview } from "./Captures";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  FileArrowUp,
  FilePdf,
  Table as TableIcon,
  Trash,
  CheckCircle,
  ArrowClockwise,
  WhatsappLogo,
  Receipt,
  UsersThree,
  CurrencyCircleDollar,
  ListChecks,
  Sparkle,
  ArrowsLeftRight,
  WarningCircle,
  Eye,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

const inp = "w-full border border-hairline px-2.5 py-1.5 text-sm text-label uppercase focus:outline-none focus:shadow-xs bg-surface";

function FilePreview({ fileUrl, kind, filename, testid }) {
  const [open, setOpen] = useState(false);
  if (!fileUrl) return null;
  const src = `${process.env.REACT_APP_BACKEND_URL}${fileUrl}`;
  const isImage = kind === "image" || /\.(png|jpe?g|webp|gif)$/i.test(filename || "");
  const view = () => { if (isImage) setOpen(true); else window.open(src, "_blank", "noopener"); };
  return (
    <>
      <button type="button" data-testid={testid} onClick={view} title="View attachment"
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-hairline px-3 py-1.5 hover:bg-primary hover:text-white transition-colors">
        <Eye size={14} weight="bold" /> View
      </button>
      {isImage && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="border border-hairline rounded-md max-w-3xl p-2" data-testid={`${testid}-lightbox`}>
            <DialogHeader><DialogTitle className="uppercase tracking-tight text-sm truncate">{filename || "Attachment"}</DialogTitle></DialogHeader>
            <img src={src} alt="attachment" className="w-full h-auto max-h-[80vh] object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

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
      <span className="text-label uppercase text-text-secondary text-[10px]">{label}</span>
      <select className={inp} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {!options.includes(value) && <option value={value || ""}>{value || "—"}</option>}
        {options.map((o) => <option key={o} value={o}>{LB[o] || o}</option>)}
      </select>
    </label>
  );
}

const withKeys = (recs) => {
  const out = { ...EMPTY, ...(recs || {}) };
  ["contacts", "invoices", "payments", "tasks"].forEach((b) => {
    out[b] = (out[b] || []).map((it) => (it._key ? it : { ...it, _key: `${b}-${Math.random().toString(36).slice(2, 9)}` }));
  });
  return out;
};

const WA_STATUS_STYLE = {
  received: "bg-status-pending-bg text-text",
  draft: "bg-primary text-primary-foreground",
  attention: "bg-amber-500 text-text",
  filed: "bg-success-600 text-white",
  structured: "bg-success-600 text-white",
  ignored: "bg-surface-sunken text-text",
  rejected: "bg-primary text-primary-foreground",
  signature_mismatch: "bg-orange-500 text-white",
  error: "bg-status-overdue-bg text-status-overdue-fg",
};

function WhatsAppCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  const { data: st } = useQuery({ queryKey: ["wa-status"], queryFn: () => api.get("/whatsapp/status").then((r) => r.data) });
  const { data: logs } = useQuery({
    queryKey: ["wa-logs"], enabled: isOwner, refetchInterval: 15000,
    queryFn: () => api.get("/whatsapp/logs").then((r) => r.data),
  });
  const waNum = st?.wa_number;
  const waLink = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent("Hi DecisionOS")}` : null;

  return (
    <div className="rounded-lg border border-hairline bg-surface p-5 mb-8" data-testid="whatsapp-card">
      {!st?.configured && (
        <div className="flex items-center gap-2 mb-4">
          <Chip value="not connected" />
        </div>
      )}

      <div className="grid md:grid-cols-[auto_1fr] gap-6">
        <div className="flex flex-col items-center text-center">
          {waLink ? (
            <>
              <a href={waLink} target="_blank" rel="noreferrer" data-testid="whatsapp-qr-link"
                className="border border-hairline rounded-xl p-2.5 bg-surface shadow-xs hover:shadow-sm transition-all">
                <QRCodeSVG value={waLink} size={132} level="M" />
              </a>
            </>
          ) : (
            <div className="border-2 border-dashed border-hairline p-6 w-full">
              <p className="text-sm font-semibold">WhatsApp not connected yet</p>
              <p className="text-xs text-text-secondary mt-1">{st?.token_error || "Add the WhatsApp credentials in your environment to enable forwarding."}</p>
            </div>
          )}
        </div>

        <div>
          {isOwner && st && st.token_error && (
            <div className="flex items-center gap-2 mb-3 border border-hairline-strong/30 bg-primary-tint rounded-lg px-3 py-2" data-testid="whatsapp-token-error">
              <Chip value="connection issue" />
              <span className="text-xs text-text-secondary">{st.token_error}</span>
            </div>
          )}

          {isOwner ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-label uppercase font-bold text-status-completed-fg flex items-center gap-1.5">
                  <WhatsappLogo size={16} weight="bold" className="text-status-completed-fg" /> Recent WhatsApp activity
                </p>
                <button data-testid="whatsapp-logs-refresh" onClick={() => qc.invalidateQueries({ queryKey: ["wa-logs"] })}
                  className="flex items-center gap-1 text-xs uppercase tracking-wider border border-hairline px-2 py-1 hover:bg-primary hover:text-white transition-colors">
                  <ArrowClockwise size={12} weight="bold" /> Refresh
                </button>
              </div>
              {(logs || []).length === 0 ? (
                <div className="border border-hairline p-3 text-xs text-text-secondary" data-testid="whatsapp-logs-empty">
                  No inbound messages logged yet. Scan the QR and send a test message — it will appear here within seconds. If nothing shows after sending, the webhook isn't reaching the app (check Meta → WhatsApp → Configuration: callback URL, <span className="text-label uppercase">messages</span> field subscribed, and app published).
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="whatsapp-logs-list">
                  {logs.map((l, i) => (
                    <div key={`${l.created_at || ""}-${l.from || ""}-${i}`} data-testid={`whatsapp-log-${i}`} className="border border-hairline p-2 flex items-start gap-2 flex-wrap">
                      <Chip value={l.status} className={WA_STATUS_STYLE[l.status] || "bg-surface-sunken text-text"} />
                      <span className="text-label uppercase text-text-secondary">{l.mtype || "—"}</span>
                      <span className="text-xs text-label uppercase">{l.from || "unknown"}</span>
                      <span className="text-xs text-text-secondary flex-1 min-w-[120px]">{l.summary || l.reason || ""}</span>
                      <span className="text-label uppercase text-text-secondary">{timeAgo(l.updated_at || l.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">Scan the code to forward an invoice, receipt or a quick note. It files itself into DecisionOS.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-label uppercase text-text-secondary text-[10px]">{label}</span>
      <input className={inp} value={value ?? ""} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ReviewPanel({ ingestion, onFiled, onCancel }) {
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
    // Guard: every purchase bill must be classified into a bucket before filing.
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
    <div className="rounded-lg border border-hairline bg-surface p-5 mb-8" data-testid="ingest-review-panel">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkle size={18} weight="fill" className="text-primary-text" />
            <span className="font-black uppercase tracking-tight text-lg">Review extracted data</span>
          </div>
          <p className="text-sm text-text-secondary">{ingestion.summary || ingestion.filename}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {ingestion.doc_type && <Chip value={ingestion.doc_type} />}
            {ingestion.entity && <Chip value={ingestion.entity} />}
            {ingestion.confidence != null && (
              <span className="text-label uppercase text-text-secondary">confidence {Math.round(ingestion.confidence * 100)}%</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <FilePreview fileUrl={ingestion.file_url} kind={ingestion.kind} filename={ingestion.filename} testid="ingest-review-view-file" />
          <button data-testid="ingest-cancel-button" onClick={onCancel} className="px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:bg-surface-hover transition-colors">
            Discard
          </button>
          <button data-testid="ingest-file-button" disabled={filing || total === 0} onClick={fileIt}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-sm transition-all disabled:opacity-50">
            <CheckCircle size={16} weight="bold" /> {filing ? "Filing…" : "File it"}
          </button>
        </div>
      </div>

      {total === 0 && <EmptyState title="Nothing detected" hint="The AI couldn't pull structured records from this file." />}

      {total > 0 && (
        <div className="border-l-4 border-hairline-strong bg-background p-3 mb-5 flex items-start gap-2" data-testid="ingest-direction-banner">
          <ArrowsLeftRight size={18} weight="bold" className="text-primary-text shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold uppercase tracking-tight">{hint.label}</p>
            <p className="text-xs text-text-secondary">{hint.desc} Use the dropdowns below to flip a party between <b>{L.customer_singular.toLowerCase()}</b> and <b>{L.vendor_singular.toLowerCase()}</b>, or the invoice between <b>sales</b> and <b>purchase</b>, before filing.</p>
          </div>
        </div>
      )}

      {ownHits.length > 0 && (
        <div className="border border-hairline bg-status-pending-bg p-3 mb-5 flex items-start gap-2" data-testid="ingest-owncompany-warning">
          <WarningCircle size={18} weight="bold" className="shrink-0 mt-0.5" />
          <p className="text-xs font-semibold">Heads up: “{ownHits[0]}” looks like <b>your own company</b>, so it will be skipped and not saved as a contact. Only the other party is filed.</p>
        </div>
      )}

      {/* Contacts */}
      {(records.contacts || []).length > 0 && (
        <div className="mb-5" data-testid="review-contacts">
          <p className="text-label uppercase text-primary-text mb-2 flex items-center gap-1"><UsersThree size={14} weight="bold" /> {L.customer_plural} & {L.vendor_plural} ({records.contacts.length})</p>
          <div className="space-y-2">
            {records.contacts.map((c, i) => (
              <div key={c._key} className={`border p-3 grid grid-cols-2 md:grid-cols-4 gap-2 relative ${isOwnCompany(c.name, ownNorm) ? "border-status-pending-line bg-status-pending-bg/20" : "border-hairline"}`} data-testid={`review-contact-${i}`}>
                <SelectField label="Type" value={c.type} onChange={(v) => setItem("contacts", i, "type", v)} options={CONTACT_TYPE_OPTS} optLabels={optLabels} />
                <Field label="Name" value={c.name} onChange={(v) => setItem("contacts", i, "name", v)} />
                <Field label="Phone" value={c.phone} onChange={(v) => setItem("contacts", i, "phone", v)} />
                <Field label="Email" value={c.email} onChange={(v) => setItem("contacts", i, "email", v)} />
                <button onClick={() => removeItem("contacts", i)} data-testid={`remove-contact-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-hairline bg-surface hover:bg-destructive-tint transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoices */}
      {(records.invoices || []).length > 0 && (
        <div className="mb-5" data-testid="review-invoices">
          <p className="text-label uppercase text-primary-text mb-2 flex items-center gap-1"><Receipt size={14} weight="bold" /> Invoices & Bills ({records.invoices.length})</p>
          <div className="space-y-2">
            {records.invoices.map((inv, i) => {
              const isPurchase = inv.type === "purchase_bill";
              const pt = (inv.purchase_type || "").toLowerCase();
              const needsBucket = isPurchase && !PURCHASE_TYPE_OPTS.includes(pt);
              return (
              <div key={inv._key} className={`border p-3 grid grid-cols-2 md:grid-cols-6 gap-2 relative ${needsBucket ? "border-hairline-strong border-2 bg-primary-tint" : "border-hairline"}`} data-testid={`review-invoice-${i}`}>
                <SelectField label="Type" value={inv.type} onChange={(v) => setItem("invoices", i, "type", v)} options={INVOICE_TYPE_OPTS} />
                {isPurchase && (
                  <label className="block" data-testid={`review-invoice-bucket-${i}`}>
                    <span className="text-label uppercase text-text-secondary text-[10px]">Book as {needsBucket && <span className="text-primary-text">• pick one</span>}</span>
                    <select className={`${inp} ${needsBucket ? "ring-2 ring-ring" : ""}`} value={pt}
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
                <button onClick={() => removeItem("invoices", i)} data-testid={`remove-invoice-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-hairline bg-surface hover:bg-destructive-tint transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            );})}
          </div>
        </div>
      )}

      {/* Payments */}
      {(records.payments || []).length > 0 && (
        <div className="mb-5" data-testid="review-payments">
          <p className="text-label uppercase text-primary-text mb-2 flex items-center gap-1"><CurrencyCircleDollar size={14} weight="bold" /> Payments ({records.payments.length})</p>
          <div className="space-y-2">
            {records.payments.map((p, i) => (
              <div key={p._key} className="border border-hairline p-3 grid grid-cols-2 md:grid-cols-5 gap-2 relative" data-testid={`review-payment-${i}`}>
                <SelectField label="Direction" value={p.direction} onChange={(v) => setItem("payments", i, "direction", v)} options={DIRECTION_OPTS} />
                <Field label="Amount" value={p.amount} onChange={(v) => setItem("payments", i, "amount", v)} />
                <Field label="Party" value={p.contact_name} onChange={(v) => setItem("payments", i, "contact_name", v)} />
                <Field label="Method" value={p.method} onChange={(v) => setItem("payments", i, "method", v)} />
                <Field label="Reference" value={p.reference} onChange={(v) => setItem("payments", i, "reference", v)} />
                <button onClick={() => removeItem("payments", i)} data-testid={`remove-payment-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-hairline bg-surface hover:bg-destructive-tint transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {(records.tasks || []).length > 0 && (
        <div className="mb-1" data-testid="review-tasks">
          <p className="text-label uppercase text-primary-text mb-2 flex items-center gap-1"><ListChecks size={14} weight="bold" /> Follow-up tasks ({records.tasks.length})</p>
          <div className="space-y-2">
            {records.tasks.map((t, i) => (
              <div key={t._key} className="border border-hairline p-3 flex items-center gap-2 relative" data-testid={`review-task-${i}`}>
                <input className={inp} value={t.title ?? ""} onChange={(e) => setItem("tasks", i, "title", e.target.value)} />
                <button onClick={() => removeItem("tasks", i)} data-testid={`remove-task-${i}`} className="shrink-0 w-8 h-8 flex items-center justify-center border border-hairline bg-surface hover:bg-destructive-tint transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-text-secondary mt-4">Currency: {currency}. Edit or remove anything above, then File it to save into your Company Brain.</p>
    </div>
  );
}

export default function Ingest() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState("invoices");
  const [mainTab, setMainTab] = useState("import");
  const canIngest = hasPerm(user, "data_input");
  const { data: capPending } = useQuery({ queryKey: ["captures-pending"], queryFn: () => api.get("/captures/pending-count").then((r) => r.data), refetchInterval: 30000 });
  const pendingCount = capPending?.count || 0;

  const { data: history } = useQuery({ queryKey: ["ingestions"], queryFn: () => api.get("/ingest").then((r) => r.data) });
  const { data: invoices } = useQuery({ queryKey: ["invoices"], queryFn: () => api.get("/invoices").then((r) => r.data) });
  const { data: payments } = useQuery({ queryKey: ["payments"], queryFn: () => api.get("/payments").then((r) => r.data) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ingestions"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };

  const upload = async (endpoint, fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setUploading(true);
    setActive(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.status === "failed") {
        toast.error("Extraction failed: " + (data.error || "unreadable file"));
      } else {
        setActive(data);
        toast.success("Extracted — review below");
      }
      qc.invalidateQueries({ queryKey: ["ingestions"] });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onFiled = () => { setActive(null); refresh(); };

  const statusChip = (s) => s === "filed" ? "bg-primary text-primary-foreground" : s === "failed" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text";

  const tabsEl = (
    <div className="flex gap-2 mb-6" data-testid="capture-main-tabs">
      <button data-testid="capture-maintab-import" onClick={() => setMainTab("import")}
        className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border-2 border-hairline transition-all ${mainTab === "import" ? "bg-primary text-primary-foreground shadow-xs" : "bg-surface hover:bg-surface-hover"}`}>
        Import
      </button>
      <button data-testid="capture-maintab-review" onClick={() => setMainTab("review")}
        className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border-2 border-hairline transition-all flex items-center gap-2 ${mainTab === "review" ? "bg-primary text-primary-foreground shadow-xs" : "bg-surface hover:bg-surface-hover"}`}>
        Review Queue
        {pendingCount > 0 && (
          <span data-testid="review-tab-badge" className="bg-primary text-primary-foreground text-[10px] min-w-5 h-5 px-1 flex items-center justify-center border border-hairline font-bold rounded-full">{pendingCount}</span>
        )}
      </button>
    </div>
  );

  return (
    <div>
      <PageHeader eyebrow="Data Input" title="Ingest">
        <a href="#records" className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:bg-surface-hover transition-colors">
          <Receipt size={16} weight="bold" /> View records
        </a>
      </PageHeader>

      {mainTab === "review" && (<>{tabsEl}<CaptureReview /></>)}

      {mainTab === "import" && (<>
      {canIngest ? (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <label data-testid="upload-document-zone" className={`rounded-lg border border-hairline bg-surface p-6 flex flex-col items-center justify-center text-center cursor-pointer shadow-hover ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            <FilePdf size={36} weight="bold" className="text-primary-text mb-2" />
            <span className="font-bold uppercase tracking-tight">PDF / Photo</span>
            <span className="text-sm text-text-secondary mt-1">Invoice, bill, receipt or PO — AI reads it with OCR</span>
            <input type="file" data-testid="upload-document-input" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => { upload("/ingest/document", e.target.files); e.target.value = ""; }} />
          </label>
          <label data-testid="upload-csv-zone" className={`rounded-lg border border-hairline bg-surface p-6 flex flex-col items-center justify-center text-center cursor-pointer shadow-hover ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            <TableIcon size={36} weight="bold" className="text-primary-text mb-2" />
            <span className="font-bold uppercase tracking-tight">CSV / Excel</span>
            <span className="text-sm text-text-secondary mt-1">Customer, supplier, sales or payment list — columns auto-detected</span>
            <input type="file" data-testid="upload-csv-input" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { upload("/ingest/csv", e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      ) : (
        <EmptyState title="View-only" hint="Your role can browse filed records but not import new data." />
      )}

      {/* WhatsApp */}
      <WhatsAppCard />

      {tabsEl}

      {uploading && (
        <div className="rounded-lg border border-hairline bg-surface p-8 mb-8 flex items-center justify-center gap-3" data-testid="ingest-loading">
          <ArrowClockwise size={20} weight="bold" className="animate-spin text-primary-text" />
          <span className="uppercase tracking-tight text-sm">Reading document with AI…</span>
        </div>
      )}

      {active && <ReviewPanel ingestion={active} onFiled={onFiled} onCancel={() => setActive(null)} />}

      {/* Recent uploads */}
      {(history || []).length > 0 && (
        <div className="mb-8">
          <p className="text-label uppercase text-primary-text mb-3">Recent uploads</p>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} data-testid={`ingestion-row-${h.id}`} className="border border-hairline bg-surface p-3 flex items-center gap-3 flex-wrap">
                {h.kind === "csv" || h.kind === "xlsx" || h.kind === "xls" ? <TableIcon size={18} weight="bold" className="text-primary-text" /> : <FileArrowUp size={18} weight="bold" className="text-primary-text" />}
                <span className="text-sm font-semibold truncate max-w-[220px]">{h.filename}</span>
                <span className="text-xs text-text-secondary truncate flex-1 min-w-[120px]">{h.summary || h.entity || h.doc_type || ""}</span>
                <Chip value={h.status} className={statusChip(h.status)} />
                <FilePreview fileUrl={h.file_url} kind={h.kind} filename={h.filename} testid={`ingestion-view-${h.id}`} />
                {h.status === "filed" && h.created_counts && (
                  <span className="text-label uppercase text-text-secondary">{h.created_counts.contacts}C · {h.created_counts.invoices}I · {h.created_counts.payments}P · {h.created_counts.tasks}T</span>
                )}
                {h.status === "review" && !active && (
                  <button data-testid={`resume-ingestion-${h.id}`} onClick={() => setActive(h)} className="text-xs font-semibold uppercase tracking-wider border border-hairline px-2 py-1 hover:bg-primary hover:text-white transition-colors">Review</button>
                )}
                {h.status === "failed" && (
                  <p data-testid={`ingestion-error-${h.id}`} className="basis-full text-xs text-primary-text text-label uppercase break-words">
                    Failed: {h.error || "The file couldn't be read or understood. Check it's a valid .xlsx/.csv with a header row and data, then try again."}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filed records */}
      <div id="records">
        <div className="flex gap-2 mb-4">
          <button data-testid="records-tab-invoices" onClick={() => setTab("invoices")} className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline transition-colors ${tab === "invoices" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>Invoices & Bills</button>
          <button data-testid="records-tab-payments" onClick={() => setTab("payments")} className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline transition-colors ${tab === "payments" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>Payments</button>
        </div>

        {tab === "invoices" && (
          (invoices || []).length === 0 ? <EmptyState title="No invoices yet" hint="Upload an invoice or a sales CSV to get started." /> : (
            <div className="overflow-x-auto border border-hairline bg-surface" data-testid="invoices-table">
              <table className="w-full text-sm">
                <thead className="bg-primary text-primary-foreground"><tr>
                  {["Type", "Number", "Party", "Amount", "Due", "Status"].map((h) => <th key={h} className="text-left px-3 py-2 text-label uppercase">{h}</th>)}
                </tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} className="border-t border-hairline">
                      <td className="px-3 py-2"><Chip value={inv.type === "sales_invoice" ? "sales" : "purchase"} className={inv.type === "sales_invoice" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} /></td>
                      <td className="px-3 py-2 text-label uppercase">{inv.number || "—"}</td>
                      <td className="px-3 py-2">{inv.contact_name || "—"}</td>
                      <td className="px-3 py-2 font-semibold">{money(inv.amount, inv.currency)}</td>
                      <td className="px-3 py-2 text-label uppercase text-xs">{inv.due_date || "—"}</td>
                      <td className="px-3 py-2"><Chip value={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === "payments" && (
          (payments || []).length === 0 ? <EmptyState title="No payments yet" hint="Upload a payment receipt or a payments CSV." /> : (
            <div className="overflow-x-auto border border-hairline bg-surface" data-testid="payments-table">
              <table className="w-full text-sm">
                <thead className="bg-primary text-primary-foreground"><tr>
                  {["Direction", "Amount", "Party", "Method", "Reference", "Date"].map((h) => <th key={h} className="text-left px-3 py-2 text-label uppercase">{h}</th>)}
                </tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} data-testid={`payment-row-${p.id}`} className="border-t border-hairline">
                      <td className="px-3 py-2"><Chip value={p.direction === "in" ? "received" : "paid"} className={p.direction === "in" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} /></td>
                      <td className="px-3 py-2 font-semibold">{money(p.amount, p.currency)}</td>
                      <td className="px-3 py-2">{p.contact_name || "—"}</td>
                      <td className="px-3 py-2">{p.method || "—"}</td>
                      <td className="px-3 py-2 text-label uppercase text-xs">{p.reference || "—"}</td>
                      <td className="px-3 py-2 text-label uppercase text-xs">{p.date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      </>)}
    </div>
  );
}
