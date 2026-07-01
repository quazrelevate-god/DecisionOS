import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
import { Plus, ArrowRight } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";

const TABS = [
  { key: "sales_dispatch", label: "Order Fulfilment", sub: "Sales → Dispatch" },
  { key: "purchase_payment", label: "Procurement", sub: "Purchase → Payment" },
];
const STAGE_LABEL = (s) => s.replace(/_/g, " ");

function NewWorkflowDialog({ type, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", detail: "", amount: "", counterparty: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await api.post("/workflows", { type, title: form.title, detail: form.detail, counterparty: form.counterparty, amount: form.amount ? Number(form.amount) : null });
      toast.success("Workflow created");
      setForm({ title: "", detail: "", amount: "", counterparty: "" });
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error("Create failed");
    }
  };
  const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="new-workflow-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> New
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New {TABS.find(t=>t.key===type).label}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input data-testid="wf-title-input" className={inp} placeholder="Title (e.g. Order #4823 — Retailer)" value={form.title} onChange={set("title")} />
          <input className={inp} placeholder="Counterparty" value={form.counterparty} onChange={set("counterparty")} />
          <input className={inp} type="number" placeholder="Amount (₹)" value={form.amount} onChange={set("amount")} />
          <textarea className={inp} rows={2} placeholder="Detail" value={form.detail} onChange={set("detail")} />
        </div>
        <DialogFooter>
          <button data-testid="wf-create-submit" onClick={create} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Create</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Workflows() {
  const qc = useQueryClient();
  const { tenant } = useAuth();
  const [tab, setTab] = useState("sales_dispatch");
  const { data } = useQuery({ queryKey: ["workflows", tab], queryFn: () => api.get(`/workflows?type=${tab}`).then((r) => r.data) });

  const stages = tab === "sales_dispatch"
    ? ["order_received", "confirmed", "in_production", "ready", "dispatched", "delivered"]
    : ["requested", "approved", "ordered", "received", "payment_pending", "paid"];

  const advance = async (wf) => {
    const idx = wf.stages.indexOf(wf.stage);
    if (idx >= wf.stages.length - 1) return toast.info("Already at final stage");
    const next = wf.stages[idx + 1];
    try {
      await api.patch(`/workflows/${wf.id}/advance`, { stage: next, note: `Moved to ${STAGE_LABEL(next)}` });
      toast.success(`→ ${STAGE_LABEL(next)}`);
      qc.invalidateQueries({ queryKey: ["workflows", tab] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cannot advance");
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Flagship operational flows" title="Workflows">
        <NewWorkflowDialog type={tab} onCreated={() => qc.invalidateQueries({ queryKey: ["workflows", tab] })} />
      </PageHeader>

      <div className="flex border border-black mb-6 w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`workflow-tab-${t.key}`}
            className={`px-5 py-2.5 text-left border-r border-black last:border-r-0 transition-colors ${tab === t.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            <span className="block text-sm font-semibold uppercase tracking-wider">{t.label}</span>
            <span className={`block text-[10px] uppercase tracking-widest ${tab === t.key ? "text-white/60" : "text-muted-foreground"}`}>{t.sub}</span>
          </button>
        ))}
      </div>

      {/* Brutalist kanban */}
      <div className="border border-black overflow-x-auto">
        <div className="flex min-w-max">
          {stages.map((st) => {
            const cards = (data || []).filter((w) => w.stage === st);
            return (
              <div key={st} className="w-64 shrink-0 border-r border-black last:border-r-0" data-testid={`stage-column-${st}`}>
                <div className="px-3 py-2 border-b border-black bg-brand-paper sticky top-0">
                  <p className="label-mono">{STAGE_LABEL(st)}</p>
                  <p className="font-heading font-black text-lg">{cards.length}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[300px] bg-white">
                  {cards.map((w) => {
                    const isLast = w.stages.indexOf(w.stage) >= w.stages.length - 1;
                    return (
                      <div key={w.id} data-testid={`workflow-card-${w.id}`} className="border border-black p-3 shadow-hover bg-white">
                        <p className="font-semibold text-sm leading-tight">{w.title}</p>
                        {w.counterparty && <p className="text-xs text-muted-foreground mt-1">{w.counterparty}</p>}
                        {w.amount != null && <p className="font-mono text-xs mt-1">{money(w.amount, tenant?.currency)}</p>}
                        {!isLast && (
                          <button onClick={() => advance(w)} data-testid={`advance-workflow-${w.id}`}
                            className="mt-3 w-full flex items-center justify-center gap-1 border border-black py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
                            Advance <ArrowRight size={12} weight="bold" />
                          </button>
                        )}
                        {isLast && <Chip value={w.stage} className="mt-3" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
