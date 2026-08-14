// MPWA-03 / MPWA-12h · AllAppsPanel — the macOS-style floating grid opened by More.
//
// Replaces the mobile hamburger drawer entirely. Explicitly NOT a bottom sheet
// and NOT a side drawer (§8) — both of those are removed on mobile.
//
// MPWA-12h (§5.7) makes it a bento rather than a uniform grid. It was "13
// identical tiles under four category headings. Four headings for thirteen items
// is more chrome than content, and every tile is a dead icon-and-label."
//
// The sizing rule is the whole idea: **a tile earns its size by carrying live
// data**, not by how important it feels. "A large tile that shows a number is
// worth its space; a large tile that is just a bigger button is waste."
//
//   Large 2x2  headline number + supporting line   CRM
//   Wide  2x1  one live line                       Operating Score, Calendar
//   Small 1x1  icon + label + optional badge       the rest
//   Utility    not a tile, a 56px strip            Settings, Language, Theme, Sign out
//
// Two rules do the heavy lifting and are easy to break later, so they are stated
// here as well as in the code:
//   1. Size is fixed by CONFIG, never by whether the data arrived. A missing
//      number shows a Skeleton in a full-size tile — "a panel whose layout
//      changes between openings feels broken."
//   2. Opening the panel fires ZERO network requests. Tiles read the React Query
//      CACHE. "Opening a nav panel must never fire six API calls."
//
// Not in the grid (§8): Dex (it is the FAB), the dock destinations, and Meeting
// Notes (hidden this phase per E2-31). Nothing appears in two places.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarBlank, AddressBook, UsersThree, Sparkle, BookOpen, Gauge,
  Bell, GearSix, Translate, MoonStars, Sun, EnvelopeSimple, SignOut, X,
  MagnifyingGlass, ArrowRight,
} from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
import { inrCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "./BottomSheet";
import { SkeletonLine } from "./Skeleton";

/**
 * Read a value straight out of the query cache, never fetching.
 *
 * `getQueriesData` rather than `getQueryData`: the keys that hold this data are
 * parameterised (["contacts", status, q]), so there is no single key to ask for.
 * The freshest cached entry wins.
 */
function cached(qc, prefix) {
  const hits = qc.getQueriesData({ queryKey: prefix });
  for (let i = hits.length - 1; i >= 0; i--) {
    const [, value] = hits[i];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * The live line each large/wide tile carries, read from cache.
 *
 * Returns `undefined` for "not cached" — which renders a Skeleton, NOT a smaller
 * tile — and `null` for "cached and genuinely empty", which renders nothing.
 */
function useLiveLines() {
  const qc = useQueryClient();

  const contacts = cached(qc, ["contacts"]);
  const crm = React.useMemo(() => {
    if (contacts === undefined) return undefined;
    const list = Array.isArray(contacts) ? contacts : contacts.contacts || [];
    const owed = list.reduce((n, c) => n + (Number(c.outstanding) || 0), 0);
    return {
      headline: owed > 0 ? inrCompact(owed) : "₹0",
      support: `${list.length} relationship${list.length === 1 ? "" : "s"}`,
    };
  }, [contacts]);

  const score = cached(qc, ["operating-score"]);
  const ops = React.useMemo(() => {
    if (score === undefined) return undefined;
    const n = score?.overall_score ?? score?.score ?? null;
    return n == null ? null : { line: String(Math.round(n)), suffix: "out of 100" };
  }, [score]);

  const calendar = cached(qc, ["calendar"]);
  const cal = React.useMemo(() => {
    if (calendar === undefined) return undefined;
    const list = Array.isArray(calendar) ? calendar : calendar?.events || calendar?.items || [];
    const today = ymd(new Date());
    const n = list.filter((e) => String(e.date || e.start || e.due_date || "").slice(0, 10) === today).length;
    return { line: String(n), suffix: n === 1 ? "today" : "today" };
  }, [calendar]);

  return { crm, ops, cal };
}

/**
 * The bento, in §5.7's order: live destinations first, occasional ones second,
 * utility last. `size` is config and never derived from the data.
 */
function buildTiles({ user, t, counts, live }) {
  const tiles = [
    {
      key: "crm",
      to: "/crm",
      label: t("nav.crm", "CRM"),
      icon: AddressBook,
      size: "large",
      perm: "people",
      live: live.crm,
    },
    { key: "notifications", to: "/notifications", label: t("nav.notifications", "Notifications"), icon: Bell, size: "small", badge: counts.notifications },
    { key: "team", to: "/team", label: t("nav.team", "Team"), icon: UsersThree, size: "small", perm: "team_manage" },
    {
      key: "operating-score",
      to: "/operating-score",
      // Not t("nav.ops") — that bundle says "Ops", which is jargon for a tile.
      label: t("allapps.operating_score", "Operating Score"),
      icon: Gauge,
      size: "wide",
      ownerOnly: true,
      live: live.ops,
    },
    { key: "journal", to: "/journal", label: t("nav.journal", "Journal"), icon: BookOpen, size: "small", ownerOnly: true },
    {
      key: "calendar",
      to: "/calendar",
      label: t("nav.calendar", "Calendar"),
      icon: CalendarBlank,
      size: "wide",
      live: live.cal,
    },
    { key: "coach", to: "/coach", label: t("nav.coach", "Work Coach"), icon: Sparkle, size: "small" },
    // §8: Send Daily Digest is nowhere near Sign out. 12h puts it in the tile
    // grid and Sign out in the utility strip, so they cannot be mis-tapped for
    // each other at all.
    { key: "digest", action: "digest", label: t("header.send_digest", "Send Daily Digest"), icon: EnvelopeSimple, size: "small", ownerOnly: true },
  ];

  return tiles.filter((tile) => {
    if (tile.ownerOnly && user?.role !== "owner") return false;
    if (tile.perm && !hasPerm(user, tile.perm)) return false;
    return true;
  });
}

function buildUtility({ user, isDark, t }) {
  return [
    { key: "settings", to: "/settings", label: t("nav.settings", "Settings"), icon: GearSix, ownerOnly: true },
    { key: "language", action: "language", label: t("allapps.language", "Language"), icon: Translate },
    { key: "theme", action: "theme", label: t("allapps.theme", "Theme"), icon: isDark ? Sun : MoonStars },
    { key: "signout", action: "signout", label: t("header.sign_out", "Sign out"), icon: SignOut, danger: true },
  ].filter((x) => !x.ownerOnly || user?.role === "owner");
}

const SPAN = {
  // §5.7: 3 columns at 390px. A `wide` tile is 2x1, and the tile after it fills
  // the third cell — "when filtering leaves a hole in the bento, promote the next
  // Small tile to fill it rather than leaving a gap." grid-flow-dense does that
  // placement for us, in either direction.
  large: "col-span-2 row-span-2",
  wide: "col-span-2",
  small: "",
};

function Tile({ tile, onPick }) {
  const Icon = tile.icon;
  const big = tile.size === "large";
  const wide = tile.size === "wide";
  // undefined = not cached yet -> Skeleton in a full-size tile (§5.7).
  const pending = (big || wide) && tile.live === undefined;

  return (
    <button
      type="button"
      data-testid={`allapps-tile-${tile.key}`}
      data-size={tile.size}
      onClick={() => onPick(tile)}
      className={cn(
        // >= 100x100 per §5.7, so the 44px floor is met with room to spare.
        "relative flex min-h-[6.25rem] flex-col rounded-xl border border-border bg-card p-3 text-left",
        "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        big || wide ? "justify-between" : "items-center justify-center gap-1.5",
        SPAN[tile.size] || "",
        tile.danger && "text-danger-700"
      )}
    >
      {big || wide ? (
        <>
          <span className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            <Icon size={18} weight="bold" aria-hidden="true" />
            {tile.label}
          </span>

          {pending ? (
            <span className="mt-2 block w-2/3" data-testid={`allapps-skeleton-${tile.key}`}>
              <SkeletonLine className="h-7" />
            </span>
          ) : tile.live ? (
            <span className={cn("mt-2 flex min-w-0 items-baseline gap-1.5", wide && "justify-between")}>
              <span className="font-heading text-2xl font-bold leading-none tabular-nums">
                {tile.live.headline ?? tile.live.line}
              </span>
              {(tile.live.support || tile.live.suffix) && (
                <span className="min-w-0 truncate text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                  {tile.live.support || tile.live.suffix}
                </span>
              )}
            </span>
          ) : (
            // Cached and genuinely empty. The tile keeps its size and says where
            // it goes rather than showing a number that is not there.
            <span className="mt-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
              Open
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </span>
          )}
        </>
      ) : (
        <>
          <Icon size={26} weight="regular" aria-hidden="true" />
          <span className="text-center text-[length:var(--text-label)] font-semibold leading-4 line-clamp-2">
            {tile.label}
          </span>
        </>
      )}

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

  const live = useLiveLines();
  const tiles = React.useMemo(
    () => buildTiles({ user, t, counts, live }),
    [user, t, counts, live]
  );
  const utility = React.useMemo(() => buildUtility({ user, isDark, t }), [user, isDark, t]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? tiles.filter((x) => x.label.toLowerCase().includes(needle)) : tiles;
  const shownUtility = needle
    ? utility.filter((x) => x.label.toLowerCase().includes(needle))
    : utility;

  // §5.7: "Search: render it only when tile count exceeds what fits without
  // scrolling (> 12). Below that it is a row of chrome above content the user
  // can already see." Twelve destinations, and the bento shows them all.
  const searchable = tiles.length + utility.length > 12;

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
            // [animation-duration:...] rather than duration-[180ms]: the
            // bare arbitrary value is ambiguous between transition- and
            // animation-duration, and Tailwind warns on it at build time.
            "[animation-duration:180ms] ease-out",
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

          {searchable ? (
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
          ) : (
            // No search row to hang it on, so the close button gets its own.
            <div className="flex shrink-0 justify-end p-2 pb-0">
              <DialogPrimitive.Close
                data-testid="allapps-close"
                aria-label={t("common.close", "Close")}
                className="grid shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ minHeight: "var(--control-h-sm)", minWidth: "var(--control-h-sm)" }}
              >
                <X size={22} weight="bold" />
              </DialogPrimitive.Close>
            </div>
          )}

          <div
            data-testid="allapps-scroll"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-safe"
          >
            {shown.length === 0 && shownUtility.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground" data-testid="allapps-no-match">
                {t("allapps.no_match", "Nothing matches that.")}
              </p>
            )}

            {/* §5.7: "Drop the visible category headings… Keep them as
                aria-labelledby group semantics — removing a visual heading must
                not remove the structure for screen readers." */}
            {shown.length > 0 && (
              <section aria-labelledby="allapps-h-destinations" data-testid="allapps-group-destinations">
                <h3 id="allapps-h-destinations" className="sr-only">
                  {t("allapps.destinations", "Screens")}
                </h3>
                <div className="grid auto-rows-[6.25rem] grid-flow-row-dense grid-cols-3 gap-3">
                  {shown.map((tile) => (
                    <Tile key={tile.key} tile={tile} onPick={pick} />
                  ))}
                </div>
              </section>
            )}

            {/* §5.7's utility strip: 56px, hairline-separated, icon + 13px label,
                horizontally distributed. Sign out last, in danger text. */}
            {shownUtility.length > 0 && (
              <section
                aria-labelledby="allapps-h-utility"
                data-testid="allapps-utility"
                className="mt-3 border-t border-border pt-2"
              >
                <h3 id="allapps-h-utility" className="sr-only">
                  {t("allapps.account", "Account")}
                </h3>
                <div className="flex items-stretch justify-between gap-1">
                  {shownUtility.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      data-testid={`allapps-tile-${item.key}`}
                      onClick={() => pick(item)}
                      className={cn(
                        "flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1",
                        "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        item.danger ? "text-danger-700" : "text-muted-foreground"
                      )}
                    >
                      <item.icon size={20} weight="bold" aria-hidden="true" />
                      <span className="text-center text-[length:var(--text-label)] font-semibold leading-4 line-clamp-1">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default AllAppsPanel;
