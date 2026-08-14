// MPWA-03 · DexSheet — what the FAB opens.
//
// The FAB *is* Dex. Sprint 5 (E2-32/E2-33) collapsed capture and AI into one
// persona on the founder's instruction — "remove the ai from the desk button
// and integrate with brain, make it single AI name" — so this sheet hosts the
// EXISTING DexCaptureBar rather than a parallel capture surface of its own.
// Rebuilding capture here would re-fragment exactly what the team just unified.
//
// Contents, per §7:
//   * DexCaptureBar at the top (speak / type / attach, unchanged endpoints)
//   * suggestion chips below
//   * `Open Dex ›` at the foot -> /brain for Ask / Search / documents
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "@phosphor-icons/react";
import { DexCaptureBar } from "../DexCaptureBar";
import { BottomSheet } from "./BottomSheet";

// Phrased as things he would actually say out loud, not as query syntax.
const SUGGESTIONS = [
  "Tell Suresh to ship the indigo lot before Friday",
  "Ask Priya where the Krishna Garments payment is",
  "Remind me to check the loom motor tomorrow",
  "What's overdue with Anita?",
];

export function DexSheet({ open, onClose, onRecordingChange, onCaptured }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [seed, setSeed] = React.useState("");

  // Clear the seed when reopening so yesterday's chip is not still sitting in
  // the box.
  React.useEffect(() => {
    if (open) setSeed("");
  }, [open]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("dex.title", "Dex")}
      description={t("dex.subtitle", "Speak, type, or attach. Dex sorts it out.")}
      data-testid="dex-sheet"
      footer={
        <button
          type="button"
          data-testid="dex-sheet-open-full"
          onClick={() => {
            onClose?.();
            navigate("/brain");
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border text-base font-semibold transition-colors hover:bg-accent"
          style={{ minHeight: "var(--control-h-md)" }}
        >
          {t("dex.open_full", "Open Dex")}
          <ArrowRight size={18} weight="bold" />
        </button>
      }
    >
      {/* The existing bar, reused verbatim — only sized for a thumb. */}
      <DexCaptureBar
        size="lg"
        seedText={seed}
        onRecordingChange={onRecordingChange}
        onCaptured={() => {
          onCaptured?.();
          onClose?.();
        }}
        placeholder={t("dex.placeholder", "Tell Dex what to do…")}
      />

      <p className="mt-4 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
        {t("dex.suggestions", "Try saying")}
      </p>
      <div className="mt-2 flex flex-col gap-touch-gap">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            data-testid="dex-suggestion"
            onClick={() => setSeed(s)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {s}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

export default DexSheet;
