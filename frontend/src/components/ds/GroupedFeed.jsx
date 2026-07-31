import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Grouped feed — Overdue / Today / This week / Later.
 *
 * The header states the urgency in words and the rows carry it as a left edge.
 * Because the header already says "Overdue", rows inside a group suppress
 * their overdue badge (see ListRow): the header, the edge and a badge would be
 * the same fact three times, and that is where a feed stops informing and
 * starts alarming.
 *
 * Group headers are sticky so the urgency context survives scrolling — an
 * overdue edge means nothing if you cannot see which group you are in.
 *
 * Empty groups are dropped rather than rendered with a zero count: "Overdue 0"
 * makes the reader check something that isn't there.
 *
 * @typedef {'overdue'|'today'|'week'|'later'} GroupKey
 */

export const GROUP_LABELS = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
};

const GROUP_ORDER = ["overdue", "today", "week", "later"];

/**
 * @typedef {object} GroupHeaderProps
 * @property {GroupKey} group
 * @property {number} [count]
 *
 * @example
 * <GroupHeader group="overdue" count={3} />
 */
export function GroupHeader({ className, group, count, ...props }) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-baseline gap-2 border-b border-hairline bg-surface-sunken px-4 py-2 backdrop-blur",
        className
      )}
      {...props}
    >
      <span className="text-label text-text-secondary">{GROUP_LABELS[group] || group}</span>
      {typeof count === "number" && (
        <span data-numeric className="text-small tabular-nums text-text-tertiary">
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * @typedef {object} GroupedFeedProps
 * @property {Partial<Record<GroupKey, any[]>>} groups Items keyed by urgency.
 * @property {(item: any, group: GroupKey) => React.ReactNode} renderItem
 *   Receives the group so rows can be given `inGroup` and the matching urgency.
 * @property {React.ReactNode} [empty] Rendered when every group is empty.
 * @property {boolean} [showCounts=true]
 *
 * @example
 * <GroupedFeed
 *   groups={{ overdue: late, today: due, week: soon, later: rest }}
 *   renderItem={(t, group) => (
 *     <ListRow key={t.id} inGroup urgency={group} title={t.title} meta={t.due_label} />
 *   )}
 *   empty={<EmptyState title="Nothing due" … />}
 * />
 */
export const GroupedFeed = React.forwardRef(
  ({ className, groups = {}, renderItem, empty, showCounts = true, ...props }, ref) => {
    const present = GROUP_ORDER.filter((g) => (groups[g] || []).length > 0);

    if (!present.length) return empty || null;

    return (
      <div
        ref={ref}
        className={cn("overflow-hidden rounded-lg border border-hairline bg-surface", className)}
        {...props}
      >
        {present.map((group) => (
          <section key={group}>
            <GroupHeader group={group} count={showCounts ? groups[group].length : undefined} />
            {groups[group].map((item) => renderItem(item, group))}
          </section>
        ))}
      </div>
    );
  }
);
GroupedFeed.displayName = "GroupedFeed";
