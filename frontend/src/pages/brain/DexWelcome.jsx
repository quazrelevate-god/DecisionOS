/**
 * DEX-R1 (2026-10-08) — /brain before anything has been asked.
 *
 * A greeting and four real questions. The old opener was a 312px orb and the
 * line "Ask Dex anything", which told the founder nothing about what Dex can
 * answer; the fastest way to learn a chat surface is to watch it answer once,
 * so the questions ARE the explanation (generative-ai › Transparency: offer
 * curated suggestions for an open-ended prompt).
 *
 * The questions are a list, not tiles: they are read top to bottom and each
 * is one sentence, which is what a list is for.
 */
import { ArrowUpRight, Info, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export const OPENERS = [
  "What needs my attention today?",
  "Show all tasks completed on time this month",
  "Which employees have the most overdue tasks?",
  "Show outstanding customer invoices",
];

function greetingFor(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * @param {string}   name    the founder's first name, if known
 * @param {boolean}  canAsk  false: this person has the page but not Ask AI
 * @param {string}   noAsk   what to tell them instead
 * @param {Function} onAsk
 */
export function DexWelcome({ name, canAsk, noAsk, onAsk }) {
  return (
    /* Left-aligned to the composer's edge, not centred on its own: the mark,
       the greeting, the questions and the bar below share one left line, so
       the page reads as one column (layout › Visual hierarchy). */
    <div className="dex-rise w-full max-w-[640px]" data-testid="brain-empty">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-kr-ink text-white" aria-hidden="true">
        <Sparkle size={20} weight="fill" />
      </span>
      <h1 className="mt-5 font-display text-[32px] font-semibold leading-[40px] tracking-[-0.015em] text-foreground">
        {greetingFor()}{name ? `, ${name}` : ""}
      </h1>
      <p className="mt-2 text-[16px] leading-6 text-muted-foreground">
        Ask about anything in your company — money owed, work running late,
        who is on what. Dex answers from your own records and shows you which.
      </p>

      {canAsk ? (
        <section className="mt-8" aria-labelledby="dex-try">
          <h2 id="dex-try" className="mb-2 text-[13px] font-medium leading-[18px] text-muted-foreground">Try asking</h2>
          <ul className="nm-raised overflow-hidden rounded-[20px]">
            {OPENERS.map((q, i) => (
              <li key={q} className="relative">
                {i > 0 && <span aria-hidden="true" className="absolute left-4 right-0 top-0 h-px bg-[hsl(var(--nm-edge)/0.45)]" />}
                <button
                  type="button"
                  onClick={() => onAsk(q)}
                  data-testid="ask-suggestion"
                  className={cn(
                    "group flex min-h-[52px] w-full items-center justify-between gap-4 px-4 py-3 text-left text-[15px] leading-[22px] text-foreground transition-colors hover:bg-foreground/[0.03]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/30"
                  )}
                >
                  {q}
                  <ArrowUpRight size={16} weight="bold" className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-8 flex gap-3 rounded-[20px] border border-nm-edge/60 bg-white/75 px-4 py-3.5 text-[15px] leading-[22px] text-foreground" data-testid="brain-no-ask">
          <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          {noAsk}
        </p>
      )}
    </div>
  );
}

export default DexWelcome;
