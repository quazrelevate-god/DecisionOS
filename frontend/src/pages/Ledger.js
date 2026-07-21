import { useState, useMemo } from "react";
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
const LEVEL_LABEL = { high: "Urgent", medium: "Important", low: "FYI" };

function Field({ label: l, children }) {
  return <div><label className={label}>{l}</label><div className="mt-1">{children}</div></div>;
}

function FileField({ file, setFile }) {
  return (
    <Field label="Attach bill / invoice / photo (optional)">
      <label className="flex items-center gap-2 border border-dashed border-border rounded-lg px-3 py-2.5 text-sm cursor-pointer hover:bg-black/[0.02]">
        <Paperclip size={15} weight="bold" />
        <span className="truncate flex-1 text-muted-foreground">{file ? file.name : "Choose image or PDF — AI will read it & fill the rest"}</span>
        <input type="file" accept="image/*,application/pdf" className="hidden" data-testid="ledger-file-input" onChange={(e) => {
          const sel = e.target.files?.[0] || null;
          if (sel && sel.size > 15 * 1024 * 1024) { toast.error("File is too large (max 15 MB)"); return; }
          if (sel && !/^image\//.test(sel.type) && sel.type !== "application/pdf") { toast.error("Only image or PDF bills are supported"); return; }
          setFile(sel);
        }} />
      </label>
      {file && <button type="button" onClick={() => setFile(null)} className="mt-1 text-xs text-brand-red hover:underline">Remove attachment</button>}
    </Field>
  );
}

function AttachmentLink({ att }) {
  if (!att?.url) return null;
  return (
    <a href={`${process.env.REACT_APP_BACKEND_URL}${att.url}`} target="_blank" rel="noopener noreferrer" data-testid="view-attachment"
      className="ml-2 inline-flex items-center gap-1 text-xs text-brand-blue hover:underline align-middle">
      <Paperclip size={12} weight="bold" /> Bill
    </a>
  );
}

// ---------- Add dialogs ----------
function AddExpenseDialog({ categories, onDone }) {
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
    if (!text) return toast.error("Add a title or vendor first");
    setSuggesting(true);
    try { const { data } = await api.post("/expenses/suggest-category", { text }); set("category", data.category); toast.success(`AI suggests: ${data.category}`); }
    catch { toast.error("Could not suggest"); } finally { setSuggesting(false); }
  };
  const save = async () => {
    if (!f.title.trim() && !f.amount && !file) return toast.error("Add a title/amount or attach a bill");
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/expenses/with-file", fd);
      toast.success(file ? "AI read your bill & added the expense" : "Expense added");
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-expense-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> Add Expense
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New Expense</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Attach a bill and AI fills the rest, or type it in manually.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <Field label="Title"><input data-testid="expense-title" className={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Cotton yarn purchase" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount"><input data-testid="expense-amount" type="number" className={inp} value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label="Status">
              <select className={inp} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value="unpaid">Unpaid</option><option value="paid">Paid</option>
              </select>
            </Field>
          </div>
          <Field label={`Vendor / ${L.vendor_singular}`}><input data-testid="expense-vendor" className={inp} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></Field>
          <div>
            <div className="flex items-center justify-between">
              <label className={label}>Category</label>
              <button type="button" onClick={suggest} disabled={suggesting} data-testid="expense-suggest-category" className="flex items-center gap-1 text-xs font-semibold text-brand-red hover:underline disabled:opacity-50">
                <Sparkle size={13} weight="bold" /> {suggesting ? "Thinking…" : "AI suggest"}
              </button>
            </div>
            <select data-testid="expense-category" className={`${inp} mt-1`} value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">— Auto —</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className={inp} value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
          </div>
          <Field label="Notes"><textarea className={inp} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <button onClick={save} disabled={busy} data-testid="expense-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
            {busy ? (file ? "AI reading bill…" : "Saving…") : "Save Expense"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddAssetDialog({ categories, onDone }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", purchase_amount: "", category: "Equipment", vendor_name: "", purchase_date: "", status: "active", notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ name: "", purchase_amount: "", category: "Equipment", vendor_name: "", purchase_date: "", status: "active", notes: "" }); setFile(null); };
  const save = async () => {
    if (!f.name.trim() && !file) return toast.error("Add a name or attach a bill");
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/assets/with-file", fd);
      toast.success(file ? "AI read your bill & added the asset" : "Asset added");
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-asset-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> Add Asset
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New Asset</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Attach the purchase bill and AI fills the rest, or type it in.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <Field label="Asset name"><input data-testid="asset-name" className={inp} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Ring spinning machine" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase amount"><input data-testid="asset-amount" type="number" className={inp} value={f.purchase_amount} onChange={(e) => set("purchase_amount", e.target.value)} /></Field>
            <Field label="Category">
              <select data-testid="asset-category" className={inp} value={f.category} onChange={(e) => set("category", e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Vendor"><input className={inp} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase date"><input type="date" className={inp} value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
            <Field label="Status">
              <select className={inp} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">Active</option><option value="maintenance">In maintenance</option><option value="disposed">Disposed</option>
              </select>
            </Field>
          </div>
          <button onClick={save} disabled={busy} data-testid="asset-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
            {busy ? (file ? "AI reading bill…" : "Saving…") : "Save Asset"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddInventoryDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ item: "", sku: "", quantity: "", unit: "unit", unit_cost: "", category: "", vendor_name: "", notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ item: "", sku: "", quantity: "", unit: "unit", unit_cost: "", category: "", vendor_name: "", notes: "" }); setFile(null); };
  const save = async () => {
    if (!f.item.trim() && !file) return toast.error("Add an item or attach a bill");
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("file", file);
      await api.post("/inventory/with-file", fd);
      toast.success(file ? "AI read your bill & added the item" : "Inventory added");
      setOpen(false); reset(); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button data-testid="add-inventory-btn" className="flex items-center justify-center gap-2 w-full sm:w-auto bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> Add Item
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New Inventory Item</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Attach a purchase bill and AI fills the rest; value is quantity × unit cost.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <FileField file={file} setFile={setFile} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Item"><input data-testid="inv-item" className={inp} value={f.item} onChange={(e) => set("item", e.target.value)} /></Field>
            <Field label="SKU"><input className={inp} value={f.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantity"><input data-testid="inv-qty" type="number" className={inp} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
            <Field label="Unit"><input className={inp} value={f.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
            <Field label="Unit cost"><input data-testid="inv-cost" type="number" className={inp} value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><input className={inp} value={f.category} onChange={(e) => set("category", e.target.value)} /></Field>
            <Field label="Vendor"><input className={inp} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} /></Field>
          </div>
          <button onClick={save} disabled={busy} data-testid="inv-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
            {busy ? (file ? "AI reading bill…" : "Saving…") : "Save Item"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- AI insight pointers (create task / ask) ----------
function CreateTaskFromInsight({ insight, members, roleOptions }) {
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
    if (!title.trim()) return toast.error("Task title required");
    setBusy(true);
    const payload = { title: title.trim(), description: desc.trim(), priority };
    if (assignee.startsWith("user:")) payload.assignee_id = assignee.slice(5);
    else if (assignee.startsWith("role:")) payload.assignee_role = assignee.slice(5);
    try { await api.post("/tasks", payload); toast.success("Task created — see My Work"); setOpen(false); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not create task"); } finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={openDialog} data-testid="insight-create-task" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border border-black bg-brand-red text-white px-3 py-1.5 hover:shadow-brutal-sm transition-all">
        <ListPlus size={13} weight="bold" /> Create task
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border border-black rounded-none">
          <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New task from insight</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Turn this AI insight into an action in My Work.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label="Task title"><input data-testid="insight-task-title" className={inp} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Description"><textarea className={inp} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assign to">
                <select className={inp} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="insight-task-assignee">
                  <option value="">Unassigned</option>
                  {roleOptions.map((r) => <option key={`role:${r.key}`} value={`role:${r.key}`}>{r.label} team</option>)}
                  {members.map((m) => <option key={`user:${m.id}`} value={`user:${m.id}`}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className={inp} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
              </Field>
            </div>
            <button onClick={save} disabled={busy} data-testid="insight-task-save" className="w-full bg-brand-red text-white py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
              {busy ? "Creating…" : "Create task"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InsightCard({ insight, scope, idx, members, roleOptions, onAsk }) {
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
              <Brain size={13} weight="bold" /> Ask AI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- AI Analysis panel (shared: brief + per-tab) ----------
function AiPanel({ scope, variant = "inline" }) {
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
    try { const { data: d } = await api.post(`/ledger/ai/${scope}/refresh`); qc.setQueryData(["ledger-ai", scope], d); toast.success("Analysis refreshed"); }
    catch { toast.error("Could not refresh analysis"); } finally { setRefreshing(false); }
  };
  const ask = async (question) => {
    const query = (typeof question === "string" ? question : q).trim();
    if (!query) return;
    setQ(query); setAsking(true); setAnswer("");
    try { const { data: d } = await api.post("/ledger/ask", { question: query, scope }); setAnswer(d.answer); }
    catch (e) { toast.error(e.response?.data?.detail || "AI is busy, try again"); } finally { setAsking(false); }
  };
  const onAsk = (title) => ask(`Tell me more and what should I do about: ${title}`);

  return (
    <div className={`card-brutal ${isBrief ? "p-6" : "p-5"} space-y-5`} data-testid={`ai-panel-${scope}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle size={isBrief ? 22 : 18} weight="fill" className="text-brand-red" />
          <h3 className={`font-heading font-black uppercase tracking-tight ${isBrief ? "text-lg" : "text-sm"}`}>{isBrief ? "AI Finance Brief" : "AI Analysis"}</h3>
        </div>
        <div className="flex items-center gap-2">
          {data?.generated_at && <span className="text-[11px] text-muted-foreground hidden sm:inline">Updated {new Date(data.generated_at).toLocaleString()}</span>}
          <button onClick={refresh} disabled={refreshing} data-testid={`ai-refresh-${scope}`} className="flex items-center gap-1 text-xs font-semibold border border-black px-2.5 py-1.5 hover:bg-black/5 transition-colors disabled:opacity-50">
            <ArrowClockwise size={13} weight="bold" className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Analysing…" : "Refresh"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">Analysing your finances…</p>
      ) : (
        <>
          {headline && <p className={`${isBrief ? "text-base" : "text-sm"} font-semibold leading-snug`} data-testid={`ai-summary-${scope}`}>{headline}</p>}

          {insights.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-muted-foreground"><WarningCircle size={15} weight="bold" /><span className="label-mono text-xs">Action Items · most urgent first</span></div>
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
        <div className="flex items-center gap-1.5 mb-2 text-muted-foreground"><Brain size={15} weight="bold" /><span className="label-mono text-xs">Ask AI about {scope === "brief" ? "your finances" : `your ${scope}`}</span></div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} data-testid={`ai-ask-input-${scope}`} placeholder="e.g. Which vendor did I spend most on?" className={inp} />
          <button onClick={() => ask()} disabled={asking} data-testid={`ai-ask-btn-${scope}`} className="flex items-center gap-1 bg-brand-ink text-white px-3 py-2 text-sm font-semibold border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50 shrink-0">
            <PaperPlaneRight size={15} weight="bold" /> {asking ? "…" : "Ask"}
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
  const f = fmt(summary.currency);
  const t = summary.totals;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KPI icon={TrendUp} label="Total Spend" value={f(t.total_spend)} accent="text-brand-red" />
      <KPI icon={Receipt} label="Outstanding" value={f(t.outstanding)} />
      <KPI icon={Buildings} label="Asset Value" value={f(t.asset_value)} />
      <KPI icon={Package} label="Inventory Value" value={f(t.inventory_value)} />
    </div>
  );
}

function OverviewTab({ summary }) {
  const f = fmt(summary.currency);
  return (
    <div className="space-y-6" data-testid="ledger-overview">
      <KpiRow summary={summary} />
      <AiPanel scope="brief" variant="brief" />

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card-brutal p-5">
          <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm mb-4">Monthly spend</h3>
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
          ) : <p className="text-sm text-muted-foreground">No spend data yet.</p>}
        </div>

        <div className="card-brutal p-5">
          <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm mb-4">By category</h3>
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
          ) : <p className="text-sm text-muted-foreground">No categories yet.</p>}
        </div>
      </div>

      <div className="card-brutal p-5">
        <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm mb-4">Top vendors by spend</h3>
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
        ) : <p className="text-sm text-muted-foreground">No vendor spend yet.</p>}
      </div>
    </div>
  );
}

function ExpensesTable({ rows, cur, onDelete }) {
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title="No expenses yet" hint="Approved purchase bills & payments show up here automatically, or add one manually." />;
  return (
    <div className="card-brutal overflow-x-auto" data-testid="expenses-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left label-mono text-xs text-muted-foreground">
          <th className="p-3">Title</th><th className="p-3">Category</th><th className="p-3">Vendor</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th><th className="p-3"></th>
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
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title="No assets yet" hint="Asset-purchase expenses auto-create here, or add one manually." />;
  return (
    <div className="card-brutal overflow-x-auto" data-testid="assets-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left label-mono text-xs text-muted-foreground">
          <th className="p-3">Asset</th><th className="p-3">Category</th><th className="p-3">Vendor</th><th className="p-3">Bought</th><th className="p-3">Status</th><th className="p-3 text-right">Value</th><th className="p-3"></th>
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
  const f = fmt(cur);
  if (!rows.length) return <EmptyState title="No inventory yet" hint="Track stock items and their value here." />;
  return (
    <div className="card-brutal overflow-x-auto" data-testid="inventory-table">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left label-mono text-xs text-muted-foreground">
          <th className="p-3">Item</th><th className="p-3">SKU</th><th className="p-3">Qty</th><th className="p-3">Unit cost</th><th className="p-3">Vendor</th><th className="p-3 text-right">Value</th><th className="p-3"></th>
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
  { key: "overview", label: "Overview", icon: Sparkle },
  { key: "expenses", label: "Expenses", icon: Receipt },
  { key: "assets", label: "Assets", icon: Buildings },
  { key: "inventory", label: "Inventory", icon: Package },
];

export default function Ledger() {
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
    try { await api.delete(`/${kind}/${id}`); invalidate(); toast.success("Deleted"); }
    catch { toast.error("Could not delete"); }
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
      <PageHeader eyebrow="Money in one place" title="Finance">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto" data-testid="ledger-controls">
          <div className="grid grid-cols-2 gap-2 sm:gap-0 sm:flex sm:border sm:border-black sm:overflow-hidden w-full sm:w-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} data-testid={`ledger-tab-${t.key}`}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold uppercase tracking-wider border border-black sm:border-0 sm:border-r sm:border-black sm:last:border-r-0 transition-colors ${tab === t.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                <t.icon size={15} weight="bold" /> {t.label}
              </button>
            ))}
          </div>
          {addBtn}
        </div>
      </PageHeader>

      {(summaryQ.isLoading && tab === "overview") ? (
        <p className="font-mono text-sm">Loading…</p>
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
          <Robot size={14} weight="bold" /> Approved purchase bills & outgoing payments auto-flow into your Ledger and Company Brain.
        </p>
      )}
    </div>
  );
}
