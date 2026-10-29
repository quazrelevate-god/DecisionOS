/* Requests (2026-10-21, docs/REQUESTS_PLAN.md) — the words and marks every
   screen that shows a request shares: the seven kinds, the six states, and the
   few rules a screen needs before the server answers. The server
   (services/staff_requests.py) holds the same list and is the one that decides;
   this is what lets the form and the cards say it the same way everywhere. */
import {
  ShoppingCart, Receipt, HandCoins, AirplaneTilt, Laptop, Wrench, Note,
  Clock, ChatCircleText, CheckCircle, SealCheck, XCircle, ArrowCounterClockwise,
} from "@phosphor-icons/react";

/* `qty` — the kind is counted in things (bags, laptops), so the form asks how
   many and in what unit; money that was spent or is needed is not.
   `amount` — the approver has to know what it costs.
   `finance` — approval books an expense and Finance pays it. A GENERAL request
   is not about money (Yokesh, 2026-10-21): it needs a yes, and the yes closes
   it — no amount on the form, nothing booked, nothing for Finance to pay.
   `stock` — a purchase can be received into inventory when Finance closes it. */
export const REQUEST_TYPES = [
  { key: "purchase", label: "Purchase & materials", short: "Purchase", icon: ShoppingCart,
    hint: "Raw material, supplies, stock", qty: true, amount: true, finance: true, stock: true },
  { key: "reimbursement", label: "Expense reimbursement", short: "Reimbursement", icon: Receipt,
    hint: "Money you already spent for work", qty: false, amount: true, finance: true },
  { key: "advance", label: "Advance", short: "Advance", icon: HandCoins,
    hint: "Money before you spend it", qty: false, amount: true, finance: true },
  { key: "travel", label: "Travel", short: "Travel", icon: AirplaneTilt,
    hint: "Tickets, stay, local travel", qty: false, amount: true, finance: true },
  { key: "equipment", label: "Equipment & assets", short: "Equipment", icon: Laptop,
    hint: "Tools, machines, laptops", qty: true, amount: true, finance: true },
  { key: "repair", label: "Repairs & services", short: "Repair", icon: Wrench,
    hint: "Fix, service, maintenance", qty: false, amount: true, finance: true },
  { key: "general", label: "General request", short: "General", icon: Note,
    hint: "Anything else that needs a yes — no money, approval closes it", qty: true, amount: false, finance: false },
];

export const requestType = (key) => REQUEST_TYPES.find((t) => t.key === key) || REQUEST_TYPES[REQUEST_TYPES.length - 1];

/* 2026-10-22/29 — each kind's quiet colour: a thin stroke and a tinted icon on
   the New Request form, the type chip on the card. Written out in full so
   Tailwind keeps the classes. */
export const REQUEST_TONES = {
  purchase:      { ring: "ring-amber-300",   ink: "text-amber-700",   wash: "bg-amber-50",   chip: "bg-amber-50 text-amber-800 ring-amber-100" },
  reimbursement: { ring: "ring-sky-300",     ink: "text-sky-700",     wash: "bg-sky-50",     chip: "bg-sky-50 text-sky-800 ring-sky-100" },
  advance:       { ring: "ring-emerald-300", ink: "text-emerald-700", wash: "bg-emerald-50", chip: "bg-emerald-50 text-emerald-800 ring-emerald-100" },
  travel:        { ring: "ring-indigo-300",  ink: "text-indigo-700",  wash: "bg-indigo-50",  chip: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  equipment:     { ring: "ring-violet-300",  ink: "text-violet-700",  wash: "bg-violet-50",  chip: "bg-violet-50 text-violet-700 ring-violet-100" },
  repair:        { ring: "ring-orange-300",  ink: "text-orange-700",  wash: "bg-orange-50",  chip: "bg-orange-50 text-orange-800 ring-orange-100" },
  general:       { ring: "ring-slate-300",   ink: "text-slate-700",   wash: "bg-slate-100",  chip: "bg-slate-100 text-slate-700 ring-slate-200" },
};
export const requestTone = (key) => REQUEST_TONES[key] || REQUEST_TONES.general;

/* The chip recipe the leave and task cards use (ASK-25): waiting is amber, a
   question back is violet, a yes is green, done is the quiet teal of something
   finished and paid, a no is rose, withdrawn is grey because it is over. */
export const REQUEST_STATUS = {
  pending: { label: "Waiting", tone: "bg-amber-50 text-amber-800 ring-amber-100", icon: Clock },
  info_requested: { label: "Needs info", tone: "bg-violet-50 text-violet-700 ring-violet-100", icon: ChatCircleText },
  approved: { label: "Approved · to pay", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100", icon: CheckCircle },
  fulfilled: { label: "Done", tone: "bg-teal-50 text-teal-800 ring-teal-100", icon: SealCheck },
  rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700 ring-rose-100", icon: XCircle },
  cancelled: { label: "Withdrawn", tone: "bg-slate-100 text-slate-600 ring-slate-200", icon: ArrowCounterClockwise },
};

export const OPEN_REQUEST = new Set(["pending", "info_requested"]);

/* A request's chip: an approved General request is finished — "Approved", not
   "Approved · to pay", because there is nothing to pay. */
export const requestStatus = (r) => (r?.status === "approved" && !requestType(r?.type).finance
  ? { ...REQUEST_STATUS.approved, label: "Approved" }
  : REQUEST_STATUS[r?.status] || REQUEST_STATUS.pending);

/* Still moving: waiting on a decision, or approved and waiting on Finance. */
export const isOpenRequest = (r) => OPEN_REQUEST.has(r?.status)
  || (r?.status === "approved" && requestType(r?.type).finance);

/* What each line of a request's history says, in the timeline. */
export const HISTORY_WORDS = {
  submitted: "Raised",
  routed: "Routed",
  approved: "Approved",
  rejected: "Rejected",
  info_requested: "Asked a question",
  replied: "Answered",
  withdrawn: "Withdrew it",
  fulfilled: "Marked done",
};

/* One blank line of the form. Amount and quantity stay strings while typed. */
export const blankItem = () => ({ name: "", quantity: "", unit: "", amount: "" });

export const itemsTotal = (items) =>
  (items || []).reduce((n, it) => n + (Number(it.amount) > 0 ? Number(it.amount) : 0), 0);
