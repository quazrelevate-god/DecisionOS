import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Left sidebar navigation.
 *
 * Active is an indigo tint with indigo text — brand marks where you are, which
 * is one of the three things brand is for. It is never a solid indigo slab:
 * navigation is not an action, and a filled item would compete with the page's
 * one primary.
 *
 * Item counts are neutral, not red. A count is "there are four of these", not
 * "something is wrong" — the only exception is an explicitly overdue count,
 * which is the one place a nav badge earns danger.
 *
 * Disabled items stay visible rather than being hidden: a permission you do not
 * have is information, and a menu that silently changes shape between users is
 * harder to learn.
 */

/**
 * @typedef {object} NavItem
 * @property {string} key
 * @property {string} label
 * @property {React.ReactNode} [icon]
 * @property {number} [count] Neutral badge, e.g. items awaiting review.
 * @property {number} [overdueCount] Danger badge — reserved for genuinely late work.
 * @property {boolean} [disabled]
 * @property {string} [disabledReason] Becomes the title attribute.
 *
 * @typedef {object} SidebarNavProps
 * @property {NavItem[]} items
 * @property {string} activeKey
 * @property {(item: NavItem) => void} onSelect
 * @property {React.ReactNode} [header]
 * @property {React.ReactNode} [footer]
 *
 * @example
 * <SidebarNav
 *   items={[{ key: "inbox", label: "Decision Desk", icon: <Tray />, count: 3 }]}
 *   activeKey="inbox"
 *   onSelect={(item) => navigate(item.key)}
 * />
 */
export const SidebarNav = React.forwardRef(({ className, items = [], activeKey, onSelect, header, footer, ...props }, ref) => (
  <nav
    ref={ref}
    aria-label="Main"
    className={cn("flex h-full flex-col border-r border-hairline bg-surface", className)}
    {...props}
  >
    {header && <div className="border-b border-hairline p-4">{header}</div>}

    <ul className="min-h-0 flex-1 overflow-y-auto p-2">
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <li key={item.key}>
            <button
              type="button"
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect?.(item)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-body transition-colors",
                "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                active
                  ? "bg-primary-tint font-medium text-primary-text"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text",
                item.disabled && "pointer-events-none text-text-disabled"
              )}
            >
              {item.icon && (
                <span className={cn("[&_svg]:size-5 shrink-0", active && "text-primary-text")}>{item.icon}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>

              {typeof item.overdueCount === "number" && item.overdueCount > 0 && (
                <span
                  data-numeric
                  title={`${item.overdueCount} overdue`}
                  className="inline-flex min-w-5 items-center justify-center rounded-pill bg-status-overdue-bg px-1.5 text-badge font-semibold tabular-nums text-status-overdue-fg"
                >
                  {item.overdueCount}
                </span>
              )}
              {typeof item.count === "number" && item.count > 0 && (
                <span
                  data-numeric
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-pill px-1.5 text-badge font-semibold tabular-nums",
                    active ? "bg-primary text-primary-foreground" : "bg-surface-sunken text-text-secondary"
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>

    {footer && <div className="border-t border-hairline p-4">{footer}</div>}
  </nav>
));
SidebarNav.displayName = "SidebarNav";
