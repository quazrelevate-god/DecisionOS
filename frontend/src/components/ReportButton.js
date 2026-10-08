import { useState } from "react";
import { toast } from "sonner";
import { Flag } from "@phosphor-icons/react";
import api, { formatApiError } from "../lib/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Textarea } from "./ui/textarea";

// 2026-10-08 — Google Play: AI output and other people's content must be
// reportable from inside the app. One small flag, one dialog, one endpoint
// (backend/routers/reports.py); platform admins work the queue. `publicEndpoint`
// is for the signup interview, before there is an account. The reasons are
// full-width rows rather than ui/radio-group's 16px circles: below lg every
// button takes the 44px touch floor (index.css), which would balloon them.

const REASONS = [
  ["offensive", "Offensive or rude"],
  ["harassment", "Harassment or bullying"],
  ["hateful", "Hateful toward a group"],
  ["sexual", "Sexual content"],
  ["violent", "Violent or threatening"],
  ["self_harm", "Self-harm"],
  ["misleading", "Wrong or misleading"],
  ["spam", "Spam"],
  ["privacy", "Shares private information"],
  ["other", "Something else"],
];

const clip = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) : s || undefined);

export function ReportButton({
  kind = "ai_output", targetType, targetId, snapshot, context,
  label, className, size = 14, publicEndpoint = false, title,
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);

  const heading = title || (kind === "user" ? "Report this person" : "What's wrong with this?");

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    try {
      await api.post(publicEndpoint ? "/reports/public" : "/reports", {
        kind,
        target_type: String(targetType || kind).slice(0, 40),
        target_id: targetId ? String(targetId).slice(0, 100) : undefined,
        reason,
        details: clip(details.trim(), 1000),
        snapshot: clip(snapshot, 4000),
        context: clip(context, 2000),
      });
      toast.success("Thanks — reported. We review every report.");
      setOpen(false);
      setReason("");
      setDetails("");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Couldn't send the report. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={label || (kind === "user" ? "Report this person" : "Report")}
        title={label || "Report"}
        data-testid={`report-${targetType || kind}`}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs max-lg:-my-2.5 text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 transition-colors",
          className,
        )}
      >
        <Flag size={size} aria-hidden="true" />
        {label ? <span>{label}</span> : null}
      </button>
      <Dialog open={open} onOpenChange={(v) => { if (!sending) setOpen(v); }}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="text-base">{heading}</DialogTitle>
            <DialogDescription className="text-xs">
              {kind === "ai_output"
                ? "Tell us what was wrong with this AI answer. Our team reviews every report."
                : "Your report goes to the DecisionOS team, not to the person involved."}
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Reason" className="grid gap-1">
            {REASONS.map(([value, text]) => {
              const on = reason === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setReason(value)}
                  data-testid={`report-reason-${value}`}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    on && "bg-muted/60 font-medium",
                  )}
                >
                  <span aria-hidden="true" className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    on ? "border-foreground" : "border-muted-foreground/50",
                  )}>
                    {on && <span className="h-2 w-2 rounded-full bg-foreground" />}
                  </span>
                  <span>{text}</span>
                </button>
              );
            })}
          </div>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
            placeholder="Anything else we should know? (optional)"
            rows={3}
            aria-label="Details"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={sending}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!reason || sending}
              data-testid="report-submit"
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send report"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// One quiet line under an AI answer area — once per answer, not per paragraph.
export function AiNotice({ className, children, report }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground/80", className)}>
      <span>AI can make mistakes. Check important details.</span>
      {report ? <ReportButton kind="ai_output" size={12} {...report} /> : null}
      {children}
    </div>
  );
}

export default ReportButton;
