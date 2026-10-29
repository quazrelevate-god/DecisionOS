/* Requests (2026-10-21) — one request, on every screen that shows one: the
 * requester's own list, the approver's queue, Finance's list to pay.
 *
 * 2026-10-29, founder's reference — ONE REQUEST, ONE CARD THAT SAYS WHERE IT
 * STANDS. Its state, its kind and when it is needed in a row of chips with its
 * number and a menu on the right; what it is for beside how much; the two
 * people it passes between, face to face with an arrow (who asked → who says
 * yes, and whether they have); then whatever is live on it — the approver's
 * question, what is being bought or booked, the files — and a foot that says
 * how long ago it was raised and offers the one thing this person can do now:
 * Approve, Reject or Ask for the approver; Mark paid for Finance; View details
 * for everyone else. The rest (every item, the notes, the expense, the
 * history) is under View details.
 *
 * What it may offer still comes from the server's `can` flags on the request
 * (routers/staff_requests._shape), so no screen re-derives a rule — the card
 * shows Approve because the server said this person may approve.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, ChatCircleText, PaperPlaneTilt, ArrowCounterClockwise, Clock, ArrowRight,
  CalendarBlank, CaretDown, CaretRight, Receipt, WarningCircle, Package, SealCheck, ClockCounterClockwise,
  DotsThreeVertical, FilePdf, FileImage, File as FileIcon, FileText, Eye,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr, money, timeAgo, agoWords, fullTime, shortDate } from "../../lib/format";
import { requestStatus, requestType, requestTone, HISTORY_WORDS, OPEN_REQUEST } from "../../lib/requests";
import { DesignCheckbox } from "../neuglass/DesignCheckbox";
import { PersonAvatar } from "../neuglass/PersonAvatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";
// A new tab on the web; in the app, signed in and through the share sheet.
import { fileLink } from "../../lib/native/files";
import {
  CHIP, DRAWER_FIELD, DRAWER_TRACK, GLASS_PILL, INK_PILL, MAROON_PILL, GLASS_MENU, GLASS_MENU_ITEM,
} from "../neuglass/glass";

const OUTLINE = "flex h-11 items-center justify-center gap-1.5 rounded-pill bg-white px-4 text-[14px] font-semibold text-neutral-900 ring-1 ring-inset ring-slate-900/10 shadow-[0_6px_16px_-10px_hsl(216_30%_25%/0.45)] transition-colors hover:bg-slate-50 disabled:opacity-50";
const KEEP = `h-10 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`;
const SHOWN_FILES = 2;
const BACKEND = process.env.REACT_APP_BACKEND_URL || "";

const first = (name, fallback = "They") => (name || fallback).split(" ")[0];
const fileKind = (a) => {
  const t = (a.content_type || "").toLowerCase();
  const n = (a.filename || "").toLowerCase();
  if (t.includes("pdf") || n.endsWith(".pdf")) return { Icon: FilePdf, tone: "text-rose-600" };
  if (t.startsWith("image/") || /\.(png|jpe?g|webp|heic|gif)$/.test(n)) return { Icon: FileImage, tone: "text-sky-600" };
  return { Icon: FileIcon, tone: "text-slate-500" };
};

/* A face and two lines: the person's name and what they are to this request. */
function Party({ name, sub, src, testid, muted = false }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5" data-testid={testid}>
      <PersonAvatar name={name} src={src} size={44} ring={false} className={muted ? "opacity-60" : ""} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-tight text-neutral-900">{name || "—"}</span>
        <span className="block truncate text-[13px] leading-tight text-slate-500">{sub}</span>
      </span>
    </span>
  );
}

export function RequestCard({ r, highlight = false, onChanged }) {
  const qc = useQueryClient();
  const [action, setAction] = useState(null);       // reject | info | withdraw | fulfil
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [markPaid, setMarkPaid] = useState(true);
  const [toStock, setToStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const [allFiles, setAllFiles] = useState(false);
  // Faces for the two people (the member list is shared, and cached, app-wide).
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((x) => x.data), staleTime: 5 * 60 * 1000 });
  const face = (id) => (usersQ.data || []).find((m) => m.id === id)?.avatar_url;

  const st = requestStatus(r);
  const kind = requestType(r.type);
  const tone = requestTone(r.type);
  const StatusIcon = st.icon;
  const KindIcon = kind.icon;
  const can = r.can || {};
  const items = r.items || [];
  const files = r.attachments || [];
  const stockable = kind.stock && items.some((it) => Number(it.quantity) > 0);
  const today = new Date().toISOString().slice(0, 10);
  const late = r.needed_by && r.needed_by < today && OPEN_REQUEST.has(r.status);
  const decided = ["approved", "fulfilled", "rejected"].includes(r.status);

  // The right-hand person: whoever said yes or no, else whoever is to.
  const right = (() => {
    if (!r.approver_id && !r.decided_by) return null;     // an owner's own request
    if (decided) {
      return { id: r.decided_by || r.approver_id, name: r.decided_by_name || r.approver_name,
        sub: r.status === "rejected" ? "Rejected" : "Approved" };
    }
    if (r.status === "info_requested") return { id: r.approver_id, name: r.info_by_name || r.approver_name, sub: "Asked a question" };
    return { id: r.approver_id, name: r.approver_name, sub: r.status === "cancelled" ? "Was the approver" : "Approver" };
  })();

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

  // What the foot offers this person, now.
  const deciding = !action && can.decide;
  const paying = !action && can.fulfil;
  const shownFiles = allFiles ? files : files.slice(0, SHOWN_FILES + (files.length === SHOWN_FILES + 1 ? 1 : 0));
  const moreFiles = files.length - shownFiles.length;
  const firstItem = items[0];

  return (
    <article data-testid={`request-card-${r.id}`} data-status={r.status} aria-labelledby={`request-title-${r.id}`}
      /* A column the height of its grid row, so the actions sit on the card's
         floor in every card of a row, however much each one says above them. */
      className={`flex h-full min-w-0 flex-col rounded-[1.75rem] bg-white p-5 shadow-[0_18px_40px_-26px_hsl(220_30%_20%/0.45)] ring-1 ring-inset ring-slate-900/[0.04] ${
        highlight ? "ring-2 ring-neutral-900/70 ring-offset-2" : ""}`}>
      {/* State · kind · when, then the number and the menu. */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className={`${CHIP} h-8 gap-1.5 px-3 text-[13px] ${st.tone}`} data-testid={`request-status-${r.id}`}>
            <StatusIcon size={14} weight={r.status === "approved" || r.status === "fulfilled" ? "fill" : "bold"} aria-hidden="true" /> {st.label}
          </span>
          <span className={`${CHIP} h-8 gap-1.5 px-3 text-[13px] ${tone.chip}`} data-testid={`request-type-${r.id}`}>
            <KindIcon size={14} weight="bold" aria-hidden="true" /> {kind.short}
          </span>
          {r.needed_by && (
            <span className={`${CHIP} h-8 gap-1.5 px-3 text-[13px] ${late ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-slate-100 text-slate-700 ring-slate-200"}`}
              title={`Needed by ${shortDate(r.needed_by)}`} data-testid={`request-needed-${r.id}`}>
              <CalendarBlank size={14} weight="bold" aria-hidden="true" /> {late ? "Was needed" : "By"} {shortDate(r.needed_by)}
            </span>
          )}
        </div>
        <span className="mt-2 shrink-0 font-mono text-[12px] tabular-nums text-slate-400" data-testid={`request-number-${r.id}`}>{r.number}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More on this request" data-testid={`request-menu-${r.id}`}
              className="-mr-2 -mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900">
              <DotsThreeVertical size={20} weight="bold" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className={`${GLASS_MENU} w-56 p-1.5`}>
            <DropdownMenuItem onSelect={() => setDetails((v) => !v)} className={GLASS_MENU_ITEM} data-testid={`request-menu-details-${r.id}`}>
              <Eye size={15} weight="bold" aria-hidden="true" /> {details ? "Hide details" : "View details"}
            </DropdownMenuItem>
            {(r.history || []).length > 1 && (
              <DropdownMenuItem onSelect={() => setDetails(true)} className={GLASS_MENU_ITEM} data-testid={`request-history-toggle-${r.id}`}>
                <ClockCounterClockwise size={15} weight="bold" aria-hidden="true" /> History
              </DropdownMenuItem>
            )}
            {can.withdraw && (
              <DropdownMenuItem onSelect={() => setAction("withdraw")} className={GLASS_MENU_ITEM} data-testid={`request-withdraw-${r.id}`}>
                <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" /> Withdraw request
              </DropdownMenuItem>
            )}
            {kind.finance && r.expense_id && can.fulfil && (
              <DropdownMenuItem asChild className={GLASS_MENU_ITEM}>
                <Link to="/finance?tab=expenses"><Receipt size={15} weight="bold" aria-hidden="true" /> Open in Finance</Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* What it is for, and how much. */}
      <div className="mt-3 flex items-start justify-between gap-4">
        <button type="button" onClick={() => setDetails((v) => !v)} className="min-w-0 text-left">
          <h3 id={`request-title-${r.id}`} className="text-[19px] font-semibold leading-snug text-neutral-900 [overflow-wrap:anywhere]">{r.title}</h3>
        </button>
        {kind.finance && (
          <p className="shrink-0 text-right font-display text-[26px] font-semibold tabular-nums leading-none text-neutral-900" data-testid={`request-total-${r.id}`}>
            {inr(r.total) || "₹0"}
          </p>
        )}
      </div>

      {/* Who asked → who says yes. */}
      <div className="mt-4 flex items-center gap-3" data-testid={`request-people-${r.id}`}>
        <Party name={r.requester_name} sub="Requested" src={face(r.requester_id)} testid={`request-requester-${r.id}`} />
        <ArrowRight size={18} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
        {right ? (
          <Party name={right.name} sub={right.sub} src={face(right.id)} testid={`request-approver-${r.id}`} muted={r.status === "cancelled"} />
        ) : (
          <span className="flex min-w-0 items-center gap-2.5" data-testid={`request-approver-${r.id}`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <SealCheck size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-tight text-neutral-900">Recorded</span>
              <span className="block text-[13px] leading-tight text-slate-500">An owner's own request</span>
            </span>
          </span>
        )}
      </div>

      {/* The approver's question — and the answer, kept together. */}
      {r.info_note && (r.status === "info_requested" || r.reply_note) && (
        <button type="button" onClick={() => setDetails(true)} data-testid={`request-info-note-${r.id}`}
          className={`mt-4 flex w-full items-center gap-2.5 bg-violet-50/80 px-4 py-2.5 text-left text-[14px] text-violet-950 ring-1 ring-inset ring-violet-100 ${details ? "rounded-2xl" : "rounded-pill"}`}>
          <ChatCircleText size={18} weight="bold" aria-hidden="true" className="shrink-0 text-violet-700" />
          <span className={`min-w-0 flex-1 ${details ? "[overflow-wrap:anywhere]" : "truncate"}`}>
            <span className="font-semibold">{first(r.info_by_name || r.approver_name, "The approver")} asked:</span> {r.info_note}
          </span>
          <CaretRight size={14} weight="bold" aria-hidden="true" className="shrink-0 text-violet-700/70" />
        </button>
      )}
      {r.reply_note && details && (
        <div className="mt-2 flex items-start gap-2 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-neutral-800 ring-1 ring-inset ring-slate-200" data-testid={`request-reply-note-${r.id}`}>
          <PaperPlaneTilt size={15} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-neutral-500" />
          <p><span className="font-semibold">{first(r.requester_name)} answered:</span> {r.reply_note}</p>
        </div>
      )}
      {r.status === "rejected" && r.decision_note && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-rose-50/80 px-3.5 py-2.5 text-[13px] text-rose-950 ring-1 ring-inset ring-rose-100" data-testid={`request-reject-note-${r.id}`}>
          <XCircle size={15} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-rose-700" />
          <p><span className="font-semibold">Why:</span> {r.decision_note}</p>
        </div>
      )}

      {/* What is being asked for, and why — one line each. */}
      {(firstItem || r.reason) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-slate-600">
          {firstItem && (
            <span className="flex min-w-0 max-w-full items-center gap-1.5" data-testid={`request-first-item-${r.id}`}>
              <KindIcon size={16} weight="bold" aria-hidden="true" className={`shrink-0 ${tone.ink}`} />
              <span className="truncate">
                {firstItem.name}{firstItem.quantity ? ` · ${firstItem.quantity}${firstItem.unit ? ` ${firstItem.unit}` : ""}` : ""}
              </span>
              {items.length > 1 && (
                <button type="button" onClick={() => setDetails(true)} data-testid={`request-items-toggle-${r.id}`}
                  className="shrink-0 font-semibold text-slate-800 underline-offset-2 hover:underline">+{items.length - 1} more</button>
              )}
            </span>
          )}
          {r.reason && (
            <span className="flex min-w-0 max-w-full items-center gap-1.5" data-testid={`request-reason-${r.id}`}>
              <FileText size={16} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
              <span className={details ? "[overflow-wrap:anywhere]" : "truncate"}>{r.reason}</span>
            </span>
          )}
        </div>
      )}

      {/* The files, as tiles. */}
      {files.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2" data-testid={`request-files-${r.id}`}>
          {shownFiles.map((a) => {
            const { Icon, tone: ft } = fileKind(a);
            return (
              <li key={a.id} className="min-w-0">
                <a {...fileLink(`${BACKEND}/api/files/${a.id}/download`, a.filename)}
                  className="flex h-full min-h-[3.75rem] items-center gap-2 rounded-2xl bg-slate-50 px-2.5 py-2 ring-1 ring-inset ring-slate-900/[0.06] hover:bg-slate-100">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white shadow-[0_2px_6px_-3px_hsl(0_0%_0%/0.3)]">
                    <Icon size={20} weight="fill" aria-hidden="true" className={ft} />
                  </span>
                  <span className="line-clamp-2 min-w-0 text-[12px] font-medium leading-tight text-neutral-800 [overflow-wrap:anywhere]">{a.filename}</span>
                </a>
              </li>
            );
          })}
          {moreFiles > 0 && (
            <li>
              <button type="button" onClick={() => setAllFiles(true)} data-testid={`request-files-more-${r.id}`}
                className="grid h-full min-h-[3.75rem] w-full place-items-center rounded-2xl bg-slate-100 text-[13px] font-semibold text-slate-700">
                + {moreFiles} more
              </button>
            </li>
          )}
        </ul>
      )}

      {/* Under View details: every item, the notes, the money, the history. */}
      {details && (
        <div className="mt-4 space-y-3" data-testid={`request-details-${r.id}`}>
          {items.length > 0 && (
            <ul className={`divide-y divide-slate-900/[0.05] rounded-[1.1rem] px-3 ${DRAWER_TRACK}`} data-testid={`request-items-${r.id}`}>
              {items.map((it, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-neutral-800 [overflow-wrap:anywhere]">
                    {it.name}
                    {it.quantity ? <span className="text-neutral-500"> · {it.quantity}{it.unit ? ` ${it.unit}` : ""}</span> : null}
                  </span>
                  {it.amount > 0 && <span className="shrink-0 tabular-nums text-neutral-700">{money(it.amount)}</span>}
                </li>
              ))}
            </ul>
          )}
          {(r.status === "approved" || r.status === "fulfilled") && r.decision_note && (
            <p className="text-xs text-neutral-600">“{r.decision_note}” — {first(r.decided_by_name, "Approver")}</p>
          )}
          {r.status === "cancelled" && r.withdrawn_note && <p className="text-xs text-neutral-500">Withdrawn: {r.withdrawn_note}</p>}
          {r.fulfil_note && <p className="text-xs text-neutral-600">Finance: {r.fulfil_note}</p>}
          {kind.finance && (r.status === "approved" || r.status === "fulfilled") && (
            r.expense_id ? (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600" data-testid={`request-expense-${r.id}`}>
                <Receipt size={13} weight="bold" aria-hidden="true" className="text-neutral-500" />
                {r.status === "fulfilled" ? "Paid" : "In Finance as an expense to pay"}
                {r.expense_category ? ` · ${r.expense_category}` : ""}
                {(r.stock_item_ids || []).length > 0 && (
                  <span className="inline-flex items-center gap-1"> · <Package size={12} weight="bold" aria-hidden="true" /> {r.stock_item_ids.length} in stock</span>
                )}
                {r.fulfilled_by_name && r.status === "fulfilled" ? ` · by ${r.fulfilled_by_name}` : ""}
              </p>
            ) : r.expense_error ? (
              <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800" data-testid={`request-expense-error-${r.id}`}>
                <WarningCircle size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0" /> {r.expense_error}
              </p>
            ) : null
          )}
          {(r.history || []).length > 0 && (
            <ol className="space-y-2 border-l border-slate-900/10 pl-3" data-testid={`request-history-${r.id}`}>
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
        </div>
      )}

      {/* The requester's side: answer the question. */}
      {can.respond && (
        <div className={`mt-4 space-y-2.5 rounded-[1.25rem] p-3 ${DRAWER_TRACK}`} data-testid={`request-reply-${r.id}`}>
          <textarea data-testid={`request-reply-input-${r.id}`} className={`${DRAWER_FIELD} resize-none text-sm`} rows={2}
            aria-label="Your answer" placeholder="Your answer" maxLength={1000}
            value={reply} onChange={(e) => setReply(e.target.value)} />
          <button onClick={answer} disabled={busy} data-testid={`request-reply-send-${r.id}`}
            className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            <PaperPlaneTilt size={15} weight="bold" aria-hidden="true" /> {busy ? "Sending…" : "Send answer"}
          </button>
        </div>
      )}

      {/* Reject's reason, the question, withdrawing, paying. */}
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

      {/* How long ago, and the one thing to do now — on the card's floor. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-3 pt-5" data-testid={`request-foot-${r.id}`}>
        <p className="flex items-center gap-1.5 text-[13px] text-slate-500" data-testid={`request-age-${r.id}`}>
          <Clock size={15} weight="bold" aria-hidden="true" />
          <span title={fullTime(r.created_at)}>{agoWords(r.created_at)}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {deciding && (
            <>
              <button onClick={approve} disabled={busy} data-testid={`request-approve-${r.id}`}
                className={`flex h-11 items-center justify-center gap-1.5 rounded-pill px-5 text-[14px] font-semibold disabled:opacity-50 ${INK_PILL}`}>
                <CheckCircle size={17} weight="bold" aria-hidden="true" /> {busy ? "Approving…" : "Approve"}
              </button>
              <button onClick={() => setAction("reject")} data-testid={`request-reject-${r.id}`} className={OUTLINE}>
                <XCircle size={17} weight="bold" aria-hidden="true" /> Reject
              </button>
              {r.status === "pending" && (
                <button onClick={() => setAction("info")} data-testid={`request-info-${r.id}`} className={OUTLINE}>
                  <ChatCircleText size={17} weight="bold" aria-hidden="true" /> Ask
                </button>
              )}
            </>
          )}
          {paying && (
            <button onClick={() => setAction("fulfil")} data-testid={`request-fulfil-${r.id}`}
              className={`flex h-11 items-center justify-center gap-1.5 rounded-pill px-5 text-[14px] font-semibold ${INK_PILL}`}>
              <SealCheck size={17} weight="bold" aria-hidden="true" /> Mark paid
            </button>
          )}
          {!deciding && !paying && !action && (
            <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} data-testid={`request-details-toggle-${r.id}`}
              className={`flex h-11 items-center gap-1 rounded-pill px-4 text-[14px] font-semibold ring-1 ring-inset ${
                r.status === "approved" || r.status === "fulfilled" ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                : "bg-slate-50 text-slate-800 ring-slate-200"}`}>
              {details ? "Hide details" : "View details"}
              {details ? <CaretDown size={14} weight="bold" aria-hidden="true" className="rotate-180" />
                : <CaretRight size={14} weight="bold" aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
