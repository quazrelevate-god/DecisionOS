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
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarBlank, AddressBook, UsersThree, Sparkle, BookOpen, Gauge,
  Bell, GearSix, Translate, MoonStars, Sun, SignOut, X,
  MagnifyingGlass, ArrowRight,
} from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "./BottomSheet";

/* KM-9 — `cached()` and `useLiveLines()` were deleted here.
   They read the React Query cache so a tile could show a live figure without
   firing a request on open. The rule was right; the consequence was not — the
   cache is only warm for routes already visited, and every route in this menu
   sits BEHIND the menu, so the figures were almost never there and the three
   wide tiles rendered a skeleton that never resolved. Static descriptors now,
   and opening More touches no query at all. */

/**
 * The bento, in §5.7's order: live destinations first, occasional ones second,
 * utility last. `size` is config and never derived from the data.
 */
function buildTiles({ user, t, counts }) {
  const tiles = [
    {
      key: "crm",
      to: "/crm",
      label: t("nav.crm", "CRM"),
      icon: AddressBook,
      /* KM-7 — CRM drops from a 2x2 to the same 2x1 the other two live tiles
         use. As a `large` it was twice the height of everything else and left
         the right-hand column (Team / Journal / Work Coach) floating against
         a tall blank, so the two columns never lined up. Three equal wide
         tiles on the left now sit level with three smalls on the right. */
      size: "wide",
      perm: "people",
      blurb: "Buyers, suppliers, complaints",
    },
    { key: "team", to: "/team", label: t("nav.team", "Team"), icon: UsersThree, size: "small", perm: "team_manage" },
    {
      key: "operating-score",
      to: "/operating-score",
      // Not t("nav.ops") — that bundle says "Ops", which is jargon for a tile.
      // KM-7 — "Ops", not "Operating Score": at a 2x1 tile the long form
      // wrapped to two lines and pushed its own live figure out of the card.
      label: t("allapps.ops", "Ops"),
      icon: Gauge,
      size: "wide",
      ownerOnly: true,
      blurb: "How the business is running",
    },
    { key: "journal", to: "/journal", label: t("nav.journal", "Journal"), icon: BookOpen, size: "small", ownerOnly: true },
    {
      key: "calendar",
      to: "/calendar",
      label: t("nav.calendar", "Calendar"),
      icon: CalendarBlank,
      size: "wide",
      blurb: "Everything with a date",
    },
    { key: "coach", to: "/coach", label: t("nav.coach", "Work Coach"), icon: Sparkle, size: "small" },
    // §5.7 listed "Send Daily Digest" as a Small tile, and §8 asked for it to sit
    // nowhere near Sign out. E2-63 (2026-08-15) then deleted
    // POST /brief/send-digest outright — "the Desk itself is the brief now, so
    // this email-a-snapshot flow duplicated live data behind an SMTP gate". A
    // tile whose endpoint is gone is a button that always fails, so it goes with
    // the endpoint. Eleven entries; the search row stays hidden either way.
  ];

  return tiles.filter((tile) => {
    if (tile.ownerOnly && user?.role !== "owner") return false;
    if (tile.perm && !hasPerm(user, tile.perm)) return false;
    return true;
  });
}

function buildUtility({ user, isDark, t }) {
  /* KM-5 — Language, Theme and Sign out are gone from here and live in
     Settings -> Account. A nav menu is a list of PLACES; a theme switch and a
     session-ending action are neither, and putting Sign out one mis-tap from
     Theme in a 4-up strip was the arrangement that made it need a red colour
     to feel safe. Settings is the only utility left, so it is the only one
     listed. */
  return [
    { key: "settings", to: "/settings", label: t("nav.settings", "Settings"), icon: GearSix, ownerOnly: true },
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

  return (
    <button
      type="button"
      data-testid={`allapps-tile-${tile.key}`}
      data-size={tile.size}
      onClick={() => onPick(tile)}
      className={cn(
        // >= 100x100 per §5.7, so the 44px floor is met with room to spare.
        /* KM-8 — minimal glass, not neumorphism. .kr-pop drew a raised,
           shadowed tile; the founder wants all seven reading as one quiet set
           of glass panes on a glass sheet, so they take .kr-frost-min and are
           drawn by their hairline rather than by depth. .kr-lift stays for the
           press response. */
        "relative flex min-h-[6.25rem] flex-col kr-frost-min kr-lift rounded-tile p-3 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
        big || wide ? "justify-between" : "items-center justify-center gap-1.5",
        SPAN[tile.size] || "",
        /* KM-3 — no red. DS-1's token comment: `danger` means money or a
           deadline at risk, "never chrome, borders, sign-out". Sign out is
           terminal, not alerting, and spending the alert colour on it
           devalues it everywhere it does mean something. */
      )}
    >
      {big || wide ? (
        <>
          <span className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            <Icon size={18} weight="bold" aria-hidden="true" />
            {tile.label}
          </span>

          {/* KM-9 — a static descriptor, not a live figure. A menu tile's
              job is to say where it goes; it does not also need to report. */}
          <span className="mt-2 block text-[length:var(--text-label)] leading-4 text-muted-foreground">
            {tile.blurb}
          </span>
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
 * @param {Function} onSignOut
 * @param {Function} onOpenLanguage
 * @param {{notifications?:number}} [counts]  KM-1: myWork was never read by buildTiles.
 */
export function AllAppsPanel({
  open,
  onClose,
  user,
  isDark,
  onToggleTheme,
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

  const tiles = React.useMemo(
    () => buildTiles({ user, t, counts }),
    [user, t, counts]
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
            /* KM-8 — no darkening, no blur. The overlay stays only to catch
               the outside-tap that closes the panel; it no longer paints. The
               founder wants the app still legible behind the menu, and a
               frosted LIGHT panel already separates itself from the page
               without the page having to be dimmed to make room for it. */
            /* KM-9 — a slight dim, still no blur. Fully transparent let the
               page compete with a light panel sitting on it; 22% black settles
               the background just enough for the frosted sheet to read. */
            "fixed inset-0 z-[10080] bg-black/[0.22]",
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
            /* KM-5 — ANCHORED TO THE DOCK, not floating in the middle.
               The founder's ask: rather than a card hovering over the screen,
               the app bar should expand upward and reveal the menu. So the
               panel sits directly above the dock, matches its inset and its
               ink material, and slides up from it — it reads as the bar
               growing rather than a separate object arriving. The bottom
               offset is the dock's own anchor (1rem + safe inset) plus its
               64px height plus a 12px seam. */
            /* KM-7 — the panel IS the bar, extended upward. It takes the
               dock's own horizontal anchor (app-dock-left), its width, its
               ink and its blur, and sits directly on top of it — so opening
               More reads as the bar growing rather than a separate card
               arriving over the app. w-[17rem] is the dock's measured width
               (267px at a 375px viewport, four slots plus padding). */
            "fixed z-[10090] flex max-h-[68vh] w-[var(--app-dock-w,17rem)] flex-col overflow-hidden app-dock-left",
            "bottom-[calc(1rem+4rem+0.5rem+env(safe-area-inset-bottom,0px))]",
            /* KM-3 — THE PANEL BECOMES AN INK OBJECT.
               It was `bg-background` — the page's own greige — so More opened
               a copy of the page floating over the page, with a hard
               `border-border` frame and shadow-brutal-lg, both retired.
               Now .kr-glass (frosted, translucent, blurred) PLUS .dark, which
               KR-2 redefined to mean "inside the ink" rather than a night
               theme: it re-scopes --nm-raised, --hairline, --text-* and the
               shadcn aliases, so every .nm-raised tile and every
               text-muted-foreground inside becomes its ink counterpart with
               no `dark:` variant written anywhere. The thing More opens now
               looks like the ink pill you tapped to open it. */
            /* KM-8 — LIGHT glass, not the bar's ink. KM-7 matched the dock's
               colour so the two read as one object; the founder's call now is
               that the menu should be light and minimal, so it keeps the
               dock's WIDTH and ANCHOR (still growing out of the bar) but takes
               .kr-frost — the light-zone glass — instead of ink. The `dark`
               token re-scope goes with it, so every label inside returns to
               the light palette on its own. */
            /* focus:outline-none — the panel takes focus itself on open (see
               onOpenAutoFocus below, which moves it off the search field so
               the keyboard does not cover the grid), and the browser was
               drawing its default ring around the whole sheet. The focus trap
               still has its anchor; it just stops painting a blue rectangle
               around a menu nobody typed into. */
            "kr-frost rounded-cardlg focus:outline-none focus-visible:outline-none",

            // scale 0.92 -> 1 with opacity, ~180ms ease-out; reverse on close
            // [animation-duration:...] rather than duration-[180ms]: the
            // bare arbitrary value is ambiguous between transition- and
            // animation-duration, and Tailwind warns on it at build time.
            "[animation-duration:180ms] ease-out",
            "data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
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

          {/* KM-9 — no close button. The panel closes by tapping outside,
              by tapping More again, or by Escape; an X in a menu this small
              was a seventh thing to look at. The search row it used to live
              in was unreachable anyway — `searchable` needs more than 12
              entries and an owner has 7. */}

          <div
            data-testid="allapps-scroll"
            /* KM-9 — `flex-1` made this fill the sheet whatever the content
               needed, which is what left dead space under Settings; and
               `pb-safe` resolves to 0 with no bottom inset, so the last row
               sat flush against the edge. Sizes to content now, with a real
               12px floor plus whatever the inset adds. */
            className="min-h-0 overflow-y-auto overscroll-contain p-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom,0px))]"
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
                        "flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-control px-1",
                        "kr-frost-min focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
                        "text-muted-foreground"   /* KM-3 — see above: no red on sign out. */
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
