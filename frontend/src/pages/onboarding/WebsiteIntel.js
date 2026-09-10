import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Globe, MagnifyingGlass, CheckCircle } from "@phosphor-icons/react";
import api from "../../lib/api";
import { INDUSTRIES } from "../../lib/format";

const MODELS = ["B2B", "B2C", "B2B & B2C", "D2C", "Marketplace", "Services"];
const SCAN_LINES = [
  "Opening your homepage…",
  "Reading what you do…",
  "Spotting your products & services…",
  "Mapping your industry…",
  "Almost there…",
];

const fade = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -20 } };

// The eyebrow used across the onboarding steps.
const Eyebrow = ({ children }) => (
  <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</p>
);

export function WebsiteIntel({ companyName, onDone, onBack }) {
  const [stage, setStage] = useState("ask"); // ask | scanning | confirm | manual
  const [url, setUrl] = useState("");
  const [scanLine, setScanLine] = useState(0);
  const [intel, setIntel] = useState(null);
  const [industry, setIndustry] = useState("");
  const [model, setModel] = useState("");
  const scanTimer = useRef(null);

  useEffect(() => {
    if (stage !== "scanning") { clearInterval(scanTimer.current); return; }
    scanTimer.current = setInterval(() => setScanLine((i) => Math.min(i + 1, SCAN_LINES.length - 1)), 1600);
    return () => clearInterval(scanTimer.current);
  }, [stage]);

  const analyse = async () => {
    if (!url.trim()) return;
    setStage("scanning"); setScanLine(0);
    try {
      const { data } = await api.post("/signup/website-intel", { url: url.trim(), company_name: companyName });
      if (data.fetched) {
        setIntel(data);
        setIndustry(data.industry || "");
        setModel(data.business_model || "");
        setStage("confirm");
        return;
      }
    } catch (e) { console.debug("website-intel scan failed — falling back to manual", e); }
    setStage("manual");
  };

  const finish = (fromIntel) => {
    onDone({
      website_url: url.trim(),
      website_summary: fromIntel ? (intel?.summary || "") : "",
      industry: industry || "Other",
      business_model: model,
      description: fromIntel ? (intel?.summary || "") : "",
      products: fromIntel ? (intel?.products || []) : [],
    });
  };

  /* KM-62 — Back, on every reversible stage. Founder: "add back functionality
     by adding a button to go back and edit their response for every step."
     From the first stage it leaves the phase entirely and returns to Basics;
     from a result it returns to the address, so a mistyped URL can be redone
     without starting the signup again. `scanning` is excluded on purpose —
     there is a request in flight and nothing yet to go back to. */
  const backTarget = stage === "ask" ? "phase" : stage === "scanning" ? null : "ask";
  const goBack = () => {
    if (!backTarget) return;
    if (backTarget === "phase") onBack?.();
    else setStage("ask");
  };

  return (
    <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-website">
      <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
      <AnimatePresence mode="wait">
        {stage === "ask" && (
          <motion.div key="ask" {...fade} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            <Eyebrow>Your world</Eyebrow>
            <h1 className="mb-2 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
              Does {companyName} live on the web?
            </h1>
            <p className="mb-7 text-sm text-muted-foreground">Drop your website — our AI reads it so you don&apos;t have to explain yourself twice.</p>
            <div className="kr-pressed flex items-center gap-3 rounded-2xl px-5 py-4 focus-within:ring-2 focus-within:ring-[hsl(var(--kr-gold))]">
              <Globe size={24} weight="bold" className="shrink-0 text-muted-foreground" />
              <input
                autoFocus
                data-testid="signup-website-input"
                placeholder="yourcompany.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); analyse(); } }}
                className="w-full bg-transparent text-xl font-semibold tracking-tight placeholder:font-normal placeholder:text-foreground/25 focus:outline-none sm:text-2xl"
              />
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button onClick={analyse} disabled={!url.trim()} data-testid="signup-website-analyse"
                className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-7 text-sm font-medium text-white disabled:opacity-40">
                <MagnifyingGlass size={16} weight="bold" /> Read my website
              </button>
              <button onClick={() => setStage("manual")} data-testid="signup-website-skip"
                className="kr-pop flex h-12 items-center rounded-pill px-6 text-sm font-medium text-muted-foreground">
                No website — set it manually
              </button>
            </div>
          </motion.div>
        )}

        {stage === "scanning" && (
          <motion.div key="scan" {...fade} className="text-center py-10" data-testid="signup-website-scanning">
            {/* The scanner. Two counter-rotating squares in the retired
                black-outline style became a sunken dial with a gold sweep —
                the same "light passing over material" the build screen uses,
                so scanning and building read as one machine. */}
            <div className="kr-pressed relative mx-auto mb-9 grid h-28 w-28 place-items-center overflow-hidden rounded-full">
              <motion.div
                aria-hidden="true"
                className="absolute inset-0 rounded-full"
                style={{ background: "conic-gradient(from 0deg, transparent 0deg, hsl(var(--kr-gold) / .55) 60deg, transparent 130deg)" }}
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }}
              />
              <div className="kr-pop relative grid h-[4.75rem] w-[4.75rem] place-items-center rounded-full">
                <Globe size={32} weight="bold" className="text-foreground" />
              </div>
            </div>
            <p className="mb-3 font-display text-2xl">Reading {url.replace(/^https?:\/\//, "")}</p>
            <AnimatePresence mode="wait">
              <motion.p key={scanLine} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="text-sm text-muted-foreground">{SCAN_LINES[scanLine]}</motion.p>
            </AnimatePresence>
          </motion.div>
        )}

        {stage === "confirm" && intel && (
          <motion.div key="confirm" {...fade} transition={{ duration: 0.35 }}>
            <Eyebrow>We did our homework</Eyebrow>
            <h1 className="mb-6 font-display text-3xl leading-[1.04] sm:text-4xl">
              Here&apos;s what we learned.
            </h1>
            {/* .kr-frost-min, not .kr-bento: this card sits INSIDE the pane's
                own glass, and stacking a second blurred fill on a blurred
                surface reads as neither glass nor solid (see the note on
                .kr-frost-min in index.css). */}
            <div className="kr-frost-min space-y-5 rounded-2xl p-5" data-testid="signup-intel-card">
              <p className="text-base leading-relaxed">{intel.summary}</p>
              {intel.highlights?.length > 0 && (
                <div className="space-y-1.5">
                  {intel.highlights.map((h, i) => (
                    <motion.div key={h} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.12 }}
                      className="flex items-center gap-2 text-sm">
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-foreground/70" /> {h}
                    </motion.div>
                  ))}
                </div>
              )}
              <div className="grid gap-4 border-t border-white/50 pt-4 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Industry</label>
                  <select data-testid="signup-intel-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}
                    className="kr-pressed mt-1.5 h-11 w-full rounded-pill bg-transparent px-4 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kr-gold))]">
                    {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">You sell to</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {MODELS.map((m) => (
                      <button key={m} data-testid={`signup-model-${m}`} onClick={() => setModel(m)}
                        className={`flex h-9 items-center rounded-pill px-4 text-xs font-medium ${model === m ? "kr-pressed" : "kr-pop"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {intel.products?.length > 0 && (
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">What you offer</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {intel.products.map((p) => (
                      <span key={p.name} className="kr-pop rounded-pill px-3 py-1.5 text-xs">{p.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* KM-62 — "Not quite, let me fix it" is gone, and its absence is
                the fix. Founder: "there is a button to let user configure the
                data on their own, but the irony is it again shows the same
                editable data fields which was already there in the previous
                page."

                They are right, and it was worse than redundant: the manual
                stage DISCARDS the scan. finish(false) sends no summary, no
                description and no products, so a founder who pressed "fix it"
                to change one dropdown silently threw away everything the scan
                had learned about them — and then handed the interview a
                thinner profile to work from.

                The two fields above are already live and already saved by
                "That's us". The manual stage stays reachable from "No website
                — set it manually", where it is the only path and nothing has
                been scanned to lose. */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button onClick={() => finish(true)} data-testid="signup-intel-confirm"
                className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-7 text-sm font-medium text-white">
                That&apos;s us <ArrowRight size={16} weight="bold" />
              </button>

            </div>
          </motion.div>
        )}

        {stage === "manual" && (
          <motion.div key="manual" {...fade} transition={{ duration: 0.35 }}>
            <Eyebrow>Your world</Eyebrow>
            <h1 className="mb-2 font-display text-3xl leading-[1.04] sm:text-4xl">
              Place {companyName} on the map.
            </h1>
            <p className="mb-7 text-sm text-muted-foreground">Just the industry and who you sell to — Dex will ask about your operations in the interview.</p>
            <div className="space-y-5">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Industry</label>
                <select autoFocus data-testid="signup-manual-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}
                  className="kr-pressed mt-1.5 h-12 w-full rounded-pill bg-transparent px-4 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kr-gold))]">
                  <option value="">Select industry…</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">You sell to</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {MODELS.map((m) => (
                    <button key={m} data-testid={`signup-manual-model-${m}`} onClick={() => setModel(m)}
                      className={`flex h-10 items-center rounded-pill px-4 text-xs font-medium ${model === m ? "kr-pressed" : "kr-pop"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => finish(false)} disabled={!industry} data-testid="signup-manual-continue"
              className="kr-pop mt-7 flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-8 text-sm font-medium text-white disabled:opacity-40">
              Continue <ArrowRight size={16} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {backTarget && (
        <button onClick={goBack} data-testid="signup-website-back"
          className="kr-pop mt-8 flex h-9 items-center gap-1.5 rounded-pill px-4 text-xs font-medium text-muted-foreground">
          <ArrowLeft size={14} weight="bold" /> Back
        </button>
      )}
      </div>
    </div>
  );
}
