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
  UsersThree, BookOpen, Gauge, AirplaneTakeoff, CaretRight,
  ShieldCheck, FlowArrow, GearSix,
} from "@phosphor-icons/react";
import { hasPerm } from "@/lib/perms";
import { INK_PLATE } from "@/components/karma/glass";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "./BottomSheet";
import { useBackDismiss } from "@/hooks/useBackDismiss";

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
 *
 * ASK-40 2 — `blurb` IS GONE FROM EVERY ENTRY, not just from the markup. The
 * founder asked for the descriptions off the cards ("How the business is
 * running" and its five siblings); a field nothing renders is a field the next
 * person has to work out is dead, so it left with them. Nothing else read it —
 * the search filter matches on `label` only.
 */
function buildTiles({ user, t }) {
  const tiles = [
    /* ASK-42 B/C — APPROVALS AND WORKFLOWS ARE THE FIRST ROW. Both were views
       inside My Work, chosen from a dropdown that otherwise lists lenses on the
       task list; both replace the whole page with a different subject when
       picked, which is what a destination does and what a lens never should.
       They are pages now (/approvals, /workflows) and this is the door to them,
       side by side because that is the founder's layout.
       AND CALENDAR AND NOTIFICATIONS LEAVE. ASK-43 — the calendar is not in
       this menu at all now: "Events desk" is a pill ON the Journal page, beside
       its Timeline/Calendar control, which is what the founder meant by the two
       being one thing. The Journal tile below is the way to both.
       Notifications leaves outright: the bell is back in the Desk's own top bar
       (components/Layout.js), where a count is worth something, rather than
       behind two taps with the count on the menu that hides it. */
    {
      key: "approvals",
      to: "/approvals",
      label: t("mywork.view_approvals", "Approvals"),
      icon: ShieldCheck,
      // The same gate the page itself uses (MyWork's showApprovalsView).
      perm: "approvals",
    },
    { key: "workflows", to: "/workflows", label: t("nav.workflows", "Workflows"), icon: FlowArrow, perm: "workflows" },
    { key: "journal", to: "/journal", label: t("nav.journal", "Journal"), icon: BookOpen, ownerOnly: true },
    /* GL-02 (JOURNEY-1 J9p-01..03, J10-03) — OPS IS NOT OWNER-ONLY. The page
       behind it has never been: /operating-score is Protected with no
       permission, so anybody signed in may open it, and on a laptop anybody
       can. This tile was the phone's only door to it and it was shut, which is
       how a team member ended up looking at a score dial on their Desk with no
       way to find out what it meant. */
    {
      key: "operating-score",
      to: "/operating-score",
      // Not t("nav.ops") — that bundle says "Ops", which is jargon for a tile.
      label: t("allapps.ops", "Ops"),
      icon: Gauge,
    },
    // RBAC P1 (2026-09-15): /team is open to everyone (read-only without Manage
    // team), so the tile is too — it hid the page from teammates on a phone.
    { key: "team", to: "/team", label: t("nav.team", "Team"), icon: UsersThree },
    // 2026-09-19 — Leave opens YOUR leave: raise a request, report an absence,
    // see your history. It used to land on Team (ASK-6), so a phone had no way
    // to ask for time off.
    { key: "leave", to: "/leave", label: t("nav.leave", "Leave"), icon: AirplaneTakeoff },
  ];

  return tiles.filter((tile) => {
    if (tile.ownerOnly && user?.role !== "owner") return false;
    // An owner passes every permission gate; hasPerm already says so.
    if (tile.perm && !hasPerm(user, tile.perm)) return false;
    return true;
  });
}

function buildUtility({ user, t }) {
  /* KM-5 — Language, Theme and Sign out are gone from here and live in
     Settings -> Account (Theme has since left the app altogether — ASK-33). A nav menu is a list of PLACES; a theme switch and a
     session-ending action are neither, and putting Sign out one mis-tap from
     Theme in a 4-up strip was the arrangement that made it need a red colour
     to feel safe. Settings is the only utility left, so it is the only one
     listed. */
  return [
    // Mobile PWA (2026-09-14): for everyone. Profile, security and Sign out
    // live in Settings, and a non-owner on a phone had no way to reach them.
    { key: "settings", to: "/settings", label: t("nav.settings", "Settings"), icon: GearSix },
  ].filter((x) => !x.ownerOnly || user?.role === "owner");
}

/* ASK-38 · THE TILE IS A DARK CARD.
   It was .kr-frost-min — a light glass pane drawn by its hairline — in three
   sizes (large / wide / small) with a `grid-flow-dense` bento packing them.
   The founder's reference is a flat list of equal cards, each with its icon in
   a chip, its name, a line saying what is behind it, and a chevron; and their
   correction to the reference's own light theme is the black the Desk's inner
   card already uses.
   SO THE FILL IS THAT EXACT ONE: pages/Desk.js's PHONE_CARD_INK, which is
   itself INK_PILL / .kr-navplate::before — a 24%->6% vertical gradient with a
   16% white lip on the top edge. The same black in both places on purpose;
   this is the app's dark card now, not a new one.
   SIZES ARE GONE. With CRM and Workflows out there is nothing left that earns
   double width, and six equal cards two-up read as a list rather than a puzzle
   — which is what "compact" asks for. `grid-flow-dense` goes with them: it
   existed to fill the holes a mixed-size bento left. */
// ASK-41 — one copy of the recipe, in components/karma/glass.js, shared with
// the Desk's phone card and the dock's live slot.
const TILE_INK = INK_PLATE;

function Tile({ tile, onPick }) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      data-testid={`allapps-tile-${tile.key}`}
      onClick={() => onPick(tile)}
      className={cn(
        /* ASK-40 2 — THE CARD IS A PILL. It was a 100px square carrying icon,
           name, a line of description and a chevron; the founder's call is to
           drop the description and let the card collapse to the height of its
           name. What is left is one row — icon, name — so the shape that fits
           it is a pill, not a tile. min-h-touch keeps the 44px floor the
           square used to clear by accident.
           The two-up grid and the Settings row below are unchanged. */
        "relative flex min-h-touch items-center gap-1.5 rounded-pill px-2 py-1.5 text-left",
        TILE_INK,
        "transition-[filter] duration-150 hover:brightness-125",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      )}
    >
      {/* The chevron goes with the description. At this size it would be a
          third object competing for the same 124px, and a menu row does not
          need to be told it leads somewhere. Settings keeps its own — that
          row is full width and has the room.
          ASK-42 D — and the badge goes with Notifications, the only tile that
          ever wore one. The count is on the Desk's own top bar now, where it is
          read rather than hidden behind the menu that hides it. */}
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-white/[.10] text-white/85">
        <Icon size={15} weight="bold" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[length:var(--text-label)] font-semibold leading-4 text-white">
        {tile.label}
      </span>
    </button>
  );
}

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {object}   user
 * @param {Function} onSignOut
 * @param {Function} onOpenLanguage
 */
export function AllAppsPanel({
  open,
  onClose,
  user,
  onSignOut,
  onOpenLanguage,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");

  useBodyScrollLock(open);
  useBackDismiss(open, (o) => { if (!o) onClose?.(); });

  // Reset the query each time it opens — he is usually looking for something
  // different than last time.
  React.useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const tiles = React.useMemo(() => buildTiles({ user, t }), [user, t]);
  const utility = React.useMemo(() => buildUtility({ user, t }), [user, t]);

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
          /* More grows out of the dock, so the dock stays while it is open
             (index.css hides it under every other dialog). */
          data-keeps-chrome=""
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
            "fixed z-[10090] flex max-h-[calc(68vh/var(--ui-scale,1))] w-[var(--app-dock-w,17rem)] flex-col overflow-hidden app-dock-left",
            /* Mobile PWA (2026-09-14): 4.5rem, the dock's real height since
               KM-32 — at 4rem the panel sat flush on the bar with no seam. */
            "bottom-[calc(1rem+4.5rem+0.5rem+var(--sa-bottom))]",
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
            /* KM-50 — kr-keep-blur: /finance strips backdrop-filter off .kr-frost
               to stay inside the blur budget, and this panel is not part of
               that budget — it is one overlay, on top, one at a time. */
            "kr-frost kr-keep-blur rounded-cardlg focus:outline-none focus-visible:outline-none",

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
            className="min-h-0 overflow-y-auto overscroll-contain p-3 [padding-bottom:calc(0.75rem+var(--sa-bottom))]"
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
                {/* ASK-38 — two up, equal, no dense packing: see TILE_INK. */}
                <div className="grid grid-cols-2 gap-2.5">
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
                className="mt-2.5"
              >
                <h3 id="allapps-h-utility" className="sr-only">
                  {t("allapps.account", "Account")}
                </h3>
                {/* ASK-38 — Settings is a full-width ROW of the same card, the
                    way the founder's reference ends its list: icon, name, what
                    is inside, chevron. It is one item and a one-up row says so
                    better than a lone tile in a two-up grid. */}
                <div className="flex flex-col gap-2.5">
                  {shownUtility.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      data-testid={`allapps-tile-${item.key}`}
                      onClick={() => pick(item)}
                      className={cn(
                        /* ASK-40 2 — a pill too, and without its description,
                           so it reads as the same object as the six above it
                           rather than the one card that kept a subtitle. Still
                           one full-width row: it is one item and a lone tile in
                           a two-up grid says the wrong thing. */
                        "relative flex min-h-touch w-full items-center gap-2 rounded-pill px-2 py-1.5 text-left",
                        TILE_INK,
                        "transition-[filter] duration-150 hover:brightness-125",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        /* KM-3 — no red on sign out; there is none here anyway. */
                      )}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-white/[.10] text-white/85">
                        <item.icon size={16} weight="bold" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[length:var(--text-label)] font-semibold leading-4 text-white">
                        {item.label}
                      </span>
                      <CaretRight size={12} weight="bold" aria-hidden="true" className="mr-1 shrink-0 text-white/35" />
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
