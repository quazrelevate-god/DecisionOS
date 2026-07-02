import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
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
} from "@phosphor-icons/react";

const inp = "w-full border border-black px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:shadow-brutal-sm bg-white";

const EMPTY = { contacts: [], invoices: [], payments: [], tasks: [] };

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="label-mono text-muted-foreground text-[10px]">{label}</span>
      <input className={inp} value={value ?? ""} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ReviewPanel({ ingestion, onFiled, onCancel }) {
  const { tenant } = useAuth();
  const currency = tenant?.currency || "INR";
  const [records, setRecords] = useState({ ...EMPTY, ...(ingestion.records || {}) });
  const [filing, setFiling] = useState(false);

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
    setFiling(true);
    try {
      const { data } = await api.post(`/ingest/${ingestion.id}/commit`, { records });
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

      {/* Contacts */}
      {(records.contacts || []).length > 0 && (
        <div className="mb-5" data-testid="review-contacts">
          <p className="label-mono text-brand-red mb-2 flex items-center gap-1"><UsersThree size={14} weight="bold" /> Customers & Vendors ({records.contacts.length})</p>
          <div className="space-y-2">
            {records.contacts.map((c, i) => (
              <div key={i} className="border border-black/20 p-3 grid grid-cols-2 md:grid-cols-4 gap-2 relative" data-testid={`review-contact-${i}`}>
                <Field label="Type" value={c.type} onChange={(v) => setItem("contacts", i, "type", v)} />
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
            {records.invoices.map((inv, i) => (
              <div key={i} className="border border-black/20 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 relative" data-testid={`review-invoice-${i}`}>
                <Field label="Type" value={inv.type} onChange={(v) => setItem("invoices", i, "type", v)} />
                <Field label="Number" value={inv.number} onChange={(v) => setItem("invoices", i, "number", v)} />
                <Field label="Party" value={inv.contact_name} onChange={(v) => setItem("invoices", i, "contact_name", v)} />
                <Field label="Amount" value={inv.amount} onChange={(v) => setItem("invoices", i, "amount", v)} />
                <Field label="Due date" value={inv.due_date} onChange={(v) => setItem("invoices", i, "due_date", v)} />
                <button onClick={() => removeItem("invoices", i)} data-testid={`remove-invoice-${i}`} className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center border border-black bg-white hover:bg-brand-red hover:text-white transition-colors"><Trash size={12} weight="bold" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payments */}
      {(records.payments || []).length > 0 && (
        <div className="mb-5" data-testid="review-payments">
          <p className="label-mono text-brand-red mb-2 flex items-center gap-1"><CurrencyCircleDollar size={14} weight="bold" /> Payments ({records.payments.length})</p>
          <div className="space-y-2">
            {records.payments.map((p, i) => (
              <div key={i} className="border border-black/20 p-3 grid grid-cols-2 md:grid-cols-5 gap-2 relative" data-testid={`review-payment-${i}`}>
                <Field label="Direction" value={p.direction} onChange={(v) => setItem("payments", i, "direction", v)} />
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
              <div key={i} className="border border-black/20 p-3 flex items-center gap-2 relative" data-testid={`review-task-${i}`}>
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

export default function Ingest() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState("invoices");
  const canIngest = hasPerm(user, "data_input");

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

  const statusChip = (s) => s === "filed" ? "bg-brand-ink text-white" : s === "failed" ? "bg-brand-red text-white" : "bg-brand-yellow text-black";

  return (
    <div>
      <PageHeader eyebrow="Data Input" title="Ingest">
        <a href="#records" className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-black/5 transition-colors">
          <Receipt size={16} weight="bold" /> View records
        </a>
      </PageHeader>

      {canIngest ? (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <label data-testid="upload-document-zone" className={`card-brutal p-6 flex flex-col items-center justify-center text-center cursor-pointer shadow-hover ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            <FilePdf size={36} weight="bold" className="text-brand-red mb-2" />
            <span className="font-heading font-bold uppercase tracking-tight">PDF / Photo</span>
            <span className="text-sm text-muted-foreground mt-1">Invoice, bill, receipt or PO — AI reads it with OCR</span>
            <input type="file" data-testid="upload-document-input" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => { upload("/ingest/document", e.target.files); e.target.value = ""; }} />
          </label>
          <label data-testid="upload-csv-zone" className={`card-brutal p-6 flex flex-col items-center justify-center text-center cursor-pointer shadow-hover ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            <TableIcon size={36} weight="bold" className="text-brand-blue mb-2" />
            <span className="font-heading font-bold uppercase tracking-tight">CSV / Excel</span>
            <span className="text-sm text-muted-foreground mt-1">Customer, vendor, sales or payment list — columns auto-detected</span>
            <input type="file" data-testid="upload-csv-input" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { upload("/ingest/csv", e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      ) : (
        <EmptyState title="View-only" hint="Your role can browse filed records but not import new data." />
      )}

      {/* WhatsApp coming soon */}
      <div className="border border-dashed border-black/40 p-4 flex items-center gap-3 mb-8" data-testid="whatsapp-soon-banner">
        <WhatsappLogo size={24} weight="bold" className="text-green-600" />
        <div className="flex-1">
          <p className="font-semibold text-sm">WhatsApp forwarding <span className="label-mono text-muted-foreground ml-1">coming soon</span></p>
          <p className="text-xs text-muted-foreground">Soon your team can forward an invoice or payment screenshot to DecisionOS on WhatsApp and it files itself — powered by this same pipeline.</p>
        </div>
      </div>

      {uploading && (
        <div className="card-brutal p-8 mb-8 flex items-center justify-center gap-3" data-testid="ingest-loading">
          <ArrowClockwise size={20} weight="bold" className="animate-spin text-brand-red" />
          <span className="font-heading uppercase tracking-tight text-sm">Reading document with AI…</span>
        </div>
      )}

      {active && <ReviewPanel ingestion={active} onFiled={onFiled} onCancel={() => setActive(null)} />}

      {/* Recent uploads */}
      {(history || []).length > 0 && (
        <div className="mb-8">
          <p className="label-mono text-brand-red mb-3">Recent uploads</p>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} data-testid={`ingestion-row-${h.id}`} className="border border-black bg-white p-3 flex items-center gap-3 flex-wrap">
                {h.kind === "csv" || h.kind === "xlsx" || h.kind === "xls" ? <TableIcon size={18} weight="bold" className="text-brand-blue" /> : <FileArrowUp size={18} weight="bold" className="text-brand-red" />}
                <span className="text-sm font-semibold truncate max-w-[220px]">{h.filename}</span>
                <span className="text-xs text-muted-foreground truncate flex-1 min-w-[120px]">{h.summary || h.entity || h.doc_type || ""}</span>
                <Chip value={h.status} className={statusChip(h.status)} />
                {h.status === "filed" && h.created_counts && (
                  <span className="label-mono text-muted-foreground">{h.created_counts.contacts}C · {h.created_counts.invoices}I · {h.created_counts.payments}P · {h.created_counts.tasks}T</span>
                )}
                {h.status === "review" && !active && (
                  <button data-testid={`resume-ingestion-${h.id}`} onClick={() => setActive(h)} className="text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">Review</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filed records */}
      <div id="records">
        <div className="flex gap-2 mb-4">
          <button data-testid="records-tab-invoices" onClick={() => setTab("invoices")} className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black transition-colors ${tab === "invoices" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>Invoices & Bills</button>
          <button data-testid="records-tab-payments" onClick={() => setTab("payments")} className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black transition-colors ${tab === "payments" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>Payments</button>
        </div>

        {tab === "invoices" && (
          (invoices || []).length === 0 ? <EmptyState title="No invoices yet" hint="Upload an invoice or a sales CSV to get started." /> : (
            <div className="overflow-x-auto border border-black bg-white" data-testid="invoices-table">
              <table className="w-full text-sm">
                <thead className="bg-brand-ink text-white"><tr>
                  {["Type", "Number", "Party", "Amount", "Due", "Status"].map((h) => <th key={h} className="text-left px-3 py-2 label-mono">{h}</th>)}
                </tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} className="border-t border-black/10">
                      <td className="px-3 py-2"><Chip value={inv.type === "sales_invoice" ? "sales" : "purchase"} className={inv.type === "sales_invoice" ? "bg-brand-blue text-white" : "bg-brand-yellow text-black"} /></td>
                      <td className="px-3 py-2 font-mono">{inv.number || "—"}</td>
                      <td className="px-3 py-2">{inv.contact_name || "—"}</td>
                      <td className="px-3 py-2 font-semibold">{money(inv.amount, inv.currency)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{inv.due_date || "—"}</td>
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
            <div className="overflow-x-auto border border-black bg-white" data-testid="payments-table">
              <table className="w-full text-sm">
                <thead className="bg-brand-ink text-white"><tr>
                  {["Direction", "Amount", "Party", "Method", "Reference", "Date"].map((h) => <th key={h} className="text-left px-3 py-2 label-mono">{h}</th>)}
                </tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} data-testid={`payment-row-${p.id}`} className="border-t border-black/10">
                      <td className="px-3 py-2"><Chip value={p.direction === "in" ? "received" : "paid"} className={p.direction === "in" ? "bg-brand-blue text-white" : "bg-brand-yellow text-black"} /></td>
                      <td className="px-3 py-2 font-semibold">{money(p.amount, p.currency)}</td>
                      <td className="px-3 py-2">{p.contact_name || "—"}</td>
                      <td className="px-3 py-2">{p.method || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.reference || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
