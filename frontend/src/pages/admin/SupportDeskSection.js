import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
// Support desk (Epic 10 Sprint 3; redesigned 2026-10-22). The inbox, and each
// ticket at its own address (/admin/support/<id>) so a ticket can be linked and
// survives a refresh. Status and priority are the app's own lists; "View as"
// asks why before it opens a session.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { ArrowClockwise, PaperPlaneRight, Eye, Lifebuoy } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtAgo, fmtDateTime, Btn, Chip, Segmented, AdminPage, Panel, Loading, Empty,
  LoadError, ReasonDialog, LinkOut, ADMIN_FIELD,
} from "./adminUi";
import { ticketStatusLabel, priorityLabel, priorityTone } from "./adminLabels";

const STATUSES = ["open", "pending", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const statusTone = (s) => ({ open: "warn", pending: "info", resolved: "good" }[s] || "neutral");

export function SupportDeskSection({ id }) {
  return id ? <Ticket id={id} /> : <Inbox />;
}

function Inbox() {
  const { go } = useAdmin();
  const [filter, setFilter] = useState("open");
  const { data, error, reload } = useAdminGet(`/admin/tickets${filter ? `?status=${filter}` : ""}`);
  const counts = useMemo(() => data?.counts || {}, [data]);
  const options = useMemo(() => [
    ...STATUSES.map((s) => ({ value: s, label: ticketStatusLabel(s), count: counts[s] ?? 0 })),
    { value: "", label: "All" },
  ], [counts]);

  return (
    <AdminPage title="Support desk" subtitle="Tickets from customers, tied to their workspace" testid="admin-support"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <div className="mb-4"><Segmented value={filter} onChange={setFilter} options={options} ariaLabel="Status" testid="tickets-filter" /></div>
      {error && !data ? <LoadError what="tickets" onRetry={reload} /> : !data ? <Loading /> : data.tickets.length === 0 ? (
        <div className={CARD_BASE}>
          <Empty icon={Lifebuoy} title={filter ? `No ${ticketStatusLabel(filter).toLowerCase()} tickets.` : "No tickets yet."}
            hint={filter === "open" ? "When a customer asks for help from inside the app, it lands here." : "Try another status."} />
        </div>
      ) : (
        <ul className={`${CARD_BASE} divide-y divide-slate-900/[0.06]`}>
          {data.tickets.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => go(`support/${t.id}`)} data-testid={`ticket-${t.id}`}
                className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-900/[0.025] focus:outline-none focus-visible:bg-slate-900/[0.04]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{t.subject}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{t.tenant_name} · updated {fmtAgo(t.updated_at)}</div>
                </div>
                {t.priority !== "normal" && <Chip tone={priorityTone(t.priority)}>{priorityLabel(t.priority)}</Chip>}
                <Chip tone={statusTone(t.status)}>{ticketStatusLabel(t.status)}</Chip>
              </button>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}

function Ticket({ id }) {
  const { go, canWrite } = useAdmin();
  const { data: sel, error, reload } = useAdminGet(`/admin/tickets/${id}`);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");
  const [viewAs, setViewAs] = useState(false);

  const sendReply = async (e) => {
    e?.preventDefault();
    if (!reply.trim()) return;
    setBusy("reply");
    try {
      await api.post(`/admin/tickets/${id}/reply`, { body: reply });
      setReply(""); reload();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(""); }
  };
  const patch = async (body, done) => {
    setBusy("patch");
    try { await api.patch(`/admin/tickets/${id}`, body); toast.success(done); reload(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(""); }
  };
  const startViewAs = async (reason) => {
    setBusy("viewas");
    try {
      await api.post(`/admin/tenants/${sel.tenant_id}/impersonate`, { reason, read_only: true, minutes: 30 });
      setViewAs(false);
      toast.success("Read-only session started for 30 minutes", { action: { label: "See sessions", onClick: () => go("audit?view=sessions") } });
    } catch (e) { toast.error(errText(e)); } finally { setBusy(""); }
  };

  const back = { label: "Support desk", onClick: () => go("support") };
  if (error && !sel) return <AdminPage title="Ticket" back={back}><LoadError what="this ticket" onRetry={reload} /></AdminPage>;
  if (!sel) return <AdminPage title="Ticket" back={back}><Loading /></AdminPage>;

  return (
    <AdminPage title={sel.subject} back={back} testid="admin-ticket-detail"
      subtitle={(
        <span className="flex flex-wrap items-center gap-2">
          <LinkOut onClick={() => go(`workspaces/${sel.tenant_id}`)}>{sel.tenant_name}</LinkOut>
          <span>· opened {fmtAgo(sel.created_at)} by {sel.created_by_name || sel.created_by}</span>
        </span>
      )}
      actions={canWrite && sel.tenant_id ? <Btn size="sm" icon={Eye} onClick={() => setViewAs(true)}>View as this workspace</Btn> : null}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {(sel.messages || []).length === 0 && <div className={CARD_BASE}><Empty compact title="No messages yet." /></div>}
          {(sel.messages || []).map((m, i) => {
            const ours = m.author_type === "admin";
            return (
              <div key={i} className={`${CARD_BASE} p-4 ${ours ? "ml-6 bg-slate-900/[0.035]" : "mr-6"}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span><strong className="font-semibold text-slate-800">{m.author}</strong>{ours ? " · us" : ""}</span>
                  <span title={fmtDateTime(m.created_at)}>{fmtAgo(m.created_at)}</span>
                </div>
                <div className="whitespace-pre-wrap text-sm text-slate-800">{m.body}</div>
              </div>
            );
          })}
          {canWrite && (
            <form onSubmit={sendReply} className={`${CARD_BASE} p-4`}>
              <label className={ADMIN_H3 + " block"} htmlFor="ticket-reply">Reply</label>
              <textarea id="ticket-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3}
                placeholder="Write to the customer…" className={`${ADMIN_FIELD} resize-y`} data-testid="ticket-reply" />
              <div className="mt-3 flex justify-end">
                <Btn type="submit" variant="primary" icon={PaperPlaneRight} busy={busy === "reply"} disabled={!reply.trim()}>Send reply</Btn>
              </div>
            </form>
          )}
        </div>
        <Panel title="Ticket">
          <div className="space-y-4">
            <div>
              <span className={ADMIN_H3 + " block"}>Status</span>
              <GlassSelect value={sel.status} disabled={!canWrite || busy === "patch"} ariaLabel="Status" testid="ticket-status"
                onChange={(v) => patch({ status: v }, `Marked ${ticketStatusLabel(v).toLowerCase()}`)}
                options={STATUSES.map((s) => ({ value: s, label: ticketStatusLabel(s) }))} />
            </div>
            <div>
              <span className={ADMIN_H3 + " block"}>Priority</span>
              <GlassSelect value={sel.priority} disabled={!canWrite || busy === "patch"} ariaLabel="Priority" testid="ticket-priority"
                onChange={(v) => patch({ priority: v }, `Priority set to ${priorityLabel(v).toLowerCase()}`)}
                options={PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) }))} />
            </div>
          </div>
        </Panel>
      </div>
      <ReasonDialog open={viewAs} onOpenChange={setViewAs} busy={busy === "viewas"} initial={`Ticket: ${sel.subject}`.slice(0, 120)}
        title={`View ${sel.tenant_name} as its owner?`}
        description="A read-only session for 30 minutes. Every change is blocked, and the session is listed in the Audit log."
        confirmLabel="Start the session" busyLabel="Starting…" onConfirm={startViewAs} testid="ticket-viewas-dialog" />
    </AdminPage>
  );
}
