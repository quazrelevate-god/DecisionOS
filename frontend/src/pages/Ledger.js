import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import FinanceMobile from "./mobile/FinanceMobile";
import { lex } from "../lib/lexicon";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import {
  Plus, Sparkle, Package, Receipt, TrendUp, Trash, Buildings, Robot,
  Paperclip, ArrowClockwise, PaperPlaneRight, WarningCircle, Brain, CaretDown, ListPlus,
  CurrencyDollar, Coins,
  // Epic 2 Sprint 4: hero capture bar + Inbox tab
  FilePdf, Camera, UploadSimple, Tray, WhatsappLogo,
} from "@phosphor-icons/react";
// Epic 2 Sprint 4 (E2-24 / E2-25 / E2-26): pull Capture Review Queue,
// upload ReviewPanel, and WhatsApp status card from Ingest.js so
// document-capture lives on /finance as the merged surface.
import { CaptureReview } from "./Captures";
// E2-30 (2026-08-15): extracted from Ingest.js so it could be retired.
import ReviewPanel from "./finance/ReviewPanel";
import WhatsAppCard from "./finance/WhatsAppCard";
import { hasPerm } from "../lib/perms";
import { formatApiError } from "../lib/api";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";

const PALETTE = ["#E63946", "#1E1E24", "#F4A261", "#457B9D", "#2A9D8F", "#E76F51", "#8D99AE", "#A8DADC", "#6D6875", "#B5838D", "#264653", "#E9C46A"];
const CHART_MARGIN = { top: 5, right: 5, left: 5, bottom: 5 };
const inp = "w-full nm-field px-3 py-2 text-sm";
const label = "text-xs text-muted-foreground";

const fmt = (cur) => (n) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "INR", maximumFractionDigits: 0 }).format(n || 0); }
  catch { return `${cur || ""} ${Math.round(n || 0).toLocaleString()}`; }
};

const SOURCE_CHIP = { manual: "bg-nm-sunken text-muted-foreground", whatsapp: "bg-success-50 text-success-800", ingest: "bg-brand-50 text-brand-700", document: "bg-brand-50 text-brand-700" };
const LEVEL_DOT = { high: "bg-danger-600", medium: "bg-caution-500", low: "bg-brand-600" };
const LEVEL_ACCENT = { high: "border-l-danger-600", medium: "border-l-caution-500", low: "border-l-brand-600" };

function Field({ label: l, children }) {
  return <div><label className={label}>{l}</label><div className="mt-1">{children}</div></div>;
}

function FileField({ file, setFile }) {
  const { t } = useTranslation();
  return (
    <Field label={t("finance.attach_label")}>
      <label className="flex items-center gap-2 border border-dashed border-nm-edge/40 rounded-lg px-3 py-2.5 text-sm cursor-pointer hover:bg-accent/50">
        <Paperclip size={15} weight="bold" />
        <span className="truncate flex-1 text-muted-foreground">{file ? file.name : t("finance.attach_ph")}</span>
        <input type="file" accept="image/*,application/pdf" className="hidden" data-testid="ledger-file-input" onChange={(e) => {
          const sel = e.target.files?.[0] || null;
          if (sel && sel.size > 15 * 1024 * 1024) { toast.error(t("finance.file_large")); return; }
          if (sel && !/^image\//.test(sel.type) && sel.type !== "application/pdf") { toast.error(t("finance.file_type")); return; }
          setFile(sel);
        }} />
      </label>
      {file && <button type="button" onClick={() => setFile(null)} className="mt-1 text-xs text-danger-600 hover:underline">{t("finance.remove_attach")}</button>}
    </Field>
  );
}

function AttachmentLink({ att }) {
  const { t } = useTranslation();
  if (!att?.url) return null;
  return (
    <a href={`${process.env.REACT_APP_BACKEND_URL}${att.url}`} target="_blank" rel="noopener noreferrer" data-testid="view-attachment"
      className="ml-2 inline-flex items-center gap-1 text-xs text-brand-blue hover:underline align-middle">
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
        <button data-testid="add-expense-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-medium nm-tile transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_expense")}
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">{t("finance.new_expense")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_expense_desc")}</DialogDescription></DialogHeader>
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
              <button type="button" onClick={suggest} disabled={suggesting} data-testid="expense-suggest-category" className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50">
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
          <button onClick={save} disabled={busy} data-testid="expense-save" className="w-full bg-brand-600 text-white py-2.5 text-sm font-medium nm-tile transition-all disabled:opacity-60">
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
        <button data-testid="add-asset-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-medium nm-tile transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_asset")}
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">{t("finance.new_asset")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_asset_desc")}</DialogDescription></DialogHeader>
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
          <button onClick={save} disabled={busy} data-testid="asset-save" className="w-full bg-brand-600 text-white py-2.5 text-sm font-medium nm-tile transition-all disabled:opacity-60">
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
        <button data-testid="add-inventory-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-medium nm-tile transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_item")}
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">{t("finance.new_inv")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_inv_desc")}</DialogDescription></DialogHeader>
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
          <button onClick={save} disabled={busy} data-testid="inv-save" className="w-full bg-brand-600 text-white py-2.5 text-sm font-medium nm-tile transition-all disabled:opacity-60">
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
        <button data-testid="add-income-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-primary text-primary-foreground px-4 py-2 text-sm font-medium nm-tile transition-all">
          <Plus size={16} weight="bold" /> Add income
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Record sale / service income</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Money coming IN. Attach a sales invoice and AI will read the amount & customer, or type it in.</DialogDescription>
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
          <button onClick={save} disabled={busy} data-testid="income-save" className="w-full bg-brand-600 text-white py-2.5 text-sm font-medium nm-tile transition-all disabled:opacity-60">
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
      <button onClick={openDialog} data-testid="insight-create-task" className="flex items-center gap-1.5 text-xs font-medium nm-tile bg-brand-600 text-white px-3 py-1.5 transition-all">
        <ListPlus size={13} weight="bold" /> {t("finance.create_task")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-cardlg border border-nm-edge/40">
          <DialogHeader><DialogTitle className="font-display text-xl">{t("finance.new_task_insight")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_task_insight_desc")}</DialogDescription></DialogHeader>
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
            <button onClick={save} disabled={busy} data-testid="insight-task-save" className="w-full bg-brand-600 text-white py-2.5 text-sm font-medium nm-tile transition-all disabled:opacity-60">
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
    <div className={`nm-tile border-l-4 ${LEVEL_ACCENT[insight.level] || "border-l-black"} rounded-lg bg-nm overflow-hidden transition-shadow`} data-testid={`ai-alert-${scope}-${idx}`}>
      <button onClick={() => setOpen((o) => !o)} data-testid={`insight-toggle-${scope}-${idx}`} className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${LEVEL_DOT[insight.level] || "bg-black"}`} title={LEVEL_LABEL[insight.level]} />
        <span className="flex-1 min-w-0 font-semibold text-sm leading-snug">{insight.title}</span>
        <span className="hidden sm:inline label-mono text-[10px] text-muted-foreground shrink-0">{LEVEL_LABEL[insight.level] || ""}</span>
        <CaretDown size={16} weight="bold" className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3">
          {insight.detail && <p className="text-sm text-muted-foreground leading-relaxed">{insight.detail}</p>}
          <div className="flex flex-wrap gap-2">
            <CreateTaskFromInsight insight={insight} members={members} roleOptions={roleOptions} />
            <button onClick={() => onAsk(insight.title)} data-testid={`insight-ask-${scope}-${idx}`} className="flex items-center gap-1.5 text-xs font-medium nm-tile px-3 py-1.5 hover:bg-accent transition-colors">
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
    <div className={`card-brutal ${isBrief ? "p-6" : "p-5"} space-y-5`} data-testid={`ai-panel-${scope}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle size={isBrief ? 22 : 18} weight="fill" className="text-brand-600" />
          <h3 className={`font-medium ${isBrief ? "text-base" : "text-sm"}`}>{isBrief ? t("finance.finance_brief") : t("finance.ai_analysis")}</h3>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="text-[11px] text-muted-foreground hidden sm:inline">{t("finance.updated", { time: new Date(data.generated_at).toLocaleString() })}</span>}
          <button onClick={refresh} disabled={refreshing} data-testid={`ai-refresh-${scope}`} className="flex items-center gap-1 text-xs font-semibold nm-tile px-2.5 py-1.5 hover:bg-accent transition-colors disabled:opacity-50">
            <ArrowClockwise size={13} weight="bold" className={refreshing ? "animate-spin" : ""} /> {refreshing ? t("finance.analysing") : t("finance.refresh")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">{t("finance.analysing_fin")}</p>
      ) : (
        <>
          {headline && <p className={`${isBrief ? "text-base" : "text-sm"} font-semibold leading-snug`} data-testid={`ai-summary-${scope}`}>{headline}</p>}

          {insights.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-muted-foreground"><WarningCircle size={15} weight="bold" /><span className="label-mono text-xs">{t("finance.action_items")}</span></div>
              <div className="space-y-2">
                {insights.map((it, i) => (
                  <InsightCard key={`${it.title || ""}-${i}`} insight={it} scope={scope} idx={i} members={members} roleOptions={roleOptions} onAsk={onAsk} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="border-t border-nm-edge/40 pt-4">
        <div className="flex items-center gap-1.5 mb-2 text-muted-foreground"><Brain size={15} weight="bold" /><span className="label-mono text-xs">{scope === "brief" ? t("finance.ask_about_fin") : t("finance.ask_about", { scope })}</span></div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} data-testid={`ai-ask-input-${scope}`} placeholder={t("finance.ask_ph")} className={inp} />
          <button onClick={() => ask()} disabled={asking} data-testid={`ai-ask-btn-${scope}`} className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold nm-tile transition-all disabled:opacity-50 shrink-0">
            <PaperPlaneRight size={15} weight="bold" /> {asking ? "…" : t("finance.ask_btn")}
          </button>
        </div>
        {answer && <div className="mt-3 nm-inset p-3 text-sm leading-relaxed" data-testid={`ai-answer-${scope}`}>{answer}</div>}
      </div>
    </div>
  );
}

// ---------- Sub-views ----------
function KPI({ icon: Icon, label: l, value, accent }) {
  return (
    <div className="card-brutal p-4" data-testid={`kpi-${l.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-1.5 text-muted-foreground"><Icon size={14} /><span className="text-xs">{l}</span></div>
      <p className={`text-2xl font-medium tabular-nums mt-1.5 ${accent || ""}`}>{value}</p>
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
      <KPI icon={CurrencyDollar} label="Revenue" value={f(tt.revenue_billed || 0)} accent="text-success-600" />
      <KPI icon={TrendUp} label={t("finance.k_spend")} value={f(tt.total_spend)} accent="text-brand-600" />
      <KPI icon={Coins} label="Net Profit" value={f(net)} accent={net >= 0 ? "text-success-600" : "text-brand-600"} />
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
        <span className={`truncate ${sel ? "" : "text-muted-foreground"}`}>{sel ? label(sel) : "Match to invoice…"}</span>
        <CaretDown size={14} weight="bold" />
      </button>
      {show && (
        <div className="absolute z-30 mt-1 w-full sm:w-[280px] bg-nm nm-tile shadow-md max-h-64 overflow-hidden flex flex-col">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${testid}-search`}
            placeholder="Search invoice # or name…" className="px-3 py-2 text-sm border-b border-nm-edge/40 focus:outline-none bg-transparent" />
          <div className="overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">No matching invoices</div>}
            {filtered.map((o) => (
              <button key={o.id} type="button" data-testid={`${testid}-opt-${o.id}`}
                onClick={() => { onChange(o.id); setShow(false); setQ(""); }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-brand-600 hover:text-white transition-colors border-b border-nm-edge/40/50">
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
    <div className="card-brutal p-4 border-2 border-brand-600 bg-brand-600/5" data-testid={testid}>
      <div className="flex items-center gap-2 mb-1">
        <WarningCircle size={18} weight="bold" className="text-brand-600" />
        <h3 className="text-sm font-medium">{title} ({unmatched.length})</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{hint}</p>
      <div className="space-y-2">
        {unmatched.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 bg-nm nm-btn p-2" data-testid={`${testid}-item-${p.id}`}>
            <span className="text-sm font-semibold">{f(p.remaining ?? p.amount)}</span>
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{p.contact_name || "Unknown"}{p.date ? ` · ${p.date}` : ""}{p.invoice_number ? ` · ref ${p.invoice_number}` : ""}{p.applied > 0 ? ` · ${f(p.applied)} already applied` : ""}</span>
            <InvoicePicker open={open} value={picks[p.id] || ""} onChange={(v) => setPicks((s) => ({ ...s, [p.id]: v }))} cur={cur} testid={`match-picker-${p.id}`} />
            <button onClick={() => match(p.id)} disabled={busy === p.id} data-testid={`match-btn-${p.id}`} className="px-3 py-1.5 text-xs font-medium nm-tile bg-success-600 text-white transition-all disabled:opacity-50">Match</button>
            <button onClick={() => standalone(p.id)} disabled={busy === p.id} data-testid={`standalone-btn-${p.id}`} className="px-3 py-1.5 text-xs font-medium nm-tile hover:bg-accent transition-all disabled:opacity-50">{standaloneLabel.btn}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// U7-08.1 (2026-08-17): overdue = awaiting invoice past this many days.
// MSME payment terms in India are commonly Net 30; we treat "awaiting >
// 30d" as the first visual flag. A stricter tenant can override later
// by pushing terms into the invoice model, but the flat 30d rule catches
// the common case without needing per-invoice due dates.
const REVENUE_OVERDUE_DAYS = 30;

function daysSinceIso(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return null;
  const d = Math.floor((Date.now() - t) / 86400000);
  return d < 0 ? null : d;
}

function RevenueTab({ data, cur, onDelete, onChange }) {
  const f = fmt(cur);
  const tt = data?.totals || {};
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];

  // U7-08.1: status filter + sort control. Founder ask: fix the Revenue
  // invoices UI/UX. A 5-invoice tenant is fine flat, but the moment
  // they cross ~20 open invoices the flat table loses. Filters land now
  // so the pattern scales with the tenant, not later.
  const [statusFilter, setStatusFilter] = useState("all");  // all | awaiting | partial | paid | overdue
  const [sortKey, setSortKey] = useState("date-desc");       // date-desc | date-asc | amount-desc | overdue

  const invStatus = (s) => s.status === "paid" ? { label: "received", cls: "bg-success-600 text-white" }
    : s.status === "partial" ? { label: "partial", cls: "bg-caution-100 text-caution-800" }
    : { label: "awaiting", cls: "bg-caution-50 text-caution-800" };

  const isOverdue = (s) => s.status !== "paid" && (daysSinceIso(s.date) || 0) > REVENUE_OVERDUE_DAYS;
  const overdueCount = invoices.filter(isOverdue).length;

  // Bucket counts for the filter strip -- shown even when 0 so the tenant
  // sees "Overdue: 0" as reassurance, not a hidden control.
  const counts = {
    all: invoices.length,
    awaiting: invoices.filter((s) => s.status !== "paid" && s.status !== "partial").length,
    partial: invoices.filter((s) => s.status === "partial").length,
    paid: invoices.filter((s) => s.status === "paid").length,
    overdue: overdueCount,
  };

  const filtered = useMemo(() => {
    let list = invoices;
    if (statusFilter === "overdue") list = list.filter(isOverdue);
    else if (statusFilter === "awaiting") list = list.filter((s) => s.status !== "paid" && s.status !== "partial");
    else if (statusFilter === "partial") list = list.filter((s) => s.status === "partial");
    else if (statusFilter === "paid") list = list.filter((s) => s.status === "paid");
    const sorted = [...list];
    if (sortKey === "date-desc") sorted.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    else if (sortKey === "date-asc") sorted.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    else if (sortKey === "amount-desc") sorted.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    else if (sortKey === "overdue") sorted.sort((a, b) => (daysSinceIso(b.date) || 0) - (daysSinceIso(a.date) || 0));
    return sorted;

  }, [invoices, statusFilter, sortKey]);

  const filteredTotal = filtered.reduce((sum, s) => sum + (s.amount || 0), 0);

  const FILTERS = [
    { key: "all", label: "All", count: counts.all },
    { key: "awaiting", label: "Awaiting", count: counts.awaiting },
    { key: "partial", label: "Partial", count: counts.partial },
    { key: "paid", label: "Received", count: counts.paid },
    { key: "overdue", label: "Overdue", count: counts.overdue, danger: true },
  ];

  return (
    <div className="space-y-6" data-testid="ledger-revenue">
      {/* U7-08.1: Received is money-in -- give it the green accent to
          match Billed. Outstanding stays brand-600 (attention). If any
          invoice is overdue, add a callout under Outstanding so the
          summary strip itself carries the alarm, not just the table. */}
      <div className="grid grid-cols-3 gap-3">
        <KPI icon={CurrencyDollar} label="Billed" value={f(tt.billed || 0)} accent="text-success-600" />
        <KPI icon={Receipt} label="Received" value={f(tt.received || 0)} accent="text-success-600" />
        <KPI icon={WarningCircle} label="Outstanding" value={f(tt.outstanding || 0)} accent="text-brand-600" />
      </div>

      {overdueCount > 0 && (
        <button
          type="button"
          onClick={() => setStatusFilter("overdue")}
          data-testid="revenue-overdue-callout"
          className="w-full flex items-center gap-2 border-2 border-danger-600 bg-danger-600/5 text-danger-600 px-4 py-2.5 text-sm font-medium hover:bg-danger-600/10 transition-colors"
        >
          <WarningCircle size={16} weight="bold" />
          {overdueCount} invoice{overdueCount === 1 ? "" : "s"} overdue &gt; {REVENUE_OVERDUE_DAYS} days
          <span className="ml-auto text-xs font-mono normal-case tracking-normal">Show only overdue →</span>
        </button>
      )}

      <NeedsMatchingPanel title="Needs matching" testid="revenue-needs-matching"
        hint="These received payments couldn’t be auto-linked to an invoice. Pick the right one, or mark it as standalone income."
        unmatched={data?.unmatched_payments} open={data?.open_invoices || []} cur={cur}
        endpoint="/revenue/payment" standaloneLabel={{ btn: "Standalone income", done: "Marked as standalone income" }}
        onChange={onChange} />

      <AiPanel scope="revenue" />

      <div>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="text-sm font-medium">
            Sales &amp; Service Invoices ({invoices.length})
          </h3>
          {invoices.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="label-mono text-muted-foreground">Sort</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                data-testid="revenue-sort"
                className="nm-tile px-2 py-1 focus:outline-none focus:shadow-sm text-xs"
              >
                <option value="date-desc">Newest first</option>
                <option value="date-asc">Oldest first</option>
                <option value="amount-desc">Amount (highest)</option>
                <option value="overdue">Oldest awaiting</option>
              </select>
            </div>
          )}
        </div>

        {invoices.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3" data-testid="revenue-status-filter">
            {FILTERS.map((f) => {
              const active = statusFilter === f.key;
              const zero = f.count === 0;
              const dangerActive = f.danger && f.count > 0;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  data-testid={`revenue-filter-${f.key}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border transition-colors ${
                    active
                      ? (dangerActive ? "border-danger-600 bg-danger-600 text-white" : "border-transparent bg-primary text-primary-foreground")
                      : (dangerActive ? "border-danger-600 text-danger-600 hover:bg-danger-600/5" : "border-nm-edge/40 text-muted-foreground hover:text-foreground")
                  } ${zero && !active ? "opacity-50" : ""}`}
                >
                  {f.label}
                  <span className={`label-mono px-1 py-px ${active ? "bg-nm/20" : "bg-nm-sunken"}`}>{f.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" hint="Record a sale/service with “Add income”, or send a sales invoice via WhatsApp/upload — it lands here." />
        ) : filtered.length === 0 ? (
          <EmptyState title={`No ${statusFilter} invoices`} hint="Try a different filter, or clear it to see all." />
        ) : (
          <div className="card-brutal overflow-x-auto" data-testid="revenue-invoices-table">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-nm-edge/40 text-left text-xs font-medium text-muted-foreground">
                <th className="p-3">Invoice</th><th className="p-3">Customer</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {filtered.map((s) => {
                  const st = invStatus(s);
                  const overdue = isOverdue(s);
                  const days = overdue ? daysSinceIso(s.date) : null;
                  return (
                  <tr
                    key={s.id}
                    className={`border-b border-nm-edge/40/60 hover:bg-accent/50 ${overdue ? "bg-danger-600/[0.03]" : ""}`}
                    data-testid={`revenue-invoice-row-${s.id}`}
                  >
                    <td className="p-3 font-medium">
                      {/* Show invoice # AND title when both exist -- title
                          alone hides the reference customers quote back
                          on WhatsApp / phone when asking about payment. */}
                      {s.number && (
                        <span className="label-mono text-muted-foreground mr-1.5">#{s.number}</span>
                      )}
                      <span>{s.title || (s.number ? "" : "Sale")}</span>
                      {s.source && s.source !== "manual" && <Chip value={s.source} className={`ml-2 ${SOURCE_CHIP[s.source] || "bg-nm-sunken"}`} />}
                      <AttachmentLink att={s.attachment} />
                    </td>
                    <td className="p-3 text-muted-foreground">{s.contact_name || "—"}</td>
                    <td className="p-3 text-muted-foreground">{s.date || "—"}</td>
                    <td className="p-3">
                      <Chip value={st.label} className={st.cls} />
                      {s.status === "partial" && <span className="ml-2 text-xs text-muted-foreground">bal {f(s.balance)}</span>}
                      {overdue && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 label-mono px-1.5 py-0.5 bg-danger-600 text-white"
                          data-testid={`revenue-overdue-${s.id}`}
                        >
                          <WarningCircle size={11} weight="bold" /> {days}d overdue
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">{f(s.amount)}</td>
                    <td className="p-3 text-right"><button onClick={() => onDelete("invoice", s.id)} data-testid={`revenue-invoice-delete-${s.id}`} className="text-muted-foreground hover:text-danger-600"><Trash size={15} /></button></td>
                  </tr>
                );})}
              </tbody>
              {filtered.length > 1 && (
                <tfoot>
                  <tr className="border-t border-nm-edge/40 bg-nm-sunken/40">
                    <td colSpan={4} className="p-3 label-mono text-xs text-muted-foreground">
                      Showing {filtered.length} of {invoices.length}
                    </td>
                    <td className="p-3 text-right font-mono font-bold" data-testid="revenue-filtered-total">
                      {f(filteredTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {payments.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">Payments Received ({payments.length})</h3>
          <div className="card-brutal overflow-x-auto" data-testid="revenue-payments-table">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-nm-edge/40 text-left text-xs font-medium text-muted-foreground">
                <th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Method</th><th className="p-3">Reference</th><th className="p-3 text-right">Amount</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-nm-edge/40/60 hover:bg-accent/50" data-testid={`revenue-payment-row-${p.id}`}>
                    <td className="p-3 text-muted-foreground">{p.date || "—"}</td>
                    <td className="p-3 font-medium">{p.contact_name || "—"}{p.source && p.source !== "manual" && <Chip value={p.source} className={`ml-2 ${SOURCE_CHIP[p.source] || "bg-nm-sunken"}`} />}</td>
                    <td className="p-3 text-muted-foreground">{p.method || "—"}</td>
                    <td className="p-3 text-muted-foreground">{p.reference || p.invoice_number || "—"}</td>
                    <td className="p-3 text-right font-mono font-semibold text-success-600">{f(p.amount)}</td>
                    <td className="p-3 text-right"><button onClick={() => onDelete("payment", p.id)} data-testid={`revenue-payment-delete-${p.id}`} className="text-muted-foreground hover:text-danger-600"><Trash size={15} /></button></td>
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
        <div className="card-brutal p-5">
          <h3 className="text-sm font-medium mb-4">{t("finance.monthly_spend")}</h3>
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
          ) : <p className="text-sm text-muted-foreground">{t("finance.no_spend")}</p>}
        </div>

        <div className="card-brutal p-5">
          <h3 className="text-sm font-medium mb-4">{t("finance.by_category")}</h3>
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
                    <span className="font-mono font-semibold">{f(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t("finance.no_categories")}</p>}
        </div>
      </div>

      <div className="card-brutal p-5">
        <h3 className="text-sm font-medium mb-4">{t("finance.top_vendors")}</h3>
        {summary.by_vendor.length ? (
          <div className="space-y-2">
            {summary.by_vendor.map((v, i) => {
              const max = summary.by_vendor[0].amount || 1;
              return (
                <div key={v.vendor} className="flex items-center gap-3">
                  <span className="w-32 sm:w-48 truncate text-sm">{v.vendor}</span>
                  <div className="flex-1 bg-nm-sunken h-5 rounded-sm overflow-hidden"><div className="h-full rounded-sm" style={{ width: `${(v.amount / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
                  <span className="font-mono text-sm font-semibold w-24 text-right">{f(v.amount)}</span>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("finance.no_vendor")}</p>}
      </div>
    </div>
  );
}

function ExpensesTable({ rows, cur, onDelete }) {
  const { t } = useTranslation();
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title={t("finance.empty_exp_title")} hint={t("finance.empty_exp_hint")} />;
  return (
    <div className="card-brutal overflow-x-auto" data-testid="expenses-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-nm-edge/40 text-left text-xs font-medium text-muted-foreground">
          <th className="p-3">{t("finance.c_title")}</th><th className="p-3">{t("finance.c_category")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3">{t("finance.c_date")}</th><th className="p-3">{t("finance.c_status")}</th><th className="p-3 text-right">{t("finance.c_amount")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-nm-edge/40/60 hover:bg-accent/50" data-testid={`expense-row-${e.id}`}>
              <td className="p-3 font-medium">{e.title}{e.source !== "manual" && <Chip value={e.source} className={`ml-2 ${SOURCE_CHIP[e.source] || "bg-nm-sunken"}`} />}<AttachmentLink att={e.attachment} /></td>
              <td className="p-3"><Chip value={e.category} className="bg-nm-sunken text-foreground" /></td>
              <td className="p-3 text-muted-foreground">{e.vendor_name || "—"}</td>
              <td className="p-3 text-muted-foreground">{e.date || "—"}</td>
              <td className="p-3"><Chip value={e.status} className={e.status === "paid" ? "bg-success-50 text-success-800" : "bg-caution-50 text-caution-800"} /></td>
              <td className="p-3 text-right font-mono font-semibold">{f(e.amount)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(e.id)} data-testid={`expense-delete-${e.id}`} className="text-muted-foreground hover:text-danger-600"><Trash size={15} /></button></td>
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
    <div className="card-brutal overflow-x-auto" data-testid="assets-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-nm-edge/40 text-left text-xs font-medium text-muted-foreground">
          <th className="p-3">{t("finance.a_asset")}</th><th className="p-3">{t("finance.c_category")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3">{t("finance.a_bought")}</th><th className="p-3">{t("finance.c_status")}</th><th className="p-3 text-right">{t("finance.a_value")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-nm-edge/40/60 hover:bg-accent/50" data-testid={`asset-row-${a.id}`}>
              <td className="p-3 font-medium">{a.name}{a.source !== "manual" && <Chip value={a.source} className={`ml-2 ${SOURCE_CHIP[a.source] || "bg-nm-sunken"}`} />}<AttachmentLink att={a.attachment} /></td>
              <td className="p-3"><Chip value={a.category} className="bg-nm-sunken text-foreground" /></td>
              <td className="p-3 text-muted-foreground">{a.vendor_name || "—"}</td>
              <td className="p-3 text-muted-foreground">{a.purchase_date || "—"}</td>
              <td className="p-3"><Chip value={a.status} className={a.status === "active" ? "bg-primary text-primary-foreground" : "bg-nm-sunken text-foreground"} /></td>
              <td className="p-3 text-right font-mono font-semibold">{f(a.purchase_amount)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(a.id)} className="text-muted-foreground hover:text-danger-600"><Trash size={15} /></button></td>
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
    <div className="card-brutal overflow-x-auto" data-testid="inventory-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-nm-edge/40 text-left text-xs font-medium text-muted-foreground">
          <th className="p-3">{t("finance.i_item")}</th><th className="p-3">{t("finance.i_sku")}</th><th className="p-3">{t("finance.i_qty")}</th><th className="p-3">{t("finance.i_unitcost")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3 text-right">{t("finance.i_value")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-nm-edge/40/60 hover:bg-accent/50" data-testid={`inv-row-${i.id}`}>
              <td className="p-3 font-medium">{i.item}<AttachmentLink att={i.attachment} /></td>
              <td className="p-3 text-muted-foreground">{i.sku || "—"}</td>
              <td className="p-3 font-mono">{i.quantity} {i.unit}</td>
              <td className="p-3 font-mono">{f(i.unit_cost)}</td>
              <td className="p-3 text-muted-foreground">{i.vendor_name || "—"}</td>
              <td className="p-3 text-right font-mono font-semibold">{f(i.value)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(i.id)} className="text-muted-foreground hover:text-danger-600"><Trash size={15} /></button></td>
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
  // Epic 2 Sprint 4 (E2-24): Inbox tab hosts the Capture Review Queue —
  // the former /ingest page's Review Queue collapsed under Finance.
  { key: "inbox", tkey: "finance.t_inbox", icon: Tray },
];


// Epic 2 Sprint 4 (E2-25): Capture hero bar.
// Always-visible at the top of every Finance tab. Founder pick
// 2026-08-14 over tab-placement or FAB: capture stays 1-click from
// anywhere in Finance.
function CaptureHero({ pendingCount, onIngested, onOpenInbox }) {
  const { user } = useAuth();
  const canIngest = user?.role === "owner" || hasPerm(user, "data_input");
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(null);
  const qc = useQueryClient();

  const upload = async (endpoint, files) => {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    setActive(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post(endpoint, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
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

  const onFiled = () => {
    setActive(null);
    onIngested && onIngested();
  };

  if (!canIngest) return null;

  return (
    <>
      <div className="nm-tile p-3 mb-6 flex flex-wrap items-center gap-2" data-testid="finance-capture-hero">
        <span className="text-xs text-muted-foreground hidden sm:inline mr-1">
          Capture
        </span>
        <label
          data-testid="finance-hero-doc"
          className={`flex items-center gap-2 nm-tile px-3 py-2 text-xs font-medium hover:bg-brand-600 hover:text-white transition-colors cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}
          title="Upload a bill or receipt (PDF or photo)"
        >
          <FilePdf size={14} weight="bold" />
          Upload bill / receipt
          <input type="file" hidden accept="image/*,application/pdf" onChange={(e) => upload("/ingest/document", e.target.files)} />
        </label>
        <label
          data-testid="finance-hero-photo"
          className={`flex items-center gap-2 nm-tile px-3 py-2 text-xs font-medium hover:bg-accent transition-colors cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}
          title="Take a photo (mobile camera)"
        >
          <Camera size={14} weight="bold" />
          Photo
          <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => upload("/ingest/document", e.target.files)} />
        </label>
        <label
          data-testid="finance-hero-csv"
          className={`flex items-center gap-2 nm-tile px-3 py-2 text-xs font-medium hover:bg-accent transition-colors cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}
          title="Bulk CSV or Excel import"
        >
          <UploadSimple size={14} weight="bold" />
          CSV / Excel
          <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => upload("/ingest/csv", e.target.files)} />
        </label>
        {pendingCount > 0 && (
          <button
            data-testid="finance-hero-inbox-badge"
            onClick={onOpenInbox}
            className="flex items-center gap-2 nm-tile bg-brand-600 text-white px-3 py-2 text-xs font-medium transition-all"
          >
            <Tray size={14} weight="bold" />
            {pendingCount} in Inbox →
          </button>
        )}
        {uploading && (
          <span className="text-xs text-muted-foreground font-mono ml-1">Extracting…</span>
        )}
      </div>
      {active && (
        <div className="mb-6" data-testid="finance-hero-review">
          <ReviewPanel ingestion={active} onFiled={onFiled} onCancel={() => setActive(null)} />
        </div>
      )}
    </>
  );
}

export default function Ledger() {
  // MPWA-09: rebuilt below lg (§8). Above lg the original tree is untouched.
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = TABS.some((tb) => tb.key === searchParams.get("tab")) ? searchParams.get("tab") : "overview";
  const [tab, setTab] = useState(initialTab);
  const qc = useQueryClient();
  const invalidate = () => ["ledger-summary", "expenses", "assets", "inventory", "revenue", "payables"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  // U7-08.2 (2026-08-17): "Fix old purchases" button removed from the
  // desktop Finance header per founder ask. The AI classifier already
  // runs on every new capture; a manual re-run belongs in admin tooling
  // if we need it again, not in the owner's day-to-day toolbar. Mobile
  // still exposes it as "Recheck earlier bills" (FinanceMobile.jsx §8);
  // the backend endpoint /ledger/reclassify-purchases stays live.

  const summaryQ = useQuery({ queryKey: ["ledger-summary"], queryFn: () => api.get("/ledger/summary").then((r) => r.data) });
  const expensesQ = useQuery({ queryKey: ["expenses"], queryFn: () => api.get("/expenses").then((r) => r.data) });
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => api.get("/assets").then((r) => r.data) });
  const inventoryQ = useQuery({ queryKey: ["inventory"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const revenueQ = useQuery({ queryKey: ["revenue"], queryFn: () => api.get("/revenue").then((r) => r.data) });
  const payablesQ = useQuery({ queryKey: ["payables"], queryFn: () => api.get("/payables").then((r) => r.data) });
  // Epic 2 Sprint 4 (E2-25): pending-capture badge feeds the hero's "N in Inbox →" pill.
  const capPendingQ = useQuery({
    queryKey: ["captures-pending"],
    queryFn: () => api.get("/captures/pending-count").then((r) => r.data),
    refetchInterval: 30000,
  });
  const pendingCount = capPendingQ.data?.count || 0;

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
  }, [tab, categories, assetCategories]);

  if (isMobile) return <FinanceMobile />;

  return (
    <div>
      <PageHeader eyebrow={t("finance.eyebrow")} title={t("finance.title")}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto" data-testid="ledger-controls">
          {/* RD-4 (2026-08-17): the six tabs were a welded segmented block of
              uppercase slabs, and the active one inverted to solid dark — the
              loudest element on a page whose job is showing money. Now the
              same pill strip the Desk and MyWork use: borderless, sentence
              case, indigo tint on the active tab. Below sm they wrap in a
              2-col grid rather than forming a bordered block. */}
          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:gap-1 w-full sm:w-auto">
            {TABS.map((tb) => {
              const active = tab === tb.key;
              return (
                <button key={tb.key} onClick={() => setTab(tb.key)} data-testid={`ledger-tab-${tb.key}`}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm transition-colors ${active ? "bg-brand-50 text-brand-700 font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                  <tb.icon size={15} weight={active ? "fill" : "regular"} /> {t(tb.tkey)}
                </button>
              );
            })}
          </div>
          {addBtn}
        </div>
      </PageHeader>

      {/* Epic 2 Sprint 4 (E2-25): hero capture bar above every tab. */}
      <CaptureHero
        pendingCount={pendingCount}
        onIngested={() => { invalidate(); qc.invalidateQueries({ queryKey: ["captures-pending"] }); }}
        onOpenInbox={() => setTab("inbox")}
      />

      {(summaryQ.isLoading && tab === "overview") ? (
        <p className="font-mono text-sm">{t("finance.loading")}</p>
      ) : (
        <>
          {tab === "overview" && summary && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div><OverviewTab summary={summary} /></div>
              {/* Epic 2 Sprint 4 (E2-26): WhatsApp status card moves here. */}
              <div className="lg:sticky lg:top-6 self-start"><WhatsAppCard /></div>
            </div>
          )}
          {tab === "revenue" && <RevenueTab data={revenueQ.data} cur={cur} onDelete={delRevenue} onChange={invalidate} />}
          {tab === "expenses" && <div className="space-y-6"><NeedsMatchingPanel title="Supplier payments to match" testid="payables-needs-matching" hint="These payments to suppliers couldn’t be auto-linked to a purchase bill. Pick the bill they settle, or mark as a standalone expense." unmatched={payablesQ.data?.unmatched_payments} open={payablesQ.data?.open_invoices || []} cur={cur} endpoint="/payables/payment" standaloneLabel={{ btn: "Standalone expense", done: "Booked as a standalone expense" }} onChange={invalidate} /><AiPanel scope="expenses" /><ExpensesTable rows={expensesQ.data || []} cur={cur} onDelete={(id) => del("expenses", id)} /></div>}
          {tab === "assets" && <div className="space-y-6"><AiPanel scope="assets" /><AssetsTable rows={assetsQ.data || []} cur={cur} onDelete={(id) => del("assets", id)} /></div>}
          {tab === "inventory" && <div className="space-y-6"><AiPanel scope="inventory" /><InventoryTable rows={inventoryQ.data || []} cur={cur} onDelete={(id) => del("inventory", id)} /></div>}
          {/* Epic 2 Sprint 4 (E2-24): Inbox tab hosts CaptureReview from /ingest. */}
          {tab === "inbox" && <CaptureReview />}
        </>
      )}

      {tab === "overview" && (
        <p className="mt-6 text-xs text-muted-foreground flex items-center gap-1.5">
          <Robot size={14} weight="bold" /> {t("finance.auto_flow")}
        </p>
      )}
    </div>
  );
}
