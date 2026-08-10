import { useRef, useState } from "react";
import { ArrowClockwise, Check, Eye, X } from "@phosphor-icons/react";

import { cn } from "../lib/utils";

/* ============================================================================
   Gesture components — see src/lib/gestures.js for the hook layer and the
   philosophy (gestures accelerate, taps remain).
   ========================================================================== */

const TONE_BG = {
  primary: "bg-primary text-primary-foreground",
  gold: "bg-brand-gold text-brand-ink",
  danger: "bg-destructive text-destructive-foreground",
  success: "bg-success text-success-foreground",
  neutral: "bg-foreground text-background",
};

/**
 * A row with mail-style swipe actions. Drag right to reveal the primary
 * action, left to reveal the secondary; release past the threshold to commit.
 * The row's tap behaviour is untouched — swiping is the fast path.
 */
export function SwipeRow({
  children,
  onLeft,
  onRight,
  leftLabel = "Dismiss",
  rightLabel = "View",
  leftIcon: LeftIcon = X,
  rightIcon: RightIcon = Eye,
  leftTone = "danger",
  rightTone = "gold",
  testid,
  className,
}) {
  const [dx, setDx] = useState(0);
  const s = useRef(null);
  const engaged = useRef(false);
  const THRESH = 70;
  const MAX = 110;

  const start = (e) => {
    const t = e.touches[0];
    s.current = { x: t.clientX, y: t.clientY };
    engaged.current = false;
  };
  const move = (e) => {
    if (!s.current) return;
    const t = e.touches[0];
    let d = t.clientX - s.current.x;
    const dy = t.clientY - s.current.y;
    if (!engaged.current) {
      if (Math.abs(d) < Math.abs(dy) || Math.abs(d) < 10) return;
      engaged.current = true;
    }
    // Once this row owns the horizontal drag, ancestors (edge-swipe drawer,
    // view paging) must not also interpret it.
    e.stopPropagation();
    if (!onRight && d > 0) d = 0;
    if (!onLeft && d < 0) d = 0;
    setDx(Math.max(-MAX, Math.min(MAX, d)));
  };
  const end = () => {
    if (dx >= THRESH && onRight) onRight();
    else if (dx <= -THRESH && onLeft) onLeft();
    setDx(0);
    s.current = null;
    engaged.current = false;
  };

  const committedR = dx >= THRESH;
  const committedL = dx <= -THRESH;

  return (
    <div
      className={cn("relative overflow-hidden rounded-xl border border-border", className)}
      data-testid={testid}
    >
      {onRight && (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 flex items-center gap-1.5 px-5 text-xs font-semibold",
            TONE_BG[rightTone],
            committedR ? "opacity-100" : "opacity-80"
          )}
          style={{ opacity: dx > 8 ? undefined : 0 }}
        >
          <RightIcon size={16} weight="bold" /> {committedR ? `Release · ${rightLabel}` : rightLabel}
        </div>
      )}
      {onLeft && (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 right-0 flex items-center gap-1.5 px-5 text-xs font-semibold",
            TONE_BG[leftTone],
            committedL ? "opacity-100" : "opacity-80"
          )}
          style={{ opacity: dx < -8 ? undefined : 0 }}
        >
          {committedL ? `Release · ${leftLabel}` : leftLabel} <LeftIcon size={16} weight="bold" />
        </div>
      )}
      <div
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        className="relative bg-card"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? "transform .2s cubic-bezier(0.16,1,0.3,1)" : "none",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Feed-style pull-to-refresh. Native browser overscroll is disabled app-wide
 * (overscroll-behavior in index.css), so at scroll-top a downward drag maps
 * onto a gold indicator; release past the threshold to run `onRefresh`.
 */
export function PullToRefresh({ onRefresh, children, disabled = false, className }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef(null);
  const THRESH = 64;

  const onTouchStart = (e) => {
    if (disabled || busy) return;
    if (window.scrollY > 2) return;
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    if (startY.current == null || busy) return;
    if (window.scrollY > 2) {
      startY.current = null;
      setPull(0);
      return;
    }
    const dy = e.touches[0].clientY - startY.current;
    setPull(dy > 0 ? Math.min(dy * 0.45, 88) : 0);
  };
  const onTouchEnd = async () => {
    const commit = pull >= THRESH;
    startY.current = null;
    if (commit && !busy) {
      setBusy(true);
      setPull(44); // hold the indicator while refreshing
      if (navigator.vibrate) navigator.vibrate(8);
      try {
        await onRefresh?.();
      } finally {
        setBusy(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  };

  const active = pull > 0 || busy;

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={cn("relative", className)}
    >
      <div
        aria-hidden={!busy}
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{ opacity: active ? 1 : 0, transform: `translateY(${Math.max(pull - 40, 0)}px)` }}
      >
        <span
          className={cn(
            "mt-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md",
            busy ? "text-primary" : pull >= THRESH ? "text-primary" : "text-muted-foreground"
          )}
        >
          <ArrowClockwise
            size={17}
            weight="bold"
            className={busy ? "animate-spin" : undefined}
            style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
          <span className="sr-only">{busy ? "Refreshing" : "Pull to refresh"}</span>
        </span>
      </div>
      <div
        style={{
          transform: active ? `translateY(${pull}px)` : undefined,
          transition: startY.current == null ? "transform .25s cubic-bezier(0.16,1,0.3,1)" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Small mobile-only hint line for teaching a gesture. Renders nothing on lg+. */
export function GestureHint({ children, className }) {
  return (
    <p className={cn("label-mono flex items-center gap-1.5 text-muted-foreground/80 lg:hidden", className)}>
      <Check size={11} weight="bold" className="text-primary" aria-hidden="true" />
      {children}
    </p>
  );
}
