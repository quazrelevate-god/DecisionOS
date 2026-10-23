/* Quick look (admin console v2 P5, 2026-10-23): a customer at a glance from the
 * list, without leaving it -- health and why, the numbers that matter, the
 * pinned note, what happened lately and any open ticket. "Open customer page"
 * for everything else. The row the list already has fills the top at once; the
 * notes, timeline and tickets load behind it. */
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../../components/ui/sheet";
import { ArrowRight, X, PushPin, Lifebuoy } from "@phosphor-icons/react";
import { useAdmin, useAdminGet, Btn, Chip, fmtAgo, fmtDate, fmtDateTime, fmtInr, fmtNum, usdToInr, planChip, Loading } from "./adminUi";
import { HealthBreakdown, StageChip } from "./customerKit";
import { describeEvent, KIND, KIND_TONE } from "./WorkspaceTabs";
import { ADMIN_H3 } from "./adminStyle";
import { SlaChip } from "./supportKit";

function Fact({ label, children }) {
  return (
    <div className="rounded-2xl bg-slate-500/[0.07] px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-[15px] font-medium tabular-nums text-slate-900">{children}</div>
    </div>
  );
}

function Behind({ tenantId }) {
  const { go } = useAdmin();
  const notes = useAdminGet(`/admin/tenants/${tenantId}/notes`);
  const timeline = useAdminGet(`/admin/tenants/${tenantId}/timeline?limit=6`);
  const tickets = useAdminGet(`/admin/tickets?tenant_id=${encodeURIComponent(tenantId)}`);
  const pinned = (notes.data?.notes || []).filter((n) => n.pinned).slice(0, 2);
  const open = (tickets.data?.tickets || []).filter((t) => t.status === "open" || t.status === "pending");
  return (
    <>
      {pinned.map((n) => (
        <div key={n.id} className="rounded-2xl bg-amber-400/[0.08] p-3.5 ring-1 ring-inset ring-amber-700/15" data-testid="quicklook-note">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-500"><PushPin size={12} weight="fill" /> {n.author_email} · {fmtAgo(n.created_at)}</div>
          <p className="line-clamp-4 whitespace-pre-wrap text-sm text-slate-800">{n.text}</p>
        </div>
      ))}
      {open.length > 0 && (
        <section>
          <h3 className={ADMIN_H3}>Open tickets</h3>
          <ul className="-mx-2">
            {open.slice(0, 3).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => go(`support/${t.id}`)} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-900/[0.04]">
                  <Lifebuoy size={14} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{t.subject}</span>
                  <SlaChip sla={t.sla} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className={ADMIN_H3}>Lately</h3>
        {!timeline.data ? <Loading /> : timeline.data.items.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing recorded yet.</p>
        ) : (
          <ol className="relative ml-1.5 border-l border-slate-900/[0.08]">
            {timeline.data.items.slice(0, 6).map((i, n) => (
              <li key={`${i.kind}-${i.at}-${n}`} className="relative py-2 pl-4">
                <span className="absolute -left-[4.5px] top-3.5 h-2 w-2 rounded-full bg-white ring-2 ring-slate-400" aria-hidden="true" />
                <div className="flex items-center gap-2">
                  <Chip tone={KIND_TONE[i.kind]}>{KIND[i.kind] || i.kind}</Chip>
                  <span className="text-xs text-slate-500" title={fmtDateTime(i.at)}>{fmtAgo(i.at)}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-sm text-slate-800">{describeEvent(i)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export function QuickLook({ customer: c, rate, onOpenChange }) {
  const { go } = useAdmin();
  const open = !!c;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideClose data-testid="customer-quicklook"
        className="flex w-full flex-col gap-0 border-0 bg-[linear-gradient(165deg,hsl(220_20%_98%),hsl(220_14%_94%))] p-0 sm:max-w-md">
        {c && (
          <>
            <div className="flex items-start gap-3 border-b border-slate-900/[0.06] px-5 pb-4 pt-5">
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate font-display text-xl font-normal text-slate-900">{c.name}</SheetTitle>
                <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <StageChip stage={c.stage} />{planChip(c.plan)}{c.is_test && <Chip>Test</Chip>}
                  <span>{c.industry || "No industry set"} · signed up {fmtDate(c.created_at)}</span>
                </SheetDescription>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} aria-label="Close"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-900/[0.05]"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-2 gap-2">
                <Fact label="MRR">{c.mrr_inr ? fmtInr(c.mrr_inr) : "—"}</Fact>
                <Fact label="Seats">{c.seats}{c.seat_limit != null ? ` / ${c.seat_limit}` : ""}</Fact>
                <Fact label="Active 7 days">{fmtNum(c.active_7d)}</Fact>
                <Fact label="Last seen"><span title={fmtDateTime(c.last_seen_at)}>{fmtAgo(c.last_seen_at)}</span></Fact>
                <Fact label="AI cost 30 days">{fmtInr(usdToInr(c.ai_cost_30d_usd, rate))}</Fact>
                <Fact label="Owner">{c.owner_name || "—"}</Fact>
              </div>
              {(c.tags?.length > 0 || c.next_follow_up_at) && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                  {(c.tags || []).map((t) => <Chip key={t}>{t}</Chip>)}
                  {c.next_follow_up_at && <span className="ml-auto">Follow up {fmtDate(c.next_follow_up_at)}</span>}
                </div>
              )}
              {c.health && <section><h3 className={ADMIN_H3}>Health</h3><HealthBreakdown health={c.health} /></section>}
              <Behind tenantId={c.id} />
            </div>
            <div className="flex gap-2 border-t border-slate-900/[0.06] px-5 py-4">
              <Btn variant="primary" icon={ArrowRight} onClick={() => go(`workspaces/${c.id}`)} className="flex-1" data-testid="quicklook-open">Open customer page</Btn>
              <Btn onClick={() => go(`workspaces/${c.id}/notes`)}>Notes</Btn>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
