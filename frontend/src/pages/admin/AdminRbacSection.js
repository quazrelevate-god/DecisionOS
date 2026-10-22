import { ADMIN_H3 } from "./adminStyle";
// Admins & two-step sign-in (Epic 10 Sprint 7; redesigned 2026-10-22).
//
// Adding an admin used to mean typing a password for them, which then
// travelled by chat. Now a super admin invites by email and gets a link that
// works once, for 7 days; the new admin sets their own password. Two-step
// sign-in is set up with a QR code, and turning it off asks for a current
// code in the app instead of the browser's prompt box.
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import api from "../../lib/api";
import { ConfirmAction } from "../../components/common";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { ArrowClockwise, ShieldCheck, UserPlus, Copy, LinkSimple, Prohibit, CheckCircle, ShieldWarning } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtAgo, fmtDate, Btn, Chip, RowMenu, AdminPage, Panel, Loading, LoadError,
  AdminDialog, ADMIN_FIELD,
} from "./adminUi";
import { adminRoleLabel, ADMIN_ROLE_HINT } from "./adminLabels";

const ROLES = ["super_admin", "support", "billing", "read_only"];
const roleOptions = (roles) => (roles?.length ? roles : ROLES).map((r) => ({ value: r, label: adminRoleLabel(r) }));
const linkFor = (path) => `${window.location.origin}${path}`;

function copy(text, done = "Copied") {
  try { navigator.clipboard.writeText(text); toast.success(done); }
  catch { toast.error("Couldn't copy. Select the link and copy it yourself."); }
}

function TwoStep({ me, onChanged }) {
  const [enroll, setEnroll] = useState(null);   // { secret, provisioning_uri }
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(null);
  const [busy, setBusy] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [offCode, setOffCode] = useState("");

  const start = async () => {
    setBusy("start");
    try { const r = await api.post("/admin/2fa/enroll"); setEnroll(r.data); setBackup(null); setCode(""); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(""); }
  };
  const confirm = async (e) => {
    e.preventDefault();
    setBusy("confirm");
    try {
      const r = await api.post("/admin/2fa/confirm", { code: code.trim() });
      setBackup(r.data.backup_codes); setEnroll(null); setCode("");
      toast.success("Two-step sign-in is on");
      onChanged();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(""); }
  };
  const turnOff = async (e) => {
    e.preventDefault();
    setBusy("off");
    try {
      await api.post("/admin/2fa/disable", { code: offCode.trim() });
      setDisabling(false); setOffCode("");
      toast.success("Two-step sign-in is off");
      onChanged();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(""); }
  };

  return (
    <Panel id="two-step" title="Two-step sign-in" testid="admin-2fa"
      hint="A code from your phone's authenticator app, on top of your password">
      {backup ? (
        <div>
          <p className="text-sm text-slate-700">Save these backup codes somewhere safe. Each one signs you in once if you lose your phone. They won&apos;t be shown again.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {backup.map((c) => <code key={c} className="rounded-xl bg-white px-3 py-2 text-center font-mono text-sm text-slate-900 ring-1 ring-inset ring-slate-900/[0.08]">{c}</code>)}
          </div>
          <div className="mt-3 flex gap-2">
            <Btn size="sm" icon={Copy} onClick={() => copy(backup.join("\n"), "Backup codes copied")}>Copy codes</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setBackup(null)}>I&apos;ve saved them</Btn>
          </div>
        </div>
      ) : me.two_factor ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-[#116329]"><ShieldCheck size={18} weight="fill" /> On for {me.email}</span>
          <Btn size="sm" variant="danger" onClick={() => { setOffCode(""); setDisabling(true); }} data-testid="admin-2fa-disable">Turn off</Btn>
        </div>
      ) : enroll ? (
        <form onSubmit={confirm} className="grid gap-5 sm:grid-cols-[auto,1fr] sm:items-start">
          <div className="justify-self-start rounded-2xl bg-white p-3 ring-1 ring-inset ring-slate-900/[0.08]">
            <QRCodeSVG value={enroll.provisioning_uri} size={148} level="M" />
          </div>
          <div className="min-w-0 space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password).</li>
              <li>Scan the code, or type this key: <code className="break-all font-mono text-xs text-slate-900">{enroll.secret}</code></li>
              <li>Enter the 6-digit code it shows.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
                autoComplete="one-time-code" placeholder="123456" aria-label="6-digit code" autoFocus
                className={`${ADMIN_FIELD} w-36 text-center font-mono tracking-[0.3em]`} data-testid="admin-2fa-code" />
              <Btn type="submit" variant="primary" busy={busy === "confirm"} disabled={code.length !== 6}>Turn on</Btn>
              <Btn variant="ghost" onClick={() => setEnroll(null)}>Cancel</Btn>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-[#7d4e00]"><ShieldWarning size={18} weight="fill" /> Off. Your password is the only thing protecting this console.</span>
          <Btn variant="primary" icon={ShieldCheck} busy={busy === "start"} onClick={start} data-testid="admin-2fa-start">Set it up</Btn>
        </div>
      )}

      <AdminDialog open={disabling} onOpenChange={setDisabling} busy={busy === "off"} title="Turn off two-step sign-in?"
        description="Enter a current code from your authenticator app, or a backup code." testid="admin-2fa-disable-dialog">
        <form onSubmit={turnOff} className="mt-1 space-y-4">
          <input value={offCode} onChange={(e) => setOffCode(e.target.value.trim())} autoFocus autoComplete="one-time-code"
            placeholder="Code" aria-label="Code" className={`${ADMIN_FIELD} font-mono tracking-[0.2em]`} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Btn variant="ghost" onClick={() => setDisabling(false)}>Keep it on</Btn>
            <Btn type="submit" variant="danger" busy={busy === "off"} disabled={offCode.length < 6}>Turn it off</Btn>
          </div>
        </form>
      </AdminDialog>
    </Panel>
  );
}

function InviteDialog({ open, onOpenChange, roles, onDone }) {
  const [form, setForm] = useState({ email: "", name: "", role: "support" });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const close = (v) => { if (!v) { setLink(null); setForm({ email: "", name: "", role: "support" }); } onOpenChange(v); };
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/admin/admins/invite", form);
      setLink(linkFor(r.data.invite_path));
      onDone();
    } catch (err) { toast.error(errText(err)); } finally { setBusy(false); }
  };
  return (
    <AdminDialog open={open} onOpenChange={close} busy={busy} testid="admin-invite-dialog"
      title={link ? "Send them this link" : "Invite an admin"}
      description={link ? `It works once, for 7 days. ${form.email} opens it and sets their own password. Nothing has been emailed.`
        : "They get a link to set their own password. You never see or send it."}>
      {link ? (
        <div className="mt-1 space-y-4">
          <div className="break-all rounded-xl bg-white p-3 font-mono text-xs text-slate-800 ring-1 ring-inset ring-slate-900/[0.08]" data-testid="admin-invite-link">{link}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Btn variant="ghost" onClick={() => close(false)}>Done</Btn>
            <Btn variant="primary" icon={Copy} onClick={() => copy(link, "Invite link copied")}>Copy link</Btn>
          </div>
        </div>
      ) : (
        <form onSubmit={send} className="mt-1 space-y-4">
          <label className="block">
            <span className={ADMIN_H3 + " block"}>Email</span>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@company.com" autoFocus className={ADMIN_FIELD} data-testid="admin-invite-email" />
          </label>
          <label className="block">
            <span className={ADMIN_H3 + " block"}>Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" className={ADMIN_FIELD} />
          </label>
          <div>
            <span className={ADMIN_H3 + " block"}>Role</span>
            <GlassSelect value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={roleOptions(roles)} ariaLabel="Role" testid="admin-invite-role" />
            <p className="mt-1.5 text-xs text-slate-500">{ADMIN_ROLE_HINT[form.role]}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Btn variant="ghost" onClick={() => close(false)}>Cancel</Btn>
            <Btn type="submit" variant="primary" busy={busy} disabled={!form.email.includes("@")} data-testid="admin-invite-go">Create invite link</Btn>
          </div>
        </form>
      )}
    </AdminDialog>
  );
}

export function AdminRbacSection() {
  const { admin, isSuper, setAdmin } = useAdmin();
  const me = useAdminGet("/admin/me");
  const list = useAdminGet(isSuper ? "/admin/admins" : null);
  const [inviting, setInviting] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [busy, setBusy] = useState(false);
  const meNow = me.data || admin;

  const refreshMe = async () => {
    me.reload();
    try { const r = await api.get("/admin/me"); setAdmin?.(r.data); } catch { /* the page still shows the change */ }
  };
  const patch = async (a, body, done) => {
    setBusy(true);
    try { await api.patch(`/admin/admins/${a.id}`, body); toast.success(done); setDeactivating(null); list.reload(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const reissue = async (a) => {
    try { const r = await api.post(`/admin/admins/${a.id}/invite`); copy(linkFor(r.data.invite_path), "New invite link copied. The old one no longer works."); list.reload(); }
    catch (e) { toast.error(errText(e)); }
  };

  return (
    <AdminPage title="Admins" testid="admin-rbac" subtitle="Who can use this console, and how they sign in"
      actions={(
        <>
          <Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={() => { me.reload(); list.reload(); }}>Refresh</Btn>
          {isSuper && <Btn size="sm" variant="primary" icon={UserPlus} onClick={() => setInviting(true)} data-testid="admin-invite">Invite an admin</Btn>}
        </>
      )}>
      <div className="space-y-4">
        {meNow ? <TwoStep me={meNow} onChanged={() => { refreshMe(); list.reload(); }} /> : <Loading />}

        {!isSuper ? (
          <p className="text-sm text-slate-500">Only a super admin can add admins or change their roles. You are signed in as {adminRoleLabel(meNow?.role)}.</p>
        ) : list.error && !list.data ? <LoadError what="admins" onRetry={list.reload} /> : !list.data ? <Loading /> : (
          <Panel title={`Admins (${list.data.admins.length})`} pad={false}>
            <ul className="divide-y divide-slate-900/[0.06]">
              {list.data.admins.map((a) => {
                const self = a.id === meNow?.id;
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid={`admin-row-${a.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{a.name && a.name !== a.email ? a.name : a.email}</span>
                        {self && <Chip>You</Chip>}
                        {a.pending && <Chip tone="warn">Invited</Chip>}
                        {!a.active && <Chip tone="bad">Deactivated</Chip>}
                        {a.two_factor ? <Chip tone="good"><ShieldCheck size={11} weight="fill" /> Two-step</Chip> : !a.pending && a.active && <Chip tone="warn">Password only</Chip>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {a.name && a.name !== a.email ? `${a.email} · ` : ""}
                        {a.pending ? `Link expires ${fmtDate(a.invite_expires_at)}` : `Last signed in ${fmtAgo(a.last_login).toLowerCase()}`}
                      </div>
                    </div>
                    <div className="w-40">
                      <GlassSelect value={a.role} onChange={(v) => patch(a, { role: v }, `${a.email} is now ${adminRoleLabel(v)}`)}
                        disabled={self || !a.active} options={roleOptions(list.data.roles)} ariaLabel={`Role for ${a.email}`}
                        testid={`admin-role-${a.id}`} triggerClassName="h-9 text-sm" />
                    </div>
                    <RowMenu testid={`admin-menu-${a.id}`} items={[
                      { label: "Copy a new invite link", icon: LinkSimple, hidden: !a.pending, onSelect: () => reissue(a) },
                      { label: "Reactivate", icon: CheckCircle, hidden: self || a.active, onSelect: () => patch(a, { active: true }, `${a.email} can sign in again`) },
                      { label: "Deactivate…", icon: Prohibit, danger: true, hidden: self || !a.active, onSelect: () => setDeactivating(a) },
                    ]} />
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
      <InviteDialog open={inviting} onOpenChange={setInviting} roles={list.data?.roles} onDone={list.reload} />
      <ConfirmAction open={!!deactivating} onOpenChange={() => setDeactivating(null)} busy={busy}
        title={deactivating ? `Deactivate ${deactivating.email}?` : ""}
        description="They're signed out and can't sign in to the console until a super admin reactivates them."
        confirmLabel="Deactivate" busyLabel="Deactivating…" cancelLabel="Keep them"
        onConfirm={() => patch(deactivating, { active: false }, `${deactivating.email} is deactivated`)} testid="admin-deactivate-confirm" />
    </AdminPage>
  );
}
