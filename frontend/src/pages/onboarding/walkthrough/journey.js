/* The walkthrough's cast, from the company the founder just built: its
 * teams, its first workflow (the one with a sign-off if there is one), the
 * work at each step, its first approval rule and its routines. Everything a
 * scene shows comes from here, so the tour is of THEIR company — never a
 * sample firm — and falls back to plain words where the draft is thin.
 */
const first = (s) => String(s || "").trim().split(/\s+/)[0] || "";
const slug = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");

export function buildJourney({ company, founder, bp, pipelines }) {
  const teams = (bp?.departments || []).map((d) => (typeof d === "string"
    ? { key: slug(d), label: d } : { key: d.key || slug(d.label), label: d.label || d.name || "" }))
    .filter((t) => t.label);
  const teamName = (key) => teams.find((t) => t.key === key)?.label || (key === "owner" ? "You" : "The team");
  const list = (pipelines || []).filter((p) => (p.stages || []).length >= 2);
  const shape = (p) => ({
    key: p.key, label: p.label || "Workflow",
    stages: (p.stages || []).slice(0, 6).map((s) => ({
      key: s.key, label: s.label, team: teamName(s.role), gate: !!s.approval,
      tasks: (s.tasks || []).map((t) => t.title).filter(Boolean),
    })),
  });
  // The one with a sign-off leads: it shows the most of the product.
  const ordered = [...list].sort((a, b) => Number((b.stages || []).some((s) => s.approval)) - Number((a.stages || []).some((s) => s.approval)));
  const flows = ordered.map(shape);
  const flow = flows[0] || null;
  const stages = flow?.stages || [];
  const rules = (bp?.approval_rules || []).filter((r) => r?.name);
  const rule = rules[0] || null;
  const routines = (bp?.operational_tasks || []).map((t) => (typeof t === "string" ? t : t?.title)).filter(Boolean);
  // The member we follow through My Work: whoever owns the flow's first step.
  const memberTeam = stages[0]?.team || teams[0]?.label || "Your team";
  const memberTasks = stages[0]?.tasks?.length ? stages[0].tasks : routines.slice(0, 3);
  const work = list.reduce((k, p) => k + (p.stages || []).reduce((m, s) => m + (s.tasks || []).length, 0), 0);
  return {
    company: company || "Your company",
    flows,
    counts: [
      { key: "teams", n: teams.length, label: "Teams" },
      { key: "workflows", n: list.length, label: "Workflows" },
      { key: "steps", n: list.reduce((k, p) => k + (p.stages || []).length, 0), label: "Steps" },
      { key: "tasks", n: work + routines.length, label: "Tasks set up" },
      { key: "signoffs", n: rules.length, label: "Sign-offs" },
      { key: "routines", n: routines.length, label: "Routines" },
    ],
    founder: first(founder) || "you",
    teams: teams.length ? teams : [{ key: "team", label: "Your team" }],
    flow,
    rule,
    rules,
    routines,
    memberTeam,
    memberTasks: memberTasks.length ? memberTasks : ["Confirm the order with the buyer", "Check stock", "Send the invoice"],
    // What the founder says in the Decide scene: their own first workflow, said.
    said: flow
      ? `Start the ${flow.label.toLowerCase()} for this week and make sure ${stages[0]?.team || "the team"} picks it up today.`
      : `Let's get this week's work moving and make sure everyone knows their part.`,
  };
}
