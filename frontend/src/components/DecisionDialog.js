import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Chip } from "./common";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border border-hairline rounded-md" data-testid="decision-dialog">
        {isError ? (
          <div className="py-2" data-testid="decision-access-restricted">
            <DialogHeader>
              <DialogTitle className="text-left">Access restricted</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-text-secondary mt-1">You don't have access to this decision.</p>
          </div>
        ) : !d ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-left sr-only">Decision</DialogTitle>
            </DialogHeader>
            <p className="py-4 text-sm text-text-secondary">Loading…</p>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Chip value={d.status} />
                {d.dtype && <Chip value={d.dtype} />}
              </div>
              <DialogTitle className="text-left">{d.title}</DialogTitle>
            </DialogHeader>
            <p className="text-label text-text-secondary flex items-center gap-1.5" data-testid="decision-raised-by">
              <RaisedByIcon d={d} size={13} weight="bold" /> {raisedByLabel(d)} · {timeAgo(d.created_at)}
            </p>
            {d.summary && <p className="text-sm mt-2">{d.summary}</p>}
            {d.tasks?.length > 0 && (
              <div className="mt-3">
                <p className="text-label text-text-secondary mb-1">Tasks</p>
                <ul className="space-y-1">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="text-sm flex justify-between gap-2 border border-hairline px-2 py-1 rounded-md">
                      <span>{t.title}</span>
                      <span className="text-label text-text-secondary shrink-0">{t.assignee_name || t.assignee_role || "unassigned"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="text-label text-text-secondary mb-2 flex items-center gap-1"><ChatCircleText size={14} weight="bold" /> Discussion &amp; activity</p>
              <div className="space-y-2 max-h-56 overflow-y-auto" data-testid="decision-timeline">
                {timeline.length === 0 && <p className="text-sm text-text-secondary">No activity yet. Start the discussion below.</p>}
                {timeline.map((e, i) => (
                  <div key={`${e.ts}-${i}`} className={`text-sm pl-2 border-l-2 ${e.kind === "comment" ? "border-hairline-strong" : "border-hairline"}`}>
                    <p className={e.kind === "comment" ? "" : "text-text-secondary"}>{e.label}</p>
                    <p className="text-label text-text-secondary">{e.actor || "System"} · {timeAgo(e.ts)}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                  data-testid="decision-comment-input" placeholder="Write a comment…" className="flex-1 border border-hairline px-2 py-1.5 text-sm focus:outline-none rounded-md" />
                <button onClick={send} disabled={sending || !text.trim()} data-testid="decision-comment-send"
                  className="flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold border border-hairline hover:bg-primary-hover transition-colors disabled:opacity-50 rounded-md">
                  <PaperPlaneTilt size={14} weight="bold" /> Send
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
