import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Globe, MagnifyingGlass, CheckCircle, PencilSimple } from "@phosphor-icons/react";
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

export function WebsiteIntel({ companyName, onDone }) {
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

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="signup-website">
      <AnimatePresence mode="wait">
        {stage === "ask" && (
          <motion.div key="ask" {...fade} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            <p className="label-mono text-brand-600 mb-3">Your world</p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-2">
              Does {companyName} live on the web?
            </h1>
            <p className="text-sm text-muted-foreground mb-8">Drop your website — our AI reads it so you don't have to explain yourself twice.</p>
            <div className="flex items-center gap-3 border-b-2 border-border focus-within:border-brand-600 transition-colors">
              <Globe size={26} weight="bold" className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                data-testid="signup-website-input"
                placeholder="yourcompany.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); analyse(); } }}
                className="w-full bg-transparent py-3 font-heading text-2xl sm:text-3xl font-bold tracking-tight placeholder:text-black/20 placeholder:font-normal focus:outline-none"
              />
            </div>
            <div className="mt-8 flex items-center gap-5">
              <button onClick={analyse} disabled={!url.trim()} data-testid="signup-website-analyse"
                className="flex items-center gap-2 bg-brand-600 text-white font-medium text-sm px-8 py-3.5 border border-border hover:-translate-y-0.5 transition-all disabled:opacity-40">
                <MagnifyingGlass size={16} weight="bold" /> Read my website
              </button>
              <button onClick={() => setStage("manual")} data-testid="signup-website-skip"
                className="text-sm font-semibold text-muted-foreground hover:text-brand-ink underline underline-offset-4 transition-colors">
                No website — set it manually
              </button>
            </div>
          </motion.div>
        )}

        {stage === "scanning" && (
          <motion.div key="scan" {...fade} className="text-center py-10" data-testid="signup-website-scanning">
            <div className="relative w-28 h-28 mx-auto mb-10">
              <motion.div className="absolute inset-0 border-2 border-brand-600"
                animate={{ rotate: 90, scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }} />
              <motion.div className="absolute inset-3 border border-border bg-white flex items-center justify-center"
                animate={{ rotate: -90 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }}>
                <Globe size={36} weight="bold" className="text-brand-ink" />
              </motion.div>
            </div>
            <p className="font-display text-2xl mb-3">Reading {url.replace(/^https?:\/\//, "")}</p>
            <AnimatePresence mode="wait">
              <motion.p key={scanLine} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="text-sm text-muted-foreground font-mono">{SCAN_LINES[scanLine]}</motion.p>
            </AnimatePresence>
          </motion.div>
        )}

        {stage === "confirm" && intel && (
          <motion.div key="confirm" {...fade} transition={{ duration: 0.35 }}>
            <p className="label-mono text-brand-600 mb-3">We did our homework</p>
            <h1 className="font-display text-3xl sm:text-4xl leading-[1.02] mb-6">
              Here's what we learned.
            </h1>
            <div className="border border-border bg-white shadow-md p-6 space-y-5" data-testid="signup-intel-card">
              <p className="text-base leading-relaxed">{intel.summary}</p>
              {intel.highlights?.length > 0 && (
                <div className="space-y-1.5">
                  {intel.highlights.map((h, i) => (
                    <motion.div key={h} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.12 }}
                      className="flex items-center gap-2 text-sm">
                      <CheckCircle size={16} weight="fill" className="text-brand-600 shrink-0" /> {h}
                    </motion.div>
                  ))}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                <div>
                  <label className="label-mono text-muted-foreground">Industry</label>
                  <select data-testid="signup-intel-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}
                    className="w-full mt-1 border border-border bg-white px-3 py-2.5 text-sm font-mono focus:outline-none focus:shadow-sm">
                    {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-mono text-muted-foreground">You sell to</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {MODELS.map((m) => (
                      <button key={m} data-testid={`signup-model-${m}`} onClick={() => setModel(m)}
                        className={`px-3 py-1.5 border border-border text-xs font-medium transition-colors ${model === m ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {intel.products?.length > 0 && (
                <div>
                  <label className="label-mono text-muted-foreground">What you offer</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {intel.products.map((p) => (
                      <span key={p.name} className="px-2.5 py-1 border border-border bg-caution-50/30 text-xs font-mono">{p.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center gap-5">
              <button onClick={() => finish(true)} data-testid="signup-intel-confirm"
                className="flex items-center gap-2 bg-primary text-primary-foreground font-medium text-sm px-8 py-3.5 border border-border hover:-translate-y-0.5 transition-all">
                That's us <ArrowRight size={16} weight="bold" />
              </button>
              <button onClick={() => setStage("manual")} data-testid="signup-intel-edit"
                className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-brand-ink underline underline-offset-4 transition-colors">
                <PencilSimple size={14} weight="bold" /> Not quite — let me fix it
              </button>
            </div>
          </motion.div>
        )}

        {stage === "manual" && (
          <motion.div key="manual" {...fade} transition={{ duration: 0.35 }}>
            <p className="label-mono text-brand-600 mb-3">Your world</p>
            <h1 className="font-display text-3xl sm:text-4xl leading-[1.02] mb-2">
              Place {companyName} on the map.
            </h1>
            <p className="text-sm text-muted-foreground mb-8">Just the industry and who you sell to — Dex will ask about your operations in the interview.</p>
            <div className="space-y-5">
              <div>
                <label className="label-mono text-muted-foreground">Industry</label>
                <select autoFocus data-testid="signup-manual-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}
                  className="w-full mt-1 border border-border bg-white px-3 py-3 text-sm font-mono focus:outline-none focus:shadow-sm">
                  <option value="">Select industry…</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className="label-mono text-muted-foreground">You sell to</label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {MODELS.map((m) => (
                    <button key={m} data-testid={`signup-manual-model-${m}`} onClick={() => setModel(m)}
                      className={`px-4 py-2 border border-border text-xs font-medium transition-colors ${model === m ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => finish(false)} disabled={!industry} data-testid="signup-manual-continue"
              className="mt-7 flex items-center gap-2 bg-primary text-primary-foreground font-medium text-sm px-8 py-3.5 border border-border hover:-translate-y-0.5 transition-all disabled:opacity-40">
              Continue <ArrowRight size={16} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
