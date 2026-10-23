import { ADMIN_H3 } from "./adminStyle";
// Support pieces (admin console v2 P4, 2026-10-23): the first-reply clock on a
// ticket, the log of messages we sent (never their text), and the recommend
// score. Used by the support desk and a customer's Support tab.
import { EnvelopeSimple, ChatText, WhatsappLogo, BellRinging, PaperPlaneTilt } from "@phosphor-icons/react";
import { Chip, Empty, fmtAgo, fmtDateTime } from "./adminUi";

// --- the first-reply clock ----------------------------------------------------------------
const hrs = (h) => (h == null ? "" : h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

export function slaText(sla) {
  if (!sla) return null;
  switch (sla.state) {
    case "breached": return { tone: "bad", text: `Late by ${hrs(sla.over_hours)}`, title: `No reply yet. The target is ${sla.target_hours}h.` };
    case "due_soon": return { tone: "warn", text: `Reply in ${hrs(sla.left_hours)}`, title: `Due ${fmtDateTime(sla.due_at)}` };
    case "waiting": return { tone: "neutral", text: `Reply in ${hrs(sla.left_hours)}`, title: `Due ${fmtDateTime(sla.due_at)}` };
    case "met": return { tone: "good", text: `Replied in ${hrs(sla.took_hours)}`, title: `Within the ${sla.target_hours}h target` };
    case "late": return { tone: "warn", text: `Replied in ${hrs(sla.took_hours)}`, title: `After the ${sla.target_hours}h target` };
    default: return null;
  }
}

export function SlaChip({ sla, testid }) {
  const s = slaText(sla);
  return s ? <Chip tone={s.tone} title={s.title} testid={testid}>{s.text}</Chip> : null;
}

export { hrs as fmtHours };

// --- messages we sent ---------------------------------------------------------------------
const CHANNEL = {
  email: { icon: EnvelopeSimple, label: "Email" },
  sms: { icon: ChatText, label: "SMS" },
  whatsapp: { icon: WhatsappLogo, label: "WhatsApp" },
  push: { icon: BellRinging, label: "Push" },
};
export const CHANNELS = Object.keys(CHANNEL).map((k) => ({ value: k, label: CHANNEL[k].label }));

const KIND = {
  invite: "Team invite", verify_email: "Confirm email", password_reset: "Password reset",
  announcement: "Announcement", owner_alert: "Owner alert", platform_alert: "Platform alert",
  sign_in_code: "Sign-in code", whatsapp_reply: "WhatsApp reply", email: "Email", push: "Notification",
};
export const kindLabel = (k) => KIND[k] || String(k || "Message").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const STATUS = { sent: ["good", "Sent"], failed: ["bad", "Failed"], skipped: ["neutral", "Not sent"] };
const SKIP_WHY = {
  not_configured: "This channel isn't set up", no_device: "No phone has the app with notifications on",
  smtp_error: "The mail server refused it", smtp_auth_failed: "The mail server login failed",
  resend_error: "The mail service refused it", network: "Couldn't reach the provider",
  no_device_accepted: "No phone accepted it",
};
export const whyText = (m) => SKIP_WHY[m.error] || (m.status === "skipped" ? "This channel isn't set up" : m.error || "");

export function MessageRow({ m, showCompany, onCompany }) {
  const ch = CHANNEL[m.channel] || CHANNEL.email;
  const Icon = ch.icon;
  const [tone, label] = STATUS[m.status] || STATUS.failed;
  const who = [m.user_name, m.to].filter(Boolean).join(" · ") + (m.count > 1 ? ` +${m.count - 1}` : "");
  return (
    <li className="flex items-center gap-3 px-2 py-2.5" data-testid={`message-${m.id}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-500/[0.08] text-slate-600" title={ch.label}>
        <Icon size={16} aria-label={ch.label} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">
          {kindLabel(m.kind)}
          {showCompany && m.tenant_name && (
            <> <span className="font-normal text-slate-500">to </span>
              {onCompany ? <button type="button" onClick={() => onCompany(m.tenant_id)} className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">{m.tenant_name}</button> : m.tenant_name}
            </>
          )}
        </span>
        <span className="block truncate text-xs text-slate-500">{who || ch.label}{m.status !== "sent" && whyText(m) ? ` · ${whyText(m)}` : ""}</span>
      </span>
      <Chip tone={tone}>{label}</Chip>
      <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-slate-500 sm:block" title={fmtDateTime(m.at)}>{fmtAgo(m.at)}</span>
    </li>
  );
}

export function MessageList({ rows, showCompany, onCompany, emptyHint }) {
  if (!rows?.length) {
    return <Empty compact icon={PaperPlaneTilt} title="No messages sent yet."
      hint={emptyHint || "Emails, sign-in codes, WhatsApp replies and notifications show up here as they go out."} />;
  }
  return (
    <ul className="-mx-2 divide-y divide-slate-900/[0.05]">
      {rows.map((m) => <MessageRow key={m.id} m={m} showCompany={showCompany} onCompany={onCompany} />)}
    </ul>
  );
}

// The 7-day tally: one tile per channel, sent / failed / not sent.
export function WeekTally({ week }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="messages-week">
      {Object.entries(CHANNEL).map(([k, c]) => {
        const w = week?.[k] || {};
        const Icon = c.icon;
        const total = (w.sent || 0) + (w.failed || 0) + (w.skipped || 0);
        return (
          <div key={k} className="rounded-2xl bg-slate-500/[0.07] p-3.5">
            <div className={ADMIN_H3 + " mb-1 flex items-center gap-1.5"}><Icon size={13} /> {c.label}</div>
            <div className="font-display text-[1.45rem] leading-none tabular-nums text-slate-900">{total}</div>
            <div className="mt-1.5 text-xs tabular-nums text-slate-500">
              {w.sent || 0} sent
              {w.failed ? <> · <span className="font-medium text-[#b91c1c]">{w.failed} failed</span></> : null}
              {w.skipped ? <> · {w.skipped} not sent</> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- the recommend score ------------------------------------------------------------------
export function NpsSplit({ promoters = 0, passives = 0, detractors = 0 }) {
  const n = promoters + passives + detractors;
  if (!n) return null;
  const seg = [["Recommend (9–10)", promoters, "bg-emerald-600/70"], ["Neutral (7–8)", passives, "bg-slate-400/40"], ["Wouldn't (0–6)", detractors, "bg-[#cf222e]/70"]];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-pill bg-slate-500/[0.1]" role="img"
        aria-label={`${promoters} would recommend, ${passives} neutral, ${detractors} wouldn't`}>
        {seg.map(([l, v, c]) => v ? <span key={l} className={c} style={{ width: `${(100 * v) / n}%` }} /> : null)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {seg.map(([l, v, c]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${c}`} />{l} <strong className="tabular-nums text-slate-900">{v}</strong></span>
        ))}
      </div>
    </div>
  );
}
