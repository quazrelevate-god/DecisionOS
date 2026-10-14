/* CLIENT SCREENSHOT vs NOW — the type-size check (2026-10-13).
 *
 * The client tested 1.0.7 on a 6.1-inch-class Android and said the text was
 * small for the screen. Much has changed since, so this answers the question
 * the only honest way: their screenshot on the left, the app as it is now on
 * the right, at the SAME CSS width and drawn at the same size — so a word that
 * is bigger now is visibly bigger, not bigger on someone's say-so.
 *
 * THE SCREENSHOT NEVER LEAVES THIS TAB. It is read with an object URL, shown,
 * and dropped: nothing is uploaded, saved, or bundled into the app — a client's
 * screen carries their real names and numbers, and that is theirs.
 *
 * The CSS width is what decides how big type looks on a given phone, and it is
 * guessed from the screenshot's pixel width (1080px is a 412-wide Android at
 * 2.625×); a resized or cropped screenshot can be set by hand. The table under
 * the frames reads the text sizes live from the right-hand frame — what is on
 * screen, after the phone's 0.8 UI scale — beside what the client's 1.0.7 build
 * drew, measured from that build at 412 CSS px.
 */
import { useEffect, useRef, useState } from "react";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { REAL_DATA_FRAME } from "../../fixtures/mobile/names";

const WIDTHS = [
  { value: "360", label: "360 · small Android (720 px wide)" },
  { value: "384", label: "384 · OnePlus 7T class" },
  { value: "390", label: "390 · iPhone 13 / 14" },
  { value: "393", label: "393 · Pixel 8, iPhone 15 / 16" },
  { value: "402", label: "402 · iPhone 17 Pro" },
  { value: "412", label: "412 · most 6.1–6.7″ Android (1080 px wide)" },
  { value: "430", label: "430 · iPhone Pro Max" },
];
// A full-resolution screenshot's width gives its CSS width away.
const BY_PIXELS = { 720: 360, 1080: 412, 1440: 412, 1170: 390, 1179: 393, 1206: 402, 1290: 430, 1320: 440 };
const guessWidth = (px) => {
  const w = BY_PIXELS[px];
  const pick = w ? WIDTHS.reduce((a, o) => (Math.abs(+o.value - w) < Math.abs(+a.value - w) ? o : a)) : null;
  return pick ? pick.value : "412";
};

/* What the client's 1.0.7 build drew, in on-screen CSS px (= dp on Android),
   measured from that exact build (commit 5331bf9) at 412 CSS px. */
const V107 = {
  greeting: 21.1, score: 44.8, kpiLabel: 11.2, kpiNumber: 28.8, workflowTitle: 11.2,
  workflowButton: 12, tab: 11.2, rowTitle: 13.6, rowMeta: 12, showAll: 11.2, dockLabel: 11.2,
};
const ROWS = [
  ["greeting", "Greeting"],
  ["score", "Score"],
  ["kpiLabel", "KPI label (“Delayed”)"],
  ["kpiNumber", "KPI number"],
  ["workflowTitle", "Workflow card name"],
  ["workflowButton", "Workflow buttons"],
  ["tab", "Desk tabs"],
  ["rowTitle", "Sheet row title"],
  ["rowMeta", "Sheet row second line"],
  ["showAll", "Show all"],
  ["dockLabel", "Dock labels"],
];
// Android's floor for readable text is 12sp; anything under it is flagged.
const FLOOR = 12;
const DISPLAY_W = 360;

/** On-screen font sizes in the frame, after its CSS zoom. */
function measureType(doc) {
  const vis = (e) => {
    if (!e) return null;
    const z = e.currentCSSZoom || 1;
    return +(parseFloat(doc.defaultView.getComputedStyle(e).fontSize) * z).toFixed(1);
  };
  const leaf = (root, re) => root && [...root.querySelectorAll("*")].find((e) => e.children.length === 0 && re.test(e.textContent.trim()));
  const q = (s) => doc.querySelector(s);
  const delayed = q('[data-testid="kpi-delayed"]');
  const row = q('[data-testid="desk-phone-card-card"] [data-row]');
  return {
    greeting: vis(q('[data-testid="desk-brief-greeting"] span') || q('[data-testid="desk-brief-greeting"]')),
    score: vis(q('[data-testid="desk-score-link-phone"] .font-display')),
    kpiLabel: vis(leaf(delayed, /^Delayed$/)),
    kpiNumber: vis(leaf(delayed, /^\d+$/)),
    workflowTitle: vis(q('[data-testid="kpi-workflows-next-title"]')),
    workflowButton: vis(q('[data-testid="kpi-workflows-open"]')),
    tab: vis(q('[data-testid="desk-tab-decisions"]')),
    rowTitle: vis(row && row.querySelector('[class*="desk-row-title"]')),
    rowMeta: vis(row && row.querySelector('[class*="desk-row-meta"]')),
    showAll: vis(q('[data-testid="desk-phone-more"]')),
    dockLabel: vis(q('[data-testid="dock-slider-items"] .dock-item span')),
  };
}

export default function ScreenshotCompare({ alone = false }) {
  const [shot, setShot] = useState(null); // { url, w, h, name }
  const [cssW, setCssW] = useState("412");
  const [fullPhone, setFullPhone] = useState(true);
  const [now, setNow] = useState(null);
  const [over, setOver] = useState(false);
  const frame = useRef(null);
  const input = useRef(null);

  // The object URL is this tab's only copy; let it go when it is replaced.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const take = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setShot({ url, w: img.naturalWidth, h: img.naturalHeight, name: file.name });
      setCssW(guessWidth(img.naturalWidth));
      // A phone is taller than 2:1 nowadays; a screenshot wider than that has
      // had its status and navigation bars cropped off.
      setFullPhone(img.naturalWidth / img.naturalHeight > 0.5);
    };
    img.src = url;
  };

  const w = +cssW;
  const cropped = shot && shot.w / shot.h > 0.5;
  const h = shot && !fullPhone ? Math.round(w * (shot.h / shot.w)) : Math.round(w * (20 / 9));
  const k = DISPLAY_W / w;

  useEffect(() => {
    const t = setInterval(() => {
      try { const doc = frame.current?.contentDocument; if (doc?.body) setNow(measureType(doc)); } catch { /* not ready */ }
    }, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="mb-10" data-testid="lab-shot-compare">
      <h2 className="font-heading text-lg font-semibold">Client screenshot vs now — text size</h2>
      <p className="mb-3 mt-1 max-w-[75ch] text-sm text-muted-foreground">
        Drop a screenshot from a phone and the Desk as it is now renders beside it at the same CSS
        width, drawn at the same size. The screenshot stays in this browser tab — it is not
        uploaded, saved or added to the app. The table reads the text sizes live from the right-hand
        frame (on-screen CSS px, which is dp on Android) beside what the client&apos;s 1.0.7 build drew.
        {!alone && (
          <>
            {" "}The rest of this lab keeps a dozen live Desks busy, so the frame can be slow to fill
            here —{" "}
            <a href="/design-lab?only=compare" target="_blank" rel="noreferrer" data-testid="lab-shot-alone"
              className="font-semibold text-primary underline-offset-2 hover:underline">open it on its own</a>.
          </>
        )}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} data-testid="lab-shot-pick"
          className="nm-btn rounded-pill px-4 py-2 text-sm font-semibold">
          {shot ? "Use another screenshot" : "Choose a screenshot"}
        </button>
        <input ref={input} type="file" accept="image/*" className="hidden" data-testid="lab-shot-input"
          onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="w-80">
          <GlassSelect variant="field" value={cssW} onChange={setCssW} options={WIDTHS}
            ariaLabel="The phone's CSS width" testid="lab-shot-width" />
        </div>
        {shot && (
          <button type="button" onClick={() => setFullPhone((v) => !v)} data-testid="lab-shot-height"
            className="nm-btn rounded-pill px-3 py-2 text-sm">
            {fullPhone ? "Height: full 20:9 phone" : "Height: same as the screenshot"}
          </button>
        )}
      </div>
      {shot && (
        <p className="mb-3 text-xs text-muted-foreground" data-testid="lab-shot-info">
          {shot.w}×{shot.h}px{cropped ? " — looks cropped (no status or navigation bar), so the frame is a full phone" : ""} · frame {w}×{h} CSS px
        </p>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <figure className="m-0 shrink-0">
          <figcaption className="mb-1.5 text-sm font-semibold">The screenshot</figcaption>
          {shot ? (
            <img src={shot.url} alt="The phone screenshot being compared" data-testid="lab-shot-image"
              className="nm-raised block" style={{ width: DISPLAY_W, height: "auto" }} />
          ) : (
            <div
              data-testid="lab-shot-drop"
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
              onClick={() => input.current?.click()}
              className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground ${over ? "border-primary bg-primary/5" : "border-border"}`}
              style={{ width: DISPLAY_W, height: Math.round(DISPLAY_W * (20 / 9)) }}
            >
              Drop a phone screenshot here, or click to choose one.
            </div>
          )}
        </figure>

        <figure className="m-0 shrink-0">
          <figcaption className="mb-1.5 text-sm font-semibold">Now · {w}×{h} CSS px</figcaption>
          <div className="nm-raised overflow-hidden" style={{ width: DISPLAY_W, height: Math.round(h * k) }}>
            <iframe
              ref={frame}
              title="The Desk now"
              /* Real data, always: the lab's other frames leave a fixture set for
                 the tab, and a fixture's Desk is not what a client's phone shows.
                 The frame's NAME is what holds it to real data (fixtures/mobile). */
              name={REAL_DATA_FRAME}
              src="/inbox?fixture=off"
              data-testid="lab-shot-frame"
              style={{ width: w, height: h, border: 0, transform: `scale(${k})`, transformOrigin: "0 0" }}
            />
          </div>
        </figure>

        <div className="min-w-[22rem]" data-testid="lab-shot-table">
          <p className="mb-1.5 text-sm font-semibold">On-screen text size (dp)</p>
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1.5 pr-4 font-medium">Text</th>
                <th className="pb-1.5 pr-4 text-right font-medium">1.0.7</th>
                <th className="pb-1.5 pr-4 text-right font-medium">Now</th>
                <th className="pb-1.5 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([key, label]) => {
                const was = V107[key];
                const is = now?.[key];
                const pct = is && was ? Math.round(((is - was) / was) * 100) : null;
                return (
                  <tr key={key} className="border-t border-border/60" data-testid={`lab-shot-row-${key}`}>
                    <td className="py-1.5 pr-4">{label}</td>
                    <td className={`py-1.5 pr-4 text-right tabular-nums ${was < FLOOR ? "text-danger-700" : ""}`}>{was}</td>
                    <td className={`py-1.5 pr-4 text-right tabular-nums ${is != null && is < FLOOR ? "text-danger-700" : ""}`}>{is ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{pct == null ? "" : `${pct > 0 ? "+" : ""}${pct}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 max-w-[22rem] text-xs text-muted-foreground">
            Red is under Android&apos;s 12sp floor for readable text. “—” means that piece is not on
            the screen right now (no rows loaded, or a different tab).
          </p>
        </div>
      </div>
    </section>
  );
}
