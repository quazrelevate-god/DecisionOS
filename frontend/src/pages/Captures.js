// The Capture Review Queue — WhatsApp captures reviewed before they become
// work. Rendered as the Finance page's Inbox tab (CaptureReview).
//
// 2026-09-14 — on the Finance glass with the page rebuild: a status track,
// white glass cards, tinted status chips that say what they mean, our own
// dropdowns for every choice, ink for Approve. Flows and data-testids are
// unchanged.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowsClockwise, ChatText, CheckCircle, FilePdf, PencilSimple, Question, ShieldWarning, Tray, WhatsappLogo, XCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common";
import { timeAgo, fullTime } from "../lib/format";
import { GlassSelect } from "../components/karma/GlassSelect";
import { DRAWER_FIELD, DRAWER_TRACK, INK_PILL } from "../components/karma/glass";
import { CARD, EmptyNote, SMALL_INK, SMALL_PILL, Tag } from "./finance/financeKit";

const INPUT = cn(DRAWER_FIELD, "h-10 rounded-xl px-3 py-0 text-sm");
const LABEL = "mb-1 block text-[11px] font-medium text-slate-500";

const STATUS_TABS = [
  { key: "pending_review", label: "Pending" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "clarification_requested", label: "Clarification" },
  { key: "executed", label: "Filed" },
  { key: "rejected", label: "Rejected" },
];
const ROLE_OPTS = ["sales", "finance", "purchase", "hr", "operations", "owner"];
const PRIORITY_OPTS = ["low", "medium", "high"];
const BUCKETS = [
  { value: "expense", label: "Expense" },
  { value: "asset", label: "Asset" },
  { value: "inventory", label: "Inventory" },
];
const money = (n) => `₹${Number(n).toLocaleString()}`;

export default function Captures() {
  return (
    <div>
      <PageHeader eyebrow="WhatsApp Smart Capture — review before it becomes work" title="Review Queue" />
      <CaptureReview />
    </div>
  );
}

export function CaptureReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending_review");
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["captures", tab],
    queryFn: () => api.get(`/captures?status=${tab}`).then((r) => r.data),
    refetchInterval: 20000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["captures"] });
    qc.invalidateQueries({ queryKey: ["captures-pending"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  return (
    <div data-testid="captures-page">
      <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div role="group" aria-label="Review status" className={`inline-flex gap-1 rounded-pill p-1 ${DRAWER_TRACK}`}>
          {STATUS_TABS.map((s) => {
            const active = tab === s.key;
            return (
              <button key={s.key} type="button" data-testid={`capture-tab-${s.key}`} onClick={() => setTab(s.key)} aria-pressed={active}
                className={cn(
                  "h-9 shrink-0 whitespace-nowrap rounded-pill px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25",
                  active ? INK_PILL : "text-slate-600 hover:bg-white/80 hover:text-slate-900",
                )}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="ds-skeleton h-44 rounded-[1.6rem]" />)}
        </div>
      ) : isError ? (
        <div className={CARD}>
          <EmptyNote icon={XCircle} title="Couldn't load the queue" hint="You may not review captures for this role, or the connection dropped." />
        </div>
      ) : rows.length === 0 ? (
        <div className={CARD}>
          <EmptyNote icon={Tray} title="Nothing here" hint="WhatsApp messages appear here as AI-drafted items for your review before anything is created." />
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((c) => <CaptureCard key={c.id} c={c} user={user} onChange={refresh} />)}
        </div>
      )}
    </div>
  );
}

function CaptureCard({ c, user, onChange }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    classification: c.classification, reviewer_role: c.reviewer_role,
    priority: c.priority, due_date: c.due_date ? c.due_date.slice(0, 10) : "",
    assignee_id: c.assignee_id || "", summary: c.summary || "", text: c.text || "",
  });
  const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState(c.records || null);
  const isOwner = user?.role === "owner";
  const isPending = c.status === "pending_review" || c.status === "clarification_requested" || c.status === "needs_attention";
  const blockedByEscalation = c.needs_owner && !isOwner;

  const purchaseBills = (recs?.invoices || [])
    .map((inv, i) => ({ inv, i }))
    .filter((x) => x.inv.type === "purchase_bill");
  const anyUnclassified = purchaseBills.some(
    (x) => !["expense", "asset", "inventory"].includes((x.inv.purchase_type || "").toLowerCase()));

  const setBucket = async (idx, val) => {
    const next = { ...recs, invoices: recs.invoices.map((iv, i) => (i === idx ? { ...iv, purchase_type: val } : iv)) };
    setRecs(next);
    try { await api.patch(`/captures/${c.id}`, { records: next }); }
    catch { toast.error("Couldn't save the classification"); }
  };

  const members = useQuery({
    queryKey: ["users"],
    enabled: edit,
    queryFn: () => api.get("/users").then((r) => r.data).catch(() => []),
  });
  const roleMembers = (members.data || []).filter((m) => m.role === form.reviewer_role);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); toast.success(okMsg); onChange(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  const saveEdit = () => act(async () => {
    await api.patch(`/captures/${c.id}`, {
      classification: form.classification, reviewer_role: form.reviewer_role,
      priority: form.priority, assignee_id: form.assignee_id || null,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      summary: form.summary, text: form.text,
    });
    setEdit(false);
  }, "Saved");

  const approve = () => {
    if (anyUnclassified) {
      toast.error("Classify each purchase bill as Expense, Asset or Inventory before approving.");
      return;
    }
    return act(() => api.post(`/captures/${c.id}/approve`), "Approved & actioned");
  };
  const reject = () => {
    const reason = window.prompt("Reason for rejecting?") || "";
    return act(() => api.post(`/captures/${c.id}/reject`, { reason }), "Rejected");
  };
  const clarify = () => {
    const note = window.prompt("What clarification do you need? (sent back on WhatsApp)");
    if (!note) return;
    return act(() => api.post(`/captures/${c.id}/clarify`, { note }), "Clarification requested");
  };
  const reassign = () => {
    const role = window.prompt(`Reassign to which role? (${ROLE_OPTS.join(", ")})`, c.reviewer_role);
    if (!role) return;
    return act(() => api.post(`/captures/${c.id}/reassign`, { reviewer_role: role }), "Reassigned");
  };

  const recCounts = c.records
    ? `${(c.records.invoices || []).length} invoice, ${(c.records.payments || []).length} payment, ${(c.records.contacts || []).length} contact`
    : null;
  const pct = c.confidence != null ? Math.round(c.confidence * 100) : null;
  const why = [
    `Read as “${(c.classification || "other").replace(/_/g, " ")}”`,
    c.reviewer_perm === "finance" ? "money item → routed to Finance" : c.reviewer_role ? `routed to the ${c.reviewer_role} team` : null,
    c.priority ? `${c.priority} priority` : null,
    c.needs_owner ? "needs owner sign-off" : null,
    pct != null ? (pct >= 80 ? `high AI confidence (${pct}%)` : pct >= 50 ? `medium confidence (${pct}%) — worth a check` : `low confidence (${pct}%) — please verify`) : null,
  ].filter(Boolean);
  const fileSrc = c.file_url ? `${process.env.REACT_APP_BACKEND_URL}${c.file_url}` : null;

  return (
    <article data-testid={`capture-card-${c.id}`} className={`p-4 sm:p-5 ${CARD}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100">
          {c.kind === "pdf" || c.kind === "image" ? <FilePdf size={20} aria-hidden="true" /> : <ChatText size={20} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag>{String(c.classification || "other").replace(/_/g, " ")}</Tag>
            <Tag className="normal-case">review: {c.reviewer_role}</Tag>
            <Tag tone={c.priority === "high" ? "bad" : "quiet"}>{c.priority}</Tag>
            {c.needs_owner && (
              <Tag tone="bad" className="normal-case" data-testid={`capture-escalated-${c.id}`}>
                <ShieldWarning size={12} weight="bold" aria-hidden="true" /> Owner approval
              </Tag>
            )}
            {c.status === "needs_attention" && <Tag tone="warn" className="normal-case">needs attention</Tag>}
            {c.auto_processed && <Tag tone="good" className="normal-case">auto-filed</Tag>}
            {c.duplicate_of && <Tag tone="warn" className="normal-case">possible duplicate</Tag>}
            {pct != null && (
              <Tag tone={pct >= 80 ? "good" : pct >= 50 ? "warn" : "bad"} className="normal-case" data-testid={`capture-confidence-${c.id}`} title="AI confidence in this classification">
                AI {pct}%
              </Tag>
            )}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500"
            title={c.sender_name ? `${c.sender_name}${c.wa_from ? " · " + c.wa_from : ""} · ${fullTime(c.created_at)}` : fullTime(c.created_at)}>
            <WhatsappLogo size={13} aria-hidden="true" />
            {c.sender_name
              ? <span data-testid={`capture-sender-${c.id}`}>{c.sender_name}{c.sender_role ? ` (${c.sender_role})` : ""}</span>
              : (c.wa_from || "whatsapp")}
            {" · "}{timeAgo(c.created_at)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[15px] font-semibold leading-snug text-slate-900">{c.summary}</p>
      {c.intent && <p className="mt-0.5 text-xs text-slate-500">Intent: {c.intent}</p>}
      <p data-testid={`capture-why-${c.id}`} className="mt-2 rounded-xl bg-slate-900/[0.03] px-3 py-2 text-xs leading-relaxed text-slate-600">
        <span className="font-semibold text-slate-800">Why AI routed this:</span> {why.join(" · ")}.
      </p>
      {c.text && <p className="mt-2 text-xs italic text-slate-500">“{c.text.slice(0, 200)}”</p>}
      {recCounts && <p className="mt-1.5 text-xs text-slate-500">Extracted: {recCounts}{c.amount ? ` · ${money(c.amount)}` : ""}</p>}
      {!recCounts && c.amount ? <p className="mt-1.5 text-xs text-slate-500">Amount: {money(c.amount)}</p> : null}
      {c.attention_reason && <p className="mt-1.5 text-xs text-amber-800">⚠ {c.attention_reason}</p>}
      {c.escalate_reason && <p className="mt-1.5 text-xs text-rose-700">⚠ {c.escalate_reason}</p>}

      {isPending && purchaseBills.length > 0 && (
        <div className="mt-3 rounded-2xl bg-amber-50/80 p-3 ring-1 ring-inset ring-amber-100" data-testid={`capture-buckets-${c.id}`}>
          <p className="mb-2 text-xs font-semibold text-amber-900">Classify purchase{purchaseBills.length > 1 ? "s" : ""} before approving</p>
          <div className="space-y-2">
            {purchaseBills.map(({ inv, i }) => {
              const pt = (inv.purchase_type || "").toLowerCase();
              const needs = !["expense", "asset", "inventory"].includes(pt);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                    {inv.contact_name || "Supplier"}{inv.number ? ` · #${inv.number}` : ""}{inv.amount ? ` · ${money(inv.amount)}` : ""}
                  </span>
                  <div className="w-40">
                    <GlassSelect variant="field" testid={`capture-bucket-select-${c.id}-${i}`} ariaLabel="Book as" placeholder="Book as…"
                      value={pt} onChange={(v) => setBucket(i, v)} options={BUCKETS} align="end"
                      triggerClassName={cn(INPUT, "bg-white", needs && "ring-2 ring-amber-400")} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {c.clarification_note && <p className="mt-1.5 text-xs text-amber-800">Note: {c.clarification_note}</p>}
      {fileSrc && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-slate-500">Under review — original file</p>
          {c.kind === "image" ? (
            <a href={fileSrc} target="_blank" rel="noopener noreferrer" data-testid={`capture-file-${c.id}`} title="Open full image"
              className="inline-block overflow-hidden rounded-xl ring-1 ring-slate-900/[0.08]">
              <img src={fileSrc} alt={c.filename || "attachment"} className="h-28 w-auto object-cover" />
            </a>
          ) : (
            <a href={fileSrc} target="_blank" rel="noopener noreferrer" data-testid={`capture-file-${c.id}`} className={SMALL_PILL}>
              <FilePdf size={14} aria-hidden="true" /> Open file{c.filename ? ` · ${c.filename}` : ""}
            </a>
          )}
        </div>
      )}

      {edit && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-slate-900/[0.06] pt-4 md:grid-cols-4" data-testid={`capture-edit-${c.id}`}>
          <div className="min-w-0">
            <label htmlFor={`cap-${c.id}-type`} className={LABEL}>Type</label>
            <input id={`cap-${c.id}-type`} className={INPUT} value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`cap-${c.id}-role`} className={LABEL}>Reviewer role</label>
            <GlassSelect id={`cap-${c.id}-role`} variant="field" ariaLabel="Reviewer role" value={form.reviewer_role}
              onChange={(v) => setForm({ ...form, reviewer_role: v, assignee_id: "" })} triggerClassName={INPUT}
              options={ROLE_OPTS.map((r) => ({ value: r, label: r }))} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`cap-${c.id}-priority`} className={LABEL}>Priority</label>
            <GlassSelect id={`cap-${c.id}-priority`} variant="field" ariaLabel="Priority" value={form.priority}
              onChange={(v) => setForm({ ...form, priority: v })} triggerClassName={INPUT}
              options={PRIORITY_OPTS.map((p) => ({ value: p, label: p }))} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`cap-${c.id}-due`} className={LABEL}>Due date</label>
            <input id={`cap-${c.id}-due`} type="date" className={INPUT} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          {roleMembers.length > 0 && (
            <div className="col-span-2 min-w-0">
              <label htmlFor={`cap-${c.id}-assignee`} className={LABEL}>Assign to</label>
              <GlassSelect id={`cap-${c.id}-assignee`} variant="field" ariaLabel="Assign to" value={form.assignee_id}
                onChange={(v) => setForm({ ...form, assignee_id: v })} triggerClassName={INPUT}
                options={[{ value: "", label: "Auto (by workload)" }, ...roleMembers.map((m) => ({ value: m.id, label: m.name }))]} />
            </div>
          )}
          <div className="col-span-2 min-w-0 md:col-span-4">
            <label htmlFor={`cap-${c.id}-summary`} className={LABEL}>Summary</label>
            <input id={`cap-${c.id}-summary`} className={INPUT} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
        </div>
      )}

      {isPending && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-900/[0.06] pt-4">
          {edit ? (
            <>
              <button type="button" data-testid={`capture-save-${c.id}`} disabled={busy} onClick={saveEdit} className={SMALL_INK}>
                <PencilSimple size={14} weight="bold" aria-hidden="true" /> Save
              </button>
              <button type="button" onClick={() => setEdit(false)} className={SMALL_PILL}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" data-testid={`capture-approve-${c.id}`} disabled={busy || blockedByEscalation || anyUnclassified}
                title={blockedByEscalation ? "Requires Owner approval" : anyUnclassified ? "Classify the purchase first" : ""}
                onClick={approve} className={SMALL_INK}>
                <CheckCircle size={14} weight="bold" aria-hidden="true" /> Approve
              </button>
              <button type="button" data-testid={`capture-edit-btn-${c.id}`} disabled={busy} onClick={() => setEdit(true)} className={SMALL_PILL}>
                <PencilSimple size={14} weight="bold" aria-hidden="true" /> Edit
              </button>
              <button type="button" data-testid={`capture-reassign-${c.id}`} disabled={busy} onClick={reassign} className={SMALL_PILL}>
                <ArrowsClockwise size={14} weight="bold" aria-hidden="true" /> Reassign
              </button>
              <button type="button" data-testid={`capture-clarify-${c.id}`} disabled={busy} onClick={clarify} className={SMALL_PILL}>
                <Question size={14} weight="bold" aria-hidden="true" /> Clarify
              </button>
              <button type="button" data-testid={`capture-reject-${c.id}`} disabled={busy} onClick={reject} className={cn(SMALL_PILL, "text-rose-700")}>
                <XCircle size={14} weight="bold" aria-hidden="true" /> Reject
              </button>
            </>
          )}
          {blockedByEscalation && <span className="text-xs text-rose-700">Waiting for Owner — you can still edit or reassign.</span>}
        </div>
      )}

      {c.status === "executed" && (
        <p className="mt-3 flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle size={13} weight="bold" aria-hidden="true" /> {c.auto_processed ? "Auto-filed" : "Approved"} & created ({c.result_ref?.type})
        </p>
      )}
      {c.status === "rejected" && (
        <p className="mt-3 flex items-center gap-1 text-xs text-rose-700">
          <XCircle size={13} weight="bold" aria-hidden="true" /> Rejected
        </p>
      )}
    </article>
  );
}
