/* THE DOCK IS THE SLIDER, on every page except the Desk.
 *
 * 2026-10-06. The founder's complaint was consistency: the Desk had grown a
 * slider while every other room still carried the old Dex circle in the corner,
 * "and we use the same ask desk functionality with different UI, right?"
 *
 *   "Take the same slider container and implement it in the navbar. Increase
 *    the navbar height to the same height of the slider container and place the
 *    centre slider icon button in the centre of the dock navbar. Rearrange the
 *    navbar items evenly to both sides."
 *
 * So this is the dock drawn as DexSlider's well, with the four destinations
 * living inside it — two to the left of the handle, two to the right. There is
 * no Dex circle anywhere any more.
 *
 * THE GESTURE IS ONE MOVEMENT, THREE THINGS. As the handle travels the founder
 * asked that the ends appear and the destinations disappear together, "both
 * have to be made simultaneously", with the handle's glyph turning to match.
 * All three are driven off the SAME number — DexSlider's own travel, reported
 * through `onDrag` — rather than off three animations that would drift.
 *
 * LEFT IS ASK, and the bar becomes the conversation: it grows with the chat to
 * half the screen and then scrolls inside itself (the founder's call), with a
 * close button to put it back. RIGHT IS DECIDE, unchanged from the Desk — the
 * capture and its review card, and this bar does not move.
 *
 * NOT ON THE DESK. The Desk has its own slider on its own sheet and is
 * explicitly out of scope: "this UI change shouldn't be affecting the home
 * screen, it should only show in other screens except the desk screen."
 */
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, DotsThree } from "@phosphor-icons/react";
import { AnimatePresence } from "framer-motion";
import { DexSlider } from "../karma/DexSlider";
import { dockSlots, DockItem } from "./FloatingDock";
import { Bubble, Outcome } from "./DexChat";
import { buildTiles, buildUtility } from "./AllAppsPanel";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { cn } from "@/lib/utils";

export function DockSlider({
  user, chat, askOpen, onAsk, onDecide, onCloseAsk, onMore, moreOpen = false,
  capturing = false, recording = false, levelsRef = null, onStop,
  onOpenDecision,
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navRef = React.useRef(null);
  const slots = React.useMemo(() => dockSlots(user, t), [user, t]);

  /* TAP ANYWHERE ELSE AND THE MENU PUTS ITSELF AWAY. (2026-10-07, founder: "no
     need of the X button at the top for closing — when we click outside this
     more menu, that more menu should collapse.")
     There is no overlay to catch that tap any more — the menu IS the bar, and
     the page behind it is live — so the bar listens for a press that starts
     outside itself. pointerdown rather than click: it closes on the way down,
     the way a menu should, and a press that ends in a scroll still closes it.
     The press is STOPPED but not prevented: whatever is under it does not also
     get actioned (dismissing a menu should not post a form or open a task), and
     not calling preventDefault leaves the page free to scroll under the finger
     that just closed it. The dock itself is excluded, so More's own button
     toggles and the destinations still work. */
  React.useEffect(() => {
    if (!moreOpen) return undefined;
    const away = (e) => {
      if (navRef.current && navRef.current.contains(e.target)) return;
      e.stopPropagation();
      onMore?.();
      /* AND THE CLICK THAT FOLLOWS IT. Stopping the pointerdown does not stop
         the click — React listens for that one — so the tap that put the menu
         away also opened whatever it landed on: measured, a task card's drawer.
         One click is swallowed, and only if it arrives: a press that turns into
         a scroll never produces one, so the listener takes itself off after half
         a second rather than waiting to eat something unrelated. */
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener("click", swallow, true);
      setTimeout(() => document.removeEventListener("click", swallow, true), 500);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [moreOpen, onMore]);
  const [pct, setPct] = React.useState(0);
  const [pressed, setPressed] = React.useState(false);
  const onDrag = React.useCallback((p) => setPct(p), []);

  /* THE DESTINATIONS GO ON THE TOUCH, not across the drag. The founder's call:
     the moment the knob is pressed the bar should be the control and nothing
     else — "then only it looks elegant, otherwise it feels like some sloppy
     stuff." So the press clears them outright; the travel still drives the
     ENDS fading in, because those have somewhere to arrive from.
     `pointer-events` goes with the opacity: a destination you cannot see must
     not be tappable either, or a committed swipe can end on a navigation. */
  const fade = pressed ? 0 : Math.max(0, 1 - pct * 1.25);
  /* TWO AND TWO, AND THE FOURTH IS MORE. dockSlots hands back Desk, Work,
     Money, CRM; the founder moved CRM into the More panel and gave its slot to
     More itself, so the bar reads Desk · Work │ handle │ Money · More. */
  const left = slots.slice(0, 2);
  const right = [
    ...slots.slice(2, 3),
    { to: "#more", label: t("bottomnav.more", "More"), icon: DotsThree, testid: "dock-more", onClick: onMore, isMore: true },
  ];

  const items = (side) => (
    <div className="flex min-w-0 flex-1 items-stretch justify-around gap-0.5">
      {side.map((s) => (
        <DockItem key={s.to} {...s}
          active={s.isMore ? moreOpen : location.pathname.startsWith(s.to)} />
      ))}
    </div>
  );

  /* THE BAR'S CONTENTS WHILE IT IS A BAR: two destinations, the handle's own
     width of air in the middle, two more. The gap is not a spacer element —
     it is the handle's footprint, so the items never sit under it. */
  const behind = (
    <div
      aria-hidden={pct > 0.4 ? "true" : undefined}
      style={{ opacity: fade, pointerEvents: fade < 0.6 ? "none" : undefined }}
      className="absolute inset-0 flex items-stretch px-2 transition-opacity duration-150"
      data-testid="dock-slider-items"
    >
      {items(left)}
      <span className="w-[6.25rem] shrink-0" aria-hidden="true" />
      {items(right)}
    </div>
  );

  return (
    <nav
      ref={navRef}
      className="lg:hidden fixed app-dock-left app-dock-right-wide z-[10000] bottom-safe-4"
      data-testid="dock-slider"
      data-mobile-chrome=""
      aria-label={t("nav.primary", "Primary")}
    >
      {moreOpen && !askOpen ? (
        /* MORE IS THE BAR, GROWN. (2026-10-06, founder.) It used to be a card
           floating over the page just above the dock; now the dock itself takes
           the height and the menu is simply what is inside it, the same way Ask
           grows it into a conversation. The slider stays at the foot, so the
           destinations and the control never leave — and the same press on More
           puts it back. */
        <DexSlider
          tone="ink"
          behind={behind}
          menu={<DockMore user={user} onClose={onMore} />}
          onDrag={onDrag}
          onPressChange={setPressed}
          onAsk={onAsk}
          onDecide={onDecide}
          capturing={capturing}
          recording={recording}
          levelsRef={levelsRef}
          onStop={onStop}
        />
      ) : askOpen ? (
        <DockAskPanel chat={chat} onClose={onCloseAsk} onOpenDecision={onOpenDecision}>
          <DexSlider
            tone="ink"
            composer
            capturing={capturing}
            recording={recording}
            levelsRef={levelsRef}
            onStop={onStop}
            onAsk={onAsk}
            onDecide={onDecide}
          />
        </DockAskPanel>
      ) : (
        <DexSlider
          tone="ink"
          behind={behind}
          onDrag={onDrag}
          onPressChange={setPressed}
          onAsk={onAsk}
          onDecide={onDecide}
          capturing={capturing}
          recording={recording}
          levelsRef={levelsRef}
          onStop={onStop}
        />
      )}
    </nav>
  );
}

/* THE BAR, GROWN INTO THE MENU.
 *
 * Founder, 2026-10-06: "instead of a separate pop-up card floating, the entire
 * dock should increase its height, accommodating all the existing five rows of
 * menus spaciously and compactly… place all the nine menu pills inside it. The
 * colour of the pills should be white-ish, and no need of an additional card
 * inside this expanded dock sheet — only the pills."
 *
 * So: no Dialog, no backdrop, no second surface. The dock's own ink grows to
 * fit five rows of two, the pills sit straight on it, and the bar with its
 * destinations stays at the foot where it was. The menu itself is still
 * AllAppsPanel's list — one set of destinations, two ways of drawing it — so a
 * page added to the menu appears here without anyone remembering to.
 */
function DockMore({ user, onClose }) {   // onClose: picked a destination
  const { t } = useTranslation();
  const navigate = useNavigate();
  /* The nine, in the order the panel has always had them: the destinations
     first, Settings last. */
  const items = React.useMemo(
    () => [
      ...buildTiles({ user, t }),
      /* Settings is the menu's one utility, and it was a full-width strip
         under the grid in the floating panel. Keeping it full width here is
         the same distinction and it saves the last row from being a single
         half-pill with a hole beside it — which reads as a missing item
         rather than as the end of the list. */
      ...buildUtility({ user, t }).map((x) => ({ ...x, wide: true })),
    ],
    [user, t]
  );
  // The Android back gesture closes the menu rather than leaving the page.
  useBackDismiss(true, (o) => { if (!o) onClose?.(); });

  return (
    /* NO CONTAINER OF ITS OWN. This is drawn inside the dock's well (DexSlider's
       `menu`), so the black around these pills IS the bar — there is no second
       sheet and nothing is nested in anything. */
    <div className="flex min-h-0 flex-col" data-testid="dock-more-panel">
      {/* NO CLOSE BUTTON. (2026-10-07, founder.) The ways out are the three a
          bar like this already has: press More again, tap anywhere off the bar,
          or pick something. A button whose only job is "undo the last tap" was
          the fourth, and it was the one taking up the most room. */}
      <div className="flex shrink-0 items-center px-3 pb-0.5 pt-2.5">
        <span className="text-[13px] font-medium text-white/60">{t("bottomnav.more", "More")}</span>
      </div>

      {/* Five rows of two, on the dock's own ink — no card between them and it.
          It scrolls only if a role ever has more than fits, which no role does
          today; the panel is sized to its content. */}
      <div className="kr-scroll-quiet min-h-0 max-h-[calc(58dvh/var(--ui-scale,1))] overflow-y-auto overscroll-contain px-2 py-2">
        <div className="grid grid-cols-2 gap-2" data-testid="dock-more-grid">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.key}
                type="button"
                data-testid={`allapps-tile-${it.key}`}
                onClick={() => { onClose?.(); navigate(it.to); }}
                /* WHITE-ISH, the founder's word: on this ink a light pill is
                   the thing itself rather than another dark card on a dark bar,
                   and it is the same white the Desk's own sheet puts its rows
                   on. Dark type, a tinted icon chip, and the 44px floor the
                   menu has always kept. */
                className={cn(
                  "flex min-h-touch items-center gap-2 rounded-pill bg-white/[.92] px-2.5 py-2 text-left",
                  it.wide && "col-span-2",
                  "text-[hsl(var(--kr-ink))] shadow-[0_1px_2px_rgb(0_0_0/.18)]",
                  "transition-colors duration-150 hover:bg-white",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                )}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-black/[.07]">
                  <Icon size={15} weight="bold" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-label)] font-semibold leading-4">
                  {it.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

/* THE BAR, GROWN INTO A CONVERSATION.
 * Half the screen is the ceiling the founder chose — beyond that the transcript
 * scrolls inside itself and the page behind stays visible, which is the whole
 * point of it being the dock that grew rather than a screen that arrived. */
function DockAskPanel({ chat, onClose, onOpenDecision, children }) {
  const navigate = useNavigate();
  const { log = [], busy, attaching = false, retry, canRetry, clear, ask } = chat || {};
  const endRef = React.useRef(null);
  const [lightbox, setLightbox] = React.useState(null);
  const openFile = React.useCallback((src, name) => setLightbox({ src, name }), []);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: log.length > 1 ? "smooth" : "auto" });
  }, [log.length, busy]);

  return (
    <div
      className="kr-dock-chat flex flex-col overflow-hidden rounded-[var(--radius-card)]"
      data-testid="dock-ask-panel"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5">
        <span className="text-[13px] font-medium text-white/60">{log.length ? "Dex" : "Ask Dex"}</span>
        <span className="flex items-center gap-2">
          {log.length > 0 && (
            <button
              type="button"
              onClick={() => clear?.()}
              data-testid="dock-ask-clear"
              aria-label="Clear this conversation"
              className="grid h-10 place-items-center rounded-pill bg-white/10 px-3.5 text-[13px] font-medium text-white hover:bg-white/20"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="dock-ask-close"
            aria-label="Close Ask and go back to the menu"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </div>

      {/* The transcript. Bottom-anchored, so a short conversation sits on the
          control rather than floating at the top of a tall empty panel. */}
      <div className="kr-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        <div className="flex min-h-full flex-col justify-end gap-2.5">
          <AnimatePresence initial={false}>
            {log.map((m, i) => (
              m.outcome
                ? <Outcome key={m.id || i} o={m.outcome} onReview={onOpenDecision}
                    onRetry={() => retry?.()} retryDisabled={!canRetry} />
                : <Bubble key={m.id || i} m={m} index={i} onOpenFile={openFile} onAsk={(q) => ask?.(q)}
                    /* Following a citation closes Ask and goes there — the bar
                       cannot sit open over the page it just sent you to. */
                    onGo={(to) => { onClose?.(); navigate(to); }} />
            ))}
          </AnimatePresence>
          {busy && !attaching && (
            <Bubble m={{ role: "dex", text: "Thinking…" }} index={log.length} onOpenFile={openFile} />
          )}
          <div ref={endRef} aria-hidden="true" />
        </div>
      </div>

      {/* The control, at the foot, where it was before the bar grew. */}
      <div className="shrink-0 px-1 pb-1">{children}</div>

      {lightbox && (
        <div
          data-testid="dock-ask-lightbox"
          role="dialog"
          aria-label={lightbox.name || "Attachment"}
          onClick={() => setLightbox(null)}
          className={cn("fixed inset-0 z-[9600] grid place-items-center bg-black/80 p-6")}
        >
          <img src={lightbox.src} alt={lightbox.name || ""} className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}

export default DockSlider;
