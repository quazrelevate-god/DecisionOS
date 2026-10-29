/* The phone's toasts, full screen (founder, 2026-10-29).
 *
 * First pass: "replace toasts with a full-screen affirmation for every state
 * change". Second pass, the same day: "some toast pills are still showing…
 * change ALL the toasts to the full-screen animation; errors too, in the same
 * full-screen view, but with an error icon instead of the tick."
 *
 * HOW IT REACHES EVERY CALL WITHOUT TOUCHING THEM. Every screen imports the
 * same `toast` object from sonner; installAffirmations() wraps its methods —
 * success, error, info, warning, message, loading and dismiss — and on a phone
 * each becomes this layer instead of a pill. (A bare `toast("…")` call cannot
 * be wrapped, so the app says `toast.message("…")` for those.) On a desktop
 * every call goes to sonner exactly as before.
 *
 *   success          the black disc and a tick that draws itself, one gold ring
 *   error            the maroon disc and an exclamation, with a small nudge
 *   info / message   the black disc and an "i"
 *   loading          the black disc and a turning ring; whatever the caller
 *                    says next (`{ id }`) replaces it
 *
 * An action the toast carried (Undo, Refresh, Review) is a real button here,
 * and the layer then waits long enough to press it. Any tap elsewhere clears
 * it early. Under prefers-reduced-motion it simply appears and goes.
 * A caller that passes `{ affirm: false }` keeps the pill.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { MOBILE_QUERY } from "../../hooks/useIsMobile";

const listeners = new Set();
let installed = false;
let seq = 0;

/* "Approved — 3 tasks created" reads as a headline and its detail: the part
   before the dash is the big line, the rest goes under it. The same for a
   first sentence ("Task created. Assigned to Asha: …"). */
export function splitAffirmation(message) {
  if (typeof message !== "string") return { title: message, detail: null };
  const m = message.match(/^(.{2,60}?)\s+[—–-]\s+(.+)$/) || message.match(/^(.{2,60}?\.)\s+(.+)$/);
  if (!m) return { title: message, detail: null };
  const detail = m[2].trim();
  return {
    title: m[1].replace(/\.$/, ""),
    detail: detail.charAt(0).toUpperCase() + detail.slice(1),
  };
}

const phoneNow = () => typeof window !== "undefined" && !!window.matchMedia?.(MOBILE_QUERY).matches;

export function installAffirmations() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const sonner = {
    success: toast.success, error: toast.error, info: toast.info, warning: toast.warning,
    message: toast.message, loading: toast.loading, dismiss: toast.dismiss,
  };
  const wrap = (kind, original) => (message, opts) => {
    const o = opts || {};
    if (!phoneNow() || !listeners.size || o.affirm === false) return original(message, opts);
    const id = o.id ?? `affirm-${++seq}`;
    // A success or failure that answers a loading toast (or any pill shown
    // before this) takes its place rather than leaving it behind.
    if (o.id != null) sonner.dismiss(o.id);
    const description = typeof o.description === "string" ? o.description : null;
    listeners.forEach((fn) => fn({
      key: `${id}-${++seq}`, id, kind, message, description,
      action: o.action && o.action.label ? o.action : null,
      cancel: o.cancel && o.cancel.label ? o.cancel : null,
      duration: o.duration,
    }));
    return id;
  };
  toast.success = wrap("success", sonner.success);
  toast.error = wrap("error", sonner.error);
  toast.info = wrap("info", sonner.info);
  toast.warning = wrap("error", sonner.warning);
  toast.message = wrap("info", sonner.message);
  toast.loading = wrap("loading", sonner.loading);
  toast.dismiss = (id) => {
    listeners.forEach((fn) => fn({ dismiss: true, id }));
    return sonner.dismiss(id);
  };
}

const EASE = [0.22, 1, 0.36, 1];
const DISC = {
  success: "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] shadow-[0_22px_44px_-18px_hsl(0_0%_0%/0.6),inset_0_1px_0_hsl(0_0%_100%/0.16)]",
  info: "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] shadow-[0_22px_44px_-18px_hsl(0_0%_0%/0.6),inset_0_1px_0_hsl(0_0%_100%/0.16)]",
  loading: "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] shadow-[0_22px_44px_-18px_hsl(0_0%_0%/0.6),inset_0_1px_0_hsl(0_0%_100%/0.16)]",
  error: "bg-[linear-gradient(180deg,hsl(350_52%_40%),hsl(349_62%_27%))] shadow-[0_22px_44px_-18px_hsl(349_62%_22%/0.7),inset_0_1px_0_hsl(0_0%_100%/0.18)]",
};
const RING = { success: "ring-[hsl(var(--ng-gold)/0.7)]", info: "ring-white/0", loading: "ring-white/0", error: "ring-[hsl(349_62%_40%/0.45)]" };

function Mark({ kind, reduced }) {
  const draw = (d, delay = 0.14, w = 4.5) => (
    <motion.path d={d} stroke="white" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none"
      initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
      transition={{ duration: 0.38, delay, ease: [0.65, 0, 0.35, 1] }} />
  );
  if (kind === "loading") {
    return (
      <svg viewBox="0 0 52 52" className="h-14 w-14 animate-spin motion-reduce:animate-none" fill="none" aria-hidden="true">
        <circle cx="26" cy="26" r="15" stroke="white" strokeOpacity=".18" strokeWidth="4" />
        <path d="M26 11a15 15 0 0 1 15 15" stroke="hsl(44 88% 60%)" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 52 52" className="h-14 w-14" fill="none" aria-hidden="true">
      {kind === "success" && draw("M14 27.5 22.5 36 39 18")}
      {kind === "error" && <>{draw("M26 14v15")}{draw("M26 37.5v.5", 0.42, 5)}</>}
      {kind === "info" && <>{draw("M26 15v.5", 0.1, 5)}{draw("M26 23v14", 0.2)}</>}
    </svg>
  );
}

export function AffirmationLayer() {
  const [item, setItem] = useState(null);
  const timer = useRef(null);
  const current = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const clear = () => { clearTimeout(timer.current); current.current = null; setItem(null); };
    const on = (next) => {
      if (next.dismiss) {
        if (next.id == null || current.current?.id === next.id) clear();
        return;
      }
      clearTimeout(timer.current);
      current.current = next;
      setItem(next);
      if (next.kind === "loading" || next.duration === Infinity) return;   // the next word clears it
      const { detail } = splitAffirmation(next.message);
      const words = String(detail || next.description || "").length;
      const base = next.kind === "error" ? 2400 : 1500;
      const hold = typeof next.duration === "number" ? next.duration
        : (next.action || next.cancel) ? 5000 : base + Math.min(1800, words * 22);
      timer.current = setTimeout(clear, hold);
    };
    listeners.add(on);
    return () => { listeners.delete(on); clearTimeout(timer.current); };
  }, []);

  const dismiss = () => { clearTimeout(timer.current); current.current = null; setItem(null); };
  const press = (b) => (e) => {
    e.stopPropagation();
    dismiss();
    try { b.onClick?.(e); } catch { /* the caller's own handler */ }
  };

  if (typeof document === "undefined") return null;
  const { title, detail } = item ? splitAffirmation(item.message) : {};
  const sub = detail || item?.description;
  const kind = item?.kind || "success";

  return createPortal(
    <AnimatePresence>
      {item && (
        <motion.div
          key="affirmation"
          role={kind === "error" ? "alert" : "status"}
          aria-live={kind === "error" ? "assertive" : "polite"}
          data-testid="affirmation"
          data-kind={kind}
          onPointerDown={dismiss}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.24, ease: EASE } }}
          transition={{ duration: reduced ? 0 : 0.2, ease: EASE }}
          className={`fixed inset-0 z-[10080] grid place-items-center px-8 lg:hidden ${kind === "error" ? "ng-affirm ng-affirm--error" : "ng-affirm"}`}
        >
          <motion.div key={item.key} className="flex flex-col items-center text-center" exit={{ scale: 0.96 }}>
            <span className="relative grid h-28 w-28 place-items-center">
              {!reduced && kind !== "loading" && (
                <motion.span aria-hidden="true"
                  className={`absolute inset-0 rounded-full ring-2 ${RING[kind]}`}
                  initial={{ scale: 0.85, opacity: 0.7 }} animate={{ scale: 1.75, opacity: 0 }}
                  transition={{ duration: 1.1, delay: 0.2, ease: EASE }} />
              )}
              <motion.span aria-hidden="true"
                className={`grid h-28 w-28 place-items-center rounded-full ${DISC[kind]}`}
                initial={reduced ? false : { scale: 0.55, opacity: 0 }}
                animate={kind === "error" && !reduced
                  ? { scale: 1, opacity: 1, x: [0, 0, -7, 6, -3, 0] }
                  : { scale: 1, opacity: 1 }}
                transition={kind === "error" && !reduced
                  ? { scale: { type: "spring", stiffness: 420, damping: 24 }, opacity: { duration: 0.15 }, x: { duration: 0.5, delay: 0.28, ease: "easeInOut" } }
                  : { type: "spring", stiffness: 420, damping: 24 }}
              >
                <Mark kind={kind} reduced={reduced} />
              </motion.span>
            </span>
            <motion.p data-testid="affirmation-title"
              className="mt-7 max-w-[20rem] text-[24px] font-semibold leading-tight tracking-tight text-slate-900 [text-wrap:balance]"
              initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, delay: 0.2, ease: EASE }}>
              {title}
            </motion.p>
            {sub && (
              <motion.p data-testid="affirmation-detail"
                className="mt-2 max-w-[19rem] text-[15px] leading-snug text-slate-600 [text-wrap:balance]"
                initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, delay: 0.28, ease: EASE }}>
                {sub}
              </motion.p>
            )}
            {(item.action || item.cancel) && (
              <motion.div className="mt-7 flex gap-2.5"
                initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, delay: 0.34, ease: EASE }}>
                {item.cancel && (
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={press(item.cancel)}
                    data-testid="affirmation-cancel"
                    className="h-12 rounded-pill bg-white/80 px-6 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-900/10 shadow-[0_6px_16px_-8px_hsl(216_30%_25%/0.35)]">
                    {item.cancel.label}
                  </button>
                )}
                {item.action && (
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={press(item.action)}
                    data-testid="affirmation-action"
                    className="h-12 rounded-pill bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] px-7 text-sm font-medium text-white shadow-[0_12px_26px_-12px_hsl(0_0%_0%/0.7),inset_0_1px_0_hsl(0_0%_100%/0.16)]">
                    {item.action.label}
                  </button>
                )}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default AffirmationLayer;
