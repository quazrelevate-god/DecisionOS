import { useState } from "react";
import { Sparkle } from "@phosphor-icons/react";

// 2026-09-20 (Settings audit) — "Regenerate with AI" replaced the owner's own
// vocabulary / operating model / finance categories on one click, unsaved
// edits included. It now asks first, in the page (window.confirm is silently
// skipped in some browsers — see Workflows.js ASK-2). `replaces` names what
// goes, e.g. "your pipelines, stages, task templates and approval gates".
export function RegenerateWithAi({ onConfirm, busy, replaces, testid }) {
  const [asking, setAsking] = useState(false);
  const btn = "flex items-center gap-2 border border-nm-edge/40 px-5 py-2 text-sm font-medium rounded-lg hover:bg-accent transition-all disabled:opacity-60";

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} disabled={busy} data-testid={testid} className={btn}>
        <Sparkle size={16} weight="bold" /> {busy ? "Regenerating…" : "Regenerate with AI"}
      </button>
    );
  }
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2" data-testid={`${testid}-confirm`}>
      <span className="text-xs text-foreground">
        This replaces {replaces} with a fresh set from AI. Unsaved changes here are lost.
      </span>
      <button type="button" data-testid={`${testid}-yes`} className={btn}
        onClick={() => { setAsking(false); onConfirm(); }}>
        Replace them
      </button>
      <button type="button" data-testid={`${testid}-no`} className={btn} onClick={() => setAsking(false)}>
        Keep mine
      </button>
    </div>
  );
}
