// MPWA-12b · Strip block (§3).
//
// 56px, thin horizontal scroll of pills — "coming up", "cleared today",
// scope/filter chips. SECONDARY CONTENT ONLY.
//
// This is the one block allowed to scroll horizontally, so it carries §5.2.2's
// obligation: a fade mask and a deliberately peeking item, never a silent clip.
// `wrap` is offered for the cases the base spec insists must wrap instead (§5.2.1
// filter chips) — the shape is the same, the overflow behaviour is the choice.
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * @param {Array<{key,label,count,icon,active,onSelect,tone}>} items
 * @param {boolean} [wrap]     wrap instead of scroll (§5.2.1)
 * @param {boolean} [sticky]   pin to the top of the scroll area (scope control)
 * @param {string}  [label]    accessible name for the group
 * @param {string}  [progress] sets data-progress — use for the L3 element
 */
export function Strip({
  items = [],
  wrap = false,
  sticky = false,
  label,
  progress,
  className,
  children,
  "data-testid": testId = "block-strip",
}) {
  if (!items.length && !children) return null;

  const pill = (it) => {
    const Icon = it.icon;
    const tone = it.tone || "default";
    return (
      <button
        key={it.key}
        type="button"
        onClick={it.onSelect}
        disabled={!it.onSelect}
        aria-pressed={it.onSelect ? !!it.active : undefined}
        data-testid={`${testId}-${it.key}`}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold transition-colors",
          !it.onSelect && "cursor-default",
          it.active
            ? "border-transparent bg-primary text-primary-foreground"
            : tone === "success"
              ? "border-success-200 bg-success-50 text-success-800 dark:border-success-800 dark:bg-success-900/30 dark:text-success-100"
              : tone === "danger"
                ? "border-danger-200 bg-danger-50 text-danger-800 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-100"
                : "border-border bg-card hover:bg-accent"
        )}
        style={{ minHeight: "var(--control-h-sm)" }}
      >
        {Icon && <Icon size={18} weight={it.active ? "fill" : "regular"} aria-hidden="true" />}
        {it.label}
        {it.count != null && (
          <span
            className={cn(
              "rounded-pill px-1.5 text-[length:var(--text-label)] font-bold leading-5 tabular-nums",
              it.active ? "bg-white/25" : "bg-neutral-100 dark:bg-neutral-700"
            )}
          >
            {it.count}
          </span>
        )}
        {it.trailing}
      </button>
    );
  };

  return (
    <section
      data-block="strip"
      data-testid={testId}
      {...(progress ? { "data-progress": progress } : {})}
      aria-label={label}
      className={cn(
        "mb-3",
        sticky && "sticky top-0 z-10 -mx-4 bg-background/90 px-4 py-2 backdrop-blur",
        className
      )}
    >
      {wrap ? (
        <div className="flex flex-wrap gap-touch-gap">{items.map(pill)}{children}</div>
      ) : (
        // §5.2.2: a scrolling strip gets a fade mask so the edge reads as
        // continuable, and the gutter-cancelling margins let the last pill peek.
        <div
          className="-mx-4 overflow-x-auto px-4"
          style={{
            maskImage: "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 28px), transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 28px), transparent 100%)",
            overscrollBehaviorX: "contain",
          }}
        >
          <div className="flex w-max gap-touch-gap pr-6">{items.map(pill)}{children}</div>
        </div>
      )}
    </section>
  );
}

export default Strip;
