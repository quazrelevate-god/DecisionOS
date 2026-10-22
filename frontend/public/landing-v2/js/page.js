/* The page's motion (MASTER.md: one easing, 120/260/520/720ms, scroll scenes
   scrubbed at 0.6). GSAP + ScrollTrigger from cdnjs, loaded deferred before this.

   Scene 1 (hero, pinned on a laptop): the six spoken lines rise as frost chips,
   then snap one by one into the Desk's black sheet as rows, while the pile of
   cards behind (scene.js) files itself into a wall. On a phone nothing pins:
   the copy stays, the sheet sits under it, and the pile files as the sheet
   scrolls into view.

   Reduced motion, or no GSAP: nothing pins or scrubs; every scene sits in its
   finished state and the pile is one still frame. */
(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EASE = "expo.out";               // the closest GSAP name to cubic-bezier(.22,1,.36,1)
  const wave = () => window.__wave || { setSettle() {}, setOffset() {}, setVisible() {}, pause() {}, resume() {} };
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* Nav: the sheet on a phone; the pill shrinks a touch once the page has moved. */
  const menu = $("#nav-menu"), sheet = $("#nav-sheet");
  menu.addEventListener("click", () => {
    const open = sheet.hidden;
    sheet.hidden = !open;
    menu.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("open", open);
  });
  sheet.addEventListener("click", (e) => { if (e.target.tagName === "A") { sheet.hidden = true; menu.setAttribute("aria-expanded", "false"); menu.classList.remove("open"); } });
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* The brief's tabs are real controls and work without motion: each writes its
     brief (typed when motion is on, at once when it is off). */
  const briefCopy = $$("#brief-copy li").map((li) => li.textContent);
  const briefText = $("#brief-text"), briefTabs = $$("#brief-tabs [role=tab]");
  let briefFrame = 0;
  function writeBrief(i, instant) {
    cancelAnimationFrame(briefFrame);
    const full = briefCopy[i];
    if (instant) { briefText.textContent = full; return; }
    const t0 = performance.now();
    const step = (now) => {
      const n = Math.min(full.length, Math.floor((now - t0) / 11));
      briefText.textContent = full.slice(0, n);
      if (n < full.length) briefFrame = requestAnimationFrame(step);
    };
    briefFrame = requestAnimationFrame(step);
  }
  briefTabs.forEach((tab, i) => tab.addEventListener("click", () => {
    briefTabs.forEach((t) => { t.classList.toggle("on", t === tab); t.setAttribute("aria-selected", String(t === tab)); });
    writeBrief(i, reduced);
  }));

  /* The ask bar's example questions. */
  const asks = ["How much do we owe vendors this week?", "Who approved the Chennai freight increase?", "What slipped yesterday, and why?", "Show receivables past 30 days."];
  const askQ = $("#ask-q");

  /* Business DNA: the milestone dots sit on the curve itself. */
  const dnaLine = $("#dna-line"), dnaDots = $$(".dna-dot"), dnaSteps = $$("#dna-steps li");
  function placeDots() {
    const L = dnaLine.getTotalLength();
    dnaDots.forEach((d) => { const p = dnaLine.getPointAtLength(L * (+d.dataset.at / 100)); d.style.left = (p.x / 10) + "%"; d.style.top = (p.y / 3.6) + "%"; });
  }
  placeDots();

  /* Every scene in its finished state, for the still page. */
  function rest() {
    $$(".tile, .score").forEach((el) => el.classList.add("live"));
    dnaDots.concat(dnaSteps).forEach((el) => el.classList.add("on"));
    $("#stage-fill").style.transform = "scaleX(.4)";
    $("#dial-val").textContent = "87"; $("#dial-fill").style.strokeDashoffset = 13;
    askQ.textContent = asks[0];
  }

  if (reduced || !window.gsap || !window.ScrollTrigger) {
    document.documentElement.classList.add("still");
    rest();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add("motion");   // the chips exist only with the scene
  const mm = gsap.matchMedia();

  /* Entrance: the label, the two lines (wiped), the lead and the buttons, 60ms apart.
     Only when the scripts arrived promptly: on a slow network the copy is already
     on screen, and hiding it again to replay an entrance would be a flash. */
  gsap.set(".reveal, .reveal-wipe", { opacity: 1 });
  if (performance.now() < 2200 && !document.hidden) {
    const intro = gsap.timeline({ defaults: { ease: EASE } });
    intro.from(".hero .label", { y: 14, opacity: 0, duration: 0.52 }, 0.05)
         .from(".hero .reveal-wipe", { clipPath: "inset(0 100% 0 0)", duration: 0.72, stagger: 0.12 }, 0.1)
         .from(".hero .lead", { y: 16, opacity: 0, duration: 0.52 }, 0.34)
         .from(".hero .cta-row", { y: 16, opacity: 0, duration: 0.52 }, 0.42);
  }

  /* Scene 1 on a laptop: pinned for 2.6 screens. */
  const chips = $$(".chip-said"), rows = $$(".sheet-rows li"), ledger = $(".hero-ledger");
  mm.add("(min-width: 901px)", () => {
    const scene = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: { trigger: ".hero", start: "top top", end: "+=260%", pin: ".hero-stage", scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true },
    });
    // Resting positions for the chips: spread across the middle 72% of the
    // viewport, so the outer ones stay on screen at every width.
    const spread = () => Math.min(window.innerWidth * 0.36, 520);
    gsap.set(chips, { x: (i) => ((i - 2.5) / 2.5) * spread(), xPercent: -50, y: 120, opacity: 0, rotate: (i) => (i % 2 ? 4 : -3) });
    gsap.set(".sheet", { opacity: 0, y: 80, scale: 0.96 });
    gsap.set(".said-caption", { opacity: 0, y: 16 });
    gsap.set(rows, { opacity: 0, x: -14 });
    gsap.set(".sheet .tick", { scale: 0.4, opacity: 0 });
    scene
      // 0 → 0.25: the chips rise out of the pile, staggered.
      .to(chips, { y: 0, opacity: 1, duration: 0.25, stagger: 0.03 }, 0)
      .to({}, { duration: 0.25, onUpdate() { wave().setSettle(0); } }, 0)
      // 0.25 → 0.45: the hero copy makes room; the sheet arrives from below.
      .to(".hero-copy", { y: -140, opacity: 0, duration: 0.2 }, 0.25)
      .to(".sheet", { opacity: 1, y: 0, scale: 1, duration: 0.2 }, 0.3)
      // 0.45 → 0.85: each chip flies into its row; the row lands; the tick draws.
      .to(chips, { x: 0, rotate: 0, y: () => ledger.offsetHeight * 0.22, opacity: 0, duration: 0.3, stagger: 0.05 }, 0.45)
      .to(rows, { opacity: 1, x: 0, duration: 0.18, stagger: 0.05 }, 0.5)
      .to(".sheet .tick", { scale: 1, opacity: 1, duration: 0.12, stagger: 0.05 }, 0.58)
      .to(".said-caption", { opacity: 1, y: 0, duration: 0.15 }, 0.55)
      // Throughout 0.3 → 0.9 the pile files itself into the wall behind the sheet.
      .to({ s: 0 }, { s: 1, duration: 0.6, onUpdate() { const s = this.targets()[0].s; wave().setSettle(s); wave().setOffset(-0.7 * s); } }, 0.3);
  });

  /* Scene 1 on a phone: no pin. The rows land as the sheet arrives; the pile
     files into the wall across the ledger's approach. */
  mm.add("(max-width: 900px)", () => {
    gsap.set(rows, { opacity: 0, x: -14 });
    gsap.set(".sheet .tick", { scale: 0.4, opacity: 0 });
    gsap.to(rows, { opacity: 1, x: 0, duration: 0.42, stagger: 0.06, ease: EASE, scrollTrigger: { trigger: ".sheet", start: "top 85%", toggleActions: "play none none reverse" } });
    gsap.to(".sheet .tick", { scale: 1, opacity: 1, duration: 0.3, stagger: 0.06, ease: EASE, scrollTrigger: { trigger: ".sheet", start: "top 78%", toggleActions: "play none none reverse" } });
    ScrollTrigger.create({ trigger: ".hero-ledger", start: "top 100%", end: "top 30%", scrub: 0.6,
      onUpdate: (s) => { wave().setSettle(s.progress); wave().setOffset(-0.4 * s.progress); } });
  });

  /* The pile fades as the product frame takes over, and stops drawing off screen. */
  ScrollTrigger.create({
    trigger: ".product", start: "top 80%", end: "top 20%", scrub: true,
    onUpdate(self) { wave().setVisible(1 - self.progress); },
    onLeave() { wave().pause(); }, onEnterBack() { wave().resume(); },
  });

  /* The product frame: tilts upright as it enters, the callouts follow. */
  gsap.set("#frame", { rotateX: 14, y: 60, transformPerspective: 1400, transformOrigin: "50% 100%" });
  gsap.to("#frame", { rotateX: 0, y: 0, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top 85%", end: "top 35%", scrub: 0.6 } });
  gsap.from(".callout", { y: 24, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.06,
    scrollTrigger: { trigger: ".frame-wrap", start: "top 45%", toggleActions: "play none none reverse" } });

  /* Headings below the hero wipe in once. */
  gsap.utils.toArray(".h2, .final .display").forEach((h) => {
    gsap.from(h, { clipPath: "inset(0 100% 0 0)", duration: 0.72, ease: EASE, scrollTrigger: { trigger: h, start: "top 80%", once: true } });
  });

  /* 3. The problem: as each risk scrolls in, its counterpart lands on the right
     and the old heading is struck through in gold. */
  gsap.utils.toArray(".risk").forEach((r) => {
    gsap.from(r.querySelector(".new"), { x: 40, opacity: 0, duration: 0.52, ease: EASE,
      scrollTrigger: { trigger: r, start: "top 72%", toggleActions: "play none none reverse", onToggle: (s) => r.classList.toggle("done", s.isActive || s.progress === 1) } });
  });
  gsap.from(".way", { y: 24, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.06, scrollTrigger: { trigger: ".ways", start: "top 80%", toggleActions: "play none none reverse" } });

  /* 4. The stream: a pinned stage; vertical scroll drives the track left through
     the gate. Each item flips from the spoken chip to the record as it crosses
     the gate (containerAnimation, as the ScrollTrigger skill prescribes). */
  const track = $("#stream-track");
  const streamTween = gsap.to(track, {
    x: () => -(track.scrollWidth - window.innerWidth * 0.4), ease: "none",
    scrollTrigger: { trigger: ".stream", start: "top top", end: () => "+=" + Math.round(track.scrollWidth * 1.1), pin: ".stream-stage", scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true },
  });
  gsap.utils.toArray(".mv").forEach((item) => {
    ScrollTrigger.create({ trigger: item, containerAnimation: streamTween, start: "center 50%", toggleActions: "play none none reverse",
      onToggle: (s) => item.classList.toggle("through", s.isActive || s.progress === 1) });
  });

  /* 5. The ten-second rule: pinned; the numeral counts as the three steps land. */
  const count = $("#rule-count"), words = $("#said-line");
  words.innerHTML = words.textContent.split(" ").map((w) => `<span class="w">${w}</span>`).join(" ");
  gsap.set(".rule-step", { y: 40, opacity: 0 });
  gsap.set(".said-line .w", { opacity: 0, y: 10 });
  gsap.set(".rule-step[data-step=understood] .chip", { scale: 0.9, opacity: 0 });
  gsap.set(".enforced li", { x: -12, opacity: 0 });
  const ruleTl = gsap.timeline({ defaults: { ease: "none" },
    scrollTrigger: { trigger: ".rule", start: "top top", end: "+=220%", pin: ".rule-stage", scrub: 0.6, anticipatePin: 1 } });
  const n = { v: 0 };
  ruleTl
    .to(n, { v: 10, duration: 0.9, onUpdate() { count.textContent = Math.round(n.v); } }, 0)
    .to(".rule-step[data-step=spoken]", { y: 0, opacity: 1, duration: 0.12 }, 0.02)
    .to(".said-line .w", { opacity: 1, y: 0, duration: 0.25, stagger: 0.01 }, 0.08)
    .to(".rule-step[data-step=understood]", { y: 0, opacity: 1, duration: 0.12 }, 0.38)
    .to(".rule-step[data-step=understood] .chip", { scale: 1, opacity: 1, duration: 0.12, stagger: 0.04 }, 0.44)
    .to(".rule-step[data-step=enforced]", { y: 0, opacity: 1, duration: 0.12 }, 0.66)
    .to(".enforced li", { x: 0, opacity: 1, duration: 0.1, stagger: 0.05 }, 0.72);

  /* 6. Who it's for: on a laptop the four portraits fan out of one pile into a
     row as the deck arrives (the hero's motif again); on a phone the deck is a
     strip the thumb scrolls, so the cards only rise. */
  const whoCards = $$(".who-card");
  mm.add("(min-width: 901px)", () => {
    gsap.fromTo(whoCards, { x: (i, el) => (1.5 - i) * el.offsetWidth * 0.94, y: 40, rotate: (i) => [-6, 2, -2, 6][i], opacity: 0 },
      { x: 0, y: 0, rotate: 0, opacity: 1, ease: "none", stagger: 0.04, scrollTrigger: { trigger: "#who-deck", start: "top 88%", end: "top 32%", scrub: 0.6, invalidateOnRefresh: true } });
  });
  mm.add("(max-width: 900px)", () => {
    gsap.from(whoCards, { y: 24, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.06, scrollTrigger: { trigger: "#who-deck", start: "top 85%", toggleActions: "play none none reverse" } });
  });

  /* 7. The comparison: the DecisionOS column lands first, then the rows. */
  gsap.from(".cmp-spine", { scaleY: 0, transformOrigin: "50% 0", duration: 0.72, ease: EASE, scrollTrigger: { trigger: ".cmp", start: "top 78%", toggleActions: "play none none reverse" } });
  gsap.from(".cmp-row:not(.cmp-head) .cmp-cell", { y: 14, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.025, scrollTrigger: { trigger: ".cmp", start: "top 72%", toggleActions: "play none none reverse" } });

  /* 8. The Brain: the stages land; the gold line draws as far as the product has come. */
  gsap.from(".stage", { y: 24, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.07, scrollTrigger: { trigger: "#stages", start: "top 82%", toggleActions: "play none none reverse" } });
  gsap.to("#stage-fill", { scaleX: 0.4, ease: "none", scrollTrigger: { trigger: "#stages", start: "top 82%", end: "top 40%", scrub: 0.6 } });

  /* 9. The engine: the tiles rise; each comes alive as it enters (the CSS runs
     the motion inside, keyed on .live). */
  gsap.from(".tile", { y: 24, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.06, scrollTrigger: { trigger: ".bento", start: "top 82%", toggleActions: "play none none reverse" } });
  $$(".tile").forEach((t) => ScrollTrigger.create({ trigger: t, start: "top 78%", onToggle: (s) => t.classList.toggle("live", s.isActive || s.progress === 1) }));

  /* 10. Business DNA: the curve draws with the scroll; each milestone lights as
     the line reaches it. */
  gsap.timeline({ scrollTrigger: { trigger: "#dna-plot", start: "top 78%", end: "bottom 50%", scrub: 0.6,
      onUpdate(self) { const at = self.progress * 100; dnaDots.forEach((d, i) => { const on = at >= +d.dataset.at - 0.5; d.classList.toggle("on", on); dnaSteps[i].classList.toggle("on", on); }); } } })
    .fromTo(dnaLine, { strokeDashoffset: 100 }, { strokeDashoffset: 0, ease: "none", duration: 1 }, 0)
    .fromTo(".dna-area", { opacity: 0 }, { opacity: 1, ease: "none", duration: 0.6 }, 0.4);

  /* 11. The brief: the score counts in and the people fill; the brief writes
     itself the first time it is seen; the ask bar asks while it is on screen. */
  const dial = { v: 0 }, dialVal = $("#dial-val"), dialFill = $("#dial-fill");
  gsap.to(dial, { v: 87, duration: 1.4, ease: EASE, onUpdate() { dialVal.textContent = Math.round(dial.v); dialFill.style.strokeDashoffset = 100 - dial.v; },
    scrollTrigger: { trigger: ".score", start: "top 78%", once: true, onEnter: () => $(".score").classList.add("live") } });
  ScrollTrigger.create({ trigger: "#brief-sheet", start: "top 78%", once: true, onEnter: () => writeBrief(0, false) });
  let askFrame = 0, askTimer = 0, askI = 0;
  function askNext() {
    const q = asks[askI++ % asks.length], t0 = performance.now();
    const step = (now) => {
      const k = Math.min(q.length, Math.floor((now - t0) / 26));
      askQ.textContent = q.slice(0, k);
      if (k < q.length) askFrame = requestAnimationFrame(step); else askTimer = setTimeout(askNext, 2400);
    };
    askFrame = requestAnimationFrame(step);
  }
  ScrollTrigger.create({ trigger: ".ask", start: "top 90%", end: "bottom 10%",
    onToggle: (s) => { cancelAnimationFrame(askFrame); clearTimeout(askTimer); if (s.isActive) askNext(); } });

  /* 12. Pricing: the three plans rise, the chosen one last. */
  gsap.from(".plan", { y: 30, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.08, scrollTrigger: { trigger: ".plans", start: "top 82%", toggleActions: "play none none reverse" } });

  /* 14. The call: the wall of filed cards returns behind the last word. */
  ScrollTrigger.create({ trigger: ".final", start: "top 95%", end: "top 35%", scrub: true,
    onEnter: () => { wave().setSettle(1); wave().resume(); }, onUpdate: (s) => wave().setVisible(s.progress), onLeaveBack: () => wave().pause() });

  window.addEventListener("load", () => ScrollTrigger.refresh());
})();
