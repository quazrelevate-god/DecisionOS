import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Chip } from "./common";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import { ResponsiveSheet } from "./ResponsiveSheet";
import { ChatCircleText, User, WhatsappLogo, Microphone, PaperPlaneTilt } from "@phosphor-icons/react";

export function raisedByLabel(d) {
  if (!d) return "";
  if (d.source === "whatsapp") return `Raised via WhatsApp${d.wa_from ? ` · ${d.wa_from}` : ""}`;
  const src = d.source === "voice" ? "Voice" : d.source === "text" ? "Text" : d.source ? d.source : "Manual";
  return `Raised by ${d.created_by_name || "Unknown"} · ${src}`;
}

export function RaisedByIcon({ d, ...rest }) {
  if (d?.source === "whatsapp") return <WhatsappLogo {...rest} />;
  if (d?.source === "voice") return <Microphone {...rest} />;
  return <User {...rest} />;
}

export function DecisionDialog({ decisionId, open, onClose }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { data: d, isError } = useQuery({
    queryKey: ["decision", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}`).then((r) => r.data),
    enabled: !!decisionId && open,
    retry: false,
  });
  const timeline = d?.timeline || [];

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`/decisions/${decisionId}/comment`, { text: text.trim() });
      setText("");
      qc.invalidateQueries({ queryKey: ["decision", decisionId] });
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) { toast.error(e.response?.data?.detail || "Could not post comment"); }
    finally { setSending(false); }
  };

  // Focused overlay: bottom sheet on mobile, dialog on desktop — the
  // decision is the only thing on screen while it's open.
  const title = isError ? "Access restricted" : d ? d.title : "Decision";
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      testid="decision-dialog"
      title={title}
      description="Decision detail and discussion"
      className="lg:max-w-lg"
    >
        {isError ? (
          <div className="py-2" data-testid="decision-access-restricted">
            <p className="text-sm text-muted-foreground mt-1">You don't have access to this decision.</p>
          </div>
        ) : !d ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip value={d.status} />
              {d.dtype && <Chip value={d.dtype} tone="primary" />}
            </div>
            <p className="label-mono text-muted-foreground flex items-center gap-1.5" data-testid="decision-raised-by">
              <RaisedByIcon d={d} size={13} weight="bold" /> {raisedByLabel(d)} · {timeAgo(d.created_at)}
            </p>
            {d.summary && <p className="text-sm mt-2">{d.summary}</p>}
            {d.tasks?.length > 0 && (
              <div className="mt-3">
                <p className="label-mono text-muted-foreground mb-1">Tasks</p>
                <ul className="space-y-1">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="text-sm flex justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
                      <span>{t.title}</span>
                      <span className="label-mono text-muted-foreground shrink-0">{t.assignee_name || t.assignee_role || "unassigned"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 border-t border-border pt-3">
              <p className="label-mono text-muted-foreground mb-2 flex items-center gap-1"><ChatCircleText size={14} weight="bold" /> Discussion &amp; activity</p>
              <div className="space-y-2 max-h-56 overflow-y-auto" data-testid="decision-timeline">
                {timeline.length === 0 && <p className="text-sm text-muted-foreground">No activity yet. Start the discussion below.</p>}
                {timeline.map((e, i) => (
                  <div key={`${e.ts}-${i}`} className={`text-sm pl-2 border-l-2 ${e.kind === "comment" ? "border-primary" : "border-border"}`}>
                    <p className={e.kind === "comment" ? "" : "text-muted-foreground"}>{e.label}</p>
                    <p className="label-mono text-muted-foreground">{e.actor || "System"} · {timeAgo(e.ts)}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                  data-testid="decision-comment-input" placeholder="Write a comment…" className="flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs transition-[border-color,box-shadow] duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/25" />
                <button onClick={send} disabled={sending || !text.trim()} data-testid="decision-comment-send"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,transform] duration-200 hover:bg-primary-emphasis active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50">
                  <PaperPlaneTilt size={14} weight="bold" /> Send
                </button>
              </div>
            </div>
          </>
        )}
    </ResponsiveSheet>
  );
}
