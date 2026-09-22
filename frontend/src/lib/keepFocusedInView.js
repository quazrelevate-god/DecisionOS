/* JOURNEY-1 J13 — THE FIELD YOU ARE TYPING IN STAYS ON SCREEN WHEN THE
 * KEYBOARD OPENS.
 *
 * On a phone the on-screen keyboard takes about half the screen. Most forms
 * here kept their field in view, but Amit's task update — a field low in a
 * drawer — ended up behind the keyboard, so he typed blind until he scrolled.
 * One listener for every form: when the visible screen shrinks while a field
 * has focus, bring that field back into view. Phones only (a coarse pointer);
 * a desktop window being resized is left alone.
 */
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

export function keepFocusedInView() {
  if (typeof window === "undefined") return;
  const coarse = () => window.matchMedia?.("(pointer: coarse)")?.matches;
  let last = window.visualViewport?.height || window.innerHeight;
  let timer = null;
  const onResize = () => {
    const h = window.visualViewport?.height || window.innerHeight;
    const shrank = h < last - 80;
    last = h;
    if (!shrank || !coarse()) return;
    const el = document.activeElement;
    if (!el || !(TYPING.test(el.tagName) || el.isContentEditable)) return;
    clearTimeout(timer);
    // After the keyboard has finished sliding up and the layout has settled.
    timer = setTimeout(() => {
      try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch (e) { /* old browser */ }
    }, 120);
  };
  window.visualViewport?.addEventListener("resize", onResize);
  window.addEventListener("resize", onResize);
}

export default keepFocusedInView;
