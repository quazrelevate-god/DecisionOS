import * as React from "react";

// KM-25 · the header slot.
//
// WHY THIS EXISTS AT ALL. KM-24 pinned the page title with `position: sticky`
// and painted a translucent white bar behind it, because a sticky header sits
// IN the scroll flow and the list scrolls visibly underneath it. The founder's
// note was exact: don't cover the content, hide it. Covering was never the
// intent — it was a symptom of the header living inside the thing that scrolls.
//
// Content can only vanish at a boundary, and a boundary needs an ancestor that
// clips — which means the header has to be OUTSIDE the scroller, not stuck to
// the top of it. Layout therefore owns a non-scrolling top region and hands its
// element down here; a page's header renders into that region through a portal
// while staying exactly where it is in the page's own source. Nothing is
// painted behind anything: the list is clipped by the scroller's top edge and
// the sky shows through the gap, because the sky is fixed and never scrolled
// in the first place.
export const HeaderSlotContext = React.createContext(null);

/** The slot element, or null on desktop / before Layout has mounted it. */
export function useHeaderSlot() {
  return React.useContext(HeaderSlotContext);
}
