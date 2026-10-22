import { CARD_BASE } from "./adminStyle";
// View-as sessions (Epic 10 Sprint 2; inside the Audit log since the
// 2026-10-22 admin redesign). Every session an admin opened to see a workspace
// as one of its people: live, expired or ended. A session is started from the
// workspace's page and asks why first.
import { roleLabel } from "../../lib/departments";
import { useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { ConfirmAction } from "../../components/common";
import { ArrowClockwise, Eye, Prohibit } from "@phosphor-icons/react";
import { useAdmin, useAdminGet, errText, fmtAgo, fmtDateTime, Btn, Chip, Empty, Loading, LoadError, LinkOut } from "./adminUi";

const STATUS = { live: { label: "Live", tone: "good" }, expired: { label: "Expired", tone: "neutral" }, revoked: { label: "Ended early", tone: "bad" } };

export function ImpersonationSection() {
  const { go, canWrite } = useAdmin();
  const { data, error, reload } = useAdminGet("/admin/impersonation");
  const [ending, setEnding] = useState(null);
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/impersonation/${ending.id}/revoke`);
      toast.success("The session is ended");
      setEnding(null); reload();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };

  if (error && !data) return <LoadError what="view-as sessions" onRetry={reload} />;
  if (!data) return <Loading />;
  const rows = data.sessions || [];

  return (
    <div data-testid="admin-impersonation">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {data.active ? <><strong className="font-semibold text-slate-900">{data.active}</strong> live now. </> : "None live now. "}
          Read-only sessions can look but every change is blocked.
        </p>
        <Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>
      </div>
      {rows.length === 0 ? (
        <div className={CARD_BASE}><Empty icon={Eye} title="No one has viewed a workspace as its people yet."
          hint="Start a session from a workspace's page, under More." /></div>
      ) : (
        <ul className={`${CARD_BASE} divide-y divide-slate-900/[0.06]`}>
          {rows.map((s) => {
            const st = STATUS[s.status] || { label: s.status, tone: "neutral" };
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-900">{s.target_name}</span>
                    <span className="text-slate-500">{roleLabel(s.target_role)} at</span>
                    <LinkOut onClick={() => go(`workspaces/${s.tenant_id}`)}>{s.tenant_name}</LinkOut>
                    <Chip tone={st.tone}>{st.label}</Chip>
                    {s.read_only && <Chip>Read-only</Chip>}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {s.admin_email} · started {fmtAgo(s.granted_at)} · {s.status === "live" ? `ends ${fmtDateTime(s.expires_at)}` : `ended ${fmtDateTime(s.expires_at)}`}
                  </div>
                  {s.reason && <div className="mt-1 text-xs text-slate-600">“{s.reason}”</div>}
                </div>
                {s.status === "live" && canWrite && (
                  <Btn size="sm" variant="danger" icon={Prohibit} onClick={() => setEnding(s)} data-testid={`revoke-${s.id}`}>End now</Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmAction open={!!ending} onOpenChange={() => setEnding(null)} busy={busy}
        title="End this session now?" description={ending ? `${ending.admin_email} stops seeing ${ending.tenant_name} at once.` : ""}
        confirmLabel="End the session" busyLabel="Ending…" cancelLabel="Leave it" onConfirm={revoke} testid="revoke-confirm" />
    </div>
  );
}
