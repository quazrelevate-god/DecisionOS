import * as React from "react";
import { CaretDown, Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Derive initials from a display name. Two letters max — three-letter monograms
 * read as acronyms rather than people.
 * @param {string} name
 * @returns {string}
 */
export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Initials avatar. Brand tint rather than a generated per-person colour: a
 * random hue per user would put colour to work saying nothing operational,
 * which is the one thing colour is not allowed to do in this system.
 *
 * @typedef {'sm'|'md'} AvatarSize
 * @typedef {object} AvatarProps
 * @property {string} name
 * @property {AvatarSize} [size='sm']
 */
export const Avatar = React.forwardRef(({ className, name, size = "sm", ...props }, ref) => (
  <span
    ref={ref}
    aria-hidden="true"
    className={cn(
      "inline-flex items-center justify-center rounded-pill bg-primary-tint font-semibold text-primary-text shrink-0",
      size === "sm" ? "size-5 text-[10px]" : "size-7 text-[11px]",
      className
    )}
    {...props}
  >
    {initialsOf(name)}
  </span>
));
Avatar.displayName = "Avatar";

/**
 * Assignee chip — initials avatar plus name.
 *
 * Unassigned is a dashed outline rather than a filled chip, so an empty slot
 * reads as an invitation instead of a person called "Unassigned".
 *
 * @typedef {object} AssigneeChipProps
 * @property {string} [name] Person's display name.
 * @property {string} [role] Fallback when a task is assigned to a role, not a person.
 * @property {boolean} [editable=false] Renders a caret and makes the chip a button.
 * @property {() => void} [onEdit]
 * @property {boolean} [disabled=false]
 * @property {AvatarSize} [size='sm']
 *
 * @example
 * <AssigneeChip name="Prasanna Narayanan" editable onEdit={openPicker} />
 * <AssigneeChip />                       // renders the unassigned affordance
 * <AssigneeChip role="finance" />        // role-level assignment
 */
export const AssigneeChip = React.forwardRef(
  ({ className, name, role, editable = false, onEdit, disabled = false, size = "sm", ...props }, ref) => {
    const label = name || role || null;
    const Comp = editable ? "button" : "span";

    const base = cn(
      "inline-flex items-center gap-1.5 rounded-pill py-1 text-small whitespace-nowrap max-w-full",
      editable &&
        "transition-colors focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      className
    );

    if (!label) {
      return (
        <Comp
          ref={ref}
          type={editable ? "button" : undefined}
          onClick={editable ? onEdit : undefined}
          disabled={editable ? disabled : undefined}
          className={cn(
            base,
            "border border-dashed border-hairline-strong px-2 text-text-tertiary",
            editable && !disabled && "hover:border-primary hover:text-primary-text",
            disabled && "text-text-disabled border-hairline"
          )}
          {...props}
        >
          <Plus size={11} weight="bold" />
          Assign
        </Comp>
      );
    }

    return (
      <Comp
        ref={ref}
        type={editable ? "button" : undefined}
        onClick={editable ? onEdit : undefined}
        disabled={editable ? disabled : undefined}
        title={label}
        className={cn(
          base,
          "border border-hairline bg-surface pl-1 pr-2",
          disabled ? "text-text-disabled" : "text-text",
          editable && !disabled && "hover:bg-surface-hover hover:border-hairline-strong"
        )}
        {...props}
      >
        <Avatar name={label} size={size} />
        <span className="truncate">{label}</span>
        {role && !name && <span className="text-text-tertiary">(role)</span>}
        {editable && <CaretDown size={11} weight="bold" className="text-text-tertiary shrink-0" />}
      </Comp>
    );
  }
);
AssigneeChip.displayName = "AssigneeChip";

/**
 * Overlapping avatars for a set of people, with a +N overflow chip.
 *
 * @typedef {object} AssigneeStackProps
 * @property {Array<{name: string}>} people
 * @property {number} [max=3]
 * @property {AvatarSize} [size='sm']
 *
 * @example
 * <AssigneeStack people={task.watchers} max={3} />
 */
export const AssigneeStack = React.forwardRef(({ className, people = [], max = 3, size = "sm", ...props }, ref) => {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center", className)}
      title={people.map((p) => p.name).join(", ")}
      {...props}
    >
      {shown.map((p, i) => (
        <Avatar
          key={p.id || p.name || i}
          name={p.name}
          size={size}
          className={cn("ring-2 ring-surface", i > 0 && "-ml-1.5")}
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-pill bg-surface-sunken text-text-secondary font-semibold ring-2 ring-surface -ml-1.5 shrink-0",
            size === "sm" ? "size-5 text-[10px]" : "size-7 text-[11px]"
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
});
AssigneeStack.displayName = "AssigneeStack";
