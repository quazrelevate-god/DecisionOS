// ASK-33 Phase 5 — the Dex failures that stay on screen until dismissed.
//
// A failed capture creates no decision, so nothing else in the app records it:
// plan item 5.2 exists because such failures went unseen (14 of 15 in the live
// data). Phase 4 made them a Sonner toast with no auto-dismiss — and at 360px
// that toast sat over the score row and the notification bell for as long as it
// stayed, which is indefinitely. The rule since (founder, 2026-09-16): a
// persistent notice may never cover anything interactive.
//
// Sonner cannot place one toast differently from the rest, so these live in
// this small store instead and are drawn by components/mobile/DexFailureNotice:
// above the dock (with the page's scroll clearance extended by its height) when
// the Dex sheet is closed, and in the sheet's own flow when it is open. Plan
// item 5.3 ("My captures") is their proper home; this stands in until then.
//
// An entry: { id, message, retry, onRetry(entry), canRetry() }. The functions are
// in-memory only, like the capture they re-send.

let notices = [];
let seq = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function addFailureNotice(entry) {
  seq += 1;
  notices = [...notices, { ...entry, id: `dex-failure-${seq}` }];
  emit();
}

export function removeFailureNotice(id) {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function subscribeFailureNotices(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getFailureNotices() {
  return notices;
}
