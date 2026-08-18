// KR-8 · WideStatCard — the reference's "Net Worth $137,036" pair: a wide
// white card, chip top-left (orange alert on the troubled one), arrow
// top-right, label bottom-left, the money bottom-right at lg scale.
// Same whole-card-is-the-link rule as StatTile.
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { IconChip } from "./IconChip";
import { BigNumeral } from "./BigNumeral";

export function WideStatCard({ icon, alert = false, label, value, urgent = false, to, className, testid }) {
  return (
    <Link
      to={to}
      data-testid={testid}
      className={cn(
        "kr-lift nm-tile flex flex-col p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <IconChip icon={icon} alert={alert} />
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-kr-ink text-white">
          <ArrowRight size={18} weight="bold" className="kr-arrow transition-transform duration-200" />
        </span>
      </div>
      <div className="mt-6 flex items-end justify-between gap-4">
        <span className="text-sm leading-snug text-muted-foreground">{label}</span>
        <BigNumeral text={value} size="lg" accent={urgent} />
      </div>
    </Link>
  );
}

export default WideStatCard;
