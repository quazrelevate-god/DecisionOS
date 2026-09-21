/* Work left behind — what happens to the open tasks on a stage a card leaves.
 *
 * Yokesh, 2026-09-21: "a review section where you show these are three, four
 * tasks left — which should be done, which shouldn't, which should still be —
 * but think frictionless." Used everywhere a card can leave a stage with open
 * work: the board's move, the card's own "Move on", and a decision that jumps a
 * card forward.
 *
 * FRICTIONLESS BY DEFAULT: every task starts on "Keep" — still to do, it moves
 * with the card and holds the next stage like any other work — so the one-tap
 * answer loses nothing. "Set all" handles the usual case (it's all done / none
 * of it matters any more) in one more tap; a single task is one tap too.
 * The three choices are the app's own pills, never an operating-system picker.
 */
import { Check, X, ArrowRight, CalendarBlank } from "@phosphor-icons/react";

export const LEFTOVER_CHOICES = [
  { key: "done", label: "Done", icon: Check, hint: "It was done — close it" },
  { key: "not_needed", label: "Not needed", icon: X, hint: "No longer needed — cancel it" },
  { key: "keep", label: "Keep", icon: ArrowRight, hint: "Still to do — it moves with the card" },
];

const ON = {
  done: "bg-emerald-600 text-white ring-emerald-600",
  not_needed: "bg-slate-700 text-white ring-slate-700",
  keep: "bg-slate-900 text-white ring-slate-900",
};
const OFF = "bg-white/80 text-slate-600 ring-slate-900/10 hover:bg-white";

/** What was chosen for a task — "keep" unless someone said otherwise. */
export const choiceOf = (value, id) => (value && value[id]) || "keep";

function shortDue(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function LeftoverReview({ tasks = [], value = {}, onChange, toLabel, testid = "leftover" }) {
  if (!tasks.length) return null;
  /* Every change is an UPDATER, built on the latest choices — found testing
     in the browser: three quick taps each copied the same stale list and only
     the last one survived, so a fast thumb on a phone lost choices. Callers pass
     a state setter (or anything that accepts one). */
  const set = (id, key) => onChange?.((prev) => ({ ...(prev || {}), [id]: key }));
  const setAll = (key) => onChange?.(() => Object.fromEntries(tasks.map((t) => [t.id, key])));
  const counts = tasks.reduce((c, t) => ({ ...c, [choiceOf(value, t.id)]: (c[choiceOf(value, t.id)] || 0) + 1 }), {});

  return (
    <div data-testid={testid} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
        <span className="mr-1">Set all:</span>
        {LEFTOVER_CHOICES.map((c) => (
          <button key={c.key} type="button" onClick={() => setAll(c.key)}
            data-testid={`${testid}-all-${c.key}`}
            className="min-h-8 rounded-pill bg-white/70 px-3 text-[12px] font-medium text-slate-700 ring-1 ring-inset ring-slate-900/10 hover:bg-white">
            {c.label}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {tasks.map((t) => {
          const chosen = choiceOf(value, t.id);
          return (
            <li key={t.id} data-testid={`${testid}-task-${t.id}`} data-choice={chosen}
              className="rounded-2xl bg-white/70 px-3 py-2.5 ring-1 ring-inset ring-slate-900/[0.06]">
              <p className={`text-[13.5px] leading-snug text-slate-800 ${chosen === "not_needed" ? "line-through decoration-slate-400" : ""}`}>
                {t.title}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
                <span>{t.assignee_name || "Nobody picked yet"}</span>
                {t.due_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarBlank size={10} weight="bold" aria-hidden="true" /> {shortDue(t.due_date)}
                  </span>
                )}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`What happens to "${t.title}"`}>
                {LEFTOVER_CHOICES.map((c) => {
                  const Icon = c.icon;
                  const on = chosen === c.key;
                  return (
                    <button key={c.key} type="button" role="radio" aria-checked={on}
                      title={c.key === "keep" && toLabel ? `Still to do — it moves to ${toLabel} with the card` : c.hint}
                      onClick={() => set(t.id, c.key)}
                      data-testid={`${testid}-${c.key}-${t.id}`}
                      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-pill px-2 text-[12.5px] font-medium ring-1 ring-inset transition-colors ${on ? ON[c.key] : OFF}`}>
                      <Icon size={13} weight="bold" aria-hidden="true" /> {c.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[11.5px] text-slate-500" data-testid={`${testid}-summary`}>
        {[
          counts.done ? `${counts.done} closed as done` : null,
          counts.not_needed ? `${counts.not_needed} cancelled` : null,
          counts.keep ? `${counts.keep} still to do${toLabel ? ` — moves to ${toLabel}` : ""}` : null,
        ].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

export default LeftoverReview;
