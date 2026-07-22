import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
} from "@phosphor-icons/react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";

const PALETTE = ["#E63946", "#1E1E24", "#F4A261", "#457B9D", "#2A9D8F", "#E76F51", "#8D99AE", "#A8DADC", "#6D6875", "#B5838D", "#264653", "#E9C46A"];
const CHART_MARGIN = { top: 5, right: 5, left: 5, bottom: 5 };
const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-ring/40";
const label = "label-mono text-muted-foreground text-xs";

const fmt = (cur) => (n) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "INR", maximumFractionDigits: 0 }).format(n || 0); }
  catch { return `${cur || ""} ${Math.round(n || 0).toLocaleString()}`; }
};

const SOURCE_CHIP = { manual: "bg-black/5 text-foreground", whatsapp: "bg-green-600 text-white", ingest: "bg-brand-blue text-white", document: "bg-brand-blue text-white" };
const LEVEL_DOT = { high: "bg-brand-red", medium: "bg-brand-yellow", low: "bg-brand-blue" };
const LEVEL_ACCENT = { high: "border-l-brand-red", medium: "border-l-brand-yellow", low: "border-l-brand-blue" };

function Field({ label: l, children }) {
  return <div><label className={label}>{l}</label><div className="mt-1">{children}</div></div>;
}

function FileField({ file, setFile }) {
  const { t } = useTranslation();
  return (
    <Field label={t("finance.attach_label")}>
      <label className="flex items-center gap-2 border border-dashed border-border rounded-lg px-3 py-2.5 text-sm cursor-pointer hover:bg-black/[0.02]">
        <Paperclip size={15} weight="bold" />
        <span className="truncate flex-1 text-muted-foreground">{file ? file.name : t("finance.attach_ph")}</span>
        <input type="file" accept="image/*,application/pdf" className="hidden" data-testid="ledger-file-input" onChange={(e) => {
          const sel = e.target.files?.[0] || null;
          if (sel && sel.size > 15 * 1024 * 1024) { toast.error(t("finance.file_large")); return; }
          if (sel && !/^image\//.test(sel.type) && sel.type !== "application/pdf") { toast.error(t("finance.file_type")); return; }
          setFile(sel);
        }} />
      </label>
      {file && <button type="button" onClick={() => setFile(null)} className="mt-1 text-xs text-brand-red hover:underline">{t("finance.remove_attach")}</button>}
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
        <button data-testid="add-expense-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_expense")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{t("finance.new_expense")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_expense_desc")}</DialogDescription></DialogHeader>
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
              <button type="button" onClick={suggest} disabled={suggesting} data-testid="expense-suggest-category" className="flex items-center gap-1 text-xs font-semibold text-brand-red hover:underline disabled:opacity-50">
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
          <button onClick={save} disabled={busy} data-testid="expense-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
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
        <button data-testid="add-asset-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_asset")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{t("finance.new_asset")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_asset_desc")}</DialogDescription></DialogHeader>
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
          <button onClick={save} disabled={busy} data-testid="asset-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
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
        <button data-testid="add-inventory-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> {t("finance.add_item")}
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{t("finance.new_inv")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_inv_desc")}</DialogDescription></DialogHeader>
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
          <button onClick={save} disabled={busy} data-testid="inv-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
            {busy ? (file ? t("finance.ai_reading") : t("finance.saving")) : t("finance.save_item")}
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
      <button onClick={openDialog} data-testid="insight-create-task" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-black bg-brand-red text-white px-3 py-1.5 hover:shadow-brutal-sm transition-all">
        <ListPlus size={13} weight="bold" /> {t("finance.create_task")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border border-black rounded-none">
          <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">{t("finance.new_task_insight")}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{t("finance.new_task_insight_desc")}</DialogDescription></DialogHeader>
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
            <button onClick={save} disabled={busy} data-testid="insight-task-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
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
    <div className={`border border-border border-l-4 ${LEVEL_ACCENT[insight.level] || "border-l-black"} rounded-lg bg-card overflow-hidden transition-shadow hover:shadow-brutal-sm`} data-testid={`ai-alert-${scope}-${idx}`}>
      <button onClick={() => setOpen((o) => !o)} data-testid={`insight-toggle-${scope}-${idx}`} className="w-full flex items-center gap-3 p-3 text-left hover:bg-black/[0.02] transition-colors">
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
            <button onClick={() => onAsk(insight.title)} data-testid={`insight-ask-${scope}-${idx}`} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-black px-3 py-1.5 hover:bg-black/5 transition-colors">
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
          <Sparkle size={isBrief ? 22 : 18} weight="fill" className="text-brand-red" />
          <h3 className={`font-heading font-black uppercase tracking-tight ${isBrief ? "text-lg" : "text-sm"}`}>{isBrief ? t("finance.finance_brief") : t("finance.ai_analysis")}</h3>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="text-[11px] text-muted-foreground hidden sm:inline">{t("finance.updated", { time: new Date(data.generated_at).toLocaleString() })}</span>}
          <button onClick={refresh} disabled={refreshing} data-testid={`ai-refresh-${scope}`} className="flex items-center gap-1 text-xs font-semibold border border-black px-2.5 py-1.5 hover:bg-black/5 transition-colors disabled:opacity-50">
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

      <div className="border-t border-border pt-4">
        <div className="flex items-center gap-1.5 mb-2 text-muted-foreground"><Brain size={15} weight="bold" /><span className="label-mono text-xs">{scope === "brief" ? t("finance.ask_about_fin") : t("finance.ask_about", { scope })}</span></div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} data-testid={`ai-ask-input-${scope}`} placeholder={t("finance.ask_ph")} className={inp} />
          <button onClick={() => ask()} disabled={asking} data-testid={`ai-ask-btn-${scope}`} className="flex items-center gap-1 bg-brand-ink text-white px-3 py-2 text-sm font-semibold border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50 shrink-0">
            <PaperPlaneRight size={15} weight="bold" /> {asking ? "…" : t("finance.ask_btn")}
          </button>
        </div>
        {answer && <div className="mt-3 border border-border rounded-lg p-3 bg-black/[0.02] text-sm leading-relaxed" data-testid={`ai-answer-${scope}`}>{answer}</div>}
      </div>
    </div>
  );
}

// ---------- Sub-views ----------
function KPI({ icon: Icon, label: l, value, accent }) {
  return (
    <div className="card-brutal p-4" data-testid={`kpi-${l.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-2 text-muted-foreground"><Icon size={16} weight="bold" /><span className="label-mono text-xs">{l}</span></div>
      <p className={`font-heading text-2xl font-black tracking-tight mt-1 ${accent || ""}`}>{value}</p>
    </div>
  );
}

function KpiRow({ summary }) {
  const { t } = useTranslation();
  const f = fmt(summary.currency);
  const tt = summary.totals;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KPI icon={TrendUp} label={t("finance.k_spend")} value={f(tt.total_spend)} accent="text-brand-red" />
      <KPI icon={Receipt} label={t("finance.k_out")} value={f(tt.outstanding)} />
      <KPI icon={Buildings} label={t("finance.k_asset")} value={f(tt.asset_value)} />
      <KPI icon={Package} label={t("finance.k_inv")} value={f(tt.inventory_value)} />
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
          <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm mb-4">{t("finance.monthly_spend")}</h3>
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
          <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm mb-4">{t("finance.by_category")}</h3>
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
        <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm mb-4">{t("finance.top_vendors")}</h3>
        {summary.by_vendor.length ? (
          <div className="space-y-2">
            {summary.by_vendor.map((v, i) => {
              const max = summary.by_vendor[0].amount || 1;
              return (
                <div key={v.vendor} className="flex items-center gap-3">
                  <span className="w-32 sm:w-48 truncate text-sm">{v.vendor}</span>
                  <div className="flex-1 bg-black/5 h-5 rounded-sm overflow-hidden"><div className="h-full rounded-sm" style={{ width: `${(v.amount / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
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
        <thead><tr className="border-b border-border text-left label-mono text-xs text-muted-foreground">
          <th className="p-3">{t("finance.c_title")}</th><th className="p-3">{t("finance.c_category")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3">{t("finance.c_date")}</th><th className="p-3">{t("finance.c_status")}</th><th className="p-3 text-right">{t("finance.c_amount")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border/60 hover:bg-black/[0.02]" data-testid={`expense-row-${e.id}`}>
              <td className="p-3 font-medium">{e.title}{e.source !== "manual" && <Chip value={e.source} className={`ml-2 ${SOURCE_CHIP[e.source] || "bg-black/5"}`} />}<AttachmentLink att={e.attachment} /></td>
              <td className="p-3"><Chip value={e.category} className="bg-black/5 text-foreground" /></td>
              <td className="p-3 text-muted-foreground">{e.vendor_name || "—"}</td>
              <td className="p-3 text-muted-foreground">{e.date || "—"}</td>
              <td className="p-3"><Chip value={e.status} className={e.status === "paid" ? "bg-brand-ink text-white" : "bg-brand-yellow text-black"} /></td>
              <td className="p-3 text-right font-mono font-semibold">{f(e.amount)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(e.id)} data-testid={`expense-delete-${e.id}`} className="text-muted-foreground hover:text-brand-red"><Trash size={15} /></button></td>
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
        <thead><tr className="border-b border-border text-left label-mono text-xs text-muted-foreground">
          <th className="p-3">{t("finance.a_asset")}</th><th className="p-3">{t("finance.c_category")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3">{t("finance.a_bought")}</th><th className="p-3">{t("finance.c_status")}</th><th className="p-3 text-right">{t("finance.a_value")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-border/60 hover:bg-black/[0.02]" data-testid={`asset-row-${a.id}`}>
              <td className="p-3 font-medium">{a.name}{a.source !== "manual" && <Chip value={a.source} className={`ml-2 ${SOURCE_CHIP[a.source] || "bg-black/5"}`} />}<AttachmentLink att={a.attachment} /></td>
              <td className="p-3"><Chip value={a.category} className="bg-black/5 text-foreground" /></td>
              <td className="p-3 text-muted-foreground">{a.vendor_name || "—"}</td>
              <td className="p-3 text-muted-foreground">{a.purchase_date || "—"}</td>
              <td className="p-3"><Chip value={a.status} className={a.status === "active" ? "bg-brand-ink text-white" : "bg-black/5 text-foreground"} /></td>
              <td className="p-3 text-right font-mono font-semibold">{f(a.purchase_amount)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(a.id)} className="text-muted-foreground hover:text-brand-red"><Trash size={15} /></button></td>
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
        <thead><tr className="border-b border-border text-left label-mono text-xs text-muted-foreground">
          <th className="p-3">{t("finance.i_item")}</th><th className="p-3">{t("finance.i_sku")}</th><th className="p-3">{t("finance.i_qty")}</th><th className="p-3">{t("finance.i_unitcost")}</th><th className="p-3">{t("finance.c_vendor")}</th><th className="p-3 text-right">{t("finance.i_value")}</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-border/60 hover:bg-black/[0.02]" data-testid={`inv-row-${i.id}`}>
              <td className="p-3 font-medium">{i.item}<AttachmentLink att={i.attachment} /></td>
              <td className="p-3 text-muted-foreground">{i.sku || "—"}</td>
              <td className="p-3 font-mono">{i.quantity} {i.unit}</td>
              <td className="p-3 font-mono">{f(i.unit_cost)}</td>
              <td className="p-3 text-muted-foreground">{i.vendor_name || "—"}</td>
              <td className="p-3 text-right font-mono font-semibold">{f(i.value)}</td>
              <td className="p-3 text-right"><button onClick={() => onDelete(i.id)} className="text-muted-foreground hover:text-brand-red"><Trash size={15} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { key: "overview", tkey: "finance.t_overview", icon: Sparkle },
  { key: "expenses", tkey: "finance.t_expenses", icon: Receipt },
  { key: "assets", tkey: "finance.t_assets", icon: Buildings },
  { key: "inventory", tkey: "finance.t_inventory", icon: Package },
];

export default function Ledger() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("overview");
  const qc = useQueryClient();
  const invalidate = () => ["ledger-summary", "expenses", "assets", "inventory"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const summaryQ = useQuery({ queryKey: ["ledger-summary"], queryFn: () => api.get("/ledger/summary").then((r) => r.data) });
  const expensesQ = useQuery({ queryKey: ["expenses"], queryFn: () => api.get("/expenses").then((r) => r.data) });
  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => api.get("/assets").then((r) => r.data) });
  const inventoryQ = useQuery({ queryKey: ["inventory"], queryFn: () => api.get("/inventory").then((r) => r.data) });

  const summary = summaryQ.data;
  const cur = summary?.currency || "INR";
  const categories = summary?.categories || [];
  const assetCategories = summary?.asset_categories || [];

  const del = async (kind, id) => {
    try { await api.delete(`/${kind}/${id}`); invalidate(); toast.success(t("finance.deleted")); }
    catch { toast.error(t("finance.del_failed")); }
  };

  const addBtn = useMemo(() => {
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
          <div className="grid grid-cols-2 gap-2 sm:gap-0 sm:flex sm:border sm:border-black sm:overflow-hidden w-full sm:w-auto">
            {TABS.map((tb) => (
              <button key={tb.key} onClick={() => setTab(tb.key)} data-testid={`ledger-tab-${tb.key}`}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold uppercase tracking-wider border border-black sm:border-0 sm:border-r sm:border-black sm:last:border-r-0 transition-colors ${tab === tb.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                <tb.icon size={15} weight="bold" /> {t(tb.tkey)}
              </button>
            ))}
          </div>
          {addBtn}
        </div>
      </PageHeader>

      {(summaryQ.isLoading && tab === "overview") ? (
        <p className="font-mono text-sm">{t("finance.loading")}</p>
      ) : (
        <>
          {tab === "overview" && summary && <OverviewTab summary={summary} />}
          {tab === "expenses" && <div className="space-y-6"><AiPanel scope="expenses" /><ExpensesTable rows={expensesQ.data || []} cur={cur} onDelete={(id) => del("expenses", id)} /></div>}
          {tab === "assets" && <div className="space-y-6"><AiPanel scope="assets" /><AssetsTable rows={assetsQ.data || []} cur={cur} onDelete={(id) => del("assets", id)} /></div>}
          {tab === "inventory" && <div className="space-y-6"><AiPanel scope="inventory" /><InventoryTable rows={inventoryQ.data || []} cur={cur} onDelete={(id) => del("inventory", id)} /></div>}
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
