# DecisionOS landing page v2 — MASTER

The design system of the new marketing page at `frontend/public/landing-v2/`.
Written 2026-10-22 by the genjutsu `paint` pipeline in **preserve mode**: every
token below is the app's own (frontend/src/index.css, components/neuglass/glass.js),
ported to plain CSS for a static page. Nothing is invented; the landing adds only
what the app has no need of (a display type scale, section spacing, scroll motion).

## Theses (validated direction)

**Visual.** The app's Neu-glassmorphism, on a marketing page: the cool silver canvas
with the amber bloom (the Desk's sky), white frost panels on it, the ink pill with the
white lip for the one action, white glass pills for the rest, 16/24/28px radii, no
drop shadows except the pill's own and the product frame's. One typeface, Nunito Sans,
the app's: light for the big line, bold for the word that matters, like the Desk
greeting. Airy spacing on an 8px base, in bands of sky and ink.

**Interaction.** Fluid and scroll-driven. 520–720ms moves on one easing,
`cubic-bezier(.22,1,.36,1)`, no overshoot; 120ms for hover, press and focus; UI
transitions 260ms. GSAP ScrollTrigger scrubs pinned scenes (the hero wave settling into
the ledger, the stream of spoken lines through the gate, the portrait strip); headings
reveal by a wipe. Hover brightens an ink pill (`filter: brightness(1.25)`, the app's own
hover) or lifts a frost tile by tone, never by scale. The hero's motif is the page's
own (founder 2026-10-22: not the app's wave): **the pile that files itself**, a few
hundred small cards in the brand's colours tumbling in a slow vortex, pushed by the
pointer, streaming into a wall of rows as the first scene scrolls (three.js, one
instanced mesh). Forbidden: bounce, glow, gradient text, coloured blur blobs, parallax on
photographs, fades from nothing, carousels, loops that report no state.

**Allowed patterns (the brand's own, kept on purpose):** frosted glass panels
(`backdrop-filter`) because they are the app's material; the ink pill; the sky bloom
(a positioned radial gradient) because it is the Desk's ground; the pile's continuous
drift (it depicts the unresolved pile and files itself on scroll); pinned scroll scenes;
the real product screenshot and video; the four photographs; amber and red as data
colours inside product visuals only.

**Dials:** variance 7 (asymmetric, pinned scenes), motion 8 ("more dynamic", choreographed
scroll), density 3 ("airy"). Recorded only; no dataset query was run in preserve mode.

## Colour

| Token | Value | From | Use |
|---|---|---|---|
| `--canvas` | `hsl(225 7% 92%)` ≈ #E9EAED | `--nm-bg` | the page ground under the bloom |
| `--raised` | `hsl(0 0% 100%)` | `--nm-raised` | the object colour, white panels |
| `--sunken` | `hsl(225 6% 88%)` | `--nm-sunken` | wells, one step under the canvas |
| `--edge` | `hsl(225 5% 77%)` | `--nm-edge` | container hairline at low alpha |
| `--ink` | `hsl(240 4% 5%)` #0C0C0D | `--ng-ink` | the band, the active pill |
| `--ink-raised` | `hsl(240 4% 9%)` | `--ng-ink-raised` | one step up inside the band |
| `--gold` | `hsl(44 88% 60%)` | `--ng-gold` | a light, never text on the canvas (2.1:1) |
| `--amber` | `hsl(35 100% 62%)` | `--ng-accent-soft` | the bloom's amber |
| `--accent` | `hsl(19 100% 50%)` | `--ng-accent` | alerts, deltas, markers only |
| `--outline` | `hsl(225 4% 51%)` | `--ng-outline` | control boundary (≈3.2:1) |
| `--text` | `hsl(222 16% 8%)` | neutral-900 | primary ink on light |
| `--text-2` | `hsl(30 5% 24%)` | sky `--text-secondary` | secondary on the sky (darkened for glass) |
| `--text-3` | `hsl(30 5% 34%)` | sky `--text-tertiary` | tertiary on the sky |
| `--on-ink` | `hsl(0 0% 98%)` | | text on the band |
| `--on-ink-2` | `hsl(0 0% 72%)` | `--ng-row-from` | secondary on the band |
| sky bloom | `--sky-core hsl(38 97% 58%/.62)`, `--sky-deep hsl(22 95% 52%/.38)`, `--sky-lift hsl(45 95% 68%/.38)`, `--sky-wash hsl(33 90% 60%/.22)` | `.app-sky` | the Desk weather |
| sky plate | `/sky/inbox.png` | the Desk | over the bloom at the app's opacity |

Contrast, computed: text on canvas 16.1:1; text-2 on a frost panel over the sky ≥ 7:1 at
the panel's lightest; on-ink on ink 18:1; on-ink-2 on ink 9.9:1; white on the ink pill
≥ 12:1 at its lightest stop (hsl 0 0% 24%).

## Material recipes (ported verbatim)

- **Frost panel** `.frost`: `background: linear-gradient(160deg, hsl(0 0% 100%/.52), hsl(0 0% 100%/.30)); backdrop-filter: blur(20px) saturate(1.5); border: 1px solid hsl(0 0% 100%/.55); border-radius: 24px`.
- **Frost, minimal** `.frost-min`: `background: hsl(0 0% 100%/.34); border: 1px solid hsl(0 0% 100%/.60)`, hover `.46`.
- **Glass pill** `.pill-glass`: `background: hsl(0 0% 100%/.75); box-shadow: inset 0 0 0 1px hsl(222 47% 11%/.05), 0 6px 16px -8px hsl(216 30% 25%/.35), inset 0 1px 0 hsl(0 0% 100%/.9)`.
- **Ink pill** `.pill-ink`: `background: linear-gradient(180deg, hsl(0 0% 24%), hsl(0 0% 6%)); color: #fff; box-shadow: 0 12px 26px -12px hsl(0 0% 0%/.7), inset 0 1px 0 hsl(0 0% 100%/.16)`; hover `filter: brightness(1.25)`.
- **Ink plate** (no drop shadow): the same gradient with only the inset lip.
- **Bento tile** `.bento`: `background: linear-gradient(152deg, hsl(214 44% 99%/.90), hsl(214 26% 95%/.76)); backdrop-filter: blur(18px) saturate(1.3); border: 1px solid hsl(214 30% 100%/.85); border-radius: 16px`.
- **Well** `.well`: `background: linear-gradient(160deg, hsl(0 0% 100%/.34), hsl(0 0% 100%/.20)); backdrop-filter: blur(22px) saturate(1.6); box-shadow: inset 7px 7px 14px hsl(230 22% 34%/.20), inset -7px -7px 14px hsl(0 0% 100%/.62); border-radius: 999px`.
- **Ink well** `.well-ink`: `background: hsl(240 4% 9%); box-shadow: inset 10px 10px 22px hsl(0 0% 0%/1), inset -8px -8px 18px hsl(0 0% 100%/.14)`.
- **Chip** `.chip`: pill, `padding: 3px 8px; font-size: 11px; font-weight: 500; box-shadow: inset 0 0 0 1px`; quiet tone `background: hsl(215 16% 47%/.07); color: slate-600`.

## Type

Nunito Sans (Google Fonts, variable 200–1000, italics), `font-display: swap`,
fallback `system-ui, -apple-system, "Segoe UI", sans-serif`. Tabular figures on money.

| Role | Size | Weight | Tracking | Line |
|---|---|---|---|---|
| Display (hero) | clamp(44px, 7.2vw, 108px) | 300 first line, 800 second | -0.03em | 0.98 |
| H2 | clamp(34px, 4.6vw, 64px) | 300 + 800 on the key word | -0.025em | 1.02 |
| H3 | clamp(22px, 2.4vw, 30px) | 700 | -0.01em | 1.15 |
| Lead | clamp(17px, 1.4vw, 21px) | 400 | 0 | 1.5 |
| Body | 17px | 400 | 0 | 1.55 |
| Small | 14px | 500 | 0 | 1.45 |
| Label | 11px / 13px on phone | 600 | .12em, uppercase | 1 |
| Score numeral | clamp(56px, 8vw, 120px) | 300 | -0.04em | 1 |

## Spacing

8px base. 8, 16, 24, 32, 40, 64, 96, 128, 160. Section padding `clamp(96px, 12vw, 160px)`
top and bottom; the gutter `max(20px, 4vw)`; content width 1200px; reading width 60ch.

## Shape and elevation

Radii: control 16px, tile 24px, card 28px, pill 999px, chip 4px/pill.
Shadows: only the ink pill's and the glass pill's own (above), and the product frame:
`0 40px 80px -40px hsl(222 16% 8%/.45)`. No other drop shadows; depth is by tone.

## Motion tokens

`--ease: cubic-bezier(.22,1,.36,1)`; `--t-fast: 120ms` (hover, press, focus);
`--t-ui: 260ms` (accordion, menu); `--t-move: 520ms` (moves, underline);
`--t-reveal: 720ms` (heading wipe, scene settle). Stagger 60ms, total ≤ 400ms.
Scroll scenes: `scrub: 0.6`, `ease: "none"` on horizontal container animations.
Reduced motion: no pins, no scrub, the wave rendered once at rest, every reveal already
in its resting state.

## Components

- Button, primary: ink pill, 52px tall (44 on phone), 0 24px, 16px/600. States: hover
  brightness 1.25; focus-visible `outline: 2px solid hsl(0 0% 0%/.3); outline-offset: 3px`;
  active brightness .92; disabled opacity .4.
- Button, secondary: glass pill, same size, text `--text`; hover `background: #fff`.
- Link: `--text`, underline draws from 0 to 100% in 520ms.
- Card: frost panel 24px; bento tile 16px; ink sheet 28px (the Desk's black sheet).
- Nav: the header pill (frost, 999px) with the live wordmark `Decision` + `OS` at 55%.
- Chip: quiet / amber / red (data only) / gold on ink.

## Dependencies

GSAP 3.12.5 + ScrollTrigger and three.js 0.160.0, pinned on cdnjs (named at the
direction gate; no CSP on the server). No build step; the page is static.

## Page map (2026-10-22)

1. Hero, pinned on a laptop (the pile files itself; six spoken lines become the sheet). On a phone nothing pins: copy, a window of sky with the pile, then the sheet while the pile files behind it.
2. The product: the real Desk screenshot in a frost frame, three callouts.
3. The problem: ink band, five risks struck through as their counterparts land.
4. The stream: pinned horizontal track through the gate (spoken chip → record).
5. The ten-second rule: pinned counter, spoken → understood → enforced.
6. Who it's for: four portraits fan out of one pile (laptop) / a snap strip (phone).
7. The comparison: a role="table" grid; the DecisionOS column is an ink spine.
8. The Brain: inputs as chips, five stages, two ink (live), three dashed (next), a gold line as far as it has come.
9. The engine: second ink band, bento of six tiles whose insides run on `.live`.
10. Business DNA: the curve drawn by the scroll, milestones placed on the path by JS.
11. The brief: CEO Brief sheet (real tabs, typed copy), Operating Score dial to 87, the ask bar.
12. Pricing: Free (frost), Plus (ink, Most chosen), Pro (frost); every button is Start free.
13. FAQ: native `<details name="faq">`, sticky heading on a laptop.
14. The call: the filed wall returns behind a frost panel with the display line.

Breakpoints: 900px (layout), 760px (comparison), 560px (single column). Scene.js reads the
same 900px media query. The canvas is sized from the layout viewport (`clientWidth`), not
`innerWidth`, because emulated viewports can disagree.
