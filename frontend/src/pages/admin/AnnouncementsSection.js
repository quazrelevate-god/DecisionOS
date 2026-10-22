import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
// Announcements (Epic 10 Sprint 8; redesigned 2026-10-22). In-app banners for
// everyone, one plan or one workspace; switch on and off, email to owners.
// The audience used to be typed as a code ("plan:starter", "tenant:<id>");
// it is picked from lists now and reads back in words.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { ConfirmAction } from "../../components/common";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { ArrowClockwise, Plus, Trash, PaperPlaneRight, Megaphone, Eye, EyeSlash } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtAgo, Btn, Chip, Segmented, Toggle, RowMenu, AdminPage, Panel, Loading, Empty,
  LoadError, ADMIN_FIELD,
} from "./adminUi";
import { PLAN_OPTIONS, planLabel, announceKindLabel, announceKindTone } from "./adminLabels";

const BLANK = { title: "", body: "", kind: "info", audience: "all", dismissible: true };
const KINDS = ["info", "warning", "maintenance"].map((k) => ({ value: k, label: announceKindLabel(k) }));

export function AnnouncementsSection() {
  const { canWrite } = useAdmin();
  const { data, error, reload } = useAdminGet("/admin/announcements");
  const tenants = useAdminGet("/admin/tenants");
  const [form, setForm] = useState(BLANK);
  const [who, setWho] = useState("all");      // all | plan | tenant
  const [plan, setPlan] = useState("starter");
  const [tenant, setTenant] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingDel, setPendingDel] = useState(null);
  const [pendingEmail, setPendingEmail] = useState(null);

  const names = useMemo(() => Object.fromEntries((tenants.data?.tenants || []).map((t) => [t.id, t.name])), [tenants.data]);
  const audienceWords = (a) => {
    if (!a || a === "all") return "Everyone";
    if (a.startsWith("plan:")) return `${planLabel(a.slice(5))} plan`;
    if (a.startsWith("tenant:")) return names[a.slice(7)] || "One workspace";
    return a;
  };
  const audience = who === "plan" ? `plan:${plan}` : who === "tenant" ? (tenant ? `tenant:${tenant}` : "") : "all";

  const create = async (e) => {
    e.preventDefault();
    if (!audience) { toast.error("Pick the workspace to show it to"); return; }
    setCreating(true);
    try {
      await api.post("/admin/announcements", { ...form, audience });
      toast.success(`“${form.title}” is live for ${audienceWords(audience).toLowerCase() === "everyone" ? "everyone" : audienceWords(audience)}`);
      setForm(BLANK); setWho("all"); setTenant("");
      reload();
    } catch (err) { toast.error(errText(err)); } finally { setCreating(false); }
  };
  const toggle = async (a) => {
    try { await api.patch(`/admin/announcements/${a.id}`, { active: !a.active }); toast.success(a.active ? "Switched off" : "Switched on"); reload(); }
    catch (e) { toast.error(errText(e)); }
  };
  /* 2026-10-02 — both of these asked through window.confirm, which some embed
     contexts answer false with nothing drawn: the operator saw no question and
     no result. The second one sends REAL EMAIL to real owners, so a question
     that can fail to appear is not a question. */
  const del = async (id) => {
    setPendingDel(null);
    try { await api.delete(`/admin/announcements/${id}`); toast.success("Announcement deleted"); reload(); } catch (e) { toast.error(errText(e)); }
  };
  const email = async (a) => {
    setPendingEmail(null);
    try { const r = await api.post(`/admin/announcements/${a.id}/email`); toast.success(`Emailed ${r.data.sent} of ${r.data.targets} owners`); }
    catch (e) { toast.error(errText(e)); }
  };

  const rows = data?.announcements || [];

  return (
    <AdminPage title="Announcements" subtitle="Banners inside the app, for everyone, one plan or one workspace" testid="admin-announcements"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <div className="grid gap-4 lg:grid-cols-5">
        {canWrite && (
          <Panel title="New announcement" className="h-fit lg:col-span-2">
            <form onSubmit={create} className="space-y-4">
              <label className="block">
                <span className={ADMIN_H3 + " block"}>Title</span>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Scheduled maintenance on Sunday, 2–3 am" className={ADMIN_FIELD} data-testid="announce-title" />
              </label>
              <label className="block">
                <span className={ADMIN_H3 + " block"}>Message (optional)</span>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3}
                  placeholder="What people should know or do" className={`${ADMIN_FIELD} resize-y`} />
              </label>
              <div>
                <span className={ADMIN_H3 + " block"}>Kind</span>
                <GlassSelect value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={KINDS} ariaLabel="Kind" testid="announce-kind" triggerClassName="h-11 text-sm" />
              </div>
              <div>
                <span className={ADMIN_H3 + " block"}>Show it to</span>
                <Segmented value={who} onChange={setWho} ariaLabel="Audience" testid="announce-who"
                  options={[{ value: "all", label: "Everyone" }, { value: "plan", label: "A plan" }, { value: "tenant", label: "One workspace" }]} />
                {who === "plan" && (
                  <div className="mt-2"><GlassSelect value={plan} onChange={setPlan} options={PLAN_OPTIONS} ariaLabel="Plan" triggerClassName="h-11 text-sm" /></div>
                )}
                {who === "tenant" && (
                  <div className="mt-2">
                    <GlassSelect value={tenant} onChange={setTenant} placeholder={tenants.data ? "Choose a workspace" : "Loading workspaces…"}
                      ariaLabel="Workspace" testid="announce-tenant" triggerClassName="h-11 text-sm"
                      options={(tenants.data?.tenants || []).filter((t) => !t.is_test).map((t) => ({ value: t.id, label: t.name }))} />
                  </div>
                )}
              </div>
              <Toggle checked={form.dismissible} onChange={(v) => setForm({ ...form, dismissible: v })} label="People can close it" />
              <Btn type="submit" variant="primary" icon={Plus} busy={creating} disabled={!form.title.trim()} className="w-full">Publish</Btn>
            </form>
          </Panel>
        )}

        <div className={canWrite ? "lg:col-span-3" : "lg:col-span-5"}>
          {error && !data ? <LoadError what="announcements" onRetry={reload} /> : !data ? <Loading /> : rows.length === 0 ? (
            <div className={CARD_BASE}><Empty icon={Megaphone} title="No announcements yet." hint="Publish one to show a banner inside the app." /></div>
          ) : (
            <ul className={`${CARD_BASE} divide-y divide-slate-900/[0.06]`}>
              {rows.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-4" data-testid={`announcement-${a.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{a.title}</span>
                      <Chip tone={announceKindTone(a.kind)}>{announceKindLabel(a.kind)}</Chip>
                      {a.live ? <Chip tone="good">Showing</Chip> : <Chip>Off</Chip>}
                    </div>
                    {a.body && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.body}</p>}
                    <div className="mt-1 text-xs text-slate-500">{audienceWords(a.audience)} · {fmtAgo(a.created_at)}{a.dismissible === false ? " · can't be closed" : ""}</div>
                  </div>
                  {canWrite && (
                    <RowMenu testid={`announcement-menu-${a.id}`} items={[
                      { label: a.active ? "Switch off" : "Switch on", icon: a.active ? EyeSlash : Eye, onSelect: () => toggle(a) },
                      { label: "Email it to owners…", icon: PaperPlaneRight, onSelect: () => setPendingEmail(a) },
                      { label: "Delete…", icon: Trash, danger: true, separatorBefore: true, onSelect: () => setPendingDel(a) },
                    ]} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmAction
        open={!!pendingDel}
        onOpenChange={() => setPendingDel(null)}
        title="Delete this announcement?"
        description={pendingDel ? `“${pendingDel.title}” comes off every workspace it is showing on. This can't be undone.` : ""}
        confirmLabel="Delete it"
        cancelLabel="Keep it"
        onConfirm={() => del(pendingDel.id)}
        testid="admin-announcement-delete-confirm" />

      <ConfirmAction
        open={!!pendingEmail}
        onOpenChange={() => setPendingEmail(null)}
        title="Send this as real email?"
        description={pendingEmail ? `“${pendingEmail.title}” goes to the inbox of every owner in ${audienceWords(pendingEmail.audience).toLowerCase() === "everyone" ? "every workspace" : audienceWords(pendingEmail.audience)}. Email cannot be unsent.` : ""}
        confirmLabel="Send the email"
        cancelLabel="Not now"
        danger={false}
        onConfirm={() => email(pendingEmail)}
        testid="admin-announcement-email-confirm" />
    </AdminPage>
  );
}
