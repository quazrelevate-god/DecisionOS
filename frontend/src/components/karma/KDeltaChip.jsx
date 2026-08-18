// KR-8 · KDeltaChip — the "+14%" / "-1 pts" grammar. Orange is worn ONLY when
// the movement is bad news (that is the accent's whole job); good or flat
// movement stays quiet ink — the reference never celebrates in colour.
import * as React from "react";
import { TrendUp, TrendDown, Minus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * @param {number}  pct        signed percentage (or points) to show
 * @param {string}  direction  "up" | "down" | "flat" (backend's own word)
 * @param {boolean} downIsBad  which way hurts (complaints: up is bad)
 * @param {string}  suffix     "%" by default; "pts" for scores
 */
export function KDeltaChip({ pct, direction = "flat", downIsBad = true, suffix = "%", className, testid }) {
  if (pct == null) return null;
  const bad = direction !== "flat" && ((direction === "down") === downIsBad);
  const Icon = direction === "up" ? TrendUp : direction === "down" ? TrendDown : Minus;
  return (
    <span
      data-testid={testid}
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold",
        bad ? "bg-kr-accent/15 text-kr-accent" : "bg-current/0 text-muted-foreground",
        className
      )}
    >
      <Icon size={12} weight="bold" aria-hidden="true" />
      {pct > 0 ? "+" : ""}{pct}{suffix}
    </span>
  );
}

export default KDeltaChip;
