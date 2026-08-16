// MPWA-12b · Verdict block (§3).
//
// 180–240px, full-bleed tinted surface, radius-xl on the BOTTOM corners only —
// it reads as the top of the screen rather than a card floating on it. Max 1 per
// screen, always first.
//
// This is the block that fixes §1's "one block shape, repeated": everything else
// on a screen is ~80px of white rounded rectangle, so a single tall tinted
// surface is what creates the rhythm the base spec never asked for.
import * as React from "react";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// Tone carries the meaning, and §3.1's ramps keep their one job each: danger is
// money or a deadline at risk, success is settled/on track, caution is waiting
// on him, brand is the action to take (so it is NEVER a tone here — the action
// is the button).
const TONES = {
  danger: "bg-danger-50 text-danger-900 border-danger-200 dark:bg-danger-900/25 dark:text-danger-100 dark:border-danger-800",
  caution: "bg-caution-50 text-caution-900 border-caution-200 dark:bg-caution-900/25 dark:text-caution-100 dark:border-caution-800",
  success: "bg-success-50 text-success-900 border-success-200 dark:bg-success-900/25 dark:text-success-100 dark:border-success-800",
  neutral: "bg-neutral-100 text-neutral-900 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:border-neutral-700",
};

const ACTION_TONES = {
  danger: "bg-danger-600 text-white hover:bg-danger-700",
  caution: "bg-caution-600 text-white hover:bg-caution-700",
  success: "bg-success-600 text-white hover:bg-success-700",
  neutral: "bg-primary text-primary-foreground hover:opacity-95",
};

/**
 * @param {string}   headline    the one sentence that matters
 * @param {string}   [eyebrow]   small label above it (greeting, scope)
 * @param {ReactNode} [detail]   the record this verdict is about — the fire card
 *                               lives INSIDE the hero (§5.1), not below it
 * @param {ReactNode} [aside]    sparkline or similar, right-aligned in the head
 * @param {{label,onClick}} [action]
 * @param {'danger'|'caution'|'success'|'neutral'} [tone]
 */
export function Verdict({
  headline,
  eyebrow,
  detail,
  aside,
  action,
  tone = "neutral",
  className,
  children,
  "data-testid": testId = "block-verdict",
}) {
  return (
    <section
      data-block="verdict"
      data-testid={testId}
      className={cn(
        // Full-bleed: cancel the page gutter so the tint reaches both edges,
        // then restore it inside. -mt cancels main's top padding so the surface
        // starts at the header.
        "-mx-4 -mt-4 mb-3 border-b px-4 pb-4 pt-4",
        "rounded-b-2xl",
        TONES[tone] || TONES.neutral,
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="text-[length:var(--text-label)] font-semibold leading-4 opacity-70">
              {eyebrow}
            </p>
          )}
          {/* §3 puts a Verdict at 180-240px. The AI finance sentence can run to
              25 words, which at 26px is six lines and ~500px — the hero ate the
              whole first viewport on Money. Long sentences step down a size
              rather than being clamped: losing the tail of a sentence about
              money is worse than setting it smaller. */}
          <h1
            data-testid={`${testId}-headline`}
            className={cn(
              "mt-1 font-heading font-bold tracking-tight",
              String(headline || "").length > 108
                ? "text-[1.1875rem] leading-[1.3]"
                : String(headline || "").length > 64
                  ? "text-[1.375rem] leading-[1.2]"
                  : "text-[1.625rem] leading-[1.15]"
            )}
          >
            {headline}
          </h1>
        </div>
        {aside && <div className="shrink-0 pt-1">{aside}</div>}
      </div>

      {detail && (
        // The record itself, on a raised surface so it reads as the subject of
        // the sentence above rather than a second sentence.
        <div
          data-testid={`${testId}-detail`}
          className="mt-3 rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-black/20"
        >
          {detail}
        </div>
      )}

      {children}

      {action?.label && (
        <button
          type="button"
          onClick={action.onClick}
          data-testid={`${testId}-action`}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition-colors",
            ACTION_TONES[tone] || ACTION_TONES.neutral
          )}
          style={{ minHeight: "var(--control-h-md)" }}
        >
          {action.label}
          <CaretRight size={18} weight="bold" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

export default Verdict;
