/* 2026-10-12 · Ask the dock's Dex handle to show its gesture (components/neuglass/
   DexSlider, "THE NUDGE"). `dir` is "ask" (swipe left) or "decide" (swipe right).
   Fire-and-forget: with no slider on screen nothing listens and nothing happens. */
export function hintDockSlider(dir = "ask") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("dos:slider-hint", { detail: { dir } }));
}

export default hintDockSlider;
