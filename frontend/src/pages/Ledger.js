import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { lex } from "../lib/lexicon";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import {
  Plus, Sparkle, Package, Receipt, TrendUp, Trash, Buildings, Robot,
  Paperclip, ArrowClockwise, PaperPlaneRight, WarningCircle, Brain, CaretDown, ListPlus,
  CurrencyDollar, Coins,
} from "@phosphor-icons/react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";

const PALETTE = ["#E63946", "#1E1E24", "#F4A261", "#457B9D", "#2A9D8F", "#E76F51", "#8D99AE", "#A8DADC", "#6D6875", "#B5838D", "#264653", "#E9C46A"];
const CHART_MARGIN = { top: 5, right: 5, left: 5, bottom: 5 };
const inp = "w-full border border-hairline rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40";
const label = "text-label uppercase text-text-secondary text-xs";

const fmt = (cur) => (n) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "INR", maximumFractionDigits: 0 }).format(n || 0); }
  catch { return `${cur || ""} ${Math.round(n || 0).toLocaleString()}`; }
};

const SOURCE_CHIP = { manual: "bg-surface-hover text-text", whatsapp: "bg-success-600 text-white", ingest: "bg-primary text-primary-foreground", document: "bg-primary text-primary-foreground" };
const LEVEL_DOT = { high: "bg-primary", medium: "bg-status-pending-bg", low: "bg-primary" };
// Urgency on a left edge, using the urgency tokens — the same language the
// grouped feed speaks, rather than three legacy hues.
const LEVEL_ACCENT = { high: "border-l-urgency-overdue", medium: "border-l-urgency-week", low: "border-l-urgency-later" };

function Field({ label: l, children }) {
  return <div><label className={label}>{l}</label><div className="mt-1">{children}</div></div>;
}

function FileField({ file, setFile }) {
  const { t } = useTranslation();
  return (
    <Field label={t("finance.attach_label")}>
      <label className="flex items-center gap-2 border border-dashed border-hairline rounded-lg px-3 py-2.5 text-sm cursor-pointer hover:bg-black/[0.02]">
        <Paperclip size={15} weight="bold" />
        <span className="truncate flex-1 text-text-secondary">{file ? file.name : t("finance.attach_ph")}</span>
        <input type="file" accept="image/*,application/pdf" className="hidden" data-testid="ledger-file-input" onChange={(e) => {
          const sel = e.target.files?.[0] || null;
          if (sel && sel.size > 15 * 1024 * 1024) { toast.error(t("finance.file_large")); return; }
          if (sel && !/^image\//.test(sel.type) && sel.type !== "application/pdf") { toast.error(t("finance.file_type")); return; }
          setFile(sel);
        }} />
      </label>
      {file && <button type="button" onClick={() => setFile(null)} className="mt-1 text-xs text-primary-text hover:underline">{t("finance.remove_attach")}</button>}
    </Field>
  );
}

function AttachmentLink({ att }) {
  const { t } = useTranslation();
  if (!att?.url) return null;
  return (
    <a href={`${process.env.REACT_APP_BACKEND_URL}${att.url}`} target="_blank" rel="noopener noreferrer" data-testid="view-attachment"
      className="ml-2 inline-flex items-center gap-1 text-xs text-primary-text hover:underline align-middle">
      <Paperclip size={12} weight="bold" /> {t("finance.bill")}
    </a>
  );
}

// ---------- Add dialogs ----------
function AddExpenseDialog({ categories, onDone }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const L = lex(tenant);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", amount: "", vendor_name: "", category: "", date: "", status: "unpaid", notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ title: "", amount: "", vendor_name: "", category: "", date: "", status: "unpaid", notes: "" }); setFile(null); };

  const suggest = async () => {
    const text = `${f.title} ${f.vendor_name} ${f.notes}`.trim();
    if (!text) return toast.error(t("finance.add_title_first"));
    setSuggesting(true);
    try { const { data } = await api.post("/expenses/suggest-category", { text }); set("category", data.category); toast.success(t("finance.ai_suggests", { category: data.category })); }
    catch { toast.error(t("finance.could_not_create")); } finally { setSuggesting(false); }
  };
  const save = async () => {
    if (!f.title.trim() && !f.amount && !file) return toast.error(t("finance.need_expense"));
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/expenses/with-file", fd);
      toast.success(file ? t("finance.added_bill") : t("finance.expense_added"));
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || t("finance.failed")); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-expense-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-sm transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_expense")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="uppercase tracking-tight">{t("finance.new_expense")}</DialogTitle><DialogDescription className="text-xs text-text-secondary">{t("finance.new_expense_desc")}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <Field label={t("finance.c_title")}><input data-testid="expense-title" className={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={t("finance.exp_title_ph")} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.c_amount")}><input data-testid="expense-amount" type="number" className={inp} value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label={t("finance.f_status")}>
              <select className={inp} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value="unpaid">{t("finance.unpaid")}</option><option value="paid">{t("finance.paid")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("finance.f_vendor", { vendor: L.vendor_singular })}><input data-testid="expense-vendor" className={inp} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></Field>
          <div>
            <div className="flex items-center justify-between">
              <label className={label}>{t("finance.c_category")}</label>
              <button type="button" onClick={suggest} disabled={suggesting} data-testid="expense-suggest-category" className="flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline disabled:opacity-50">
                <Sparkle size={13} weight="bold" /> {suggesting ? t("finance.thinking") : t("finance.ai_suggest")}
              </button>
            </div>
            <select data-testid="expense-category" className={`${inp} mt-1`} value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">{t("finance.auto")}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.c_date")}><input type="date" className={inp} value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
          </div>
          <Field label={t("finance.f_notes")}><textarea className={inp} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <button onClick={save} disabled={busy} data-testid="expense-save" className="w-full bg-primary text-primary-foreground py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-xs transition-all disabled:opacity-60">
            {busy ? (file ? t("finance.ai_reading") : t("finance.saving")) : t("finance.save_expense")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddAssetDialog({ categories, onDone }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", purchase_amount: "", category: "Equipment", vendor_name: "", purchase_date: "", status: "active", notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ name: "", purchase_amount: "", category: "Equipment", vendor_name: "", purchase_date: "", status: "active", notes: "" }); setFile(null); };
  const save = async () => {
    if (!f.name.trim() && !file) return toast.error(t("finance.need_asset"));
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/assets/with-file", fd);
      toast.success(file ? t("finance.asset_added_bill") : t("finance.asset_added"));
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || t("finance.failed")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-asset-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-sm transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_asset")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="uppercase tracking-tight">{t("finance.new_asset")}</DialogTitle><DialogDescription className="text-xs text-text-secondary">{t("finance.new_asset_desc")}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <Field label={t("finance.asset_name")}><input data-testid="asset-name" className={inp} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("finance.asset_name_ph")} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.purchase_amount")}><input data-testid="asset-amount" type="number" className={inp} value={f.purchase_amount} onChange={(e) => set("purchase_amount", e.target.value)} /></Field>
            <Field label={t("finance.c_category")}>
              <select data-testid="asset-category" className={inp} value={f.category} onChange={(e) => set("category", e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("finance.c_vendor")}><input className={inp} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.purchase_date")}><input type="date" className={inp} value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
            <Field label={t("finance.f_status")}>
              <select className={inp} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">{t("finance.active")}</option><option value="maintenance">{t("finance.maintenance")}</option><option value="disposed">{t("finance.disposed")}</option>
              </select>
            </Field>
          </div>
          <button onClick={save} disabled={busy} data-testid="asset-save" className="w-full bg-primary text-primary-foreground py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-xs transition-all disabled:opacity-60">
            {busy ? (file ? t("finance.ai_reading") : t("finance.saving")) : t("finance.save_asset")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddInventoryDialog({ onDone }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ item: "", sku: "", quantity: "", unit: "unit", unit_cost: "", category: "", vendor_name: "", notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ item: "", sku: "", quantity: "", unit: "unit", unit_cost: "", category: "", vendor_name: "", notes: "" }); setFile(null); };
  const save = async () => {
    if (!f.item.trim() && !file) return toast.error(t("finance.need_item"));
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/inventory/with-file", fd);
      toast.success(file ? t("finance.inv_added_bill") : t("finance.inv_added"));
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || t("finance.failed")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-inventory-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-sm transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_item")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="uppercase tracking-tight">{t("finance.new_inv")}</DialogTitle><DialogDescription className="text-xs text-text-secondary">{t("finance.new_inv_desc")}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.i_item")}><input data-testid="inv-item" className={inp} value={f.item} onChange={(e) => set("item", e.target.value)} /></Field>
            <Field label={t("finance.i_sku")}><input className={inp} value={f.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("finance.quantity")}><input data-testid="inv-qty" type="number" className={inp} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
            <Field label={t("finance.unit")}><input className={inp} value={f.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
            <Field label={t("finance.unit_cost")}><input data-testid="inv-cost" type="number" className={inp} value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.c_category")}><input className={inp} value={f.category} onChange={(e) => set("category", e.target.value)} /></Field>
            <Field label={t("finance.c_vendor")}><input className={inp} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></Field>
          </div>
          <button onClick={save} disabled={busy} data-testid="inv-save" className="w-full bg-primary text-primary-foreground py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-xs transition-all disabled:opacity-60">
            {busy ? (file ? t("finance.ai_reading") : t("finance.saving")) : t("finance.save_item")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddIncomeDialog({ onDone }) {
  const { tenant } = useAuth();
  const L = lex(tenant);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", customer_name: "", amount: "", number: "", date: "", due_date: "", status: "unpaid", notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ title: "", customer_name: "", amount: "", number: "", date: "", due_date: "", status: "unpaid", notes: "" }); setFile(null); };
  const save = async () => {
    if (!f.title.trim() && !f.amount && !f.customer_name.trim() && !file) return toast.error("Add a title, customer or amount");
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/revenue/with-file", fd);
      toast.success(file ? "Income recorded from the invoice" : "Income recorded");
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not record income"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-income-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-sm transition-all">
          <Plus size={16} weight="bold" /> Add income
        </button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-tight">Record sale / service income</DialogTitle>
          <DialogDescription className="text-xs text-text-secondary">Money coming IN. Attach a sales invoice and AI will read the amount & customer, or type it in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <Field label="What was it for"><input data-testid="income-title" className={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Design retainer · Order #204" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount"><input data-testid="income-amount" type="number" className={inp} value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label="Payment status">
              <select data-testid="income-status" className={inp} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value="unpaid">Awaiting payment</option>
                <option value="paid">Received</option>
              </select>
            </Field>
          </div>
          <Field label={`${L.customer_singular} name`}><input data-testid="income-customer" className={inp} value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Invoice #"><input className={inp} value={f.number} onChange={(e) => set("number", e.target.value)} /></Field>
            <Field label="Date"><input type="date" className={inp} value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Due date"><input type="date" className={inp} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
          </div>
          <button onClick={save} disabled={busy} data-testid="income-save" className="w-full bg-primary text-primary-foreground py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-xs transition-all disabled:opacity-60">
            {busy ? (file ? "AI reading…" : "Saving…") : "Save income"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ---------- AI insight pointers (create task / ask) ----------
function CreateTaskFromInsight({ insight, members, roleOptions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("medium");
  const [busy, setBusy] = useState(false);

  const openDialog = () => {
    setTitle(insight.action || insight.title || "");
    setDesc(insight.detail || "");
    setPriority(insight.level === "high" ? "high" : insight.level === "low" ? "low" : "medium");
    setAssignee("");
    setOpen(true);
  };
  const save = async () => {
    if (!title.trim()) return toast.error(t("finance.task_title_required"));
    setBusy(true);
    const payload = { title: title.trim(), description: desc.trim(), priority };
    if (assignee.startsWith("user:")) payload.assignee_id = assignee.slice(5);
    else if (assignee.startsWith("role:")) payload.assignee_role = assignee.slice(5);
    try { await api.post("/tasks", payload); toast.success(t("finance.task_created")); setOpen(false); }
    catch (e) { toast.error(e.response?.data?.detail || t("finance.could_not_create")); } finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={openDialog} data-testid="insight-create-task" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-hairline bg-primary text-primary-foreground px-3 py-1.5 hover:shadow-xs transition-all">
        <ListPlus size={13} weight="bold" /> {t("finance.create_task")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border border-hairline rounded-md">
          <DialogHeader><DialogTitle className="uppercase tracking-tight">{t("finance.new_task_insight")}</DialogTitle><DialogDescription className="text-xs text-text-secondary">{t("finance.new_task_insight_desc")}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label={t("finance.task_title")}><input data-testid="insight-task-title" className={inp} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={t("finance.description")}><textarea className={inp} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("finance.assign_to")}>
                <select className={inp} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="insight-task-assignee">
                  <option value="">{t("finance.unassigned")}</option>
                  {roleOptions.map((r) => <option key={`role:${r.key}`} value={`role:${r.key}`}>{t("finance.team_suffix", { role: r.label })}</option>)}
                  {members.map((m) => <option key={`user:${m.id}`} value={`user:${m.id}`}>{m.name}</option>)}
                </select>
              </Field>
              <Field label={t("finance.priority")}>
                <select className={inp} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">{t("finance.low")}</option><option value="medium">{t("finance.medium")}</option><option value="high">{t("finance.high")}</option>
                </select>
              </Field>
            </div>
            <button onClick={save} disabled={busy} data-testid="insight-task-save" className="w-full bg-primary text-primary-foreground py-2.5 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-xs transition-all disabled:opacity-60">
              {busy ? t("finance.creating") : t("finance.create_task")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InsightCard({ insight, scope, idx, members, roleOptions, onAsk }) {
  const { t } = useTranslation();
  const LEVEL_LABEL = { high: t("finance.urgent"), medium: t("finance.important"), low: t("finance.fyi") };
  const [open, setOpen] = useState(false);
  return (
    <div className={`border border-hairline border-l-4 ${LEVEL_ACCENT[insight.level] || "border-l-black"} rounded-lg bg-surface overflow-hidden transition-shadow hover:shadow-xs`} data-testid={`ai-alert-${scope}-${idx}`}>
      <button onClick={() => setOpen((o) => !o)} data-testid={`insight-toggle-${scope}-${idx}`} className="w-full flex items-center gap-3 p-3 text-left hover:bg-black/[0.02] transition-colors">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${LEVEL_DOT[insight.level] || "bg-black"}`} title={LEVEL_LABEL[insight.level]} />
        <span className="flex-1 min-w-0 font-semibold text-sm leading-snug">{insight.title}</span>
        <span className="hidden sm:inline text-label uppercase text-[10px] text-text-secondary shrink-0">{LEVEL_LABEL[insight.level] || ""}</span>
        <CaretDown size={16} weight="bold" className={`shrink-0 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          {insight.detail && <p className="text-sm text-text-secondary leading-relaxed">{insight.detail}</p>}
          <div className="flex flex-wrap gap-2">
            <CreateTaskFromInsight insight={insight} members={members} roleOptions={roleOptions} />
            <button onClick={() => onAsk(insight.title)} data-testid={`insight-ask-${scope}-${idx}`} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-hairline px-3 py-1.5 hover:bg-surface-hover transition-colors">
              <Brain size={13} weight="bold" /> {t("finance.ask_ai")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- AI Analysis panel (shared: brief + per-tab) ----------
function AiPanel({ scope, variant = "inline" }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tenant } = useAuth();
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger-ai", scope],
    queryFn: () => api.get(`/ledger/ai/${scope}`).then((r) => r.data),
    staleTime: Infinity,
  });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), retry: false });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];
  const isBrief = variant === "brief";

  const headline = data?.headline || data?.summary || "";
  const insights = data?.insights || [
    ...((data?.alerts) || []).map((a) => ({ level: a.level || "medium", title: a.title, detail: a.detail, action: a.title })),
    ...((data?.recommendations) || []).map((r) => ({ level: "low", title: r.title, detail: r.detail, action: r.title })),
  ];

  const refresh = async () => {
    setRefreshing(true);
    try { const { data: d } = await api.post(`/ledger/ai/${scope}/refresh`); qc.setQueryData(["ledger-ai", scope], d); toast.success(t("finance.refreshed")); }
    catch { toast.error(t("finance.refresh_failed")); } finally { setRefreshing(false); }
  };
  const ask = async (question) => {
    const query = (typeof question === "string" ? question : q).trim();
    if (!query) return;
    setQ(query); setAsking(true); setAnswer("");
    try { const { data: d } = await api.post("/ledger/ask", { question: query, scope }); setAnswer(d.answer); }
    catch (e) { toast.error(e.response?.data?.detail || t("finance.ai_busy")); } finally { setAsking(false); }
  };
  const onAsk = (title) => ask(`Tell me more and what should I do about: ${title}`);

  return (
    <div className={`rounded-lg border border-hairline bg-surface ${isBrief ? "p-6" : "p-5"} space-y-5`} data-testid={`ai-panel-${scope}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle size={isBrief ? 22 : 18} weight="fill" className="text-primary-text" />
          <h3 className={` font-black uppercase tracking-tight ${isBrief ? "text-lg" : "text-sm"}`}>{isBrief ? t("finance.finance_brief") : t("finance.ai_analysis")}</h3>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="text-[11px] text-text-secondary hidden sm:inline">{t("finance.updated", { time: new Date(data.generated_at).toLocaleString() })}</span>}
          <button onClick={refresh} disabled={refreshing} data-testid={`ai-refresh-${scope}`} className="flex items-center gap-1 text-xs font-semibold border border-hairline px-2.5 py-1.5 hover:bg-surface-hover transition-colors disabled:opacity-50">
            <ArrowClockwise size={13} weight="bold" className={refreshing ? "animate-spin" : ""} /> {refreshing ? t("finance.analysing") : t("finance.refresh")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-label uppercase text-sm text-text-secondary">{t("finance.analysing_fin")}</p>
      ) : (
        <>
          {headline && <p className={`${isBrief ? "text-base" : "text-sm"} font-semibold leading-snug`} data-testid={`ai-summary-${scope}`}>{headline}</p>}

          {insights.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-text-secondary"><WarningCircle size={15} weight="bold" /><span className="text-label uppercase text-xs">{t("finance.action_items")}</span></div>
              <div className="space-y-2">
                {insights.map((it, i) => (
                  <InsightCard key={`${it.title || ""}-${i}`} insight={it} scope={scope} idx={i} members={members} roleOptions={roleOptions} onAsk={onAsk} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="border-t border-hairline pt-4">
        <div className="flex items-center gap-1.5 mb-2 text-text-secondary"><Brain size={15} weight="bold" /><span className="text-label uppercase text-xs">{scope === "brief" ? t("finance.ask_about_fin") : t("finance.ask_about", { scope })}</span></div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} data-testid={`ai-ask-input-${scope}`} placeholder={t("finance.ask_ph")} className={inp} />
          <button onClick={() => ask()} disabled={asking} data-testid={`ai-ask-btn-${scope}`} className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all disabled:opacity-50 shrink-0">
            <PaperPlaneRight size={15} weight="bold" /> {asking ? "…" : t("finance.ask_btn")}
          </button>
        </div>
        {answer && <div className="mt-3 border border-hairline rounded-lg p-3 bg-black/[0.02] text-sm leading-relaxed" data-testid={`ai-answer-${scope}`}>{answer}</div>}
      </div>
    </div>
  );
}

// ---------- Sub-views ----------
function KPI({ icon: Icon, label: l, value, accent }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4" data-testid={`kpi-${l.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-2 text-text-secondary"><Icon size={16} weight="bold" /><span className="text-label uppercase text-xs">{l}</span></div>
      <p className={` text-2xl font-black tracking-tight mt-1 ${accent || ""}`}>{value}</p>
    </div>
  );
}

function KpiRow({ summary }) {
  const { t } = useTranslation();
  const f = fmt(summary.currency);
  const tt = summary.totals;
  const net = tt.net_profit ?? ((tt.revenue_billed || 0) - (tt.total_spend || 0));
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <KPI icon={CurrencyDollar} label="Revenue" value={f(tt.revenue_billed || 0)} accent="text-status-completed-fg" />
      <KPI icon={TrendUp} label={t("finance.k_spend")} value={f(tt.total_spend)} accent="text-primary-text" />
      <KPI icon={Coins} label="Net Profit" value={f(net)} accent={net >= 0 ? "text-status-completed-fg" : "text-primary-text"} />
      <KPI icon={Receipt} label="Received" value={f(tt.revenue_received || 0)} />
      <KPI icon={Buildings} label={t("finance.k_asset")} value={f(tt.asset_value)} />
      <KPI icon={Package} label={t("finance.k_inv")} value={f(tt.inventory_value)} />
    </div>
  );
}

function InvoicePicker({ open, value, onChange, cur, testid }) {
  const f = fmt(cur);
  const [q, setQ] = useState("");
  const [show, setShow] = useState(false);
  const sel = open.find((o) => o.id === value);
  const label = (o) => (o.number ? `#${o.number} · ` : "") + (o.contact_name || o.title || "Invoice") + ` · bal ${f(o.balance)}`;
  const filtered = open.filter((o) => label(o).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative" data-testid={testid}>
      <button type="button" onClick={() => setShow((s) => !s)} data-testid={`${testid}-toggle`}
        className={`${inp} w-full sm:w-[240px] text-left flex items-center justify-between gap-1`}>
        <span className={`truncate ${sel ? "" : "text-text-secondary"}`}>{sel ? label(sel) : "Match to invoice…"}</span>
        <CaretDown size={14} weight="bold" />
      </button>
      {show && (
        <div className="absolute z-30 mt-1 w-full sm:w-[280px] bg-surface border-2 border-hairline shadow-sm max-h-64 overflow-hidden flex flex-col">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testid}-search`}
            placeholder="Search invoice # or name…" className="px-3 py-2 text-sm border-b border-hairline focus:outline-none bg-transparent" />
          <div className="overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-3 text-xs text-text-secondary">No matching invoices</div>}
            {filtered.map((o) => (
              <button key={o.id} type="button" data-testid={`${testid}-opt-${o.id}`}
                onClick={() => { onChange(o.id); setShow(false); setQ(""); }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-destructive-tint transition-colors border-b border-hairline/50">
                {label(o)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NeedsMatchingPanel({ title, hint, unmatched, open, cur, endpoint, standaloneLabel, onChange, testid }) {
  const f = fmt(cur);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(null);
  if (!unmatched || unmatched.length === 0) return null;

  const match = async (pid) => {
    const invoice_id = picks[pid];
    if (!invoice_id) return toast.error("Pick an invoice to match");
    setBusy(pid);
    try {
      const { data } = await api.post(`${endpoint}/${pid}/match`, { invoice_id });
      toast.success(data.payment_remaining > 0.01 ? `Matched — ${f(data.payment_remaining)} still to match` : "Payment matched");
      setPicks((s) => ({ ...s, [pid]: "" })); onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not match"); } finally { setBusy(null); }
  };
  const standalone = async (pid) => {
    setBusy(pid);
    try { await api.post(`${endpoint}/${pid}/standalone`); toast.success(standaloneLabel.done); onChange(); }
    catch { toast.error("Could not update"); } finally { setBusy(null); }
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4 border-2 border-hairline-strong bg-primary-tint" data-testid={testid}>
      <div className="flex items-center gap-2 mb-1">
        <WarningCircle size={18} weight="bold" className="text-primary-text" />
        <h3 className="font-extrabold uppercase tracking-tight text-sm">{title} ({unmatched.length})</h3>
      </div>
      <p className="text-xs text-text-secondary mb-3">{hint}</p>
      <div className="space-y-2">
        {unmatched.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 bg-surface border border-hairline rounded-lg p-2" data-testid={`${testid}-item-${p.id}`}>
            <span className="text-sm font-semibold">{f(p.remaining ?? p.amount)}</span>
            <span className="text-xs text-text-secondary flex-1 min-w-0 truncate">{p.contact_name || "Unknown"}{p.date ? ` · ${p.date}` : ""}{p.invoice_number ? ` · ref ${p.invoice_number}` : ""}{p.applied > 0 ? ` · ${f(p.applied)} already applied` : ""}</span>
            <InvoicePicker open={open} value={picks[p.id] || ""} onChange={(v) => setPicks((s) => ({ ...s, [p.id]: v }))} cur={cur} testid={`match-picker-${p.id}`} />
            <button onClick={() => match(p.id)} disabled={busy === p.id} data-testid={`match-btn-${p.id}`} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-hairline bg-success-600 text-white hover:shadow-xs transition-all disabled:opacity-50">Match</button>
            <button onClick={() => standalone(p.id)} disabled={busy === p.id} data-testid={`standalone-btn-${p.id}`} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-hairline bg-surface hover:bg-surface-hover transition-all disabled:opacity-50">{standaloneLabel.btn}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueTab({ data, cur, onDelete, onChange }) {
  const f = fmt(cur);
  const tt = data?.totals || {};
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];
  const invStatus = (s) => s.status === "paid" ? { label: "received", cls: "bg-success-600 text-white" }
    : s.status === "partial" ? { label: "partial", cls: "bg-primary text-primary-foreground" }
    : { label: "awaiting", cls: "bg-status-pending-bg text-text" };
  return (
    <div className="space-y-6" data-testid="ledger-revenue">
      <div className="grid grid-cols-3 gap-3">
        <KPI icon={CurrencyDollar} label="Billed" value={f(tt.billed || 0)} accent="text-status-completed-fg" />
        <KPI icon={Receipt} label="Received" value={f(tt.received || 0)} />
        <KPI icon={WarningCircle} label="Outstanding" value={f(tt.outstanding || 0)} accent="text-primary-text" />
      </div>

      <NeedsMatchingPanel title="Needs matching" testid="revenue-needs-matching"
        hint="These received payments couldn’t be auto-linked to an invoice. Pick the right one, or mark it as standalone income."
        unmatched={data?.unmatched_payments} open={data?.open_invoices || []} cur={cur}
        endpoint="/revenue/payment" standaloneLabel={{ btn: "Standalone income", done: "Marked as standalone income" }}
        onChange={onChange} />

      <AiPanel scope="revenue" />

      <div>
        <h3 className="font-extrabold uppercase tracking-tight text-sm mb-3">Sales & Service Invoices ({invoices.length})</h3>
        {invoices.length === 0 ? (
          <EmptyState title="No income yet" hint="Record a sale/service with “Add income”, or send a sales invoice via WhatsApp/upload — it lands here." />
        ) : (
          <div className="rounded-lg border border-hairline bg-surface overflow-x-auto" data-testid="revenue-invoices-table">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-label uppercase text-xs text-text-secondary">
                <th className="p-3">For / Invoice</th><th className="p-3">Customer</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {invoices.map((s) => {
                  const st = invStatus(s);
                  return (
                  <tr key={s.id} className="border-b border-hairline/60 hover:bg-black/[0.02]" data-testid={`revenue-invoice-row-${s.id}`}>
                    <td className="p-3 font-medium">{s.title || (s.number ? `#${s.number}` : "Sale")}{s.source && s.source !== "manual" && <Chip value={s.source} className={`ml-2 ${SOURCE_CHIP[s.source] || "bg-surface-hover"}`} />}<AttachmentLink att={s.attachment} /></td>
                    <td className="p-3 text-text-secondary">{s.contact_name || "—"}</td>
                    <td className="p-3 text-text-secondary">{s.date || "—"}</td>
                    <td className="p-3"><Chip value={st.label} className={st.cls} />{s.status === "partial" && <span className="ml-2 text-xs text-text-secondary">bal {f(s.balance)}</span>}</td>
                    <td className="p-3 text-right text-label uppercase font-semibold">{f(s.amount)}</td>
                    <td className="p-3 text-right"><button onClick={() => onDelete("invoice", s.id)} data-testid={`revenue-invoice-delete-${s.id}`} className="text-text-secondary hover:text-primary-text"><Trash size={15} /></button></td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payments.length > 0 && (
        <div>
          <h3 className="font-extrabold uppercase tracking-tight text-sm mb-3">Payments Received ({payments.length})</h3>
          <div className="rounded-lg border border-hairline bg-surface overflow-x-auto" data-testid="revenue-payments-table">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-label uppercase text-xs text-text-secondary">
                <th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Method</th><th className="p-3">Reference</th><th className="p-3 text-right">Amount</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-hairline/60 hover:bg-black/[0.02]" data-testid={`revenue-payment-row-${p.id}`}>
                    <td className="p-3 text-text-secondary">{p.date || "—"}</td>
                    <td className="p-3 font-medium">{p.contact_name || "—"}{p.source && p.source !== "manual" && <Chip value={p.source} className={`ml-2 ${SOURCE_CHIP[p.source] || "bg-surface-hover"}`} />}</td>
                    <td className="p-3 text-text-secondary">{p.method || "—"}</td>
                    <td className="p-3 text-text-secondary">{p.reference || p.invoice_number || "—"}</td>
                    <td className="p-3 text-right text-label uppercase font-semibold text-status-completed-fg">{f(p.amount)}</td>
                    <td className="p-3 text-right"><button onClick={() => onDelete("payment", p.id)} data-testid={`revenue-payment-delete-${p.id}`} className="text-text-secondary hover:text-primary-text"><Trash size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ summary }) {
  const { t } = useTranslation();
  const f = fmt(summary.currency);
  return (
    <div className="space-y-6" data-testid="ledger-overview">
      <KpiRow summary={summary} />
      <AiPanel scope="brief" variant="brief" />

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-hairline bg-surface p-5">
          <h3 className="font-extrabold uppercase tracking-tight text-sm mb-4">{t("finance.monthly_spend")}</h3>
          {summary.by_month.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={summary.by_month} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip formatter={(v) => f(v)} />
                <Bar dataKey="amount" fill="#E63946" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-text-secondary">{t("finance.no_spend")}</p>}
        </div>

        <div className="rounded-lg border border-hairline bg-surface p-5">
          <h3 className="font-extrabold uppercase tracking-tight text-sm mb-4">{t("finance.by_category")}</h3>
          {summary.by_category.length ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={220}>
                <PieChart>
                  <Pie data={summary.by_category} dataKey="amount" nameKey="category" cx="50%" cy="50%" outerRadius={80} innerRadius={45}>
                    {summary.by_category.map((c, i) => <Cell key={c.category || i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => f(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 min-w-0">
                {summary.by_category.slice(0, 6).map((c, i) => (
                  <div key={c.category} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="truncate flex-1">{c.category}</span>
                    <span className="text-label uppercase font-semibold">{f(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-text-secondary">{t("finance.no_categories")}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-5">
        <h3 className="font-extrabold uppercase tracking-tight text-sm mb-4">{t("finance.top_vendors")}</h3>
        {summary.by_vendor.length ? (
          <div className="space-y-2">
            {summary.by_vendor.map((v, i) => {
              const max = summary.by_vendor[0].amount || 1;
              return (
                <div key={v.vendor} className="flex items-center gap-3">
                  <span className="w-32 sm:w-48 truncate text-sm">{v.vendor}</span>
                  <div className="flex-1 bg-surface-hover h-5 rounded-sm overflow-hidden"><div className="h-full rounded-sm" style={{ width: `${(v.amount / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
                  <span className="text-label uppercase text-sm font-semibold w-24 text-right">{f(v.amount)}</span>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-text-secondary">{t("finance.no_vendor")}</p>}
      </div>
    </div>
  );
}

function ExpensesTable({ rows, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title={t("finance.empty_exp_title")} hint={t("finance.empty_exp_hint")} />;
  return (
    <div className="rounded-lg border border-hairline bg-surface overflow-x-auto" data-testid="expenses-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-hairline text-left text-label uppercase text-xs text-text-secondary">
          <th className="p-3">{t("finance.c_title")}</th><th className="p-3">{t("finance.c_category")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3">{t("finance.c_date")}</th><th className="p-3">{t("finance.c_status")}</th><th className="p-3 text-right">{t("finance.c_amount")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-hairline/60 hover:bg-black/[0.02]" data-testid={`expense-row-${e.id}`}>
              <td className="p-3 font-medium">{e.title}{e.source !== "manual" && <Chip value={e.source} className={`ml-2 ${SOURCE_CHIP[e.source] || "bg-surface-hover"}`} />}<AttachmentLink att={e.attachment} /></td>
              <td className="p-3"><Chip value={e.category} className="text-text" /></td>
              <td className="p-3 text-text-secondary">{e.vendor_name || "—"}</td>
              <td className="p-3 text-text-secondary">{e.date || "—"}</td>
              <td className="p-3"><Chip value={e.status} className={e.status === "paid" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} /></td>
              <td className="p-3 text-right text-label uppercase font-semibold">{f(e.amount)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(e.id)} data-testid={`expense-delete-${e.id}`} className="text-text-secondary hover:text-primary-text"><Trash size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssetsTable({ rows, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title={t("finance.empty_asset_title")} hint={t("finance.empty_asset_hint")} />;
  return (
    <div className="rounded-lg border border-hairline bg-surface overflow-x-auto" data-testid="assets-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-hairline text-left text-label uppercase text-xs text-text-secondary">
          <th className="p-3">{t("finance.a_asset")}</th><th className="p-3">{t("finance.c_category")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3">{t("finance.a_bought")}</th><th className="p-3">{t("finance.c_status")}</th><th className="p-3 text-right">{t("finance.a_value")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-hairline/60 hover:bg-black/[0.02]" data-testid={`asset-row-${a.id}`}>
              <td className="p-3 font-medium">{a.name}{a.source !== "manual" && <Chip value={a.source} className={`ml-2 ${SOURCE_CHIP[a.source] || "bg-surface-hover"}`} />}<AttachmentLink att={a.attachment} /></td>
              <td className="p-3"><Chip value={a.category} className="text-text" /></td>
              <td className="p-3 text-text-secondary">{a.vendor_name || "—"}</td>
              <td className="p-3 text-text-secondary">{a.purchase_date || "—"}</td>
              <td className="p-3"><Chip value={a.status} className={a.status === "active" ? "bg-primary text-primary-foreground" : "bg-surface-hover text-text"} /></td>
              <td className="p-3 text-right text-label uppercase font-semibold">{f(a.purchase_amount)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(a.id)} className="text-text-secondary hover:text-primary-text"><Trash size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryTable({ rows, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title={t("finance.empty_inv_title")} hint={t("finance.empty_inv_hint")} />;
  return (
    <div className="rounded-lg border border-hairline bg-surface overflow-x-auto" data-testid="inventory-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-hairline text-left text-label uppercase text-xs text-text-secondary">
          <th className="p-3">{t("finance.i_item")}</th><th className="p-3">{t("finance.i_sku")}</th><th className="p-3">{t("finance.i_qty")}</th><th className="p-3">{t("finance.i_unitcost")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3 text-right">{t("finance.i_value")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-hairline/60 hover:bg-black/[0.02]" data-testid={`inv-row-${i.id}`}>
              <td className="p-3 font-medium">{i.item}<AttachmentLink att={i.attachment} /></td>
              <td className="p-3 text-text-secondary">{i.sku || "—"}</td>
              <td className="p-3 text-label uppercase">{i.quantity} {i.unit}</td>
              <td className="p-3 text-label uppercase">{f(i.unit_cost)}</td>
              <td className="p-3 text-text-secondary">{i.vendor_name || "—"}</td>
              <td className="p-3 text-right text-label uppercase font-semibold">{f(i.value)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(i.id)} className="text-text-secondary hover:text-primary-text"><Trash size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { key: "overview", tkey: "finance.t_overview", icon: Sparkle },
  { key: "revenue", tkey: "finance.t_revenue", icon: CurrencyDollar },
  { key: "expenses", tkey: "finance.t_expenses", icon: Receipt },
  { key: "assets", tkey: "finance.t_assets", icon: Buildings },
  { key: "inventory", tkey: "finance.t_inventory", icon: Package },
];

export default function Ledger() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = TABS.some((tb) => tb.key === searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const [tab, setTab] = useState(initialTab);
  const [reclassifying, setReclassifying] = useState(false);
  const qc = useQueryClient();
  const invalidate = () => ["ledger-summary", "expenses", "assets", "inventory", "revenue", "payables"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const reclassify = async () => {
    if (!window.confirm("Re-run AI on all filed purchase bills and move any mis-booked ones into the correct bucket (Expense / Asset / Inventory)? This updates your ledger.")) return;
    setReclassifying(true);
    try {
      const { data: s } = await api.post("/ledger/reclassify-purchases");
      invalidate();
      qc.invalidateQueries({ queryKey: ["ledger-ai"] });
      toast.success(`Reviewed ${s.reviewed} bills — ${s.to_asset} → assets, ${s.to_inventory} → inventory${s.unknown ? `, ${s.unknown} need manual review` : ""}.`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Re-classification failed"); }
    finally { setReclassifying(false); }
  };

  const summaryQ = useQuery({ queryKey: ["ledger-summary"], queryFn: () => api.get("/ledger/summary").then((r) => r.data) });
  const expensesQ = useQuery({ queryKey: ["expenses"], queryFn: () => api.get("/expenses").then((r) => r.data) });
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => api.get("/assets").then((r) => r.data) });
  const inventoryQ = useQuery({ queryKey: ["inventory"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const revenueQ = useQuery({ queryKey: ["revenue"], queryFn: () => api.get("/revenue").then((r) => r.data) });
  const payablesQ = useQuery({ queryKey: ["payables"], queryFn: () => api.get("/payables").then((r) => r.data) });

  const summary = summaryQ.data;
  const cur = summary?.currency || "INR";
  const categories = summary?.categories || [];
  const assetCategories = summary?.asset_categories || [];

  const del = async (kind, id) => {
    try { await api.delete(`/${kind}/${id}`); invalidate(); toast.success(t("finance.deleted")); }
    catch { toast.error(t("finance.del_failed")); }
  };

  const delRevenue = async (kind, id) => {
    try { await api.delete(`/revenue/${kind}/${id}`); invalidate(); toast.success(t("finance.deleted")); }
    catch { toast.error(t("finance.del_failed")); }
  };

  const addBtn = useMemo(() => {
    if (tab === "revenue") return <AddIncomeDialog onDone={invalidate} />;
    if (tab === "expenses") return <AddExpenseDialog categories={categories} onDone={invalidate} />;
    if (tab === "assets") return <AddAssetDialog categories={assetCategories} onDone={invalidate} />;
    if (tab === "inventory") return <AddInventoryDialog onDone={invalidate} />;
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, categories, assetCategories]);

  return (
    <div>
      <PageHeader eyebrow={t("finance.eyebrow")} title={t("finance.title")}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto" data-testid="ledger-controls">
          <div className="grid grid-cols-2 gap-2 sm:gap-0 sm:flex sm:border sm:border-hairline sm:overflow-hidden w-full sm:w-auto">
            {TABS.map((tb) => (
              <button key={tb.key} onClick={() => setTab(tb.key)} data-testid={`ledger-tab-${tb.key}`}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold uppercase tracking-wider border border-hairline sm:border-0 sm:border-r sm:border-hairline sm:last:border-r-0 transition-colors ${tab === tb.key ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
                <tb.icon size={15} weight="bold" /> {t(tb.tkey)}
              </button>
            ))}
          </div>
          {addBtn}
          {user?.role === "owner" && (
            <button onClick={reclassify} disabled={reclassifying} data-testid="ledger-reclassify-btn"
              title="Re-run AI classification on historical purchase bills"
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold uppercase tracking-wider border border-hairline bg-surface hover:bg-surface-hover transition-colors disabled:opacity-50 w-full sm:w-auto">
              <ArrowClockwise size={15} weight="bold" className={reclassifying ? "animate-spin" : ""} />
              {reclassifying ? "Re-classifying…" : "Fix old purchases"}
            </button>
          )}
        </div>
      </PageHeader>

      {(summaryQ.isLoading && tab === "overview") ? (
        <p className="text-label uppercase text-sm">{t("finance.loading")}</p>
      ) : (
        <>
          {tab === "overview" && summary && <OverviewTab summary={summary} />}
          {tab === "revenue" && <RevenueTab data={revenueQ.data} cur={cur} onDelete={delRevenue} onChange={invalidate} />}
          {tab === "expenses" && <div className="space-y-6"><NeedsMatchingPanel title="Supplier payments to match" testid="payables-needs-matching" hint="These payments to suppliers couldn’t be auto-linked to a purchase bill. Pick the bill they settle, or mark as a standalone expense." unmatched={payablesQ.data?.unmatched_payments} open={payablesQ.data?.open_invoices || []} cur={cur} endpoint="/payables/payment" standaloneLabel={{ btn: "Standalone expense", done: "Booked as a standalone expense" }} onChange={invalidate} /><AiPanel scope="expenses" /><ExpensesTable rows={expensesQ.data || []} cur={cur} onDelete={(id) => del("expenses", id)} /></div>}
          {tab === "assets" && <div className="space-y-6"><AiPanel scope="assets" /><AssetsTable rows={assetsQ.data || []} cur={cur} onDelete={(id) => del("assets", id)} /></div>}
          {tab === "inventory" && <div className="space-y-6"><AiPanel scope="inventory" /><InventoryTable rows={inventoryQ.data || []} cur={cur} onDelete={(id) => del("inventory", id)} /></div>}
        </>
      )}

      {tab === "overview" && (
        <p className="mt-6 text-xs text-text-secondary flex items-center gap-1.5">
          <Robot size={14} weight="bold" /> {t("finance.auto_flow")}
        </p>
      )}
    </div>
  );
}
