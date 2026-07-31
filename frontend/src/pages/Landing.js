import { Link } from "react-router-dom";
import {
  Sparkle, Microphone, TreeStructure, Brain, ChartLineUp, Package,
  Storefront, UsersThree, Gear, ArrowRight, CheckCircle, WarningCircle, Lightning,
} from "@phosphor-icons/react";

const Logo = ({ size = "md" }) => {
  const box = size === "sm" ? "w-8 h-8" : "w-9 h-9";
  const dtext = size === "sm" ? "text-lg" : "text-xl";
  const word = size === "sm" ? "text-xl" : "text-2xl";
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${box} bg-primary rounded-lg flex items-center justify-center shrink-0`}>
        <span className={`font-logo font-black text-white ${dtext} leading-none`}>D</span>
      </div>
      <span className={`font-logo font-black ${word} tracking-tight leading-none`}>
        <span className="text-white">Decision</span><span className="text-brand-400">OS</span>
      </span>
    </div>
  );
};

const NavBar = () => (
  <header className="sticky top-0 z-50 bg-[#16161a]/90 backdrop-blur-md border-b border-white/10">
    <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
      <Logo />
      <div className="flex items-center gap-2 sm:gap-3">
        <Link to="/login" data-testid="landing-login-btn"
          className="text-white/90 hover:text-white text-sm font-semibold px-3 sm:px-4 py-2 transition-colors">
          Log in
        </Link>
        <Link to="/login?signup=1" data-testid="landing-signup-btn"
          className="bg-primary text-primary-foreground text-sm font-semibold px-4 sm:px-5 py-2 border border-primary hover:bg-surface hover:text-brand-400 transition-colors rounded-md">
          Sign up
        </Link>
      </div>
    </div>
  </header>
);

const Kicker = ({ children, big }) => (
  <div className={`text-label tracking-[0.25em] mb-4 text-brand-400 ${big ? "text-sm sm:text-base" : "text-xs"}`}>{children}</div>
);

const Dept = ({ icon: Icon, tag, title, children }) => (
  <div className="border-2 border-hairline bg-surface p-6 hover:shadow-sm transition-all rounded-lg">
    <div className="flex items-center gap-2 text-brand-400 mb-2"><Icon size={18} weight="bold" /><span className="text-label text-[11px]">{tag}</span></div>
    <h3 className="font-extrabold tracking-tight text-lg">{title}</h3>
    <p className="text-sm text-text-secondary mt-1">{children}</p>
  </div>
);

export default function Landing() {
  return (
    <div className="bg-surface text-[#16161a]" data-testid="landing-page">
      <NavBar />

      {/* HERO */}
      <section className="bg-[#16161a] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <Kicker big>The Operating Brain for Founder-Led Businesses</Kicker>
          <h1 className="font-black tracking-tight text-5xl sm:text-6xl lg:text-7xl leading-[1.02]">
            Speak the decision.<br /><span className="text-brand-400">We run</span> the company.
          </h1>
          <div className="h-1.5 w-20 bg-primary my-8" />
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl leading-relaxed">
            The AI operating system that remembers every decision, organises every task, and executes the way your business actually runs — from voice notes and WhatsApp to paper bills.
          </p>
          <div className="flex flex-wrap gap-3 mt-10">
            <Link to="/login?signup=1" data-testid="hero-signup-btn"
              className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-semibold px-6 py-3 border border-primary hover:bg-surface hover:text-brand-400 transition-colors rounded-md">
              Get started free <ArrowRight size={16} weight="bold" />
            </Link>
            <a href="#how" className="flex items-center gap-2 border border-white/40 text-white text-sm font-semibold px-6 py-3 hover:bg-surface hover:text-[#16161a] transition-colors rounded-md">
              See how it works
            </a>
          </div>
          <p className="text-label text-[11px] text-white/40 mt-8">Voice · Text · WhatsApp · Documents — captured once, executed forever</p>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="bg-[#f7f5f2]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <Kicker>The Founder Problem</Kicker>
          <h2 className="font-black tracking-tight text-3xl sm:text-4xl leading-tight max-w-2xl">Your business lives inside your head. That's the risk.</h2>
          <div className="grid sm:grid-cols-2 gap-5 mt-10">
            <div className="border-2 border-[#16161a] bg-[#16161a] text-white p-6 rounded-lg">
              <div className="text-label text-xs text-white/50 mb-2">The old way</div>
              <p className="text-white/90">Founder remembers → tells someone → hopes it happens → chases → repeats. Decisions evaporate, work scatters, nothing is provable, and you become the bottleneck.</p>
            </div>
            <div className="border-2 border-[#16161a] bg-surface p-6 rounded-lg">
              <div className="text-label text-xs text-brand-400 mb-2">The DecisionOS way</div>
              <p>Founder speaks → AI captures, routes, assigns, tracks, chases, and remembers it forever. One place where nothing is lost, ignored, or left undone.</p>
            </div>
          </div>
        </div>
      </section>

      {/* WOW */}
      <section className="bg-[#16161a] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <Kicker dark>The 10-Second Wow</Kicker>
          <h2 className="font-black tracking-tight text-3xl sm:text-4xl leading-tight max-w-3xl">One sentence. A company-wide rule, <span className="text-brand-400">enforced.</span></h2>
          <div className="mt-10 space-y-4 max-w-3xl">
            <div className="border-l-4 border-primary pl-5 py-2">
              <div className="text-label text-[11px] text-brand-400/90">Second 0 — the owner speaks</div>
              <p className="font-black text-xl sm:text-2xl mt-1 leading-snug">"From today, stop any dispatch that doesn't have payment approval."</p>
            </div>
            <div className="border-l-4 border-primary pl-5 py-2">
              <div className="text-label text-[11px] text-brand-400/90">Second 3 — the AI understands</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Operating Rule", "Trigger: Dispatch", "Condition: Payment approved", "Scope: Company-wide"].map((c, i) => (
                  <span key={c} className={`text-xs font-semibold rounded-pill px-3 py-1 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-surface/10 text-white border border-white/20"}`}>{c}</span>
                ))}
              </div>
            </div>
            <div className="border-l-4 border-primary pl-5 py-2">
              <div className="text-label text-[11px] text-brand-400/90">Second 10 — the business changes</div>
              <div className="mt-2 border border-white/15 bg-surface/5 p-4 rounded-md">
                <p className="text-white/90"><CheckCircle size={16} weight="fill" className="inline text-brand-400 mr-1" /> Rule live across the dispatch workflow · teams notified · exceptions escalate to the owner · filed to the Company Brain.</p>
              </div>
            </div>
          </div>
          <p className="text-lg mt-8 max-w-2xl">Not a to-do — <span className="text-brand-400 font-semibold">an operational change, running itself.</span></p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="bg-surface">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <Kicker>Decision Flow</Kicker>
          <h2 className="font-black tracking-tight text-3xl sm:text-4xl leading-tight">Capture → Execute → Remember.</h2>
          <div className="grid md:grid-cols-3 gap-5 mt-10">
            {[
              { icon: Microphone, t: "Capture", d: "Speak it, type it, forward it, or upload it. Voice, text, WhatsApp, PDFs and photos — the channels your team already uses." },
              { icon: TreeStructure, t: "Execute", d: "AI classifies, extracts and routes to the right department. On approval it creates tasks, invoices, payments, contacts and finance entries — with owners and due dates." },
              { icon: Brain, t: "Remember", d: "Every decision, approval and rupee is filed into the Company Brain — searchable in plain English, forever." },
            ].map((s, i) => (
              <div key={s.t} className="border-2 border-hairline p-6 relative rounded-lg">
                <div className="font-black text-5xl text-text/10 absolute top-4 right-5">{i + 1}</div>
                <s.icon size={26} weight="bold" className="text-brand-400" />
                <h3 className="font-extrabold tracking-tight text-xl mt-3">{s.t}</h3>
                <p className="text-sm text-text-secondary mt-2">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROACTIVE */}
      <section className="bg-[#f7f5f2]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <Kicker>Proactive Intelligence</Kicker>
          <h2 className="font-black tracking-tight text-3xl sm:text-4xl leading-tight">It doesn't wait to be asked.</h2>
          <p className="text-text-secondary mt-3 max-w-2xl">DecisionOS watches the business and speaks up first — surfacing the risk and the recommended action before it costs you money.</p>
          <div className="grid sm:grid-cols-2 gap-4 mt-8">
            {[
              { t: "Cash flow", a: "₹45,000 overdue to a vendor — due today.", r: "→ Confirm terms & clear payment." },
              { t: "Inventory", a: "Stock won't cover next week's orders.", r: "→ Raise a purchase order now." },
              { t: "Delayed orders", a: "A dispatch is 2 days past due, no update.", r: "→ Nudge owner & notify customer." },
              { t: "Workload", a: "A teammate has 5 open, 1 overdue.", r: "→ Reassign or extend." },
            ].map((x) => (
              <div key={x.t} className="border-2 border-hairline bg-surface p-5 rounded-lg">
                <div className="flex items-center gap-2 text-brand-400 mb-2"><WarningCircle size={16} weight="bold" /><span className="text-label text-[11px]">{x.t}</span></div>
                <p className="font-semibold text-sm">{x.a}</p>
                <p className="text-sm text-text-secondary mt-1">{x.r}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-lg">Every alert is <span className="text-brand-400 font-semibold">one tap from action</span> — turn it into a task, assign it, done.</p>
        </div>
      </section>

      {/* AI DEPARTMENTS */}
      <section className="bg-surface">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <Kicker>AI Departments</Kicker>
          <h2 className="font-black tracking-tight text-3xl sm:text-4xl leading-tight">Every function, quietly on autopilot.</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            <Dept icon={ChartLineUp} tag="Finance" title="The AI CFO">Snap a bill — AI reads & files it. Live spend, outstanding, assets & inventory, plus a ranked action brief.</Dept>
            <Dept icon={Package} tag="Inventory" title="Stock in the open">Track items, quantities & value; purchase bills flow into the ledger and the Brain.</Dept>
            <Dept icon={Storefront} tag="Sales" title="Nothing slips">Orders, invoices, follow-ups & dispatch workflows — captured from a message and driven to done.</Dept>
            <Dept icon={UsersThree} tag="HR & People" title="Team & leave">Leave with AI impact-routing, a CRM-lite people hub, and coaching for every member.</Dept>
            <Dept icon={Gear} tag="Operations" title="The daily heartbeat">A morning CEO Brief — done, open, overdue, needs-a-decision — with auto follow-ups & escalations.</Dept>
            <Dept icon={Brain} tag="Company Brain" title="Total recall">Ask your business anything in plain English and get the answer from your real history in seconds.</Dept>
          </div>
        </div>
      </section>

      {/* WHY */}
      <section className="bg-[#16161a] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <Kicker dark>Why DecisionOS?</Kicker>
          <h2 className="font-black tracking-tight text-3xl sm:text-4xl leading-tight">Not a chatbot. Not a clunky ERP. <span className="text-brand-400">An operating brain.</span></h2>
          <div className="grid sm:grid-cols-3 gap-5 mt-10">
            {[
              { t: "Permanent company memory", d: "Every decision & record remembered — not forgotten each chat, not just rows of data." },
              { t: "Turns talk into action", d: "Tasks, records and rules — executed. Not text out, not manual data entry." },
              { t: "Learns how you operate", d: "Your Business DNA compounds over time — the foundation for AI managers." },
            ].map((x) => (
              <div key={x.t} className="border border-white/15 bg-surface/5 p-6 rounded-md">
                <Lightning size={20} weight="bold" className="text-brand-400" />
                <h3 className="font-extrabold tracking-tight text-base mt-3">{x.t}</h3>
                <p className="text-sm text-white/60 mt-1">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-neutral-900 text-text-inverse">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 text-center">
          <Sparkle size={30} weight="fill" className="mx-auto mb-5" />
          <h2 className="font-black tracking-tight text-3xl sm:text-5xl leading-tight max-w-3xl mx-auto">Every business decision — remembered, organized, and executed.</h2>
          <div className="flex flex-wrap gap-3 justify-center mt-10">
            <Link to="/login?signup=1" data-testid="cta-signup-btn"
              className="flex items-center gap-2 bg-surface text-brand-400 text-sm font-semibold px-7 py-3 border border-white hover:bg-transparent hover:text-white transition-colors rounded-md">
              Start free <ArrowRight size={16} weight="bold" />
            </Link>
            <Link to="/login" data-testid="cta-login-btn"
              className="border border-white/60 text-white text-sm font-semibold px-7 py-3 hover:bg-surface hover:text-brand-400 transition-colors rounded-md">
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#16161a] text-white/50">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <div className="flex items-center gap-6 text-sm">
            <a href="/DecisionOS-Vision.pdf" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Vision doc</a>
            <Link to="/login" className="hover:text-white transition-colors">Log in</Link>
            <Link to="/login?signup=1" className="hover:text-white transition-colors">Sign up</Link>
          </div>
          <div className="text-label text-[11px]">© 2026 DecisionOS</div>
        </div>
      </footer>
    </div>
  );
}
