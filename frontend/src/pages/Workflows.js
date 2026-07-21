import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { lex } from "../lib/lexicon";
import { opModel } from "../lib/operatingModel";
import { PageHeader, Chip } from "../components/common";
import { money, timeAgo, fullTime } from "../lib/format";
import { toast } from "sonner";
import { Plus, ArrowRight, Trash, ClockCounterClockwise } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";

const STAGE_LABEL = (s) => (s || "").replace(/_/g, " ");

function NewWorkflowDialog({ type, typeLabel, custLabel, vendLabel, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", detail: "", amount: "", counterparty: "", contact_id: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const contactType = type === "purchase_payment" ? "vendor" : "customer";
  const contactLabel = contactType === "customer" ? custLabel : vendLabel;
  const { data: contacts } = useQuery({
    queryKey: ["contacts", contactType, "", ""],
    queryFn: () => api.get(`/contacts?type=${contactType}`).then((r) => r.data),
    enabled: open,
  });
  const pickContact = (e) => {
    const id = e.target.value;
    const c = (contacts || []).find((x) => x.id === id);
    setForm({ ...form, contact_id: id, counterparty: c ? (c.company || c.name) : form.counterparty });
  };
  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await api.post("/workflows", { type, title: form.title, detail: form.detail, counterparty: form.counterparty, contact_id: form.contact_id || null, amount: form.amount ? Number(form.amount) : null });
      toast.success("Workflow created");
      setForm({ title: "", detail: "", amount: "", counterparty: "", contact_id: "" });
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
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New {typeLabel}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Add a card to track this {typeLabel.toLowerCase()} process.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input data-testid="wf-title-input" className={inp} placeholder="Title (e.g. Order #4823)" value={form.title} onChange={set("title")} />
          <div>
            <label className="label-mono text-muted-foreground">{contactLabel}</label>
            <select data-testid="wf-contact-select" className={`${inp} mt-1`} value={form.contact_id} onChange={pickContact}>
              <option value="">Select {contactLabel.toLowerCase()}… (or type below)</option>
              {(contacts || []).map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
            </select>
          </div>
          <input data-testid="wf-counterparty-input" className={inp} placeholder="Counterparty name" value={form.counterparty} onChange={set("counterparty")} />
          <input className={inp} type="number" placeholder="Amount" value={form.amount} onChange={set("amount")} />
          <textarea className={inp} rows={2} placeholder="Detail" value={form.detail} onChange={set("detail")} />
        </div>
        <DialogFooter>
          <button data-testid="wf-create-submit" onClick={create} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Create</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Workflows({ embedded = false }) {
  const qc = useQueryClient();
  const { tenant, user } = useAuth();
  const L = lex(tenant);
  const om = opModel(tenant);
  const pipelines = om.pipelines;
  const [tab, setTab] = useState(pipelines[0]?.key);
  const activeKey = pipelines.some((p) => p.key === tab) ? tab : pipelines[0]?.key;
  const { data } = useQuery({ queryKey: ["workflows", activeKey], queryFn: () => api.get(`/workflows?type=${activeKey}`).then((r) => r.data) });

  const pipeline = pipelines.find((p) => p.key === activeKey) || pipelines[0];
  const stages = pipeline?.stages || [];
  const stageLabelMap = Object.fromEntries(stages.map((s) => [s.key, s.label]));
  const labelOf = (k) => stageLabelMap[k] || STAGE_LABEL(k);
  const tabLabel = pipeline?.label || "";
  const newWfDialog = (
    <NewWorkflowDialog
      type={activeKey} typeLabel={tabLabel} custLabel={L.customer_singular} vendLabel={L.vendor_singular}
      onCreated={() => qc.invalidateQueries({ queryKey: ["workflows", activeKey] })} />
  );

  const advance = async (wf) => {
    const idx = wf.stages.indexOf(wf.stage);
    if (idx >= wf.stages.length - 1) return toast.info("Already at final stage");
    const next = wf.stages[idx + 1];
    try {
      await api.patch(`/workflows/${wf.id}/advance`, { stage: next, note: `Moved to ${labelOf(next)}` });
      toast.success(`→ ${labelOf(next)}`);
      qc.invalidateQueries({ queryKey: ["workflows", activeKey] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cannot advance");
    }
  };

  const del = async (wf) => {
    if (!window.confirm(`Delete "${wf.title}"? This removes the card permanently.`)) return;
    try {
      await api.delete(`/workflows/${wf.id}`);
      toast.success("Workflow deleted");
      qc.invalidateQueries({ queryKey: ["workflows", activeKey] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div>
      {embedded ? (
        <div className="flex justify-end mb-4">
          {newWfDialog}
        </div>
      ) : (
        <PageHeader eyebrow="Flagship operational flows" title="Workflows">
          {newWfDialog}
        </PageHeader>
      )}

      <div className="flex flex-wrap border border-black mb-6 w-fit">
        {pipelines.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`workflow-tab-${t.key}`}
            className={`px-5 py-2.5 text-left border-r border-black last:border-r-0 transition-colors ${activeKey === t.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            <span className="block text-sm font-semibold uppercase tracking-wider">{t.label}</span>
            <span className={`block text-[10px] uppercase tracking-widest ${activeKey === t.key ? "text-white/60" : "text-muted-foreground"}`}>{t.sub}</span>
          </button>
        ))}
      </div>

      {/* Brutalist kanban */}
      <div className="border border-black overflow-x-auto">
        <div className="flex min-w-max">
          {stages.map((stg) => {
            const cards = (data || []).filter((w) => w.stage === stg.key);
            return (
              <div key={stg.key} className="w-64 shrink-0 border-r border-black last:border-r-0" data-testid={`stage-column-${stg.key}`}>
                <div className="px-3 py-2 border-b border-black bg-brand-paper sticky top-0">
                  <p className="label-mono">{stg.label}</p>
                  <p className="font-heading font-black text-lg">{cards.length}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[300px] bg-white">
                  {cards.map((w) => {
                    const isLast = w.stages.indexOf(w.stage) >= w.stages.length - 1;
                    const lastEv = (w.history || [])[(w.history || []).length - 1];
                    const updAt = lastEv?.at || w.created_at;
                    const updLabel = lastEv?.note || "Created";
                    return (
                      <div key={w.id} data-testid={`workflow-card-${w.id}`} className="border border-black p-3 shadow-hover bg-white">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight">{w.title}</p>
                          {user?.role === "owner" && (
                            <button onClick={() => del(w)} data-testid={`delete-workflow-${w.id}`} title="Delete card"
                              className="shrink-0 text-muted-foreground hover:text-brand-red transition-colors">
                              <Trash size={14} weight="bold" />
                            </button>
                          )}
                        </div>
                        {w.counterparty && <p className="text-xs text-muted-foreground mt-1">{w.counterparty}</p>}
                        {w.amount != null && <p className="font-mono text-xs mt-1">{money(w.amount, tenant?.currency)}</p>}
                        {updAt && (
                          <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1" data-testid={`workflow-updated-${w.id}`} title={fullTime(updAt)}>
                            <ClockCounterClockwise size={11} weight="bold" /> {updLabel} · {timeAgo(updAt)}
                          </p>
                        )}
                        {!isLast && (
                          <button onClick={() => advance(w)} data-testid={`advance-workflow-${w.id}`}
                            className="mt-3 w-full flex items-center justify-center gap-1 border border-black py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
                            Advance <ArrowRight size={12} weight="bold" />
                          </button>
                        )}
                        {isLast && <Chip value={labelOf(w.stage)} className="mt-3" />}
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
