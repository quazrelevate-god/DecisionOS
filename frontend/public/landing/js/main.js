// DecisionOS landing page — interactivity only, no framework needed.

/* ==========================================================================
   Scroll inertia. One rAF loop keeps a smoothed scroll position that chases
   the real one. Everything scroll-driven reads Inertia.lag (real minus
   smoothed) and adds it to its own getBoundingClientRect maths, so the whole
   page settles into place instead of snapping frame-for-frame to the wheel.
   ========================================================================== */
const Inertia = (() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = reduce ? 1 : 0.16;   // ~0.5s settle on a wheel notch
  let smooth = window.scrollY;
  let lag = 0;
  let raf = null;
  const subs = [];

  const step = () => {
    const y = window.scrollY;
    smooth += (y - smooth) * EASE;
    if (Math.abs(y - smooth) < 0.5) smooth = y;   // sub-pixel: stop the loop
    lag = y - smooth;
    for (let i = 0; i < subs.length; i++) subs[i]();
    raf = lag !== 0 ? requestAnimationFrame(step) : null;
  };

  const kick = () => { if (raf === null) raf = requestAnimationFrame(step); };

  window.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('resize', () => { smooth = window.scrollY; kick(); });

  return {
    get lag() { return lag; },
    sub(fn) { subs.push(fn); fn(); },
    kick
  };
})();

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- sticky header shadow + mobile nav ---------- */
  const header = document.getElementById('site-header');
  const navToggle = document.getElementById('nav-toggle');

  // Header stays out of the way over the hero, then swipes down once you scroll past it.
  const hero = document.getElementById('top');
  let ticking = false;

  const syncHeader = () => {
    const trigger = hero ? hero.offsetHeight * 0.55 : 360;
    const show = window.scrollY > trigger;
    header.classList.toggle('is-visible', show);
    if (!show && header.classList.contains('nav-open')) {
      header.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
    ticking = false;
  };

  syncHeader();
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(syncHeader);
    }
  }, { passive: true });

  /* ---------- pinned hero defocuses as §2 climbs over it ---------- */
  if (hero && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const driveHero = () => {
      // Smoothed position, so the blur eases in rather than tracking the wheel.
      const y = window.scrollY - Inertia.lag;
      const travel = Math.max(1, hero.offsetHeight * 0.82);
      hero.style.setProperty('--hp', Math.min(1, Math.max(0, y / travel)).toFixed(3));
    };
    Inertia.sub(driveHero);
    window.addEventListener('resize', driveHero);
  }

  navToggle.addEventListener('click', () => {
    const isOpen = header.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.querySelectorAll('.mobile-nav a').forEach(link => {
    link.addEventListener('click', () => {
      header.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- parallax: grid drifts behind the panel as the section passes ---------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- sky: scatter stars across three depth planes ---------- */
  const starField = document.getElementById('sky-stars');
  const stars = [];
  if (starField) {
    // Deterministic scatter, so the sky looks identical on every load.
    let seed = 20260815;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 70; i++) {
      const depth = rand();                    // 0 = far, 1 = near
      const size = 1 + depth * 2.4;            // nearer stars read larger
      const star = document.createElement('span');
      star.className = 'sky-star';
      star.style.cssText =
        `left:${(rand() * 100).toFixed(2)}%;` +
        `top:${(rand() * 100).toFixed(2)}%;` +
        `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
        `opacity:${(0.28 + depth * 0.62).toFixed(2)};`;
      starField.appendChild(star);
      // Near stars travel furthest; far ones barely move.
      stars.push({ el: star, shift: 26 + depth * 150 });
    }
  }
  const layers = Array.from(document.querySelectorAll('[data-parallax]')).map(el => ({
    el,
    // Grid travels furthest; the panel drifts the other way, so they separate in depth.
    depth: el.dataset.parallax === 'grid' ? 70 : -14
  }));

  const skySection = document.querySelector('.final-cta');
  const clouds = document.querySelector('.sky-clouds');

  if ((layers.length || stars.length) && !reduceMotion) {
    const drawParallax = () => {
      const vh = window.innerHeight;
      const lag = Inertia.lag;   // where the page *was*, not where the bar is

      layers.forEach(({ el, depth }) => {
        const host = el.dataset.parallax === 'grid' ? el.parentElement : el.closest('section');
        const rect = host.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > vh + 200) return;
        const top = rect.top + lag;
        // -1 when the section sits below the fold, +1 once it has passed above it.
        const progress = (top + rect.height / 2 - vh / 2) / vh;
        el.style.transform = `translate3d(0, ${(progress * depth).toFixed(2)}px, 0)`;
      });

      if (skySection && stars.length) {
        const rect = skySection.getBoundingClientRect();
        if (rect.bottom > -200 && rect.top < vh + 200) {
          const progress = (rect.top + lag + rect.height / 2 - vh / 2) / vh;
          stars.forEach(({ el, shift }) => {
            el.style.transform = `translate3d(0, ${(progress * shift).toFixed(2)}px, 0)`;
          });
          if (clouds) clouds.style.transform = `translate3d(0, ${(progress * 42).toFixed(2)}px, 0)`;
        }
      }

      parallaxTicking = false;
    };

    Inertia.sub(drawParallax);
    window.addEventListener('resize', drawParallax);
  }

  /* ---------- flow stage: only animate while it is actually on screen ---------- */
  const flowStage = document.querySelector('.flow-stage');
  if (flowStage && 'IntersectionObserver' in window) {
    flowStage.classList.add('is-paused');
    new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        flowStage.classList.toggle('is-paused', !entry.isIntersecting);
      });
    }, { rootMargin: '120px' }).observe(flowStage);
  }

  /* ---------- accordions (AI Departments + FAQ) ---------- */
  document.querySelectorAll('.accordion').forEach(accordion => {
    const items = accordion.querySelectorAll('.accordion-item');
    items.forEach(item => {
      const trigger = item.querySelector('.accordion-trigger');
      trigger.addEventListener('click', () => {
        const willOpen = !item.classList.contains('is-open');
        items.forEach(i => {
          i.classList.remove('is-open');
          i.querySelector('.accordion-trigger').setAttribute('aria-expanded', 'false');
        });
        if (willOpen) {
          item.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });
    });
  });

  /* ---------- early access form (front-end only for now) ---------- */
  const earlyForm = document.getElementById('early-form');
  const formNote = document.getElementById('form-note');
  if (earlyForm) {
    earlyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = earlyForm.name.value.trim().split(' ')[0];
      formNote.textContent = `Thanks${name ? ', ' + name : ''} — we'll reach out shortly.`;
      earlyForm.reset();
    });
  }

});

/* ---------- scroll-triggered counters, rail, DNA graph, brief tabs, modal ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Count up to a target the first time the element scrolls into view.
  const countUp = (el, to, ms) => {
    const out = el.querySelector('.wc-num, .sd-val') || el;
    if (reduce) { out.textContent = String(to); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      out.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const once = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (el.hasAttribute('data-count-to')) { el.classList.add('is-on'); countUp(el, +el.dataset.countTo, 1600); }
      if (el.hasAttribute('data-rail')) el.classList.add('is-on');
      if (el.classList.contains('dna-stage')) el.classList.add('is-on');
      once.unobserve(el);
    });
  }, { threshold: 0.35 });

  document.querySelectorAll('[data-count-to], [data-rail], .dna-stage').forEach(el => once.observe(el));

  // CEO Brief cycles its four cadences so the product explains itself.
  const brief = document.querySelector('[data-brief]');
  if (brief && !reduce) {
    const tabs = brief.querySelectorAll('.bb-tabs span');
    const slides = brief.querySelectorAll('.bb-slide');
    let i = 0, timer = null;
    const show = (n) => {
      tabs.forEach((t, k) => t.classList.toggle('on', k === n));
      slides.forEach((sl, k) => sl.classList.toggle('on', k === n));
    };
    const play = () => { timer = setInterval(() => { i = (i + 1) % slides.length; show(i); }, 2600); };
    new IntersectionObserver((es) => {
      es.forEach(e => {
        if (e.isIntersecting && !timer) play();
        else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
      });
    }, { threshold: 0.25 }).observe(brief);
  }

  // Ghost word drifts against the scroll.
  const ghost = document.querySelector('[data-ghost]');
  if (ghost && !reduce) {
    const draw = () => {
      const host = ghost.closest('section').getBoundingClientRect();
      const top = host.top + Inertia.lag;
      const p = (top + host.height / 2 - window.innerHeight / 2) / window.innerHeight;
      ghost.style.transform = `translate(-50%,-50%) translateY(${(p * -110).toFixed(1)}px)`;
    };
    Inertia.sub(draw);
  }

  /* ---------- early-access modal ---------- */
  const modal = document.getElementById('access-modal');
  const opener = document.getElementById('open-access');
  if (modal && opener) {
    let lastFocus = null;
    const open = () => {
      lastFocus = document.activeElement;
      modal.hidden = false;
      requestAnimationFrame(() => modal.classList.add('is-open'));
      document.body.classList.add('modal-open');
      modal.querySelector('input').focus();
    };
    const close = () => {
      modal.classList.remove('is-open');
      document.body.classList.remove('modal-open');
      setTimeout(() => { modal.hidden = true; }, 350);
      if (lastFocus) lastFocus.focus();
    };
    opener.addEventListener('click', open);
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
    // Keep tabbing inside the dialog while it is open.
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = modal.querySelectorAll('button, input');
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    const form = document.getElementById('access-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const first = form.name.value.trim().split(' ')[0];
      document.getElementById('modal-note').textContent = `Thanks${first ? ', ' + first : ''} — we'll be in touch shortly.`;
      form.reset();
    });
  }
});

/* ---------- scroll-progress driver: roadmap rail ---------- */
document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const rail = document.querySelector('[data-rail]');
  if (!rail) return;
  const stops = Array.from(rail.querySelectorAll('.rail-stop'));

  // 0 as the section enters the viewport, 1 once it has travelled through it.
  const progress = (el) => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    return Math.max(0, Math.min(1, (vh - (r.top + Inertia.lag)) / (vh + r.height * 0.55)));
  };

  const draw = () => {
    const p = progress(rail.closest('section'));
    // Remap so the line only starts once the section is genuinely in view.
    const eased = Math.max(0, Math.min(1, (p - 0.18) / 0.5));
    rail.style.setProperty('--p', eased.toFixed(3));
    stops.forEach((stop, i) => {
      stop.classList.toggle('lit', eased >= i / (stops.length - 1) - 0.02);
    });
  };

  Inertia.sub(draw);
  window.addEventListener('resize', draw);
});


/* ---------- S3: pair each raw/solved pill to one shared width ----------
   The slice only reads as a single object being cut if both halves share the
   exact same box, but each pill should still hug its own text on one line.
   So measure the natural width of both copies and give the pair the larger. */
document.addEventListener('DOMContentLoaded', () => {
  const rawItems  = document.querySelectorAll('.lane-raw  .flow-item');
  const doneItems = document.querySelectorAll('.lane-done .flow-item');
  if (!rawItems.length || rawItems.length !== doneItems.length) return;

  const pair = () => {
    rawItems.forEach((rawItem, i) => {
      const doneItem = doneItems[i];
      const measure = [rawItem.querySelector('.fi-raw'), doneItem.querySelector('.fi-done')];
      measure.forEach(el => { el.style.width = 'auto'; });
      const w = Math.ceil(Math.max(measure[0].getBoundingClientRect().width,
                                   measure[1].getBoundingClientRect().width)) + 1;
      // Both lanes hold both spans, so all four copies need the shared width.
      [rawItem, doneItem].forEach(host => {
        host.querySelectorAll('.fi-raw, .fi-done').forEach(el => { el.style.width = w + 'px'; });
      });
    });
  };

  pair();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(pair);
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(pair, 180); });
});

/* ---------- start micro-loops only when their section is reached ---------- */
document.addEventListener('DOMContentLoaded', () => {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.bento-section, .orbit-section, .flow-section')
      .forEach(s => s.classList.add('is-live'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-live');   // finite counts mean they settle on their own
      io.unobserve(e.target);
    });
  }, { threshold: 0.2 });
  document.querySelectorAll('.bento-section, .orbit-section, .flow-section').forEach(s => io.observe(s));
});
