// MPWA-12i · EmptyScreen — an empty screen, not an empty card.
//
// `EmptyState` (MPWA-04) is the right thing inside a list: one sentence, one
// action, in place. But when a whole screen has nothing on it, that card floats
// in 300–450px of white space and the screen reads as unfinished — which is
// exactly what §3's density floor and §8's white-gap rule exist to catch, and
// what the audit reported on /crm, /my-work, /finance and the Desk in fixture A.
//
// The fix is not to inflate the card. It is to compose the empty screen from the
// same blocks as the full one, saying only true things:
//
//   Verdict   the sentence, and the one thing to do about it
//   Strip     the other things he could do from here
//   Grid      what will land on this screen, and what puts it there
//   Pulse     the pair of numbers this screen exists to answer — at zero
//
// On the zeros: §8 says "hide zeros. A KPI reading ₹0 spends a sixth of the
// viewport saying nothing." That rule is about a zero competing with real
// content. On a screen with no content the zero IS the content — it is the
// answer to "how much do they owe me", and its absence would leave him unsure
// whether the number is nought or merely missing. So the Pulse renders here and
// is suppressed everywhere else, which is the opposite of arbitrary.
import * as React from "react";
import { Verdict, Pulse, Grid, Strip } from "./blocks";

/** Ask Layout to open the Dex sheet — see the listener there for why an event. */
export const openDex = () => window.dispatchEvent(new CustomEvent("dos:open-dex"));

/**
 * "What lands here" as a Grid — the honest next stratum for a screen with little
 * or nothing on it (§3 L2: "render the next stratum rather than leaving white
 * space"). Each tile names one thing that will appear and what makes it appear,
 * so it reads as an explanation rather than as filler. Exported because four
 * screens need it and one copy of the markup is better than four.
 */
export function LandsGrid({ items = [], title = "What lands here", "data-testid": testId = "empty-lands" }) {
  if (!items.length) return null;
  return (
    <Grid
      title={title}
      items={items}
      data-testid={testId}
      renderTile={(it) => (
        <>
          <span className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            <it.icon size={16} weight="bold" aria-hidden="true" />
            {it.title}
          </span>
          <span className="mt-1.5 block text-sm leading-snug">{it.body}</span>
        </>
      )}
    />
  );
}

/**
 * @param {string}   eyebrow
 * @param {string}   headline   one sentence, business language (§5.4)
 * @param {string}   [hint]     at most one more sentence
 * @param {{label:string,onSelect:Function}} [action]   the primary action
 * @param {Array<{key:string,label:string,icon?:Component,onSelect:Function}>} [more]
 *        secondary actions, as Strip chips
 * @param {Array<{id:string,icon:Component,title:string,body:string,onOpen?:Function}>} [lands]
 *        "what lands here", as Grid tiles — each explains one thing that will
 *        appear and what makes it appear
 * @param {Array} [stats]       exactly two, or omitted
 * @param {string} [progress]   data-progress key for the first stat
 */
export function EmptyScreen({
  eyebrow,
  headline,
  hint,
  action,
  more = [],
  lands = [],
  stats,
  progress,
  "data-testid": testId = "empty-screen",
}) {
  return (
    <div data-testid={testId} data-empty-screen="true" data-empty-state="true">
      <Verdict
        tone="neutral"
        eyebrow={eyebrow}
        headline={headline}
        action={action?.label ? { label: action.label, onClick: action.onSelect } : undefined}
        data-testid={`${testId}-verdict`}
      >
        {hint && <p className="mt-2 text-sm leading-relaxed opacity-80">{hint}</p>}
      </Verdict>

      {more.length > 0 && (
        <Strip
          label="Or"
          wrap
          data-testid={`${testId}-more`}
          items={more.map((m) => ({ key: m.key, label: m.label, icon: m.icon, onSelect: m.onSelect }))}
        />
      )}

      <LandsGrid items={lands} data-testid={`${testId}-lands`} />

      {stats?.length === 2 && (
        <Pulse
          data-testid={`${testId}-pulse`}
          stats={[
            { ...stats[0], series: [], delta: null, progress },
            { ...stats[1], series: [], delta: null },
          ]}
        />
      )}
    </div>
  );
}

export default EmptyScreen;
