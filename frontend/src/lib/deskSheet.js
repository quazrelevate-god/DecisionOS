/* THE DESK'S BLACK SHEET, AS THE LINE THE DOCK OPENS TO. (2026-10-09.)
 *
 * Founder, on Ask opening over the Desk: the expanded dock was a black panel
 * of its own height standing on a black sheet of another — "not visually
 * appealing… increase the default height of the expanded dock as same height
 * as the black sheet height for all screen for all page."
 *
 * So the Ask panel's top is the sheet's top. On the Desk that is read off the
 * sheet itself; everywhere else there is no sheet, so the Desk leaves the line
 * here when it lays out and the dock opens to it — the same panel, the same
 * height, on every page of the same phone. Kept across launches (the Desk has
 * always been laid out at least once on a phone that has used the app), and
 * only for the width it was measured at: a rotation is a different Desk.
 *
 * Screen pixels (getBoundingClientRect), not the app's zoomed CSS pixels —
 * the reader converts at the element it sizes, against its own zoom.
 */
const KEY = "kr.deskSheetTop";
let last = null;

/** The Desk, whenever its sheet settles: where the sheet's top edge is. */
export function publishDeskSheetTop(top) {
  if (!Number.isFinite(top) || top <= 0) return;
  const v = { top: Math.round(top), w: window.innerWidth };
  if (last && last.top === v.top && last.w === v.w) return;
  last = v;
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode: this launch only */ }
}

/** Where the dock's Ask panel should reach up to, in screen pixels. */
export function deskSheetTop() {
  /* On the Desk, the sheet itself — unless it is lifted out over the page
     (Show all), when its rect is the pop's and not the sheet's. */
  const board = document.querySelector('[data-testid="desk-board"].kr-desk-sheet-floor');
  if (board && board.style.position !== "fixed") {
    const top = board.getBoundingClientRect().top;
    if (top > 0) { publishDeskSheetTop(top); return top; }
  }
  let v = last;
  if (!v) { try { v = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { v = null; } }
  if (v && v.w === window.innerWidth && Number.isFinite(v.top)) return v.top;
  /* Never seen the Desk at this width: where its sheet starts on the phones
     it was measured on (347-408px from the top, 360x640 to 440x956), held
     below the top bar on a short screen. */
  return Math.min(380, window.innerHeight * 0.6);
}
