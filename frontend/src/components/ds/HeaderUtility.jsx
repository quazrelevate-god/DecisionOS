import * as React from "react";
import { Bell, Sun, Moon, Translate, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { IconButton, Button } from "./Button";

/**
 * The header's utility cluster: language, theme, notifications.
 *
 * Everything here is tertiary. These are utilities, not the work — the moment
 * one of them becomes a solid fill it outranks the page's actual primary, which
 * is exactly what happened on the Decision Desk before Phase 2.
 */

/**
 * Notification bell with a CAPPED, RESOLVABLE count.
 *
 * A permanent "99+" is a UI that has given up: the number stops being
 * actionable, so people stop reading it, and the badge becomes decoration that
 * happens to be red. Two rules keep it honest:
 *
 *   1. The count is capped for display (default 9+) — beyond a handful the
 *      exact number changes nothing about what you do next.
 *   2. `onResolveAll` is required whenever the cap is exceeded, so there is
 *      always a way back to zero. A count you cannot clear is not a count.
 *
 * @typedef {object} NotificationBellProps
 * @property {number} count
 * @property {number} [cap=9] Above this the badge shows "{cap}+".
 * @property {() => void} onOpen
 * @property {() => void} [onResolveAll] Required once count exceeds cap.
 * @property {string} [resolveLabel='Mark all read']
 *
 * @example
 * <NotificationBell count={unread} onOpen={openPanel} onResolveAll={markAllRead} />
 */
export const NotificationBell = React.forwardRef(
  ({ className, count = 0, cap = 9, onOpen, onResolveAll, resolveLabel = "Mark all read", ...props }, ref) => {
    const over = count > cap;
    const display = over ? `${cap}+` : String(count);

    if (process.env.NODE_ENV !== "production" && over && !onResolveAll) {
      console.warn(
        "[NotificationBell] count exceeds the cap but no onResolveAll was given — " +
          "that is how a badge becomes a permanent unclearable number."
      );
    }

    return (
      <div className={cn("flex items-center gap-1", className)}>
        <span className="relative inline-flex">
          <IconButton ref={ref} label={count ? `Notifications, ${count} unread` : "Notifications"} icon={<Bell />} onClick={onOpen} {...props} />
          {count > 0 && (
            <span
              data-numeric
              aria-hidden="true"
              className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-pill bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
            >
              {display}
            </span>
          )}
        </span>
        {over && onResolveAll && (
          <Button variant="tertiary" size="sm" onClick={onResolveAll}>
            {resolveLabel}
          </Button>
        )}
      </div>
    );
  }
);
NotificationBell.displayName = "NotificationBell";

/**
 * Theme toggle. Shows the theme you would switch TO, which is the choice being
 * offered — showing the current theme makes people guess what the button does.
 *
 * @typedef {object} ThemeToggleProps
 * @property {boolean} isDark
 * @property {() => void} onToggle
 *
 * @example
 * <ThemeToggle isDark={isDark} onToggle={toggle} />
 */
export const ThemeToggle = React.forwardRef(({ isDark, onToggle, ...props }, ref) => (
  <IconButton
    ref={ref}
    label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    icon={isDark ? <Sun /> : <Moon />}
    onClick={onToggle}
    {...props}
  />
));
ThemeToggle.displayName = "ThemeToggle";

/**
 * Language switch. Each language is written in its own script — a user looking
 * for Tamil is looking for தமிழ், not for the English word "Tamil".
 *
 * @typedef {object} LanguageOption
 * @property {string} value
 * @property {string} label Native-script name.
 *
 * @typedef {object} LanguageSwitchProps
 * @property {LanguageOption[]} options
 * @property {string} value
 * @property {(next: string) => void} onValueChange
 *
 * @example
 * <LanguageSwitch value={lang} onValueChange={setLang}
 *   options={[{ value: "en", label: "English" }, { value: "ta", label: "தமிழ்" }]} />
 */
export const LanguageSwitch = React.forwardRef(({ className, options = [], value, onValueChange, ...props }, ref) => {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn("relative", className)} {...props}>
      <IconButton
        label={current ? `Language: ${current.label}` : "Language"}
        icon={<Translate />}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-1 min-w-40 overflow-hidden rounded-md border border-hairline bg-surface-raised shadow-md"
        >
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onValueChange?.(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-body transition-colors",
                  "focus-visible:outline-none focus-visible:bg-surface-hover",
                  o.value === value ? "text-primary-text" : "text-text hover:bg-surface-hover"
                )}
              >
                {o.label}
                {o.value === value && <Check size={13} weight="bold" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
LanguageSwitch.displayName = "LanguageSwitch";

/**
 * Container for the cluster. Exists so the spacing and the "everything here is
 * tertiary" rule live in one place instead of being re-decided per header.
 *
 * @example
 * <HeaderUtility>
 *   <LanguageSwitch … /><ThemeToggle … /><NotificationBell … />
 * </HeaderUtility>
 */
export const HeaderUtility = React.forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
));
HeaderUtility.displayName = "HeaderUtility";
