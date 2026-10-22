# DecisionOS landing page v3 — notes

Built 2026-10-22 at `frontend/public/landing-v3/` (static: HTML + CSS + vanilla JS,
GSAP 3.12.5 + ScrollTrigger from cdnjs, no build step; served by express.static
at `/landing-v3/` like v2). Desktop first, by the founder's call; the phone layout
comes after the desktop is signed off.

## What it is

An Apple-style full-screen story: one scene per screen, dark and light scenes
alternating, the real product renders at scale (the promo-video shots in
`Claude outputs/promo-video/shots/`, downscaled into `assets/`), captions that
swap as the scroll moves, and one easing. The brand palette is the app's
(silver canvas, amber bloom, ink, gold); the type is Nunito Sans, the app's.

## The scenes

1. **Hero + Dex** (pinned 360vh). A businessman built from ~25,000 dots
   (`js/figure.js`, three.js Points on sampled spheres, ellipsoids and
   capsules: head, hair, neck, shoulders, chest, arms, hands, the phone's rim),
   seen over his right shoulder from behind and above, the camera on the phone
   in his hands. The phone's screen is the HTML element `#hero-phone`, glued to
   the 3D screen plane every frame with a CSS `matrix3d` (a four-corner
   homography of the projected quad), so the real app runs inside the scene in
   the same perspective. The pointer orbits the camera a few degrees at rest;
   the scroll dollies it down the screen's normal (`REST` → `ZOOM` pose, eased)
   until the phone faces us and fills the frame; the dots soften as it does.
   On the screen the real slide-to-decide frames (13 crops of the slider strip,
   `assets/seq/`) scrub as the thumb slides; the listening waveform frame
   follows; the spoken line types into a bubble; Dex's draft rises as a sheet
   inside the screen (sized in `cqw`); "Approved" stamps; the record card flies
   to the top-right. Four captions on the left. Ink dots, gold where the
   phone's glow reaches, silver under the top light.
2. **Organise** (pinned 280vh, dark). Fifteen spoken scraps plus twelve noise
   chips scattered over the screen gather into three people's lists; each
   scrap turns into its row as it lands; the noise shrinks away; the phone's
   My Work appears. `fromTo`, not `from`: with `invalidateOnRefresh` a `from()`
   re-records its end from the scattered state.
3. **The Desk** (pinned 340vh). The monitor render on a slab straightens from a
   28° tilt, then a camera visits the Dex bar, the Operating Score, the tiles
   and the sheet (`look(fx, fy, scale)` = scale about centre + xPercent/yPercent
   so the focus point lands mid-screen). Frosted captions.
4. **Two desks** — laptop + phone with the same Desk, "Approved ✓" on both.
5. **It chases** (pinned 300vh, dark). One task across one day on a horizontal
   timeline the scroll drives; the clock reads the progress; the escalation
   lands as a phone toast.
6. **Ask Dex** — typed question, typed answer card, the real Ask screen.
7. **Five stages** — two live, three dashed, the gold line as far as it has come.
8. **Operating Score + CEO Brief** — 72 counts in, parts fill, brief types; tabs work.
9. **Who it's for** (pinned) — the four portraits as a strip the scroll slides.
10. **Pricing**, 11. **FAQ** (native `<details name>`), 12. **The call** with a
    glowing phone, platforms Android · iOS · Web.

## Known limits / next

- Phone layout not done (by request). The pins, the rig's `vh` sizing and the
  three-column scenes all need the ≤900px pass.
- The founder is procedural (primitives sampled into dots). A sculpted model
  (a GLB sampled into points) would give a real collar, hair line and hands;
  the camera, the glued phone and the shader would not change.
- Tuning the shot without reloading: `__figure.setRest([x,y,z], [tx,ty,tz])`
  in the console moves the rest camera; bake the result into `REST`.
- Verified in the desktop pane at 1440×900 and 1920×1080; the in-app pane
  freezes rAF between scrolls, so screenshots were taken with the scrub
  tweens forced to their targets (`window.__settle` in the session), which is
  how a real browser renders them anyway.
