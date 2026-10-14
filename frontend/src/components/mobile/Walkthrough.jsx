/* 2026-10-12 · THE WALKTHROUGH — a first look at the phone app, in five taps.
 *
 * The client asked for an in-app walkthrough before the store release, and
 * asked that it be short: enough to find your way, not a manual. So it is a
 * handful of spotlights over the REAL screen — the Desk for anyone who decides,
 * My Work for everyone else — one sentence each, Next and Skip, and the full
 * guide (lib/guide) one tap away at the end. Nothing is mocked up: every step
 * points at the control it is talking about.
 *
 * ONCE PER PERSON, NOT PER DEVICE. Finishing or skipping posts
 * /auth/tour/done with TOUR_VERSION; the flag rides on the user, so a reinstall
 * or a second phone does not play it again. Raise TOUR_VERSION and it plays
 * once more for everyone — the way to announce a changed screen later.
 * Preferences (Settings) → Help & guide replays it on demand (?tour=1).
 *
 * IT WAITS ITS TURN. The welcome screen, the owner's credentials gate, the
 * Terms and the member's welcome card all come first; the tour starts only
 * when none of them is up, no dialog is open and its first target is on the
 * screen.
 *
 * GEOMETRY. Phones run on CSS `zoom: 0.8` (--ui-scale, ASK-43): rects come
 * back in on-screen pixels while anything we position inside the zoomed body is
 * laid out in CSS pixels, so every coordinate is divided by the scale — the
 * same rule DexSlider follows. Where WebKit ignores zoom, --ui-scale is 1 and
 * the division is a no-op.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Lifebuoy } from "@phosphor-icons/react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { hasPerm } from "@/lib/perms";
import { termsAccepted } from "@/lib/legal";
import { needsOwnerCredentials } from "@/components/auth/OwnerCredentialsGate";
import { INK_PILL, GLASS_PILL } from "@/components/neuglass/glass";
import { openGuide } from "@/lib/guide";
import { cn } from "@/lib/utils";

export const TOUR_VERSION = 1;

/* The two scripts. `target` is one selector or several (the spotlight covers
   them all); `guide` is the section of the user guide the last step opens. */
const DECIDER = [
  {
    target: ['[data-testid="desk-score-link-phone"]', '[data-testid="desk-kpi-grid"]'],
    title: "Your company at a glance",
    body: "Your operating score, and the few numbers that need you: what's late, complaints, money to collect, workflows that are stuck.",
  },
  {
    target: ['[data-testid="desk-phone-card"]'],
    title: "What's waiting for you",
    body: "Decisions to approve, tasks to sign off, and things to watch. Tap a row to see it and give your call.",
  },
  {
    target: ['[data-testid="dex-slider-handle"]'],
    title: "Meet Dex",
    body: "Swipe right and say what you decided — Dex turns it into tasks, owners and dates for you to approve. Swipe left to ask anything. Slide back to the middle to cancel.",
    hint: true,
  },
  {
    target: ['[data-testid="dock-slider"]'],
    title: "Your places",
    body: "Desk for what needs you, Work for tasks, Money for invoices and bills.",
  },
  {
    target: ['[data-testid="dock-more"]'],
    title: "Everything else is under More",
    body: "Approvals, leave, CRM, team — and Preferences, where Help & guide lives whenever you want the full tour.",
    guide: "start",
  },
];

const MEMBER = [
  {
    target: ['[data-testid^="mywork-task-"]'],
    title: "Your tasks",
    body: "Everything you're working on. Tap a task to update it, add a photo or document as proof, and mark it done.",
  },
  {
    target: ['[data-testid="work-mobile-view"]'],
    title: "Switch what you see",
    body: "Your own tasks, or the ones you've asked others to do.",
  },
  {
    target: ['[data-testid="dex-slider-handle"]'],
    title: "Meet Dex",
    body: "Swipe left to ask Dex anything — where a task stands, who has what, what a document says. Slide back to the middle to cancel.",
    hint: true,
  },
  {
    target: ['[data-testid="dock-more"]'],
    title: "Everything else is under More",
    body: "Leave, your score, the team — and Preferences, where Help & guide lives whenever you want the full tour.",
    guide: "start",
  },
];

/** The script for this person on this screen, or null where the tour has nothing to show. */
export function tourScript(user, path) {
  if (path === "/inbox" && hasPerm(user, "inbox")) return DECIDER;
  if (path === "/my-work") return MEMBER;
  return null;
}

const uiScale = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;

/** The union of the step's targets, in CSS pixels of the zoomed body; null if none is on screen. */
function measure(selectors) {
  const s = uiScale();
  let box = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box = box
      ? { l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) }
      : { l: r.left, t: r.top, r: r.right, b: r.bottom };
  }
  if (!box) return null;
  return { x: box.l / s, y: box.t / s, w: (box.r - box.l) / s, h: (box.b - box.t) / s, vw: window.innerWidth / s, vh: window.innerHeight / s };
}

/** Nothing else is asking for the person's attention. */
function clearToStart(user) {
  if (!user || user.welcome_pending || needsOwnerCredentials(user) || !termsAccepted(user)) return false;
  try { if (localStorage.getItem("dos_welcome")) return false; } catch { /* private mode */ }
  /* The demo workspace's banner sits fixed over the top of the Desk, on the
     very numbers step 1 points at: in a demo the tour waits until it is put away. */
  return !document.querySelector('[role="dialog"], [role="alertdialog"], [data-testid="dock-more-panel"], [data-testid="dock-ask-panel"], [data-testid="demo-banner"]');
}

export default function Walkthrough() {
  const { user, refreshMe } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [steps, setSteps] = React.useState(null);
  const [i, setI] = React.useState(0);
  const [box, setBox] = React.useState(null);
  const doneRef = React.useRef(false);
  const sessionDone = React.useRef(false);   // finished here: never restart while /auth/me catches up

  const replay = new URLSearchParams(location.search).get("tour") === "1";
  const seen = (user?.tour_seen?.version || 0) >= TOUR_VERSION;

  /* Decide whether to start, and wait until the screen is free. */
  React.useEffect(() => {
    if (steps || !isMobile || !user) return undefined;
    if ((seen || sessionDone.current) && !replay) return undefined;
    const script = tourScript(user, location.pathname);
    if (!script) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > 90) { clearInterval(timer); return; }          // ~70s: give up quietly, try next visit
      if (!clearToStart(user) || !measure(script[0].target)) return;
      clearInterval(timer);
      doneRef.current = false;
      setI(0);
      setSteps(script);
    }, 800);
    return () => clearInterval(timer);
  }, [steps, isMobile, user, seen, replay, location.pathname]);

  /* Keep the spotlight on its target while the step is up. */
  React.useLayoutEffect(() => {
    if (!steps) return undefined;
    const step = steps[i];
    const update = () => setBox(measure(step.target));
    update();
    const t = setInterval(update, 400);   // the Desk settles, fonts land, a row loads
    window.addEventListener("resize", update);
    return () => { clearInterval(t); window.removeEventListener("resize", update); };
  }, [steps, i]);

  const finish = React.useCallback((how) => {
    if (doneRef.current) return;
    doneRef.current = true;
    sessionDone.current = true;
    setSteps(null);
    setBox(null);
    if (replay) navigate(location.pathname, { replace: true });
    api.post("/auth/tour/done", { version: TOUR_VERSION })
      .then(() => refreshMe?.())
      .catch(() => { /* offline: it plays again next time, which is harmless */ });
    if (how === "guide") openGuide(steps?.[steps.length - 1]?.guide);
  }, [replay, navigate, location.pathname, refreshMe, steps]);

  const open = !!steps;
  // Android's back gesture is "skip", never "leave the page under the tour".
  useBackDismiss(open, (o) => { if (!o) finish("skip"); });

  const nextRef = React.useRef(null);
  React.useEffect(() => { if (open) nextRef.current?.focus({ preventScroll: true }); }, [open, i]);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") finish("skip"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  /* The card's real height, so it is placed where it FITS rather than where a
     rule of thumb guesses (2026-10-12: on an iPhone with the demo banner up, a
     guess put step 1's card under the status bar and the Dynamic Island). */
  const cardRef = React.useRef(null);
  const [cardH, setCardH] = React.useState(230);
  const boxW = box?.vw;
  React.useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  }, [i, steps, boxW, cardH]);

  if (!open || !box) return null;
  const step = steps[i];
  const last = i === steps.length - 1;
  const PAD = 8;
  const hole = { left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 };
  /* Under the spotlight if the card fits there, else over it, else pinned to
     whichever edge has more room — clear of the status bar at the top and the
     home indicator at the bottom either way. */
  const GAP = 14, TOP_SAFE = 72, BOTTOM_SAFE = 40;
  const roomBelow = box.vh - (hole.top + hole.height) - GAP - BOTTOM_SAFE;
  const roomAbove = hole.top - GAP - TOP_SAFE;
  const cardStyle = roomBelow >= cardH ? { top: hole.top + hole.height + GAP }
    : roomAbove >= cardH ? { top: hole.top - GAP - cardH }
    : roomBelow >= roomAbove ? { bottom: BOTTOM_SAFE }
    : { top: TOP_SAFE };

  return createPortal(
    /* Above the dock (z-10000) and its lightbox: the dock is one of the things it points at. */
    <div className="fixed inset-0 z-[10050]" data-testid="walkthrough" aria-live="polite">
      {/* The dimmer is the spotlight's own shadow, so the hole is exactly the
          target; the layer under it swallows taps — nothing in the app moves
          while the tour is talking. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} aria-hidden="true" />
      <div
        aria-hidden="true"
        data-testid="walkthrough-spotlight"
        className="pointer-events-none absolute rounded-[22px] transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={{
          ...hole,
          boxShadow: "0 0 0 2px hsl(var(--ng-gold)), 0 0 0 7px hsl(var(--ng-gold) / .28), 0 0 0 9999px hsl(240 4% 5% / .66)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        aria-describedby="walkthrough-body"
        ref={cardRef}
        data-testid="walkthrough-card"
        className="absolute left-4 right-4 mx-auto max-w-[24rem] rounded-[1.6rem] bg-white/95 p-5 shadow-[0_24px_60px_-20px_hsl(240_20%_8%/.6)] ring-1 ring-white/70 backdrop-blur-xl"
        style={cardStyle}
      >
        <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
          {steps.map((_, n) => (
            <span key={n} className={cn("h-1 rounded-full transition-all duration-300", n === i ? "w-6 bg-[hsl(var(--ng-ink))]" : "w-2.5 bg-slate-900/15")} />
          ))}
          <span className="ml-auto text-xs font-medium text-slate-500" data-testid="walkthrough-count">{i + 1} of {steps.length}</span>
        </div>
        <h2 id="walkthrough-title" className="text-[17px] font-semibold leading-snug text-slate-900">{step.title}</h2>
        <p id="walkthrough-body" className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.body}</p>
        {step.hint && (
          /* The slider's two directions, drawn the way the bar reads. */
          <div className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-slate-700" aria-hidden="true">
            <span className={cn("inline-flex items-center gap-1 rounded-pill px-3 py-1.5", GLASS_PILL)}><ArrowLeft size={12} weight="bold" /> Ask</span>
            <span className="h-6 w-6 rounded-full bg-[hsl(var(--ng-ink))] ring-4 ring-[hsl(var(--ng-gold)/.35)]" />
            {steps === DECIDER && <span className={cn("inline-flex items-center gap-1 rounded-pill px-3 py-1.5", GLASS_PILL)}>Decide <ArrowRight size={12} weight="bold" /></span>}
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          {!last ? (
            <button type="button" onClick={() => finish("skip")} data-testid="walkthrough-skip"
              className="h-11 rounded-pill px-3 text-sm font-medium text-slate-500 hover:text-slate-800">
              Skip
            </button>
          ) : (
            <button type="button" onClick={() => finish("guide")} data-testid="walkthrough-guide"
              className={cn("inline-flex h-11 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-slate-800", GLASS_PILL)}>
              <Lifebuoy size={15} weight="bold" aria-hidden="true" /> Open the guide
            </button>
          )}
          <button ref={nextRef} type="button" data-testid={last ? "walkthrough-done" : "walkthrough-next"}
            onClick={() => (last ? finish("done") : setI(i + 1))}
            className={cn("ml-auto inline-flex h-11 items-center gap-1.5 rounded-pill px-5 text-sm font-semibold", INK_PILL)}>
            {last ? "Done" : <>Next <ArrowRight size={14} weight="bold" aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
