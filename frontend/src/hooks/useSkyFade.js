// KR-13 · useSkyFade — stamps the route's room on <html>.
//
// WHAT THIS IS NOT, and why the name is now slightly wrong.
//
// This was meant to CROSS-FADE the per-page sky. Three implementations were
// built and each was measured failing, in this engine:
//
//   1. `transition: --sky-core 620ms` on .app-sky::before.
//      Rendered correctly, never animated. Sampling the composited gradient
//      at 80/180/300/450/700ms through one navigation returned amber, then
//      violet, with no value in between.
//
//   2. The same transition moved onto the real element, in case pseudo-
//      elements were the restriction. Worse: with the transition declared,
//      --sky-core computed AMBER on /team indefinitely; deleting that single
//      declaration at runtime resolved it to violet in the same frame. The
//      transition was not slow, it was wedged — the third stalled CSS
//      transition on this branch (see .kr-pop ⇄ .kr-pressed in MyWork).
//
//   3. rAF interpolation of the four colours, writing inline. The hook
//      reached its animate branch and a MutationObserver on the element
//      recorded ZERO style writes: frames scheduled, nothing painted.
//
//   4. An opacity "curtain" — dip the sky, swap the colour at the trough.
//      The keyframe appeared in animationName and opacity stayed pinned at
//      1 for the whole run.
//
// So the sky SNAPS, and this hook now only does the part that works: it
// stamps data-page. The navigation still reads as a transition because the
// content layer (.kr-page-in, 320ms rise + fade) is verified working, and
// the Dex boundary keeps its blur. Shipping a fourth broken attempt would
// have been worse than shipping an honest snap.
import { useEffect } from "react";

/** First path segment only — /finance?tab=x and /finance are one room. */
const roomOf = (pathname) => pathname.split("/").filter(Boolean)[0] || "";

export function useSkyFade(pathname) {
  useEffect(() => {
    const room = roomOf(pathname);
    const root = document.documentElement;
    if (room) root.setAttribute("data-page", room);
    else root.removeAttribute("data-page");
  }, [pathname]);

  /* THE STAMP IS CLEARED WHEN THE SHELL GOES, and without this the login page
     came back grey (founder, 2026-09-19).

     data-page lives on <html>, which outlives React, but the hook that owns it
     runs inside Layout — and Layout UNMOUNTS at logout, because /login renders
     outside the shell. So the last room you were in stayed stamped on the
     document with nothing left to clear it, and the login page was styled as
     that room: measured after logging out from /team, data-page was still
     "team" and the login artwork was drawing at opacity .45 instead of 1.

     .45 is the Team room's --sky-art-opacity, added when that sky was warmed.
     The orphaned attribute is older than that and was simply harmless before:
     the rules it used to carry were --sky-art picture urls, which the login
     art overrides for itself. Adding an opacity to the room is what made a
     long-standing leak visible, and the leak is the thing to fix.

     Its own effect with an empty dep list, so it fires ONLY on unmount. Doing
     it in the cleanup of the effect above would clear and restamp on every
     navigation, leaving a frame in each one with no room set — which is the
     bare amber default flashing between every page. */
  useEffect(() => () => document.documentElement.removeAttribute("data-page"), []);
}

export default useSkyFade;
