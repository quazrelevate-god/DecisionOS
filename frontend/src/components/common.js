import { StatusBadge } from "@/components/ds";
import { EmptyState as DsEmptyState } from "@/components/ds";

export function PageHeader({ eyebrow, title, children }) {
  if (!children) return null;
  return <div className="mb-6 flex flex-wrap items-center gap-2 w-full">{children}</div>;
}

/**
 * Legacy status chip, now a thin adapter over the design system's StatusBadge.
 *
 * Changing what this renders migrates 19 files without editing them, which is
 * why it goes first in the migration: the sweep gets smaller before it starts.
 *
 * Two semantic corrections come with it, and both are deliberate:
 *
 * 1. `high` priority was solid red and is now caution amber. High priority is
 *    not the same claim as overdue — red stays for danger and genuinely late
 *    work, so a list of important-but-fine tasks no longer reads as an alarm.
 * 2. Category values (owner, sales, purchase, decision, policy…) were
 *    hue-coded — red for owner, blue for decision, yellow for purchase — which
 *    spends colour on classification rather than state. They are neutral now.
 *    Colour in this system means something is happening, not what kind of
 *    thing it is.
 *
 * This component is retired once its 19 call sites are swept; until then it
 * keeps their markup working unchanged.
 */
const TONE = {
  /* Decision and task states */
  pending_approval: { status: "pending" },
  blocked: { status: "pending" },
  waiting: { status: "pending" },
  review: { status: "pending" },
  todo: { status: "directive" },
  in_progress: { status: "directive" },
  approved: { status: "completed" },
  done: { status: "completed" },
  rejected: { status: "rejected" },
  cancelled: { status: "rejected" },
  overdue: { status: "overdue" },

  /* Capture review states — waiting on a human, which is caution's job */
  needs_attention: { status: 'pending' },
  'needs attention': { status: 'pending' },
  'possible duplicate': { status: 'pending' },
  absent: { status: 'neutral' },
  Emergency: { status: 'overdue' },

  /* Priority — never red; see note above */
  high: { priority: "high" },
  medium: { priority: "medium" },
  low: { priority: "low" },
};

const STATUS_LABELS = {
  blocked: "pending approval",
};

/**
 * Chip values arrive as wire keys — "pending_approval", "in_progress". They used
 * to be rendered lowercase and CSS-uppercased into looking like labels. With
 * all-caps gone that trick is gone too, so the text has to be Title Case for
 * real rather than shouted into shape.
 */
const titleCase = (v) =>
  String(v || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function Chip({ value, className = "", ...rest }) {
  const key = String(value || "");
  // Anything not a state is a classification, and classifications get no colour.
  const tone = TONE[key] || { status: "neutral" };
  const label = titleCase(STATUS_LABELS[key] || key);

  return (
    <StatusBadge {...tone} className={className} {...rest}>
      {label}
    </StatusBadge>
  );
}

/**
 * Legacy empty state, now the design system's — and now able to carry an action.
 *
 * The old one was a dashed grey box: the visual language of "something is
 * missing". No data is not a failure, it is the state every account starts in,
 * so an empty screen should tell you what to create first and give you the
 * control to do it. Callers that pass `actionLabel`/`onAction` get an
 * onboarding prompt; the rest still get the calm version.
 */
export function EmptyState({ title, hint, icon, actionLabel, onAction, secondaryAction }) {
  return (
    <DsEmptyState
      title={title}
      description={hint}
      icon={icon}
      actionLabel={actionLabel}
      onAction={onAction}
      secondaryAction={secondaryAction}
    />
  );
}
