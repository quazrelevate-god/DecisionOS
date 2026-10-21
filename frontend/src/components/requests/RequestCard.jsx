/* Requests (2026-10-21) — one request, on every screen that shows one: the
 * requester's own list, the approver's queue, Finance's list to pay.
 *
 * It wears the leave card's vocabulary (pages/Leave.js LeaveCard): ASK-25
 * chips, the task drawer's pills, a question and its answer kept together, and
 * a "no" that commits in maroon. What it may offer comes from the server's
 * `can` flags on the request (routers/staff_requests._shape), so no screen
 * re-derives a rule — the card shows Approve because the server said this
 * person may approve, not because a client guessed.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, ChatCircleText, PaperPlaneTilt, ArrowCounterClockwise, Clock,
  Paperclip, CalendarBlank, CaretDown, Receipt, WarningCircle, Package, SealCheck, ClockCounterClockwise,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr, money, timeAgo, fullTime, shortDate } from "../../lib/format";
import { requestStatus, requestType, HISTORY_WORDS, OPEN_REQUEST } from "../../lib/requests";
import { DesignCheckbox } from "../neuglass/DesignCheckbox";
import {
  CHIP, QUIET_CHIP, DRAWER_FIELD, DRAWER_TRACK, GLASS_PILL, INK_PILL, MAROON_PILL,
} from "../neuglass/glass";

const SECONDARY = `flex h-11 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`;
const KEEP = `h-10 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`;
const SHOWN_ITEMS = 3;
const BACKEND = process.env.REACT_APP_BACKEND_URL || "";

const first = (name, fallback = "They") => (name || fallback).split(" ")[0];

export function RequestCard({ r, highlight = false, onChanged }) {
  const qc = useQueryClient();
  const [action, setAction] = useState(null);       // reject | info | withdraw | fulfil
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [markPaid, setMarkPaid] = useState(true);
  const [toStock, setToStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [allItems, setAllItems] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const st = requestStatus(r);
  const kind = requestType(r.type);
  const StatusIcon = st.icon;
  const KindIcon = kind.icon;
  const can = r.can || {};
  const items = r.items || [];
  const shown = allItems ? items : items.slice(0, SHOWN_ITEMS);
  const stockable = kind.stock && items.some((it) => Number(it.quantity) > 0);
  const today = new Date().toISOString().slice(0, 10);
  const late = r.needed_by && r.needed_by < today && OPEN_REQUEST.has(r.status);

  // The server's answer shows on the card at once, then the lists reload.
  const applyNow = (updated) => {
    if (!updated?.id) return;
    qc.setQueriesData({ queryKey: ["requests"] }, (old) => (
      Array.isArray(old) ? old.map((x) => (x.id === updated.id ? updated : x)) : old));
  };
  const done = (updated, said) => {
    applyNow(updated);
    toast.success(said);
    setAction(null); setNote(""); setReply("");
    qc.invalidateQueries({ queryKey: ["requests"] });
    qc.invalidateQueries({ queryKey: ["desk"] });
    onChanged?.(updated);
  };
  const post = async (path, body, said) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/requests/${r.id}/${path}`, body);
      done(data, said);
    } catch (e) { toast.error(e.response?.data?.detail || "That didn't go through. Try again."); }
    finally { setBusy(false); }
  };

  const approve = () => post("approve", { note: "" },
    kind.finance ? `Approved — ${r.number} is in Finance as an expense` : `Approved — ${first(r.requester_name, "they")} was told`);
  const confirm = () => {
    if (action === "reject") {
      if (!note.trim()) return toast.error("Say why — it helps them raise a better request");
      return post("reject", { note: note.trim() }, "Rejected — they were told why");
    }
    if (action === "info") {
      if (!note.trim()) return toast.error("Write your question first");
      return post("request-info", { note: note.trim() }, "Question sent");
    }
    if (action === "withdraw") return post("withdraw", { note: note.trim() }, "Request withdrawn — your approver was told");
    if (action === "fulfil") {
      return post("fulfil", { note: note.trim(), mark_paid: markPaid, add_to_stock: stockable && toStock },
        stockable && toStock ? "Done — paid, and the items are in stock" : "Done — marked paid");
    }
    return undefined;
  };
  const answer = () => {
    if (!reply.trim()) return toast.error("Write your answer first");
    return post("respond", { note: reply.trim() }, "Answer sent — it's back with your approver");
  };

  return (
    <article data-testid={`request-card-${r.id}`} aria-labelledby={`request-title-${r.id}`}
      className={`ng-bento p-5 ${highlight ? "ring-2 ring-neutral-900/70 ring-offset-2" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP} ${st.tone}`} data-testid={`request-status-${r.id}`}>
          <StatusIcon size={11} weight="bold" aria-hidden="true" /> {st.label}
        </span>
        <span className={`${CHIP} ${QUIET_CHIP}`} data-testid={`request-type-${r.id}`}>
          <KindIcon size={11} weight="bold" aria-hidden="true" /> {kind.short}
        </span>
        {r.needed_by && (
          <span className={`${CHIP} ${late ? "bg-rose-50 text-rose-700 ring-rose-100" : QUIET_CHIP}`} title={`Needed by ${shortDate(r.needed_by)}`}>
            <CalendarBlank size={11} weight="bold" aria-hidden="true" /> {late ? "Was needed" : "By"} {shortDate(r.needed_by)}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-neutral-400">{r.number}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id={`request-title-${r.id}`} className="text-base font-semibold leading-tight text-neutral-900 [overflow-wrap:anywhere]">{r.title}</h3>
          <p className="mt-1 text-sm text-neutral-600">
            {r.requester_name}
            {r.approver_name && r.status !== "approved" && r.status !== "fulfilled" ? ` → ${r.approver_name}` : ""}
          </p>
        </div>
        {kind.finance && (
          <p className="shrink-0 text-right font-display text-2xl tabular-nums leading-none text-neutral-900" data-testid={`request-total-${r.id}`}>
            {inr(r.total) || "₹0"}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <ul className={`mt-3 divide-y divide-slate-900/[0.05] rounded-[1.1rem] px-3 ${DRAWER_TRACK}`} data-testid={`request-items-${r.id}`}>
          {shown.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 text-neutral-800 [overflow-wrap:anywhere]">
                {it.name}
                {it.quantity ? <span className="text-neutral-500"> · {it.quantity}{it.unit ? ` ${it.unit}` : ""}</span> : null}
              </span>
              {it.amount > 0 && <span className="shrink-0 tabular-nums text-neutral-700">{money(it.amount)}</span>}
            </li>
          ))}
          {items.length > SHOWN_ITEMS && (
            <li>
              <button type="button" onClick={() => setAllItems((v) => !v)} data-testid={`request-items-toggle-${r.id}`}
                className="flex min-h-10 w-full items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-900">
                <CaretDown size={12} weight="bold" aria-hidden="true" className={`transition-transform ${allItems ? "rotate-180" : ""}`} />
                {allItems ? "Show fewer" : `Show all ${items.length} items`}
              </button>
            </li>
          )}
        </ul>
      )}

      {r.reason && <p className="mt-3 text-sm text-neutral-600 [overflow-wrap:anywhere]">{r.reason}</p>}

      {(r.attachments || []).length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" data-testid={`request-files-${r.id}`}>
          {r.attachments.map((a) => (
            <li key={a.id}>
              <a href={`${BACKEND}/api/files/${a.id}/download`} target="_blank" rel="noreferrer"
                className={`flex max-w-[14rem] items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-900 ${GLASS_PILL}`}>
                <Paperclip size={12} weight="bold" aria-hidden="true" className="shrink-0" />
                <span className="truncate">{a.filename}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
        <Clock size={12} weight="bold" aria-hidden="true" />
        <span title={fullTime(r.created_at)}>{timeAgo(r.created_at)}</span>
        {r.decided_by_name && (r.status === "approved" || r.status === "fulfilled" || r.status === "rejected")
          ? ` · ${r.status === "rejected" ? "Rejected" : "Approved"} by ${r.decided_by_name}` : ""}
        {r.fulfilled_by_name && r.status === "fulfilled" ? ` · Paid by ${r.fulfilled_by_name}` : ""}
      </p>

      {/* The question and its answer, together, so both sides read the whole exchange. */}
      {r.info_note && (r.status === "info_requested" || r.reply_note) && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-violet-50/80 px-3 py-2.5 text-xs text-violet-950 ring-1 ring-inset ring-violet-100" data-testid={`request-info-note-${r.id}`}>
          <ChatCircleText size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-violet-700" />
          <p><span className="font-semibold">{r.info_by_name || r.approver_name || "The approver"} asked:</span> {r.info_note}</p>
        </div>
      )}
      {r.reply_note && (
        <div className="mt-2 flex items-start gap-2 rounded-2xl bg-white/70 px-3 py-2.5 text-xs text-neutral-800 ring-1 ring-inset ring-neutral-200" data-testid={`request-reply-note-${r.id}`}>
          <PaperPlaneTilt size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-neutral-500" />
          <p><span className="font-semibold">{first(r.requester_name)} answered:</span> {r.reply_note}</p>
        </div>
      )}
      {r.status === "rejected" && r.decision_note && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50/80 px-3 py-2.5 text-xs text-rose-950 ring-1 ring-inset ring-rose-100" data-testid={`request-reject-note-${r.id}`}>
          <XCircle size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-rose-700" />
          <p><span className="font-semibold">Why:</span> {r.decision_note}</p>
        </div>
      )}
      {(r.status === "approved" || r.status === "fulfilled") && r.decision_note && (
        <p className="mt-2 text-xs text-neutral-600">“{r.decision_note}” — {first(r.decided_by_name, "Approver")}</p>
      )}
      {r.status === "cancelled" && r.withdrawn_note && (
        <p className="mt-2 text-xs text-neutral-500">Withdrawn: {r.withdrawn_note}</p>
      )}
      {r.fulfil_note && <p className="mt-2 text-xs text-neutral-600">Finance: {r.fulfil_note}</p>}

      {/* Where the money is: the expense approval booked, or why there isn't one. */}
      {kind.finance && (r.status === "approved" || r.status === "fulfilled") && (
        r.expense_id ? (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-600" data-testid={`request-expense-${r.id}`}>
            <Receipt size={13} weight="bold" aria-hidden="true" className="text-neutral-500" />
            {r.status === "fulfilled" ? "Paid" : "In Finance as an expense to pay"}
            {r.expense_category ? ` · ${r.expense_category}` : ""}
            {(r.stock_item_ids || []).length > 0 && (
              <span className="inline-flex items-center gap-1"> · <Package size={12} weight="bold" aria-hidden="true" /> {r.stock_item_ids.length} in stock</span>
            )}
            {can.fulfil && (
              <Link to="/finance?tab=expenses" className="font-semibold text-neutral-800 underline-offset-2 hover:underline">Open Finance</Link>
            )}
          </p>
        ) : r.expense_error ? (
          <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-amber-800" data-testid={`request-expense-error-${r.id}`}>
            <WarningCircle size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0" /> {r.expense_error}
          </p>
        ) : null
      )}

      {/* The requester's side: answer the question. */}
      {can.respond && (
        <div className={`mt-3 space-y-2.5 rounded-[1.25rem] p-3 ${DRAWER_TRACK}`} data-testid={`request-reply-${r.id}`}>
          <textarea data-testid={`request-reply-input-${r.id}`} className={`${DRAWER_FIELD} resize-none text-sm`} rows={2}
            aria-label="Your answer" placeholder="Your answer" maxLength={1000}
            value={reply} onChange={(e) => setReply(e.target.value)} />
          <button onClick={answer} disabled={busy} data-testid={`request-reply-send-${r.id}`}
            className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            <PaperPlaneTilt size={15} weight="bold" aria-hidden="true" /> {busy ? "Sending…" : "Send answer"}
          </button>
        </div>
      )}

      {/* The approver's side, and Finance's. */}
      {!action && (can.decide || can.fulfil) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {can.decide && (
            <>
              <button onClick={approve} disabled={busy} data-testid={`request-approve-${r.id}`}
                className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-pill px-5 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
                <CheckCircle size={16} weight="bold" aria-hidden="true" /> {busy ? "Approving…" : "Approve"}
              </button>
              <button onClick={() => setAction("reject")} data-testid={`request-reject-${r.id}`} className={SECONDARY}>
                <XCircle size={16} weight="bold" aria-hidden="true" /> Reject
              </button>
              {r.status === "pending" && (
                <button onClick={() => setAction("info")} data-testid={`request-info-${r.id}`} className={SECONDARY}>
                  <ChatCircleText size={16} weight="bold" aria-hidden="true" /> Ask
                </button>
              )}
            </>
          )}
          {can.fulfil && (
            <button onClick={() => setAction("fulfil")} data-testid={`request-fulfil-${r.id}`}
              className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
              <SealCheck size={16} weight="bold" aria-hidden="true" /> Mark paid
            </button>
          )}
        </div>
      )}

      {action && (
        <div className={`mt-4 space-y-2.5 rounded-[1.25rem] p-3 ${DRAWER_TRACK}`} data-testid={`request-action-${r.id}`}>
          {action === "withdraw" && (
            <>
              <p className="text-sm font-semibold text-neutral-900">Withdraw this request?</p>
              <p className="text-xs text-neutral-500">Your approver is told, and it stays in your history as withdrawn.</p>
            </>
          )}
          {action === "fulfil" && (
            <>
              <p className="text-sm font-semibold text-neutral-900">Paid or bought?</p>
              {r.expense_id && (
                <DesignCheckbox checked={markPaid} onChange={setMarkPaid} testid={`request-mark-paid-${r.id}`}>
                  Mark its expense paid in Finance
                </DesignCheckbox>
              )}
              {stockable && (
                <DesignCheckbox checked={toStock} onChange={setToStock} testid={`request-to-stock-${r.id}`}>
                  Add the items to stock
                </DesignCheckbox>
              )}
            </>
          )}
          <textarea data-testid={`request-note-${r.id}`} className={`${DRAWER_FIELD} resize-none text-sm`} rows={2} autoFocus
            maxLength={1000}
            aria-label={action === "reject" ? "Why you're rejecting it" : action === "info" ? "Your question" : "A note (optional)"}
            placeholder={action === "reject" ? "Why? They'll see this" : action === "info" ? "What do you need to know?"
              : action === "fulfil" ? "Where it was bought, the bill number… (optional)" : "Why? (optional)"}
            value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={confirm} disabled={busy} data-testid={`request-confirm-${r.id}`}
              className={`flex h-10 flex-1 items-center justify-center rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${
                action === "reject" || action === "withdraw" ? MAROON_PILL : INK_PILL}`}>
              {busy ? "Saving…" : action === "reject" ? "Reject request" : action === "info" ? "Send question"
                : action === "withdraw" ? "Withdraw" : "Mark done"}
            </button>
            <button onClick={() => { setAction(null); setNote(""); }} data-testid={`request-cancel-${r.id}`} className={KEEP}>
              {action === "withdraw" ? "Keep it" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {can.withdraw && !action && (
          <button onClick={() => setAction("withdraw")} data-testid={`request-withdraw-${r.id}`}
            className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-neutral-600 underline-offset-2 hover:text-neutral-900 hover:underline">
            <ArrowCounterClockwise size={13} weight="bold" aria-hidden="true" /> Withdraw request
          </button>
        )}
        {(r.history || []).length > 1 && (
          <button onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} data-testid={`request-history-toggle-${r.id}`}
            className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-neutral-600 underline-offset-2 hover:text-neutral-900 hover:underline">
            <ClockCounterClockwise size={13} weight="bold" aria-hidden="true" /> {showHistory ? "Hide history" : "History"}
          </button>
        )}
      </div>
      {showHistory && (
        <ol className="mt-2 space-y-2 border-l border-slate-900/10 pl-3" data-testid={`request-history-${r.id}`}>
          {(r.history || []).map((h, i) => (
            <li key={i} className="text-xs text-neutral-600">
              <span className="font-semibold text-neutral-800">{HISTORY_WORDS[h.action] || h.action}</span>
              {h.by_name ? ` · ${h.by_name}` : ""}
              <span className="text-neutral-400" title={fullTime(h.at)}> · {timeAgo(h.at)}</span>
              {h.note ? <span className="block text-neutral-500 [overflow-wrap:anywhere]">{h.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
