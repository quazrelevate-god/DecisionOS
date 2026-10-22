/* DecisionOS landing v3: the motion. GSAP + ScrollTrigger (cdnjs, deferred before
   this). Every scene is scrubbed by the scroll (scrub .5), captions swap at
   thresholds, hover and taps are 120ms, reveals 520–720ms on one easing.

   1  Hero: the founder and the phone in a 3D rig the pointer turns; the scroll
      pushes the camera into the phone, the real app slides to Decide, Dex hears
      the line, drafts the decision, you approve, the record flies to the corner.
   2  Organise: a day of spoken scraps gathers into three people's lists.
   3  The Desk: the monitor straightens, then a camera visits four places on it.
   5  It chases: one task through one day on a timeline the scroll drives.
   Everything else is a reveal. Reduced motion: still states, no pins. */
(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EASE = "expo.out";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const vw = () => window.innerWidth, vh = () => window.innerHeight;

  /* Nav: a touch smaller once the page has moved. */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* Hour marks on the chase timeline (layout only). */
  $("#hours").innerHTML = Array.from({ length: 10 }, (_, i) => `<span style="--h:${i}">${String(9 + i).padStart(2, "0")}:00</span>`).join("");

  /* Scatter for the organise scene: deterministic, so reloads look the same. */
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const jobs = $$(".job"), scraps = $$(".scrap");
  const scatter = jobs.map(() => ({ x: 0.05 + rnd() * 0.9, y: 0.16 + rnd() * 0.72, r: (rnd() - 0.5) * 22 }));
  scraps.forEach((s) => { s.style.setProperty("--x", (4 + rnd() * 88) + "vw"); s.style.setProperty("--y", (18 + rnd() * 70) + "vh"); s.style.setProperty("--r", ((rnd() - 0.5) * 24) + "deg"); });

  /* The brief's tabs are real controls and work without motion. */
  const briefCopy = $$("#brief-copy li").map((li) => li.textContent);
  const briefText = $("#brief-text"), briefTabs = $$("#brief-tabs [role=tab]");
  let briefFrame = 0;
  function writeBrief(i, instant) {
    cancelAnimationFrame(briefFrame);
    const full = briefCopy[i];
    if (instant) { briefText.textContent = full; return; }
    const t0 = performance.now();
    const step = (now) => { const n = Math.min(full.length, Math.floor((now - t0) / 11)); briefText.textContent = full.slice(0, n); if (n < full.length) briefFrame = requestAnimationFrame(step); };
    briefFrame = requestAnimationFrame(step);
  }
  briefTabs.forEach((tab, i) => tab.addEventListener("click", () => {
    briefTabs.forEach((t) => { t.classList.toggle("on", t === tab); t.setAttribute("aria-selected", String(t === tab)); });
    writeBrief(i, reduced);
  }));

  /* Ask Dex: question and answer pairs, from the demo company's records. */
  const QA = [
    ["Who has the most overdue tasks?", "Ravi Kumar, with three: the Salem receivable (2 days), the Kapoor dispatch note and the loom-4 buyer quote."],
    ["What's late this week?", "Four items: two dispatches, the PO approval for Surat Spinners, and the Bombay Dyeing House payment of ₹2,10,000."],
    ["How much do we owe vendors by Friday?", "₹6,20,000 across five bills. The largest is Bombay Dyeing House, ₹2,10,000, due Thursday."],
    ["Who approved the Reliance credit terms?", "You did, on 14 October, after Priya's note. 45 days, reviewed again in January."],
  ];
  const askQ = $("#ask-q"), askA = $("#ask-a"), answer = $("#answer");
  const SAID = "“Approve the twelve tonnes of cotton yarn from Surat Spinners. Priya raises the PO by Friday.”";

  /* Every scene in its finished state, for the still page. */
  function rest() {
    $$(".tile, .score-big").forEach((el) => el.classList.add("live"));
    jobs.forEach((j) => j.classList.add("filed"));
    $$(".ev").forEach((e) => e.classList.add("on"));
    $$(".cap").forEach((c) => c.classList.add("on"));
    $("#bubble-text").textContent = SAID;
    $("#score-n").textContent = "72";
    askQ.textContent = QA[0][0]; askA.textContent = QA[0][1]; answer.classList.add("on");
    $$("#draft li").forEach((li) => { li.style.opacity = 1; });
  }

  if (reduced || !window.gsap || !window.ScrollTrigger) {
    document.documentElement.classList.add("still");
    rest();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add("motion");
  const setCap = (list, i) => list.forEach((c, j) => c.classList.toggle("on", j === i));
  const band = (p, edges) => { for (let i = 0; i < edges.length; i++) if (p < edges[i]) return i - 1; return -1; };

  /* ── 1 · Hero ─────────────────────────────────────────────────────────── */
  const fig = () => window.__figure || { setProgress() {}, setLive() {}, pause() {}, resume() {} };
  const record = $("#record");
  const seqImgs = $$("#seq img"), heroCaps = $$("#hero-caps .cap"), draftItems = $$("#draft li"), bubbleText = $("#bubble-text");
  const recordFrom = () => { const r = record.getBoundingClientRect(); return { x: vw() * 0.5 - (r.left - gsap.getProperty(record, "x") + r.width / 2), y: vh() * 0.5 - (r.top - gsap.getProperty(record, "y") + r.height / 2) }; };
  gsap.set("#draft", { yPercent: 125 });
  gsap.set(draftItems, { opacity: 0, x: -8 });
  gsap.set("#stamp", { scale: 0, rotation: -8 });
  gsap.set("#bubble", { opacity: 0, y: 10 });
  gsap.set(record, { opacity: 0 });
  const cam = { p: 0 };

  // Entrance, once: the copy and the figure.
  if (performance.now() < 2500 && !document.hidden) {
    gsap.from(".hero-copy > *", { y: 18, opacity: 0, duration: 0.72, ease: EASE, stagger: 0.07, delay: 0.1 });
    gsap.from("#figure", { opacity: 0, duration: 1.2, ease: EASE, delay: 0.15 });
  }

  const hero = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: ".hero", start: "top top", end: "+=360%", pin: "#hero-pin", scrub: 0.5, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate(self) {
        const p = self.progress;
        const f = p < 0.18 ? 0 : p < 0.40 ? Math.round(gsap.utils.mapRange(0.18, 0.40, 0, 12, p)) : 13;
        seqImgs.forEach((im, i) => im.classList.toggle("on", i === f));
        setCap(heroCaps, band(p, [0.14, 0.42, 0.60, 0.80, 0.95]));
        const t = gsap.utils.clamp(0, 1, (p - 0.42) / 0.16);
        bubbleText.textContent = SAID.slice(0, Math.round(SAID.length * t));
        fig().setLive(p < 0.98);
      },
      onLeave: () => fig().pause(), onEnterBack: () => fig().resume(),
    },
  });
  hero
    .to("#hero-copy", { y: -80, opacity: 0, duration: 0.14 }, 0.06)
    .to(cam, { p: 1, duration: 0.26, onUpdate: () => fig().setProgress(cam.p) }, 0.08)
    .to("#bubble", { opacity: 1, y: 0, duration: 0.05 }, 0.40)
    .to("#draft", { yPercent: 0, duration: 0.08 }, 0.58)
    .to(draftItems, { opacity: 1, x: 0, duration: 0.05, stagger: 0.025 }, 0.63)
    .to("#bubble", { opacity: 0, y: -10, duration: 0.05 }, 0.74)
    .to("#stamp", { scale: 1, duration: 0.05, ease: "back.out(2)" }, 0.78)
    .fromTo(record, { opacity: 0, x: () => recordFrom().x, y: () => recordFrom().y, scale: 0.4 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.1 }, 0.82)
    .to("#draft", { yPercent: 125, duration: 0.06 }, 0.88)
    .to(cam, { p: 0.78, duration: 0.1, onUpdate: () => fig().setProgress(cam.p) }, 0.9);

  /* ── 2 · Organise ─────────────────────────────────────────────────────── */
  const orgPin = $("#org-pin");
  const offsetIn = (el) => { let x = 0, y = 0; for (let n = el; n && n !== orgPin; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y }; };
  const org = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: ".organise", start: "top top", end: "+=280%", pin: orgPin, scrub: 0.5, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate(self) { const p = self.progress; jobs.forEach((j, i) => j.classList.toggle("filed", p > 0.66 + (i % 5) * 0.022 + Math.floor(i / 5) * 0.012)); },
    },
  });
  org
    // fromTo, not from: under invalidateOnRefresh a from() re-records its end from
    // whatever the element shows at refresh time, which here is the scatter.
    .fromTo(jobs, { x: (i, el) => scatter[i].x * vw() - offsetIn(el).x, y: (i, el) => scatter[i].y * vh() - offsetIn(el).y, rotation: (i) => scatter[i].r },
      { x: 0, y: 0, rotation: 0, duration: 0.62, stagger: { each: 0.004, from: "random" } }, 0.04)
    .to(scraps, { scale: 0, opacity: 0, duration: 0.25, stagger: 0.012 }, 0.24)
    .to(".col h3", { opacity: 1, duration: 0.08, stagger: 0.03 }, 0.56)
    .to("#org-phone", { opacity: 1, y: -14, duration: 0.1 }, 0.78)
    .to("#org-note", { opacity: 1, duration: 0.08 }, 0.84);

  /* ── 3 · The Desk ─────────────────────────────────────────────────────── */
  const deskImg = $("#desk-img"), deskCaps = $$("#desk-caps .cap");
  const look = (fx, fy, s) => ({ scale: s, xPercent: (50 - fx) * s, yPercent: (50 - fy) * s, duration: 0.14 });
  gsap.set("#slab", { rotationX: 28, yPercent: 30, scale: 0.8, transformPerspective: 1800, transformOrigin: "50% 100%" });
  const desk = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: ".desk", start: "top top", end: "+=340%", pin: "#desk-pin", scrub: 0.5, anticipatePin: 1,
      onUpdate(self) { setCap(deskCaps, band(self.progress, [0.3, 0.5, 0.66, 0.82, 0.96])); } },
  });
  desk
    .to("#slab", { rotationX: 0, yPercent: 0, scale: 1, duration: 0.22 }, 0)
    .to("#desk-head", { opacity: 0, y: -40, duration: 0.1 }, 0.1)
    .to(deskImg, look(22, 53, 2.0), 0.3)      // the Dex bar
    .to(deskImg, look(9, 41, 2.2), 0.5)       // the Operating Score
    .to(deskImg, look(70, 25, 1.6), 0.66)     // the tiles
    .to(deskImg, look(50, 85, 1.5), 0.82)     // the sheet
    .to(deskImg, look(50, 50, 1), 0.96);

  /* ── 4 · Two desks ────────────────────────────────────────────────────── */
  gsap.from("#laptop", { y: 60, opacity: 0, duration: 0.9, ease: EASE, scrollTrigger: { trigger: "#two-devices", start: "top 75%", toggleActions: "play none none reverse" } });
  gsap.from("#two-phone", { y: 80, x: 40, opacity: 0, duration: 0.9, delay: 0.15, ease: EASE, scrollTrigger: { trigger: "#two-devices", start: "top 75%", toggleActions: "play none none reverse" } });
  gsap.to(["#sync-a", "#sync-b"], { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.35, ease: "back.out(1.6)", scrollTrigger: { trigger: "#two-devices", start: "top 45%", toggleActions: "play none none reverse" } });

  /* ── 5 · It chases ────────────────────────────────────────────────────── */
  const evs = $$(".ev"), clock = $("#clock"), toast = $("#toast");
  gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: ".chase", start: "top top", end: "+=300%", pin: "#chase-pin", scrub: 0.5, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate(self) {
        const p = self.progress, mins = 9 * 60 + 10 + p * (8 * 60 + 30);
        clock.textContent = String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(Math.floor(mins % 60)).padStart(2, "0");
        evs.forEach((e, i) => e.classList.toggle("on", p >= i / 5 - 0.03));
        toast.classList.toggle("on", p > 0.79 && p < 0.98);
      } },
  }).to("#day", { x: () => -1.3 * vw(), duration: 1 }, 0);

  /* ── 6 · Ask ──────────────────────────────────────────────────────────── */
  gsap.from("#ask-phone", { y: 60, opacity: 0, duration: 0.9, ease: EASE, scrollTrigger: { trigger: ".ask", start: "top 70%", toggleActions: "play none none reverse" } });
  let askFrame = 0, askTimer = 0, askI = 0;
  function askNext() {
    const [q, a] = QA[askI++ % QA.length], t0 = performance.now();
    answer.classList.remove("on"); askA.textContent = "";
    const typeQ = (now) => {
      const k = Math.min(q.length, Math.floor((now - t0) / 26)); askQ.textContent = q.slice(0, k);
      if (k < q.length) askFrame = requestAnimationFrame(typeQ);
      else askTimer = setTimeout(() => { answer.classList.add("on"); const t1 = performance.now();
        const typeA = (n2) => { const m = Math.min(a.length, Math.floor((n2 - t1) / 12)); askA.textContent = a.slice(0, m); if (m < a.length) askFrame = requestAnimationFrame(typeA); else askTimer = setTimeout(askNext, 3200); };
        askFrame = requestAnimationFrame(typeA); }, 500);
    };
    askFrame = requestAnimationFrame(typeQ);
  }
  ScrollTrigger.create({ trigger: ".ask", start: "top 70%", end: "bottom 20%", onToggle: (s) => { cancelAnimationFrame(askFrame); clearTimeout(askTimer); if (s.isActive) askNext(); } });

  /* ── 7 · Stages ───────────────────────────────────────────────────────── */
  gsap.from(".st", { y: 24, opacity: 0, duration: 0.52, ease: EASE, stagger: 0.07, scrollTrigger: { trigger: "#rail", start: "top 80%", toggleActions: "play none none reverse" } });
  gsap.to("#rail-fill", { scaleX: 0.4, ease: "none", scrollTrigger: { trigger: "#rail", start: "top 80%", end: "top 40%", scrub: 0.5 } });

  /* ── 8 · Score + brief ────────────────────────────────────────────────── */
  const score = { v: 0 }, scoreN = $("#score-n");
  gsap.to(score, { v: 72, duration: 1.6, ease: EASE, onUpdate() { scoreN.textContent = Math.round(score.v); },
    scrollTrigger: { trigger: "#score-big", start: "top 75%", once: true, onEnter: () => $("#score-big").classList.add("live") } });
  ScrollTrigger.create({ trigger: "#brief-sheet", start: "top 75%", once: true, onEnter: () => writeBrief(0, false) });
  gsap.from("#brief-sheet", { y: 40, opacity: 0, duration: 0.9, ease: EASE, scrollTrigger: { trigger: "#brief-sheet", start: "top 80%", toggleActions: "play none none reverse" } });

  /* ── 9 · Who: a strip the scroll slides ───────────────────────────────── */
  const track = $("#who-track");
  gsap.to(track, { x: () => Math.min(0, vw() - track.scrollWidth - vw() * 0.12), ease: "none",
    scrollTrigger: { trigger: ".who", start: "top top", end: () => "+=" + Math.max(500, track.scrollWidth * 0.9), pin: "#who-pin", scrub: 0.5, anticipatePin: 1, invalidateOnRefresh: true } });

  /* ── 10 · Pricing, 12 · the call ──────────────────────────────────────── */
  gsap.from(".plan", { y: 30, opacity: 0, duration: 0.6, ease: EASE, stagger: 0.08, scrollTrigger: { trigger: ".plans", start: "top 80%", toggleActions: "play none none reverse" } });
  gsap.from("#final-phone", { y: 140, rotation: -2, opacity: 0, duration: 1.2, ease: EASE, scrollTrigger: { trigger: ".final", start: "top 60%", toggleActions: "play none none reverse" } });

  /* Headings wipe in once. */
  gsap.utils.toArray(".h2, .final .display").forEach((h) => {
    gsap.from(h, { clipPath: "inset(0 100% 0 0)", duration: 0.72, ease: EASE, scrollTrigger: { trigger: h, start: "top 85%", once: true } });
  });

  window.addEventListener("load", () => ScrollTrigger.refresh());
})();
