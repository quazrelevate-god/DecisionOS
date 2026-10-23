import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
// Support desk (Epic 10 Sprint 3; redesigned 2026-10-22). The inbox, and each
// ticket at its own address (/admin/support/<id>) so a ticket can be linked and
// survives a refresh. Status and priority are the app's own lists; "View as"
// asks why before it opens a session.
// P4 (2026-10-23): every ticket runs a first-reply clock against its priority's
// target; /admin/support/messages is what we sent customers (never the text);
// /admin/support/nps is the recommend score.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { ArrowClockwise, PaperPlaneRight, Eye, Lifebuoy, Smiley, Timer } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtAgo, fmtDateTime, Btn, Chip, Segmented, AdminPage, Panel, Loading, Empty,
  LoadError, ReasonDialog, LinkOut, ADMIN_FIELD, Stat, fmtNum,
} from "./adminUi";
import { ticketStatusLabel, priorityLabel, priorityTone } from "./adminLabels";
import { SlaChip, fmtHours, MessageList, WeekTally, CHANNELS, NpsSplit, kindLabel } from "./supportKit";

const STATUSES = ["open", "pending", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const statusTone = (s) => ({ open: "warn", pending: "info", resolved: "good" }[s] || "neutral");

export function SupportDeskSection({ id }) {
  if (id === "messages") return <Messages />;
  if (id === "nps") return <Recommend />;
  return id ? <Ticket id={id} /> : <Inbox />;
}

// Tickets · Messages sent · Recommend score: three views of one desk.
function DeskTabs({ value }) {
  const { go } = useAdmin();
  return (
    <div className="mb-5">
      <Segmented value={value} ariaLabel="Support view" testid="support-view"
        onChange={(v) => go(v ? `support/${v}` : "support")}
        options={[{ value: "", label: "Tickets" }, { value: "messages", label: "Messages sent" }, { value: "nps", label: "Recommend score" }]} />
    </div>
  );
}

function SlaStrip({ sla }) {
  if (!sla) return null;
  const t = sla.targets || {};
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="support-sla">
      <Stat label="Past the reply target" value={fmtNum(sla.breached)}
        sub={sla.breached ? <span className="font-medium text-[#b91c1c]">Reply to these first</span> : "Nobody waiting too long"} />
      <Stat label="Due soon" value={fmtNum(sla.due_soon)} sub="In the last quarter of their window" />
      <Stat label="Replied in time" value={sla.met_pct == null ? "—" : `${sla.met_pct}%`}
        sub={sla.answered_30d ? `of ${fmtNum(sla.answered_30d)} tickets, last 30 days` : "No replies in 30 days"} />
      <Stat label="Typical first reply" value={sla.median_first_reply_hours == null ? "—" : fmtHours(sla.median_first_reply_hours)}
        sub={`Targets: urgent ${t.urgent}h · high ${t.high}h · normal ${t.normal}h · low ${t.low}h`} />
    </div>
  );
}

// Late first, then the ones closest to their target; the rest by last update.
const SLA_RANK = { breached: 0, due_soon: 1, waiting: 2 };

function Inbox() {
  const { go } = useAdmin();
  const [filter, setFilter] = useState("open");
  const { data, error, reload } = useAdminGet(`/admin/tickets${filter ? `?status=${filter}` : ""}`);
  const counts = useMemo(() => data?.counts || {}, [data]);
  const options = useMemo(() => [
    ...STATUSES.map((s) => ({ value: s, label: ticketStatusLabel(s), count: counts[s] ?? 0 })),
    { value: "", label: "All" },
  ], [counts]);
  const tickets = useMemo(() => [...(data?.tickets || [])].sort((a, b) => {
    const ra = SLA_RANK[a.sla?.state] ?? 9, rb = SLA_RANK[b.sla?.state] ?? 9;
    return ra - rb || String(b.updated_at).localeCompare(String(a.updated_at));
  }), [data]);

  return (
    <AdminPage title="Support desk" subtitle="Tickets from customers, the messages we sent them, and how likely they are to recommend us" testid="admin-support"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <DeskTabs value="" />
      <SlaStrip sla={data?.sla} />
      <div className="mb-4"><Segmented value={filter} onChange={setFilter} options={options} ariaLabel="Status" testid="tickets-filter" /></div>
      {error && !data ? <LoadError what="tickets" onRetry={reload} /> : !data ? <Loading /> : data.tickets.length === 0 ? (
        <div className={CARD_BASE}>
          <Empty icon={Lifebuoy} title={filter ? `No ${ticketStatusLabel(filter).toLowerCase()} tickets.` : "No tickets yet."}
            hint={filter === "open" ? "When a customer asks for help from inside the app, it lands here." : "Try another status."} />
        </div>
      ) : (
        <ul className={`${CARD_BASE} divide-y divide-slate-900/[0.06]`}>
          {tickets.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => go(`support/${t.id}`)} data-testid={`ticket-${t.id}`}
                className={`flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-900/[0.025] focus:outline-none focus-visible:bg-slate-900/[0.04] ${t.sla?.state === "breached" ? "shadow-[inset_3px_0_0_#cf222e]" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{t.subject}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{t.tenant_name} · updated {fmtAgo(t.updated_at)}</div>
                </div>
                {/* Late or nearly late shows at every width; the rest only where there is room. */}
                <span className={["breached", "due_soon"].includes(t.sla?.state) ? "inline-flex" : "hidden sm:inline-flex"}>
                  <SlaChip sla={t.sla} testid={`ticket-sla-${t.id}`} />
                </span>
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
            {sel.sla && sel.sla.state !== "none" && (
              <div>
                <span className={ADMIN_H3 + " flex items-center gap-1.5"}><Timer size={13} /> First reply</span>
                <SlaChip sla={sel.sla} testid="ticket-sla" />
                <p className="mt-1.5 text-xs text-slate-500">Target {sel.sla.target_hours}h for {priorityLabel(sel.priority).toLowerCase()} priority.</p>
              </div>
            )}
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
            {sel.resolved_at && <p className="text-xs text-slate-500">Resolved {fmtAgo(sel.resolved_at)}</p>}
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

// --- messages we sent -----------------------------------------------------------------------
function Messages() {
  const { go } = useAdmin();
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const qs = [channel && `channel=${channel}`, status && `status=${status}`].filter(Boolean).join("&");
  const { data, error, reload } = useAdminGet(`/admin/messages${qs ? `?${qs}` : ""}`);
  return (
    <AdminPage title="Support desk" subtitle="Every email, sign-in code, WhatsApp reply and notification we tried to send. Never the text." testid="admin-messages"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <DeskTabs value="messages" />
      {error && !data ? <LoadError what="messages" onRetry={reload} /> : !data ? <Loading /> : (
        <div className="space-y-4">
          <Panel title="Last 7 days" hint="Not sent means that channel isn't set up, or the person has no phone with notifications on">
            <WeekTally week={data.week} />
            {data.failing?.length > 0 && (
              <div className="mt-4 rounded-2xl bg-[#cf222e]/[0.06] px-4 py-3 text-sm text-[#8f1620]" data-testid="messages-failing">
                <strong className="font-semibold">Failing most: </strong>
                {data.failing.map((f) => `${kindLabel(f.kind)} (${f.channel}) ×${f.count}`).join(" · ")}
              </div>
            )}
          </Panel>
          <Panel title="Latest" hint="Newest first, up to 100"
            actions={(
              <div className="flex flex-wrap gap-2">
                <Segmented value={channel} onChange={setChannel} ariaLabel="Channel" testid="messages-channel"
                  options={[{ value: "", label: "All" }, ...CHANNELS]} />
                <Segmented value={status} onChange={setStatus} ariaLabel="Result" testid="messages-status"
                  options={[{ value: "", label: "Any result" }, { value: "failed", label: "Failed" }, { value: "skipped", label: "Not sent" }]} />
              </div>
            )}>
            <MessageList rows={data.messages} showCompany onCompany={(tid) => go(`workspaces/${tid}/support`)}
              emptyHint={qs ? "Nothing matches these filters." : undefined} />
          </Panel>
        </div>
      )}
    </AdminPage>
  );
}

// --- the recommend score --------------------------------------------------------------------
function Recommend() {
  const { go } = useAdmin();
  const [days, setDays] = useState(90);
  const { data, error, reload } = useAdminGet(`/admin/nps?days=${days}`);
  return (
    <AdminPage title="Support desk" subtitle="How likely are customers to recommend DecisionOS? Asked in the app, at most once a quarter." testid="admin-nps"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <DeskTabs value="nps" />
      {error && !data ? <LoadError what="the recommend score" onRetry={reload} /> : !data ? <Loading /> : (
        <div className="space-y-4">
          {!data.enabled && (
            <div className={`${CARD_BASE} flex flex-wrap items-center justify-between gap-3 p-5`} data-testid="nps-off">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">The question is switched off</div>
                <div className="mt-0.5 max-w-xl text-xs text-slate-500">
                  Turn on the global flag <code className="rounded bg-slate-900/[0.05] px-1">nps</code> in Config and people see a
                  one-question card, at most once every 90 days and never in a workspace's first two weeks.
                </div>
              </div>
              <Btn size="sm" onClick={() => go("config")}>Open Config</Btn>
            </div>
          )}
          <div className="flex justify-end">
            <Segmented value={days} onChange={setDays} ariaLabel="Period" testid="nps-days"
              options={[{ value: 30, label: "30 days" }, { value: 90, label: "90 days" }, { value: 365, label: "A year" }]} />
          </div>
          {data.responses === 0 ? (
            <div className={CARD_BASE}>
              <Empty icon={Smiley} title="No answers yet."
                hint={data.enabled ? "Answers appear here as people see the card." : "Switch the question on to start hearing back."} />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="Score" hint="% who would recommend minus % who wouldn't, from −100 to +100" testid="nps-score">
                <div className="font-display text-[3rem] leading-none tabular-nums text-slate-900">{data.score > 0 ? `+${data.score}` : data.score}</div>
                <div className="mt-2 text-xs text-slate-500">{fmtNum(data.responses)} answers · {fmtNum(data.dismissed)} closed the card</div>
                <div className="mt-4"><NpsSplit promoters={data.promoters} passives={data.passives} detractors={data.detractors} /></div>
              </Panel>
              <Panel title="What they said" hint="The latest comments" className="lg:col-span-2">
                {data.comments.length === 0 ? <Empty compact title="Nobody left a comment yet." /> : (
                  <ul className="-mx-2 divide-y divide-slate-900/[0.05]">
                    {data.comments.map((c) => (
                      <li key={c.id} className="flex gap-3 px-2 py-3">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-semibold tabular-nums ${c.score >= 9 ? "bg-emerald-600/[0.08] text-[#116329]" : c.score <= 6 ? "bg-[#cf222e]/[0.07] text-[#b91c1c]" : "bg-slate-500/[0.08] text-slate-600"}`}>{c.score}</span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap text-sm text-slate-800">{c.comment}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {c.user_name || "Someone"} at{" "}
                            <LinkOut onClick={() => go(`workspaces/${c.tenant_id}`)}>{c.tenant_name || "a workspace"}</LinkOut> · {fmtAgo(c.created_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}
    </AdminPage>
  );
}
