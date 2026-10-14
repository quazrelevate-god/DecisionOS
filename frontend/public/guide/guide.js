/* DecisionOS guide — shows each step on the real screen, whole, with the control
   it talks about ringed in gold (2026-10-12, founder: no zoomed crops and no
   floating lens — everything within the screen), and keeps the navigation quick:
   role paths, search ("/"), a chapter rail on big screens and a contents sheet
   on phones. All geometry is in percentages of a 390×844 phone, so the same
   numbers lay out at any size and in print. */
(() => {
  "use strict";
  const W = 390, H = 844, PAD = 7;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const ROLE = { owner: "Owner", manager: "Manager", member: "Team member" };
  const src = (shot) => `/guide/shots/${shot}.webp?v=3`;
  let SHOTS = {};

  /* ── Geometry ─────────────────────────────────────────────────────────── */
  function boxOf(shot, target) {
    const s = SHOTS[shot];
    if (!s || !target) return null;
    let b = null;
    for (const k of target.split("+")) {
      const v = s[k];
      if (!v) continue;
      const [x, y, w, h] = v;
      b = b ? { l: Math.min(b.l, x), t: Math.min(b.t, y), r: Math.max(b.r, x + w), b: Math.max(b.b, y + h) }
            : { l: x, t: y, r: x + w, b: y + h };
    }
    if (!b) return null;
    const l = Math.max(PAD, b.l), t = Math.max(PAD, b.t), r = Math.min(W - PAD, b.r), bb = Math.min(H - PAD, b.b);
    return { x: l, y: t, w: Math.max(8, r - l), h: Math.max(8, bb - t) };
  }
  const pct = (v) => `${(v * 100).toFixed(3)}%`;

  /** Place a ring inside a box that represents the whole 390×844 screen. */
  function placeRing(ring, box) {
    if (!box) { ring.style.opacity = "0"; return; }
    ring.style.opacity = "1";
    ring.style.left = pct((box.x - PAD) / W);
    ring.style.top = pct((box.y - PAD) / H);
    ring.style.width = pct((box.w + PAD * 2) / W);
    ring.style.height = pct((box.h + PAD * 2) / H);
  }

  /* A phone mockup.
     STATIC phones (each step's own screen on a phone, the hero, print) hold ONE
     image: it is set once and never hidden, so nothing can leave it blank.
     The LIVE phone (a chapter's stage on a computer) changes with the step and
     cross-fades between two images.

     2026-10-13 — THE SWAP IS DRIVEN BY ONE PROMISE PER REQUEST, AND ONLY THE
     LATEST REQUEST MAY FINISH. It used to listen for `load` AND check
     `complete`: for a cached screen both fire — `complete` at once, `load` a
     moment later — so the swap ran twice and the second run flipped the phone's
     idea of which image was in front. From then on, going back to a screen the
     hidden image already held looked like "already showing" and did nothing:
     the founder's "the mockup doesn't change until I refresh". Now each change
     is numbered, waits on img.decode() (one settle, cached or not), and a stale
     or late finish is simply ignored. */
  function makePhone(alt, { live = false, lazy = false } = {}) {
    const phone = el("div", "phone");
    const screen = el("div", "screen");
    const front = el("img");
    front.alt = alt || ""; front.decoding = "async";
    if (lazy) front.loading = "lazy";
    screen.append(front);
    let back = null;
    if (live) {
      back = el("img", "out");
      back.alt = ""; back.decoding = "async";
      screen.append(back);
    }
    const ring = el("div", "ring");
    const badge = el("span", "badge");
    ring.append(badge);
    screen.append(ring);
    phone.append(screen);
    return { phone, screen, front, back, live, shown: "", token: 0, ring, badge };
  }

  /* Settles once the image's current src is decoded (or has failed). */
  function ready(img) {
    if (img.decode) return img.decode();
    return new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth) return resolve();
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(), { once: true });
    });
  }

  function setPhone(p, shot, target, n, alt) {
    const url = src(shot);
    const box = boxOf(shot, target);
    const label = () => {
      placeRing(p.ring, box);
      p.badge.textContent = String(n || "");
      p.badge.style.display = n ? "" : "none";
    };
    if (!p.live) {
      if (p.front.getAttribute("src") !== url) p.front.src = url;
      p.front.alt = alt || "";
      label();
      return;
    }
    const token = ++p.token;
    if (p.shown === url) { p.front.alt = alt || ""; label(); return; }
    const back = p.back;
    if (back.getAttribute("src") !== url) back.src = url;
    const show = () => {
      if (token !== p.token) return;           // a newer step was picked meanwhile
      back.alt = alt || "";
      p.front.alt = "";
      back.classList.remove("out");
      p.front.classList.add("out");
      p.back = p.front;
      p.front = back;
      p.shown = url;
      label();
    };
    // A failed decode still shows the step (a broken image beats a wrong one).
    ready(back).then(show, () => { if (back.getAttribute("src") === url) show(); });
  }

  /* ── Chapters ─────────────────────────────────────────────────────────── */
  const chapters = $$(".chapter");
  const plain = (html) => { const d = el("div"); d.innerHTML = html; return d.textContent.replace(/\s+/g, " ").trim(); };
  const pad2 = (i) => String(i + 1).padStart(2, "0");

  function buildChapter(ch, idx) {
    // Header: number, who it is for, where it lives.
    const meta = el("div", "ch-meta");
    meta.append(el("span", "ch-num", pad2(idx)));
    const roles = (ch.dataset.roles || "").split(" ").filter(Boolean);
    if (roles.length && roles.length < 3) roles.forEach((r) => meta.append(el("span", "chip", ROLE[r])));
    else meta.append(el("span", "chip", "Everyone"));
    if (ch.dataset.where) meta.append(el("span", "chip where", ch.dataset.where));
    ch.insertBefore(meta, ch.firstElementChild);

    const ol = $(".steps", ch);
    if (!ol) return;
    const tip = $(".tip", ch);
    const body = el("div", "ch-body");
    const left = el("div");
    ol.replaceWith(body);
    left.append(ol);
    if (tip) left.append(tip);
    body.append(left);

    const stage = el("div", "stage");
    const phone = makePhone("", { live: true });
    const caption = el("p", "stage-caption");
    stage.append(phone.phone, caption);
    body.append(stage);

    const steps = $$(":scope > li", ol);
    const data = steps.map((li, i) => {
      const d = { shot: li.dataset.shot, target: li.dataset.target, html: li.innerHTML, n: i + 1 };
      li.className = "step";
      li.innerHTML = "";
      const btn = el("button", "step-btn");
      btn.type = "button";
      btn.append(el("span", "step-n", String(i + 1)), el("span", "step-text", d.html));
      li.append(btn);
      if (d.shot) {
        // Phones and print: the step carries its own screen, whole, ringed.
        const holder = el("div", "step-phone");
        const p = makePhone(plain(d.html), { lazy: true });
        holder.append(p.phone);
        setPhone(p, d.shot, d.target, i + 1, plain(d.html));
        li.append(holder);
      }
      return d;
    });

    let active = -1;
    const activate = (i, focus) => {
      if (i === active || !data[i]) return;
      active = i;
      steps.forEach((li, k) => {
        li.classList.toggle("active", k === i);
        $(".step-btn", li).setAttribute("aria-current", k === i ? "step" : "false");
      });
      const d = data[i];
      if (d.shot) setPhone(phone, d.shot, d.target, d.n, plain(d.html));
      caption.textContent = `Step ${d.n} of ${data.length}`;
      if (focus) $(".step-btn", steps[i]).focus();
    };
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    steps.forEach((li, i) => {
      const btn = $(".step-btn", li);
      btn.addEventListener("click", () => activate(i));
      btn.addEventListener("mouseenter", () => { if (fine.matches) activate(i); });
      btn.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); activate(Math.min(i + 1, steps.length - 1), true); }
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); activate(Math.max(i - 1, 0), true); }
      });
    });
    activate(0);
    ch._activate = activate;
  }

  function buildFooters() {
    const list = chapters;
    list.forEach((ch, i) => {
      const foot = el("div", "ch-foot");
      const prev = list[i - 1], next = list[i + 1];
      if (prev) { const a = el("a", "prev", `<small>Previous</small>${$("h2", prev).textContent}`); a.href = `#${prev.id}`; foot.append(a); }
      if (next) { const a = el("a", "next", `<small>Next</small>${$("h2", next).textContent}`); a.href = `#${next.id}`; foot.append(a); }
      ch.append(foot);
    });
  }

  /* ── Navigation: rail, contents sheet, role paths ─────────────────────── */
  const rail = $(".rail");
  const tocList = $(".toc-list");
  function buildNav(container) {
    let group = null;
    chapters.forEach((ch, i) => {
      if (ch.dataset.group !== group) {
        group = ch.dataset.group;
        container.append(el("div", "rail-group", group));
      }
      const a = el("a", "", `<span class="k">${pad2(i)}</span>${$("h2", ch).textContent}`);
      a.href = `#${ch.id}`;
      a.dataset.ch = ch.id;
      container.append(a);
    });
  }

  function setRole(role) {
    if (!ROLE[role]) role = "owner";
    try { localStorage.setItem("dos-guide-role", role); } catch { /* private mode */ }
    document.body.dataset.role = role;
    $$(".role").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === role)));
    const mine = (ch) => (ch.dataset.roles || "").split(" ").includes(role);
    chapters.forEach((ch) => ch.classList.toggle("not-yours", !mine(ch)));
    $$("a[data-ch]").forEach((a) => a.classList.toggle("dim", !mine(document.getElementById(a.dataset.ch))));
    const path = $(".path-list");
    path.innerHTML = "";
    chapters.filter((ch) => mine(ch) && ch.id !== "faq").forEach((ch) => {
      const li = el("li");
      const a = el("a", "", $("h2", ch).textContent);
      a.href = `#${ch.id}`;
      li.append(a);
      path.append(li);
    });
  }

  function spy() {
    const label = $(".toc-pill .label");
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = e.target.id;
        $$("a[data-ch]").forEach((a) => a.classList.toggle("active", a.dataset.ch === id));
        if (label) label.textContent = $("h2", e.target).textContent;
        const ra = $(`.rail a[data-ch="${id}"]`);
        if (ra && rail) {
          const r = ra.getBoundingClientRect(), rr = rail.getBoundingClientRect();
          if (r.top < rr.top || r.bottom > rr.bottom) ra.scrollIntoView({ block: "nearest" });
        }
      });
    }, { rootMargin: "-35% 0px -55% 0px" });
    chapters.forEach((ch) => io.observe(ch));
  }

  /* ── Search ───────────────────────────────────────────────────────────── */
  let INDEX = [];
  function buildIndex() {
    INDEX = [];
    chapters.forEach((ch) => {
      const title = $("h2", ch).textContent;
      const kw = ch.dataset.keywords || "";
      const lede = $(".lede", ch)?.textContent || "";
      INDEX.push({ id: ch.id, step: -1, title, text: `${lede}`, kw, weight: 2 });
      // Keywords rank the chapter; a step has to say the word itself.
      $$(".step", ch).forEach((li, i) => INDEX.push({ id: ch.id, step: i, title, text: $(".step-text", li).textContent, kw: "", weight: 1 }));
      $$("details", ch).forEach((d) => INDEX.push({ id: ch.id, step: -1, title: d.querySelector("summary").textContent, text: d.querySelector("p").textContent, kw: "", weight: 1 }));
    });
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function search(q) {
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (!terms.length) return [];
    const out = [];
    for (const it of INDEX) {
      const T = it.title.toLowerCase(), X = it.text.toLowerCase(), K = it.kw.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const s = (it.step < 0 && T.includes(t) ? 6 : 0) + (K.includes(t) ? 3 : 0) + (X.includes(t) ? 2 : 0);
        if (!s) { score = 0; break; }
        score += s;
      }
      if (score) out.push({ ...it, score: score * it.weight });
    }
    out.sort((a, b) => b.score - a.score);
    const seen = new Set();
    return out.filter((r) => { const k = `${r.id}:${r.step}:${r.title}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  }
  function snippet(text, terms) {
    const low = text.toLowerCase();
    const first = Math.min(...terms.map((t) => { const i = low.indexOf(t); return i < 0 ? Infinity : i; }));
    const at = Number.isFinite(first) ? Math.max(0, first - 30) : 0;
    let s = (at > 0 ? "…" : "") + text.slice(at, at + 110);
    s = esc(s);
    terms.forEach((t) => { s = s.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<mark>$1</mark>"); });
    return s;
  }
  function go(r) {
    closeToc();
    const ch = document.getElementById(r.id);
    if (!ch) return;
    if (r.step >= 0 && ch._activate) ch._activate(r.step);
    const target = r.step >= 0 ? $$(".step", ch)[r.step] : ch;
    history.replaceState(null, "", `#${r.id}`);
    (target || ch).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: r.step >= 0 ? "center" : "start" });
  }
  function wireSearch(input, box, { onEmpty } = {}) {
    let results = [], sel = 0;
    const render = () => {
      const q = input.value.trim();
      const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      results = search(q);
      sel = 0;
      if (!q) { box.innerHTML = ""; box.classList.remove("open"); input.setAttribute("aria-expanded", "false"); onEmpty?.(true); return; }
      onEmpty?.(false);
      box.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      box.innerHTML = results.length
        ? results.map((r, i) => `<button type="button" class="result" role="option" aria-selected="${i === 0}" data-i="${i}"><b>${esc(r.title)}</b><span>${snippet(r.text || r.title, terms)}</span></button>`).join("")
        : `<div class="results-empty">Nothing for “${esc(q)}”. Try “approve”, “leave” or “invoice”.</div>`;
    };
    const mark = () => $$(".result", box).forEach((b, i) => b.setAttribute("aria-selected", String(i === sel)));
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
      else if (e.key === "Enter" && results[sel]) { e.preventDefault(); go(results[sel]); input.value = ""; render(); input.blur(); }
      else if (e.key === "Escape") { input.value = ""; render(); input.blur(); }
    });
    box.addEventListener("click", (e) => {
      const b = e.target.closest(".result");
      if (!b) return;
      go(results[+b.dataset.i]);
      input.value = ""; render();
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target) && e.target !== input) box.classList.remove("open"); });
    input.addEventListener("focus", () => { if (input.value.trim()) box.classList.add("open"); });
  }

  /* ── Contents sheet (phones) ──────────────────────────────────────────── */
  const sheet = $(".toc-sheet");
  let lastFocus = null;
  function openToc() {
    lastFocus = document.activeElement;
    document.body.classList.add("toc-open");
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("shown")));
    setTimeout(() => $("#toc-search")?.focus({ preventScroll: true }), 250);
    const act = $(".toc-list a.active");
    act?.scrollIntoView({ block: "center" });
  }
  function closeToc() {
    if (!document.body.classList.contains("toc-open")) return;
    sheet.classList.remove("shown");
    setTimeout(() => document.body.classList.remove("toc-open"), 300);
    lastFocus?.focus?.({ preventScroll: true });
  }

  /* ── Boot ─────────────────────────────────────────────────────────────── */
  async function boot() {
    try { SHOTS = (await (await fetch("/guide/shots.json?v=3")).json()).shots || {}; } catch { SHOTS = {}; }

    // The hero phone.
    const hero = $(".hero-stage .phone[data-shot]");
    if (hero) {
      const p = makePhone(hero.dataset.alt);
      hero.replaceWith(p.phone);
      p.phone.querySelector(".ring").classList.add("hero-ring");
      setPhone(p, hero.dataset.shot, hero.dataset.target, 0, hero.dataset.alt);
    }

    chapters.forEach(buildChapter);
    buildFooters();
    if (rail) buildNav(rail);
    if (tocList) buildNav(tocList);
    buildIndex();

    const fromUrl = new URLSearchParams(location.search).get("role");
    let saved = null;
    try { saved = localStorage.getItem("dos-guide-role"); } catch { /* private mode */ }
    setRole(fromUrl || saved || "owner");
    $$(".role").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
    spy();

    const top = $("#search");
    if (top) wireSearch(top, $("#results"));
    const ts = $("#toc-search");
    if (ts) wireSearch(ts, $(".toc-results"), { onEmpty: (empty) => { tocList.style.display = empty ? "" : "none"; } });
    document.addEventListener("keydown", (e) => {
      const typing = /input|textarea|select/i.test(document.activeElement?.tagName || "");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        if (top && top.offsetParent) top.focus(); else openToc();
      }
      if (e.key === "Escape") closeToc();
    });
    $$("[data-open-toc]").forEach((b) => b.addEventListener("click", openToc));
    $$("[data-close-toc]").forEach((b) => b.addEventListener("click", closeToc));
    tocList?.addEventListener("click", (e) => { if (e.target.closest("a")) closeToc(); });

    // Arrived on a deep link (the app opens #start, #decide …): land on it once the page has its height.
    window.addEventListener("beforeprint", () => $$(".step-phone img[loading=lazy]").forEach((i) => { i.loading = "eager"; }));

    if (location.hash) {
      const t = document.getElementById(location.hash.slice(1));
      if (t) requestAnimationFrame(() => t.scrollIntoView({ block: "start" }));
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
