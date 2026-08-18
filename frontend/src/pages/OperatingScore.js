// /operating-score — KR-9. The DIAGNOSTIC surface.
//
// WHAT CHANGED, AND WHY IT HAD TO. Until KR-8 this page opened with a 152px
// score dial and a "company health" headline. /inbox now opens with exactly
// that — the giant numeral, the arc, the band word, Dex's read. Two pages
// leading with the same number is not a design system, it is a duplicate, and
// the founder clicks the second one expecting to learn something new.
//
// So the score is demoted here to a compact card and the page's real subject
// becomes WHY the number is what it is: the four categories, what is dragging
// each one, and the team behind them. /inbox says "72". This says "because".
//
// THE MATERIAL, per the founder's standing brief:
//   · neumorphic — StatTiles and category cards sit ON the ground; the "what
//     to do first" panel is a .kr-well, pressed INTO it, same as /inbox's
//     insight well. A pit reads as "read this", a raised card as "click this".
//   · glass — the leaderboard rides the dark band as kr-glass cards.
//   · red is rationed. scoreColor used to run green → amber → danger across
//     four categories at once, which made a healthy page look like a warning
//     panel. Numerals are monochrome now; the BAND WORD carries the verdict in
//     text, and the accent survives only where something genuinely needs a
//     hand (an overdue count, a failing meter, the view-as strip).
//
// HONESTY. demoActions is gone — it printed invented point-lifts ("+6 pts")
// beside real figures. lib/karmaScore's scoreActions replaces it with the
// useful half: the order, derived from stats, claiming no lift. demoDex,
// demoDelta, demoDrivers and demoDrilldowns stay, but every one of them is
// now behind isDemoTenant, so a real tenant sees honest fallbacks.
//
// Deep link preserved: /operating-score?user=<id> renders that person's
// self-view with the view-as strip (U7-01.40).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { selfScore, scoreBand, scoreActions } from "../lib/karmaScore";
import {
  ArcGauge, StatTile, ScoreMeter, DarkBand, InsightWell, IconChip, BigNumeral,
} from "../components/karma";
import {
  Gauge, Lightning, CurrencyCircleDollar, TrendUp, ChatCenteredDots, Trophy,
  CaretRight, Camera, ClipboardText, Check, ArrowRight,
  Info, CaretDown, CaretUp, Microphone, Receipt, X,
  ArrowsClockwise, Eye,
} from "@phosphor-icons/react";
import {
  isDemoTenant, demoDelta, demoDrivers, demoDrilldowns, demoDex,
  DEFAULT_WEIGHTS, WEIGHT_PRESETS,
} from "./_operatingScoreDemo";

// U7-01.16: each category carries its formula + weight so the (i) affordance
// can explain WHAT the number measures without digging into backend code.
// Weights match _score_execution / _score_sales / inline finance +
// responsiveness in server.py (35/25/20/20).
const CATS = [
  { key: "execution", label: "Execution", icon: Lightning,
    weight: 35,
    formula: "(tasks done ÷ total actionable) × 100  −  (overdue ÷ open) × 40",
    plain: "How much of what you started is finished on time." },
  { key: "finance", label: "Finance", icon: CurrencyCircleDollar,
    weight: 25,
    formula: "(paid ÷ billed) × 100  −  overdue invoices × 5",
    plain: "How well cash is coming in vs. how much is stuck." },
  { key: "sales", label: "Sales", icon: TrendUp,
    weight: 20,
    formula: "approved decisions ÷ total decisions × 100",
    plain: "Rate at which raised decisions get a green light." },
  { key: "responsiveness", label: "Responsiveness", icon: ChatCenteredDots,
    weight: 20,
    formula: "100  −  (open complaints × 12)  −  (overdue tasks × 3)",
    plain: "How fast the team is closing loops — complaints + missed dates." },
];

// KR-9 — a score below 40 is the ONE place a category number raises its
// voice. Everything above that is monochrome and lets the band word talk.
const isFailing = (v) => v != null && v < 40;

export default function OperatingScore() {
  const [searchParams] = useSearchParams();
  const userIdParam = searchParams.get("user") || null;

  const { data, isLoading } = useQuery({
    queryKey: ["operating-score", userIdParam],
    queryFn: () => api
      .get("/operating-score", { params: userIdParam ? { user_id: userIdParam } : {} })
      .then((r) => r.data),
  });

  if (isLoading || !data) return <OperatingScoreSkeleton />;

  const isOwnerView = data.view === "owner" || Boolean(data.company);
  return isOwnerView ? <OwnerView data={data} /> : <SelfView data={data} />;
}

// ─── page furniture ──────────────────────────────────────────────────────────

/** The Karma page opening: eyebrow over a display heading, no card. */
function PageTitle({ eyebrow, title, testid }) {
  return (
    <header className="mb-7" data-testid={testid}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">{title}</h1>
    </header>
  );
}

/**
 * ViewAsBanner — the owner is looking at someone else's page. This is one of
 * the few places the accent is doing real work: it is a MODE, and a mode the
 * viewer can forget they are in.
 */
function ViewAsBanner({ target }) {
  if (!target) return null;
  return (
    <div
      className="mb-5 flex items-center justify-between gap-3 rounded-control border-l-[3px] border-kr-accent bg-kr-accent/10 px-4 py-3"
      data-testid="operating-view-as-banner"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Eye size={16} weight="bold" className="shrink-0 text-kr-accent" aria-hidden="true" />
        <p className="truncate text-sm">
          Viewing <strong>{target.name}</strong>
          <span className="ml-2 text-muted-foreground">{target.role}</span>
        </p>
      </div>
      <Link
        to="/operating-score"
        className="flex shrink-0 items-center gap-1 text-xs font-semibold hover:underline"
      >
        <ArrowRight size={12} weight="bold" className="rotate-180" aria-hidden="true" />
        Back to company
      </Link>
    </div>
  );
}

/**
 * ScoreCard — the compact score. Deliberately NOT the /inbox hero: half the
 * gauge, a quarter of the numeral, and the band word doing the talking.
 */
function ScoreCard({ score, caption, delta, testid }) {
  const band = scoreBand(score);
  return (
    <div className="nm-tile flex items-center gap-5 p-5 sm:p-6" data-testid={testid}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <BigNumeral text={score != null ? String(score) : "—"} size="lg" countUp={score != null} testid="operating-overall-score" />
          {score != null && <span className="text-lg text-muted-foreground">/ 100</span>}
        </div>
        {band && <p className="mt-1 text-sm font-medium">{band}</p>}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{caption}</p>
        {delta}
      </div>
      <ArcGauge
        value={score}
        size={150}
        className="w-[104px] shrink-0 text-foreground sm:w-[124px]"
        testid="operating-gauge"
      />
    </div>
  );
}

// ─── owner view ──────────────────────────────────────────────────────────────

function OwnerView({ data }) {
  const { tenant } = useAuth();
  const demo = isDemoTenant(tenant);

  const rankedEmployees = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data]
  );

  const { company, stats, my_snapshot: mySnapshot } = data;
  const overall = company.overall;
  const enough = company.enough_data !== false;

  const [drillCat, setDrillCat] = useState(null);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);

  const actions = useMemo(
    () => scoreActions(stats, company.categories),
    [stats, company.categories]
  );

  return (
    <div data-testid="operating-page">
      <PageTitle eyebrow="How well the business is running" title="Operating score" />

      {!enough ? (
        <NotEnoughDataEmptyState stats={stats} />
      ) : (
        <>
          {/* The score, then the four reasons for it. 5/7 split: the
              categories are the subject of this page, not the total. */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <ScoreCard
              score={overall}
              caption="Weighted across the four categories. Updates as work lands."
              testid="operating-overall"
              delta={demo ? (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="operating-delta-chip">
                  {demoDelta.sign === "up" ? "+" : "−"}{Math.abs(demoDelta.value)} pts {demoDelta.period}
                </p>
              ) : null}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="operating-categories">
              {CATS.map((c) => (
                <CategoryCard
                  key={c.key}
                  cat={c}
                  value={company.categories[c.key]}
                  drivers={demo ? (demoDrivers[c.key] || []) : []}
                  onDrillIn={() => setDrillCat(c.key)}
                />
              ))}
            </div>
          </div>

          {/* WHAT TO DO FIRST — a pit, like /inbox's insight well, because it
              is something to read rather than a card to click. */}
          <NextMoves actions={actions} onDrill={setDrillCat} demoText={demo ? demoDex.explainer : null} />

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="operating-quick-stats">
            <StatTile icon={Check} label="Tasks done" value={String(stats.done)} to="/my-work" countUp testid="ops-stat-done" />
            <StatTile icon={ClipboardText} label="Open tasks" value={String(stats.open)} to="/my-work" countUp testid="ops-stat-open" />
            <StatTile
              icon={Lightning}
              label="Overdue"
              value={String(stats.overdue)}
              alert={stats.overdue > 0}
              urgent={stats.overdue > 0}
              to="/my-work?filter=overdue"
              countUp
              testid="ops-stat-overdue"
            />
            <StatTile
              icon={ChatCenteredDots}
              label="Open complaints"
              value={String(stats.open_complaints)}
              alert={stats.open_complaints > 0}
              urgent={stats.open_complaints > 0}
              to="/crm"
              countUp
              testid="ops-stat-complaints"
            />
          </div>

          {mySnapshot && <PersonalSnapshot stats={mySnapshot} />}

          <FormulaExplainer weights={weights} setWeights={setWeights} />
        </>
      )}

      {/* THE TEAM, on the band. Glass cards on ink — the same treatment the
          desk's decision boxes get, so "a person" and "a decision" read as
          the same class of object you can open. */}
      <DarkBand testid="operating-band" className="mt-10 pt-9 pb-24 lg:pb-12 -mb-4 lg:-mb-8">
        <Leaderboard employees={rankedEmployees} />
      </DarkBand>

      {drillCat && (
        <CategoryDrillModal
          cat={CATS.find((c) => c.key === drillCat)}
          value={company.categories[drillCat]}
          drivers={demo ? (demoDrivers[drillCat] || []) : []}
          drill={demo ? demoDrilldowns[drillCat] : null}
          onClose={() => setDrillCat(null)}
        />
      )}
    </div>
  );
}

/**
 * NextMoves — the page's editorial moment, in the same sunken glass the
 * founder approved on /inbox. Actions are real; the Dex paragraph appears
 * only for the demo tenant.
 */
function NextMoves({ actions, onDrill, demoText }) {
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState(demoText);
  useEffect(() => setText(demoText), [demoText]);

  if (!actions.length && !text) return null;

  return (
    <div className="kr-well mt-6" data-testid="operating-next-moves">
      <div className="kr-well__pane p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide text-foreground/75">
            Do these first
          </span>
          {text && (
            <button
              type="button"
              onClick={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 900); }}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Ask Dex to re-explain"
            >
              <ArrowsClockwise size={11} weight="bold" className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
              {refreshing ? "thinking…" : "refresh"}
            </button>
          )}
        </div>

        {text && <p className="mt-3 text-sm leading-relaxed">{text}</p>}

        {actions.length > 0 && (
          <ul className="mt-4 space-y-2.5">
            {actions.map((a) => {
              const body = (
                <>
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="text-sm font-semibold">{a.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-foreground/65">{a.why}</span>
                  </span>
                  <ArrowRight size={13} weight="bold" aria-hidden="true"
                    className="kr-arrow ml-auto mt-1 shrink-0 opacity-55 transition-transform duration-200" />
                </>
              );
              return (
                <li key={a.key}>
                  {a.to ? (
                    <Link to={a.to} className="kr-lift flex w-full items-start gap-2.5 text-left" data-testid={`ops-action-${a.key}`}>
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDrill(a.drill)}
                      className="kr-lift flex w-full items-start gap-2.5 text-left"
                      data-testid={`ops-action-${a.key}`}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function PersonalSnapshot({ stats }) {
  return (
    <section className="mt-8" data-testid="operating-personal-snapshot">
      <h2 className="text-h3">Your own execution</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You are an operator too — this is your work, not the company's.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={TrendUp} label="Completion" value={`${stats.completion_rate}%`} to="/my-work" testid="ops-me-completion" />
        <StatTile icon={ClipboardText} label="Open" value={String(stats.open)} to="/my-work" countUp testid="ops-me-open" />
        <StatTile
          icon={Lightning} label="Overdue" value={String(stats.overdue)}
          alert={stats.overdue > 0} urgent={stats.overdue > 0}
          to="/my-work?filter=overdue" countUp testid="ops-me-overdue"
        />
        <StatTile
          icon={Camera} label="Proof rate" value={`${stats.proof_upload_rate}%`}
          meaning={stats.proof_upload_rate < 40 && stats.completed > 0 ? "Attach a photo or voice on done tasks" : undefined}
          to="/my-work" testid="ops-me-proof"
        />
      </div>
    </section>
  );
}

// ─── self view ───────────────────────────────────────────────────────────────

function SelfView({ data }) {
  const {
    self, stats, my_open_work: openWork = [], my_active_workflows: activeWfs = [],
    peer_context: peer, view_as: viewAs,
  } = data;
  const score = selfScore(stats);
  const hasActivity = stats.actionable > 0;
  const actions = useMemo(() => scoreActions(stats), [stats]);

  const isViewAs = Boolean(viewAs);
  const firstName = self.name?.split(" ")[0] || "there";

  return (
    <div data-testid="operating-page">
      <ViewAsBanner target={viewAs} />
      <PageTitle
        eyebrow={isViewAs ? "Team member ops (owner view)" : "Your operating view"}
        title={isViewAs ? `${self.name}'s operating view` : `Hi ${firstName} — here's how you're doing`}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ScoreCard
          score={hasActivity ? score : null}
          caption={hasActivity
            ? "Completion, less the drag from anything overdue."
            : "Close a task or two and your score kicks in."}
          testid="operating-self-hero"
        />

        <div className="grid grid-cols-2 gap-3" data-testid="operating-self-stats">
          <StatTile icon={Check} label="Completed" value={String(stats.completed)} to="/my-work" countUp testid="ops-self-completed" />
          <StatTile icon={ClipboardText} label="Open" value={String(stats.open)} to="/my-work" countUp testid="ops-self-open" />
          <StatTile
            icon={Lightning} label="Overdue" value={String(stats.overdue)}
            alert={stats.overdue > 0} urgent={stats.overdue > 0}
            to="/my-work?filter=overdue" countUp testid="ops-self-overdue"
          />
          <StatTile icon={TrendUp} label="Completion" value={`${stats.completion_rate}%`} to="/my-work" testid="ops-self-completion" />
        </div>
      </div>

      {actions.length > 0 && <NextMoves actions={actions} onDrill={() => {}} demoText={null} />}

      <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <BreakdownCard
          icon={Camera}
          label="Proof rate"
          value={`${stats.proof_upload_rate}%`}
          meter={stats.proof_upload_rate}
          detail={`${_pctToCount(stats.proof_upload_rate, stats.completed)} of ${stats.completed} done with photo/voice`}
          hint={stats.proof_upload_rate < 40 && stats.completed >= 3
            ? "Attach a photo or voice update on your next done task" : null}
        />
        <BreakdownCard
          icon={ClipboardText}
          label="Plans in use"
          value={`${stats.plans_completed}/${stats.plans_used}`}
          meter={stats.plans_used > 0 ? (stats.plans_completed / stats.plans_used) * 100 : null}
          detail={`${stats.plans_used} accepted plan${stats.plans_used === 1 ? "" : "s"}, ${stats.plans_completed} finished`}
          hint={stats.plans_used === 0 && stats.actionable >= 3 ? "Ask Dex to plan your next big task" : null}
        />
        <BreakdownCard
          icon={Check}
          label="Actionable"
          value={String(stats.actionable)}
          meter={stats.actionable > 0 ? (stats.completed / stats.actionable) * 100 : null}
          detail={`${stats.completed} done + ${stats.open} open`}
        />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-h3">Your open work</h2>
          <Link to="/my-work" className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            See all <ArrowRight size={12} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        {openWork.length === 0 ? (
          <div className="nm-tile p-6 text-center">
            <p className="text-sm text-muted-foreground">Nothing open right now — good place to be.</p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="operating-self-open">
            {openWork.map((t) => (
              <li key={t.id}>
                <Link to="/my-work" className="kr-lift nm-tile flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{t.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.status} · {t.priority || "med"}
                      {t.due_date ? ` · due ${_formatDate(t.due_date)}` : ""}
                      {t.stage_key ? ` · stage ${t.stage_key}` : ""}
                    </p>
                  </div>
                  {t.is_overdue && (
                    <span className="shrink-0 rounded-pill bg-kr-accent/12 px-2 py-0.5 text-xs font-semibold text-kr-accent">
                      Overdue
                    </span>
                  )}
                  <CaretRight size={15} weight="bold" aria-hidden="true" className="shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(activeWfs.length > 0 || peer) && (
        <DarkBand testid="operating-self-band" className="mt-10 pt-9 pb-24 lg:pb-12 -mb-4 lg:-mb-8">
          {activeWfs.length > 0 && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-h3">Workflows waiting on you</h2>
                <Link to="/workflows" className="flex items-center gap-1 text-xs font-semibold opacity-75 hover:opacity-100">
                  See board <ArrowRight size={12} weight="bold" aria-hidden="true" />
                </Link>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="operating-self-workflows">
                {activeWfs.map((w) => (
                  <li key={w.id}>
                    <Link to="/workflows" className="kr-glass kr-glass--blue kr-lift flex h-full flex-col p-4">
                      <p className="text-sm font-semibold leading-snug line-clamp-2">{w.title}</p>
                      <p className="mt-auto pt-3 text-xs opacity-75">
                        {w.type} · stage {w.stage}
                        {w.counterparty ? ` · ${w.counterparty}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {peer && peer.my_rank_in_role && peer.role_ranked_size >= 2 && (
            <div className="mt-6 flex items-center gap-3" data-testid="operating-self-peer">
              <Trophy size={16} weight="bold" aria-hidden="true" className="shrink-0 opacity-70" />
              <p className="text-sm opacity-85">
                Among your <strong>{peer.role}</strong> peers you are ranked{" "}
                <strong>{peer.my_rank_in_role}</strong> of {peer.role_ranked_size}.
              </p>
            </div>
          )}
        </DarkBand>
      )}
    </div>
  );
}

// ─── pieces ──────────────────────────────────────────────────────────────────

function BreakdownCard({ icon, label, value, detail, hint, meter }) {
  return (
    <div className="nm-tile p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <IconChip icon={icon} size={34} />
        <BigNumeral text={value} size="sm" />
      </div>
      <p className="mt-3 text-sm font-medium">{label}</p>
      {meter != null && <ScoreMeter value={meter} size="sm" className="mt-2.5" />}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      {hint && <p className="mt-2 text-xs font-semibold leading-relaxed">{hint}</p>}
    </div>
  );
}

/**
 * CategoryCard — the meter IS the card. Drivers are demo-only, so on a real
 * tenant this is a clean number + meter rather than three blank rows.
 */
function CategoryCard({ cat, value, drivers, onDrillIn }) {
  const has = value != null;
  return (
    <button
      type="button"
      onClick={onDrillIn}
      disabled={!has}
      className="kr-lift nm-tile p-4 text-left disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
      data-testid={`operating-cat-${cat.key}`}
      aria-label={`${cat.label} — see breakdown`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <cat.icon size={14} weight="regular" aria-hidden="true" className="text-muted-foreground" />
          {cat.label}
        </span>
        <span
          title={`${cat.plain}\n\nFormula: ${cat.formula}\nWeight: ${cat.weight}%`}
          className="cursor-help text-muted-foreground"
          aria-label={`How ${cat.label} is calculated`}
        >
          <Info size={12} weight="bold" aria-hidden="true" />
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <BigNumeral text={has ? String(value) : "—"} size="md" accent={isFailing(value)} />
        <span className="text-sm text-muted-foreground">/ 100</span>
      </div>

      <ScoreMeter value={value} alert={isFailing(value)} className="mt-3" testid={`operating-meter-${cat.key}`} />

      {drivers.length > 0 && (
        <ul className="mt-3 space-y-1">
          {drivers.slice(0, 2).map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{d.label}</span>
              <span className="font-mono tabular-nums">{d.value}</span>
            </li>
          ))}
        </ul>
      )}

      <span className="mt-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        See breakdown
        <CaretRight size={11} weight="bold" aria-hidden="true" className="kr-arrow transition-transform duration-200" />
      </span>
    </button>
  );
}

/** Drill-down. Mechanics unchanged (Esc, backdrop, X); surface re-skinned. */
function CategoryDrillModal({ cat, value, drivers, drill, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const has = value != null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-kr-ink/45 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drill-title"
      data-testid={`operating-drill-${cat.key}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="nm-raised flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="flex items-start gap-4 border-b border-nm-edge/40 p-5">
          <IconChip icon={cat.icon} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Weight {cat.weight}% of overall</p>
            <h2 id="drill-title" className="font-display text-2xl leading-tight">
              {drill?.title || cat.label}
            </h2>
          </div>
          <BigNumeral text={has ? String(value) : "—"} size="md" accent={isFailing(value)} className="shrink-0" />
          <button
            type="button"
            onClick={onClose}
            className="nm-btn grid h-9 w-9 shrink-0 place-items-center"
            aria-label="Close breakdown"
          >
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-nm-edge/40 p-5">
            {drill?.hero && <p className="text-sm font-semibold">{drill.hero}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{cat.plain}</p>
            <ScoreMeter value={value} alert={isFailing(value)} className="mt-4" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">{cat.formula}</p>
          </div>

          {drivers.length > 0 && (
            <div className="border-b border-nm-edge/40 p-5">
              <p className="mb-3 text-xs font-semibold">Top drivers this period</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {drivers.map((d, i) => (
                  <div key={i} className="nm-inset p-3">
                    <p className="text-xs text-muted-foreground">{d.label}</p>
                    <p className="mt-1 font-mono text-xl tabular-nums">{d.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {drill?.items && (
            <div className="p-5">
              <p className="mb-3 text-xs font-semibold">Specifics</p>
              <ul className="space-y-2">
                {drill.items.map((item, i) => (
                  <li key={i} className="nm-inset flex items-center gap-3 p-3">
                    <span
                      aria-hidden="true"
                      className={`h-8 w-1 shrink-0 rounded-pill ${item.tone === "bad" ? "bg-kr-accent" : "bg-foreground/25"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.meta}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!drivers.length && !drill?.items && (
            <div className="p-5">
              <p className="text-sm text-muted-foreground">
                Per-driver breakdown is not wired for this category yet — the score
                above is live, the detail is not.
              </p>
            </div>
          )}
        </div>

        {drill?.action && (
          <div className="flex items-center justify-between gap-3 border-t border-nm-edge/40 p-4">
            <span className="text-xs text-muted-foreground">Ready to act?</span>
            <Link
              to={drill.action.to}
              onClick={onClose}
              className="kr-lift inline-flex items-center gap-2 rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-semibold text-white"
            >
              {drill.action.label}
              <ArrowRight size={14} weight="bold" aria-hidden="true" className="kr-arrow transition-transform duration-200" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** Leaderboard — glass member cards on the band. Sort preserved. */
function Leaderboard({ employees }) {
  const [sortBy, setSortBy] = useState("score");
  const sorted = useMemo(() => {
    const copy = [...(employees || [])];
    copy.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "activity") return (b.done + b.open) - (a.done + a.open);
      return (b.score ?? -1) - (a.score ?? -1);
    });
    return copy;
  }, [employees, sortBy]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h2">Team execution</h2>
          <p className="mt-1 text-sm opacity-70">
            Last 30 days · open anyone to see their full ops
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold opacity-80">
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-control border border-white/25 bg-transparent px-2 py-1.5 text-xs font-semibold"
            aria-label="Sort team by"
            data-testid="operating-leaderboard-sort"
          >
            <option value="score">Score</option>
            <option value="activity">Activity</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm opacity-65">No team activity to rank yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="operating-employees">
          {sorted.map((e, i) => (
            <li key={e.id}>
              <Link
                to={`/operating-score?user=${e.id}`}
                data-testid={`operating-emp-${e.id}`}
                className="kr-glass kr-glass--warm kr-lift flex h-full items-center gap-3.5 p-4"
              >
                <span className="w-5 shrink-0 font-mono text-sm opacity-55">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.name}</span>
                  <span className="mt-0.5 block truncate text-xs opacity-70">
                    {e.role} · {e.done} done · {e.open} open
                    {e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}
                  </span>
                  <ScoreMeter value={e.score} size="sm" className="mt-2" />
                </span>
                <span className="shrink-0 text-2xl font-semibold tabular-nums">
                  {e.score != null ? e.score : "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── empty + loading ─────────────────────────────────────────────────────────

function InlineCapture() {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSent(true);
    setText("");
    setTimeout(() => setSent(false), 2400);
  };
  return (
    <form onSubmit={submit} className="nm-inset mt-5 flex items-center gap-2 p-3" data-testid="operating-inline-capture">
      <Microphone size={16} weight="regular" aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or capture a decision right here"
        className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        aria-label="Capture a decision"
      />
      <button type="submit" disabled={!text.trim()}
        className="kr-lift rounded-pill bg-kr-ink px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
        Capture
      </button>
      {sent && <span className="text-xs font-semibold" role="status">sent</span>}
    </form>
  );
}

function NotEnoughDataEmptyState({ stats }) {
  const doneCount = (stats?.done || 0) + (stats?.open || 0);
  const hasTasks = doneCount >= 3;
  const hasInvoices = (stats?.total_decisions || 0) > 0;
  const taskProgress = Math.min(doneCount, 3);

  return (
    <div className="nm-tile p-6 sm:p-8" data-testid="operating-not-ready">
      <div className="flex flex-col items-start gap-8 lg:flex-row">
        <div className="shrink-0">
          <div className="nm-inset grid h-32 w-32 place-items-center rounded-full px-4 text-center">
            <Gauge size={28} weight="regular" aria-hidden="true" className="text-muted-foreground" />
          </div>
          <p className="mt-3 text-center text-sm font-medium" data-testid="operating-overall-score">
            Score kicks in soon
          </p>
        </div>
        <div className="w-full flex-1">
          <h2 className="text-h3">Two quick things and your score turns on</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The operating score needs a little real activity before it can say
            anything useful. Do either of these and it starts tracking.
          </p>
          <div className="mt-5 space-y-3">
            <ChecklistItem
              done={hasTasks}
              label={hasTasks ? "Capture 3 actionable tasks" : `Capture 3 actionable tasks (${taskProgress} of 3)`}
              hint="Speak or type a decision on the Decision Desk — it becomes tasks automatically."
              actionLabel="Open Desk"
              actionTo="/inbox"
            />
            <ChecklistItem
              done={hasInvoices}
              label="Add your first invoice"
              hint="Import from Tally / Zoho, upload a PDF, or log it manually in Finance."
              actionLabel="Open Finance"
              actionTo="/finance"
              icon={Receipt}
            />
          </div>
          <InlineCapture />
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label, hint, actionLabel, actionTo, icon: Icon = Microphone }) {
  return (
    <div className="nm-inset flex items-start gap-3 p-4">
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
          done ? "border-transparent bg-foreground text-nm-raised" : "border-kr-outline"
        }`}
        aria-hidden="true"
      >
        {done && <Check size={13} weight="bold" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${done ? "text-muted-foreground line-through" : ""}`}>{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      {!done && (
        <Link to={actionTo} className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-semibold hover:underline">
          <Icon size={12} weight="bold" aria-hidden="true" /> {actionLabel}
        </Link>
      )}
    </div>
  );
}

function OperatingScoreSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="operating-skeleton">
      <div className="mb-7">
        <div className="ds-skeleton mb-2 h-3 w-40 rounded-control" />
        <div className="ds-skeleton h-9 w-64 rounded-control" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="ds-skeleton h-[168px] rounded-tile" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="ds-skeleton h-[168px] rounded-tile" />)}
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="ds-skeleton h-[150px] rounded-tile" />)}
      </div>
    </div>
  );
}

// ─── formula panel ───────────────────────────────────────────────────────────

function FormulaExplainer({ weights = DEFAULT_WEIGHTS, setWeights }) {
  const [open, setOpen] = useState(false);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const applyPreset = (key) => setWeights && setWeights(WEIGHT_PRESETS[key].weights);
  const setOne = (key, val) => setWeights && setWeights({ ...weights, [key]: Math.max(0, Math.min(100, val)) });

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
        aria-controls="operating-formula-panel"
        data-testid="operating-formula-toggle"
      >
        <Info size={12} weight="bold" aria-hidden="true" />
        How is this calculated?
        {open ? <CaretUp size={11} weight="bold" aria-hidden="true" /> : <CaretDown size={11} weight="bold" aria-hidden="true" />}
      </button>

      {open && (
        <div id="operating-formula-panel" className="nm-tile mt-3 space-y-5 p-5" data-testid="operating-formula-panel">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Overall is a weighted average across the four categories. Categories
            with no data yet are skipped and the remaining weights renormalize.
          </p>

          {setWeights && (
            <div className="nm-inset p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold">Customize weights for your business</p>
                <span className={`text-xs font-mono tabular-nums ${total === 100 ? "text-muted-foreground" : "text-kr-accent"}`}>
                  total: {total}%
                </span>
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(WEIGHT_PRESETS).map(([k, p]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => applyPreset(k)}
                    className="nm-btn px-3 py-1.5 text-xs font-semibold"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {CATS.map((c) => (
                  <div key={c.key} className="flex items-center gap-3">
                    <span className="flex w-32 shrink-0 items-center gap-2 text-xs font-semibold">
                      <c.icon size={12} weight="regular" aria-hidden="true" className="text-muted-foreground" />
                      {c.label}
                    </span>
                    <input
                      type="range" min="0" max="60" step="5"
                      value={weights[c.key]}
                      onChange={(e) => setOne(c.key, Number(e.target.value))}
                      className="flex-1 accent-kr-ink"
                      aria-label={`${c.label} weight`}
                    />
                    <span className="w-12 text-right font-mono text-xs tabular-nums">{weights[c.key]}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {total !== 100
                  ? "Weights should add up to 100%. Pick a preset or adjust the sliders."
                  : "Local preview only — backend persistence lands next."}
              </p>
            </div>
          )}

          {CATS.map((c) => (
            <div key={c.key} className="border-l-2 border-nm-edge/60 pl-4">
              <div className="mb-1 flex items-center gap-2">
                <c.icon size={14} weight="regular" aria-hidden="true" className="text-muted-foreground" />
                <span className="text-sm font-semibold">{c.label}</span>
                <span className="text-xs text-muted-foreground">weight {weights[c.key]}%</span>
              </div>
              <p className="mb-1 text-xs text-muted-foreground">{c.plain}</p>
              <p className="font-mono text-xs">{c.formula}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function _pctToCount(pct, total) {
  if (!total) return 0;
  return Math.round((pct / 100) * total);
}

function _formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
