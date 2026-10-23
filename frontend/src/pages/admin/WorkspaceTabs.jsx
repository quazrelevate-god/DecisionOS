/* The customer page's tabs that load their own data (2026-10-23, admin
 * console v2 P2): Timeline, Usage, Support and Notes (with the account's
 * tags, owner and follow-up date). Overview, People, Billing and Data are
 * drawn from the workspace's one 360 answer in WorkspacePage. */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { PushPin, PushPinSlash, Trash, Lifebuoy, NotePencil, ClockCounterClockwise, X } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtNum, fmtInr, usdToInr, fmtDate, fmtDateTime, fmtAgo, Btn, Chip, Segmented,
  Panel, Loading, Empty, LoadError, ADMIN_FIELD,
} from "./adminUi";
import { auditLabel, humanize, planLabel, ticketStatusLabel, priorityLabel, priorityTone } from "./adminLabels";
import { AdoptionGrid } from "./customerKit";
import { ADMIN_H3 } from "./adminStyle";

const KIND = {
  lifecycle: "Lifecycle", activity: "Activity", admin: "Admin action", ticket: "Ticket", note: "Note",
  member: "People", payment: "Payment",
};
const KIND_TONE = { lifecycle: "info", admin: "warn", ticket: "warn", note: "neutral", member: "good", payment: "good", activity: "neutral" };
const EVENT = {
  signed_up: "Signed up", plan_changed: "Plan changed", payment_received: "Payment received", payment_failed: "Payment failed",
  subscription_halted: "Subscription halted", suspended: "Suspended", reactivated: "Reactivated",
};

function describe(i) {
  if (i.kind === "lifecycle") {
    const base = EVENT[i.type] || humanize(i.type);
    if (i.type === "plan_changed") return `${base}: ${planLabel(i.data?.from)} to ${planLabel(i.data?.to)}${i.reason ? ` · ${i.reason}` : ""}`;
    return i.reason ? `${base} · ${i.reason}` : base;
  }
  if (i.kind === "admin") return `${auditLabel(i.type)}${i.text ? ` · ${i.text}` : ""}`;
  if (i.kind === "ticket") return `Ticket: ${i.text}`;
  if (i.kind === "payment") return `${humanize(i.type)}${i.amount_inr ? ` · ${fmtInr(i.amount_inr)}` : ""}`;
  return i.text || humanize(i.type);
}

export function TimelineTab({ tenantId }) {
  const { go } = useAdmin();
  const { data, error, reload } = useAdminGet(`/admin/tenants/${tenantId}/timeline`);
  const [kind, setKind] = useState("");
  const items = useMemo(() => (data?.items || []).filter((i) => !kind || i.kind === kind), [data, kind]);
  const counts = useMemo(() => {
    const c = {};
    (data?.items || []).forEach((i) => { c[i.kind] = (c[i.kind] || 0) + 1; });
    return c;
  }, [data]);
  if (error && !data) return <LoadError what="the timeline" onRetry={reload} />;
  if (!data) return <Loading />;
  const options = [{ value: "", label: "Everything", count: data.items.length },
    ...Object.keys(KIND).filter((k) => counts[k]).map((k) => ({ value: k, label: KIND[k], count: counts[k] }))];
  return (
    <Panel title="Timeline" hint="Everything that happened to this customer, newest first" testid="workspace-timeline"
      actions={<Segmented value={kind} onChange={setKind} options={options} ariaLabel="Kind" testid="timeline-kind" />}>
      {items.length === 0 ? <Empty compact icon={ClockCounterClockwise} title="Nothing recorded yet." /> : (
        <ol className="relative ml-2 border-l border-slate-900/[0.08]">
          {items.map((i, n) => (
            <li key={`${i.kind}-${i.at}-${n}`} className="relative py-2.5 pl-5">
              <span className="absolute -left-[5px] top-4 h-2.5 w-2.5 rounded-full bg-white ring-2 ring-slate-400" aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={KIND_TONE[i.kind]}>{KIND[i.kind] || i.kind}</Chip>
                <span className="text-xs text-slate-500" title={fmtDateTime(i.at)}>{fmtDate(i.at)} · {fmtAgo(i.at)}</span>
                {i.by && <span className="text-xs text-slate-500">· {i.by}</span>}
              </div>
              <div className="mt-1 text-sm text-slate-800 [overflow-wrap:anywhere]">
                {i.kind === "ticket" && i.ref
                  ? <button type="button" onClick={() => go(`support/${i.ref}`)} className="text-left underline-offset-2 hover:underline">{describe(i)}</button>
                  : describe(i)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function UsageTab({ tenantId, rate }) {
  const { data, error, reload } = useAdminGet(`/admin/tenants/${tenantId}/usage?weeks=8`);
  if (error && !data) return <LoadError what="usage" onRetry={reload} />;
  if (!data) return <Loading />;
  const weeks = data.weeks;
  const used = data.areas.filter((a) => weeks.some((w) => (w.areas || {})[a]));
  return (
    <div className="space-y-4">
      <Panel title="What they use" hint="Actions by product area, week by week (last 8 weeks)" testid="workspace-usage">
        {used.length === 0 ? <Empty compact title="Nothing counted in the last 8 weeks." /> : <AdoptionGrid weeks={weeks} areas={data.areas} />}
      </Panel>
      <Panel title="Week by week">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="text-[11px] uppercase tracking-[0.1em] text-slate-500">
              <th className="pb-2 text-left font-semibold">Week of</th><th className="pb-2 text-right font-semibold">Most active people</th>
              <th className="pb-2 text-right font-semibold">Sign-ins</th><th className="pb-2 text-right font-semibold">Actions</th>
              <th className="pb-2 text-right font-semibold">AI cost</th>
            </tr></thead>
            <tbody>
              {[...weeks].reverse().map((w) => (
                <tr key={w.week_start} className="border-t border-slate-900/[0.05]">
                  <td className="py-2 text-slate-800">{fmtDate(w.week_start)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(w.active_people_max)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(w.sign_ins)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(w.actions)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtInr(usdToInr(w.ai_cost_usd, rate))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function SupportTab({ tenantId }) {
  const { go } = useAdmin();
  const { data, error, reload } = useAdminGet(`/admin/tickets?tenant_id=${encodeURIComponent(tenantId)}`);
  if (error && !data) return <LoadError what="tickets" onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <Panel title="Tickets" hint="Everything this customer asked support" testid="workspace-support">
      {data.tickets.length === 0 ? <Empty compact icon={Lifebuoy} title="No tickets from this customer." /> : (
        <ul className="-mx-2 divide-y divide-slate-900/[0.05]">
          {data.tickets.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => go(`support/${t.id}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-900/[0.03]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{t.subject}</span>
                  <span className="block text-xs text-slate-500">Updated {fmtAgo(t.updated_at)}</span>
                </span>
                {t.priority !== "normal" && <Chip tone={priorityTone(t.priority)}>{priorityLabel(t.priority)}</Chip>}
                <Chip>{ticketStatusLabel(t.status)}</Chip>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AccountPanel({ tenantId, account, onSaved }) {
  const { canWrite } = useAdmin();
  const admins = useAdminGet("/admin/admin-names");
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const tags = account?.tags || [];
  const save = async (patch, done) => {
    setBusy(true);
    try {
      const r = await api.patch(`/admin/tenants/${tenantId}/account`, patch);
      onSaved({ ...account, ...r.data });
      toast.success(done);
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const addTag = (e) => {
    e.preventDefault();
    const t = tagDraft.trim().toLowerCase();
    if (!t || tags.includes(t)) { setTagDraft(""); return; }
    save({ tags: [...tags, t] }, `Tagged "${t}"`);
    setTagDraft("");
  };
  return (
    <Panel title="Account" hint="Who looks after this customer, and when to follow up" testid="workspace-account">
      <div className="space-y-4">
        <div>
          <span className={ADMIN_H3 + " block"}>Owner</span>
          <GlassSelect value={account?.owner_admin_id || ""} disabled={!canWrite || busy} ariaLabel="Account owner" testid="account-owner"
            onChange={(v) => save({ owner_admin_id: v }, v ? "Owner set" : "Owner cleared")} triggerClassName="h-10 text-sm"
            options={[{ value: "", label: "No owner" }, ...(admins.data?.admins || []).map((a) => ({ value: a.id, label: a.name }))]} />
        </div>
        <div>
          <span className={ADMIN_H3 + " block"}>Follow up on</span>
          <div className="flex items-center gap-2">
            <input type="date" value={account?.next_follow_up_at || ""} disabled={!canWrite || busy} data-testid="account-follow-up"
              onChange={(e) => save({ next_follow_up_at: e.target.value }, e.target.value ? `Follow up on ${fmtDate(e.target.value)}` : "Follow-up cleared")}
              className={`${ADMIN_FIELD} !w-48 py-2`} />
            {account?.next_follow_up_at && canWrite && (
              <Btn size="sm" variant="ghost" onClick={() => save({ next_follow_up_at: "" }, "Follow-up cleared")}>Clear</Btn>
            )}
          </div>
        </div>
        <div>
          <span className={ADMIN_H3 + " block"}>Tags</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.length === 0 && <span className="text-xs text-slate-500">No tags yet.</span>}
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-pill bg-slate-500/[0.08] py-1 pl-2.5 pr-1 text-xs text-slate-700">
                {t}
                {canWrite && (
                  <button type="button" aria-label={`Remove the tag ${t}`} onClick={() => save({ tags: tags.filter((x) => x !== t) }, `Removed "${t}"`)}
                    className="grid h-4 w-4 place-items-center rounded-full hover:bg-slate-500/20"><X size={10} /></button>
                )}
              </span>
            ))}
          </div>
          {canWrite && (
            <form onSubmit={addTag} className="mt-2 flex gap-2">
              <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add a tag, e.g. textiles"
                className={`${ADMIN_FIELD} h-9 py-0`} data-testid="account-tag-input" />
              <Btn size="sm" type="submit" disabled={!tagDraft.trim() || busy}>Add</Btn>
            </form>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function NotesTab({ tenantId, account, onAccountSaved }) {
  const { canWrite } = useAdmin();
  const { data, error, reload, setData } = useAdminGet(`/admin/tenants/${tenantId}/notes`);
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.post(`/admin/tenants/${tenantId}/notes`, { text, pinned });
      setData((d) => ({ notes: [r.data.note, ...(d?.notes || [])] }));
      setText(""); setPinned(false);
      toast.success("Note saved");
      reload();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(false); }
  };
  const pin = async (n) => {
    try { await api.patch(`/admin/notes/${n.id}`, { pinned: !n.pinned }); reload(); }
    catch (e) { toast.error(errText(e)); }
  };
  const remove = async (n) => {
    try { await api.delete(`/admin/notes/${n.id}`); toast.success("Note deleted"); reload(); }
    catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {canWrite && (
          <Panel title="Add a note" testid="workspace-note-form">
            <form onSubmit={add} className="space-y-3">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} data-testid="note-text"
                placeholder="What was said on the call, what they need, what we promised" className={`${ADMIN_FIELD} resize-y`} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 accent-slate-900" />
                  Pin to the top
                </label>
                <Btn type="submit" variant="primary" size="sm" icon={NotePencil} busy={busy} disabled={!text.trim()} data-testid="note-save">Save note</Btn>
              </div>
            </form>
          </Panel>
        )}
        <Panel title="Notes" hint="Shared with every admin" testid="workspace-notes">
          {error && !data ? <LoadError what="notes" onRetry={reload} /> : !data ? <Loading /> : data.notes.length === 0 ? (
            <Empty compact icon={NotePencil} title="No notes yet." hint="Write down calls, promises and anything the next person should know." />
          ) : (
            <ul className="space-y-3">
              {data.notes.map((n) => (
                <li key={n.id} className={`rounded-xl p-3 ring-1 ring-inset ${n.pinned ? "bg-amber-400/[0.08] ring-amber-700/15" : "bg-white/60 ring-slate-900/[0.06]"}`}>
                  <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                    {n.pinned && <Chip tone="warn">Pinned</Chip>}
                    <span>{n.author_email}</span><span title={fmtDateTime(n.created_at)}>· {fmtAgo(n.created_at)}</span>
                    {canWrite && (
                      <span className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={() => pin(n)} aria-label={n.pinned ? "Unpin" : "Pin"} title={n.pinned ? "Unpin" : "Pin to the top"}
                          className="grid h-7 w-7 place-items-center rounded-full hover:bg-slate-900/[0.06]">
                          {n.pinned ? <PushPinSlash size={14} /> : <PushPin size={14} />}
                        </button>
                        <button type="button" onClick={() => remove(n)} aria-label="Delete note" title="Delete"
                          className="grid h-7 w-7 place-items-center rounded-full text-[#b91c1c] hover:bg-[#cf222e]/[0.07]"><Trash size={14} /></button>
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-slate-800">{n.text}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <AccountPanel tenantId={tenantId} account={account} onSaved={onAccountSaved} />
    </div>
  );
}
