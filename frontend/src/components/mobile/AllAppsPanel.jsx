// MPWA-03 · AllAppsPanel — the macOS-style floating grid opened by More.
//
// Replaces the mobile hamburger drawer entirely. Explicitly NOT a bottom sheet
// and NOT a side drawer (§8) — both of those are removed on mobile.
//
// Not in the grid (§8): Dex (it is the FAB), the three dock destinations, and
// Meeting Notes (hidden this phase per E2-31). Nothing appears in two places.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Briefcase, CalendarBlank, AddressBook, UsersThree, Sparkle, BookOpen, Gauge,
  Bell, GearSix, Translate, MoonStars, Sun, EnvelopeSimple, SignOut, X,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "./BottomSheet";

/**
 * The grid, in §8's order. `perm`/`ownerOnly` reuse Layout's existing filter
 * semantics — owner-only tiles are hidden, never greyed out (§8 footnote 2).
 */
function buildGroups({ user, isDark, t, counts }) {
  const groups = [
    {
      key: "work",
      label: t("allapps.work", "Work"),
      tiles: [
        { key: "my-work", to: "/my-work", label: t("nav.mywork", "My Work"), icon: Briefcase, badge: counts.myWork },
        { key: "calendar", to: "/calendar", label: t("nav.calendar", "Calendar"), icon: CalendarBlank },
      ],
    },
    {
      key: "people",
      label: t("allapps.people", "People"),
      tiles: [
        { key: "crm", to: "/crm", label: t("nav.crm", "CRM"), icon: AddressBook, perm: "people" },
        { key: "team", to: "/team", label: t("nav.team", "Team"), icon: UsersThree, perm: "team_manage" },
      ],
    },
    {
      key: "insight",
      label: t("allapps.insight", "Insight"),
      tiles: [
        { key: "coach", to: "/coach", label: t("nav.coach", "Work Coach"), icon: Sparkle },
        { key: "journal", to: "/journal", label: t("nav.journal", "Journal"), icon: BookOpen, ownerOnly: true },
        // Not t("nav.ops") — that bundle says "Ops", which is jargon for a
        // tile. §5.4 wants business language on screen.
        { key: "operating-score", to: "/operating-score", label: t("allapps.operating_score", "Operating Score"), icon: Gauge, ownerOnly: true },
      ],
    },
    {
      key: "account",
      label: t("allapps.account", "Account"),
      tiles: [
        { key: "notifications", to: "/notifications", label: t("nav.notifications", "Notifications"), icon: Bell, badge: counts.notifications },
        { key: "settings", to: "/settings", label: t("nav.settings", "Settings"), icon: GearSix, ownerOnly: true },
        { key: "language", action: "language", label: t("allapps.language", "Language"), icon: Translate },
        // §8: Send Daily Digest sits in Account but NOT next to Sign out —
        // Theme is deliberately between them. Two high-consequence actions
        // side by side is how mis-taps happen.
        { key: "digest", action: "digest", label: t("header.send_digest", "Send Daily Digest"), icon: EnvelopeSimple, ownerOnly: true },
        { key: "theme", action: "theme", label: t("allapps.theme", "Theme"), icon: isDark ? Sun : MoonStars },
        { key: "signout", action: "signout", label: t("header.sign_out", "Sign out"), icon: SignOut, danger: true },
      ],
    },
  ];

  return groups
    .map((g) => ({
      ...g,
      tiles: g.tiles.filter((tile) => {
        if (tile.ownerOnly && user?.role !== "owner") return false;
        if (tile.perm && !hasPerm(user, tile.perm)) return false;
        return true;
      }),
    }))
    .filter((g) => g.tiles.length > 0);
}

function Tile({ tile, onPick }) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      data-testid={`allapps-tile-${tile.key}`}
      onClick={() => onPick(tile)}
      className={cn(
        // >= 88x88 per §8; aspect-square keeps the grid regular at any width.
        "relative flex min-h-[5.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-1.5 py-2",
        "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tile.danger && "text-danger-700"
      )}
    >
      <Icon size={28} weight="regular" aria-hidden="true" />
      <span className="text-center text-[length:var(--text-label)] font-semibold leading-4 line-clamp-2">
        {tile.label}
      </span>
      {tile.badge > 0 && (
        <span
          data-testid={`allapps-badge-${tile.key}`}
          aria-label={`${tile.badge} need you`}
          className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-pill bg-danger-600 px-1 text-[length:var(--text-label)] font-bold leading-none text-white"
        >
          {Math.min(9, tile.badge)}
        </span>
      )}
    </button>
  );
}

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {object}   user
 * @param {boolean}  isDark
 * @param {Function} onToggleTheme
 * @param {Function} onSendDigest
 * @param {Function} onSignOut
 * @param {Function} onOpenLanguage
 * @param {{myWork?:number,notifications?:number}} [counts]
 */
export function AllAppsPanel({
  open,
  onClose,
  user,
  isDark,
  onToggleTheme,
  onSendDigest,
  onSignOut,
  onOpenLanguage,
  counts = {},
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");

  useBodyScrollLock(open);

  // Reset the query each time it opens — he is usually looking for something
  // different than last time.
  React.useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const groups = React.useMemo(
    () => buildGroups({ user, isDark, t, counts }),
    [user, isDark, t, counts]
  );

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? groups
        .map((g) => ({ ...g, tiles: g.tiles.filter((x) => x.label.toLowerCase().includes(needle)) }))
        .filter((g) => g.tiles.length)
    : groups;

  const pick = (tile) => {
    if (tile.to) {
      onClose?.();
      navigate(tile.to);
      return;
    }
    switch (tile.action) {
      case "theme":
        // Stay open: theme is a thing you look at while toggling.
        onToggleTheme?.();
        break;
      case "language":
        onClose?.();
        onOpenLanguage?.();
        break;
      case "digest":
        onClose?.();
        onSendDigest?.();
        break;
      case "signout":
        onClose?.();
        onSignOut?.();
        break;
      default:
        onClose?.();
    }
  };

  // Swipe down to dismiss (§8 lists it alongside backdrop tap, Escape and the
  // close button). Vertical intent only, and never while the grid is scrolled.
  const touch = React.useRef(null);
  const onTouchStart = (e) => {
    const el = e.currentTarget.querySelector('[data-testid="allapps-scroll"]');
    touch.current = { y: e.touches[0].clientY, atTop: (el?.scrollTop ?? 0) <= 0 };
  };
  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start?.atTop) return;
    if (e.changedTouches[0].clientY - start.y > 70) onClose?.();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogPrimitive.Portal>
        {/* Full-bleed blurred backdrop, neutral ~55% — never tinted (§8). */}
        <DialogPrimitive.Overlay
          data-testid="allapps-backdrop"
          className={cn(
            "fixed inset-0 z-[10080] bg-neutral-900/55 backdrop-blur-[20px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          data-testid="allapps-panel"
          // §8: "Autofocus off — he usually taps, not types." Radix focuses the
          // first focusable child on open, which is the search field, and that
          // pops the keyboard over half the grid. Move focus to the panel
          // itself so the trap still has an anchor.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            e.currentTarget?.focus?.();
          }}
          tabIndex={-1}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className={cn(
            // inset 16px from every edge, max-height 80vh (§8)
            "fixed inset-x-4 z-[10090] mx-auto flex max-h-[80vh] max-w-md flex-col overflow-hidden",
            "rounded-2xl border border-border bg-background shadow-brutal-lg",
            "top-1/2 -translate-y-1/2",
            // scale 0.92 -> 1 with opacity, ~180ms ease-out; reverse on close
            "duration-[180ms] ease-out",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-[0.92] data-[state=closed]:zoom-out-[0.92]"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("allapps.title", "All apps")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("allapps.description", "Every screen, grouped")}
          </DialogPrimitive.Description>

          {/* Search pinned to the panel top. Autofocus OFF — he usually taps. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
            <div className="relative flex-1">
              <MagnifyingGlass
                size={20}
                weight="bold"
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="text"
                inputMode="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                data-testid="allapps-search"
                aria-label={t("allapps.search", "Search screens")}
                placeholder={t("allapps.search", "Search screens")}
                className="w-full rounded-lg border border-input bg-card pl-10 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ minHeight: "var(--control-h-base)" }}
              />
            </div>
            <DialogPrimitive.Close
              data-testid="allapps-close"
              aria-label={t("common.close", "Close")}
              className="grid shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ minHeight: "var(--control-h-base)", minWidth: "var(--control-h-base)" }}
            >
              <X size={22} weight="bold" />
            </DialogPrimitive.Close>
          </div>

          <div
            data-testid="allapps-scroll"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-safe"
          >
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground" data-testid="allapps-no-match">
                {t("allapps.no_match", "Nothing matches that.")}
              </p>
            )}
            {filtered.map((g) => (
              <section key={g.key} className="mb-4 last:mb-0" data-testid={`allapps-group-${g.key}`}>
                <h3 className="mb-2 px-1 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                  {g.label}
                </h3>
                {/* 3 columns at 390px, 4 at >= 480px; gap 12px (§8) */}
                <div className="grid grid-cols-3 gap-3 min-[480px]:grid-cols-4">
                  {g.tiles.map((tile) => (
                    <Tile key={tile.key} tile={tile} onPick={pick} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default AllAppsPanel;
