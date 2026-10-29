/* Finished since you last looked (the pilot client, through the founder,
 * 2026-10-29): "whenever the app is opened, a floating card shows the
 * finished tasks that still need to be seen — a short, minimised list,
 * scrollable inside, with the page blurred behind it; tap one and its task
 * opens. A task shown once is never shown again."
 *
 * Once per launch, on the Desk: GET /finished-tasks answers with what was
 * marked done since this person last saw the list (an owner the company's,
 * anyone else the work they asked for), and the moment it is on screen the
 * newest of them is sent back as seen — so the next launch starts after it,
 * whether or not the card was read to the end.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CaretRight, CheckCircle, X } from "@phosphor-icons/react";
import api from "../../lib/api";
import { agoWords } from "../../lib/format";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { GLASS_SHEET, INK_PILL } from "../../components/neuglass/glass";
import { cn } from "../../lib/utils";

/* One answer per launch, shared by every mount of the Desk (React mounts it
   twice in development, and a remount must not ask again or drop the answer),
   and shown by whichever mount is still on screen — once. */
let launchFetch = null;
let shownThisLaunch = false;

export function FinishedWorkCard() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!launchFetch) {
      launchFetch = api.get("/finished-tasks")
        .then(({ data }) => (Array.isArray(data?.tasks) ? data.tasks : []))
        .catch(() => []);
    }
    launchFetch.then((list) => {
      if (!alive || shownThisLaunch || !list.length) return;
      shownThisLaunch = true;
      setRows(list);
      setOpen(true);
      api.post("/finished-tasks/seen", { until: list[0].completed_at }).catch(() => {});
    });
    return () => { alive = false; };
  }, []);

  const go = (id) => {
    setOpen(false);
    navigate(`/my-work?task=${encodeURIComponent(id)}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent overlayClassName="bg-slate-900/30 backdrop-blur-md"
        className={cn(GLASS_SHEET, "flex max-h-[calc(78dvh/var(--ui-scale,1))] flex-col gap-0 overflow-hidden rounded-[1.75rem] p-0 [&>button.absolute]:hidden sm:max-w-md")}
        data-testid="finished-work-card">
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white">
            <CheckCircle size={20} weight="fill" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-left text-[19px] font-semibold leading-tight tracking-tight text-slate-900">
              {rows.length === 1 ? "1 task finished" : `${rows.length} tasks finished`}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-left text-[13px] text-slate-500">
              Since you last looked. Tap one to open it.
            </DialogDescription>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" data-testid="finished-work-close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-white">
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <ul className="ng-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2" data-testid="finished-work-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => go(r.id)} data-testid={`finished-work-row-${r.id}`}
                className="flex min-h-[3.5rem] w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20">
                <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[hsl(150_30%_90%)] text-[hsl(152_40%_28%)]">
                  <CheckCircle size={15} weight="fill" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-slate-900">{r.title}</span>
                  <span className="block truncate text-[12px] text-slate-500">
                    {r.assignee_name || "The team"} · {agoWords(r.completed_at)}
                  </span>
                </span>
                <CaretRight size={14} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-900/[0.06] px-5 pb-[calc(1rem+var(--sa-bottom))] pt-3">
          <button type="button" onClick={() => setOpen(false)} data-testid="finished-work-ok"
            className={cn("flex h-12 w-full items-center justify-center rounded-pill text-sm font-medium", INK_PILL)}>
            Got it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FinishedWorkCard;
