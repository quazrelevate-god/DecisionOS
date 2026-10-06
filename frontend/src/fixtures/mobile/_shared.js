// Shared builders for the three fixture states (§4).
//
// Dates are anchored to midnight UTC today so relative strings ("3 days
// overdue", "Due Monday") are stable for a whole day and screenshots do not
// flake — the same anchoring the MPWA-00 harness uses.
const ANCHOR = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
export const shift = (days) => new Date(ANCHOR.getTime() + days * 86400000);
export const ymd = (n) => shift(n).toISOString().slice(0, 10);
export const iso = (n) => shift(n).toISOString();
export const TODAY = ymd(0);

export const OWNER = { id: "u_owner", name: "Rajesh Sharma", role: "owner", email: "owner@sharma.com", language: "en" };

export const TENANT = {
  id: "ten_fixture",
  name: "Sharma Textiles Pvt Ltd",
  industry: "Textile Manufacturing",
  currency: "INR",
  high_value_threshold: 50000,
  onboarded: true,
};

export const TEAM = [
  OWNER,
  { id: "u_sales", name: "Priya Nair", role: "sales", email: "priya@sharma.com" },
  { id: "u_prod", name: "Amit Verma", role: "production", email: "amit@sharma.com" },
  { id: "u_fin", name: "Sunita Rao", role: "finance", email: "sunita@sharma.com" },
];

/** A 7-point series for Pulse sparklines. */
export const series = (...points) => points.map((v, i) => ({ x: i, v }));

/**
 * Assemble the route table every fixture shares, so each state only declares
 * its own data. Anything a state leaves undefined simply does not match, and
 * the request falls through to the network rather than silently returning {}.
 */
/**
 * Writes that must answer with a real shape rather than a bare `ok: true`,
 * because the UI reads a field out of the response and takes its next step from
 * it. MPWA-12e: the Dex sheet follows the returned note id to show what Dex
 * understood, so a response without `id` would silently skip it. (This named
 * DexSheet, which was removed from Layout in 97c2bfc (KM-23) and is not mounted;
 * the live sheet is DexChat, which follows the id through useDexCapture, as the
 * Desk's Dex well does.)
 */
/* The capture walk's read counter, shared by the write that starts a capture
   (it resets the walk) and the note route that walks it. */
let dexReads = 0;
// PILOT-2 A — a decision approved in the Dex pop-up comes back approved (the
// pop-up's foot turns into Done); a new capture starts it pending again.
let dexApproved = false;
// PILOT-2 B — "Save as draft" is a call to the server now (POST/DELETE
// /decisions/:id/draft, lib/decisionDrafts). Unanswered, the fixture's generic
// {ok:true} echo let a save look identical to a refusal, which is the
// wrong-verb class of bug MPWA-13 named. So it is answered, and remembered.
let dexDraft = false;
/* ASK-33 — which ending the simulated capture reaches. Dev-only (fixtures are
   never in the production bundle): sessionStorage "dos_fixture_capture" set to
   "nothing", "consent" or "failed"; anything else is a ready decision.
   ASK-33 Phase 5 — "failed_long" fails with a raw, unbroken exception string,
   to check a long reason wraps rather than truncates or overflows. */
const dexEnding = () => {
  try { return window.sessionStorage.getItem("dos_fixture_capture") || "decision"; } catch { return "decision"; }
};
/* PILOT-2 A — what the recording "said". The Dex pop-up's first step exists
   for a LONG spoken capture, so a suite can hand the fixture one:
   sessionStorage "dos_fixture_transcript" overrides the short line below. */
const SAID = "Tell Suresh to ship the indigo lot before Friday";
const dexSaid = () => {
  try { return window.sessionStorage.getItem("dos_fixture_transcript") || SAID; } catch { return SAID; }
};

export function buildWrites() {
  return [
    // ASK-32 1.6 — a held recording is sent as /voice-notes/{id}/submit and
    // followed by the same id, so that write answers with it too.
    // ASK-33 — every new capture walks the stages again from the start.
    { match: /^\/voice-notes(\/text|\/[^/]+\/submit)?$/, data: () => { dexReads = 0; dexApproved = false; dexDraft = false; return { id: "vn_fixture", status: "queued" }; } },
    /* 2026-10-07 — AND THE DICTATION HELPER, which the lab did not answer.
       Ask's audio does not go to /voice-notes: it posts /transcribe and gets
       the words straight back (routers/voice_notes.transcribe, "{ text }"),
       and with nothing here that call fell through to the real backend — so
       the whole Ask path was unreachable in fixture mode and no suite could
       walk it. Same knob as the capture's words (dos_fixture_transcript). */
    { match: "/transcribe", data: () => ({ text: dexSaid() }) },
    /* 2026-10-07 — AND THE ASK ITSELF. Every POST the lab does not know is
       answered `{ ok: true }` (see resolveFixture), so /ask came back with no
       `answer`, no `sources` and no `type` — which is indistinguishable, from
       the phone, from a brain that had nothing to say. Ask was therefore the
       one path in the app the lab could not walk at all.
       The three shapes are routers/brain.py's own, read from it rather than
       invented: ANSWER with typed, deep-linked citations; INSUFFICIENT_DATA
       with what is missing; PERMISSION_DENIED with the message that names the
       access and what you may ask instead. sessionStorage "dos_fixture_ask"
       picks which — default, "thin", "denied". */
    { match: "/ask", data: () => {
      let mode = "";
      try { mode = window.sessionStorage.getItem("dos_fixture_ask") || ""; } catch { mode = ""; }
      if (mode === "denied") {
        return {
          type: "PERMISSION_DENIED",
          message: "Money is not open to you here. You can ask me about tasks, decisions or workflows.",
          can_ask: ["tasks", "decisions", "workflows"],
        };
      }
      if (mode === "thin") {
        return {
          type: "INSUFFICIENT_DATA",
          answer: "I couldn't find enough information in your workspace to answer that yet.",
          missing_information: ["dispatch dates on the October orders"],
          suggested_questions: ["Which orders are late this week?"],
          query_context_id: "ctx_fixture",
        };
      }
      return {
        type: "ANSWER",
        answer: "Three dispatches are late this week. The Ashok Pumps lot is the oldest at 11 days.",
        query_context_id: "ctx_fixture",
        kpis: [],
        table: null,
        sources: [
          { id: "doc_fixture", type: "document", title: "Dispatch policy 2026.pdf", deep_link: "/company-brain?doc=doc_fixture" },
          { id: "wf_fixture", type: "workflow", title: "Order #4821 — Delhi Retailer", deep_link: "/workflows?id=wf_fixture" },
        ],
        applied_filters: {},
        suggested_questions: ["Which ones are over 7 days?", "Who owns the Ashok Pumps lot?"],
        export_options: [],
        currency: "INR",
      };
    } },
    // ASK-50 — approving answers with what the server's approve does
    // (services/decision_flow.approve_decision_flow): the decision, now
    // approved, with the task ids it made and the counts. The review card reads
    // task_ids to set the priority and proof it was given on those tasks; a
    // bare { ok: true } had no ids, so in fixture mode that step never ran.
    { match: /^\/decisions\/[^/]+\/approve$/, data: ({ path }) => (dexApproved = true) && ({
      id: path.split("/")[2], status: "approved",
      task_ids: ["t_approved_1", "t_approved_2"],
      created_on_approval: { task_ids: 2, workflow_ids: 1, meetings: 0, reminders: 0, memory_notes: 0 },
    }) },
    // PILOT-2 B — the draft flag, set and cleared the way the router does it
    // (routers/decisions.py), answering with the decision it changed.
    { match: /^\/decisions\/[^/]+\/draft$/, data: ({ path, method }) => {
      dexDraft = method !== "DELETE";
      return { id: path.split("/")[2], status: "pending_approval", draft: dexDraft };
    } },
    // 2026-09-21's "work these moves leave behind" asks this before approving;
    // unanswered, the fixture server said {} and the review crashed on it.
    { match: /^\/decisions\/[^/]+\/moves$/, data: [] },
    // ASK-33 — the Desk well attaches a file by the id this returns; without
    // one there is nothing to send with the note and no chip to show.
    { match: /^\/files$/, data: { id: "file_fixture", filename: "attachment" } },
  ];
}

export function buildRoutes(d) {
  const R = [];
  const add = (match, data) => { if (data !== undefined) R.push({ match, data }); };

  add("/auth/me", { user: OWNER, tenant: d.tenant || TENANT });
  add("/users", d.team || TEAM);
  add("/notifications", { notifications: d.notifications || [], unread: (d.notifications || []).filter((n) => !n.read).length });
  add("/captures/pending-count", { count: d.pendingCaptures ?? 0 });

  // /desk answers per chip, and always returns the full counters map so the
  // header sentence needs one call (same contract as routers/desk.py).
  if (d.desk) {
    R.push({
      match: "/desk",
      data: ({ query }) => {
        const chip = query.get("chip") || "needs_decision";
        return { chip, counters: d.desk.counters, cards: d.desk.cards?.[chip] || [] };
      },
    });
  }
  if (d.brief) {
    // `fires_detail` is derived from the same records /desk?chip=on_fire serves
    // rather than written out a second time in each state file: they ARE the
    // same fires, and a state where the counter says 12 but the list is empty
    // would quietly stop testing the narrative screen's biggest block. Shaped
    // the way MPWA-07 consumes it.
    const firesDetail = d.brief.fires_detail
      || (d.desk?.cards?.on_fire || []).map((c) => ({
        id: c.target_id || c.id,
        title: c.title,
        days_late: c.days_late ?? c.overdue_days ?? c.waiting_days ?? null,
        person: c.from_name || null,
        action: { chase: "Chase", nudge: "Nudge", respond: "Reply" }[c.cta] || null,
        amount: c.amount ?? null,
      }));
    R.push({
      match: "/brief",
      data: ({ query }) => {
        const period = query.get("period") || "morning";
        return {
          ...d.brief,
          fires_detail: firesDetail,
          period,
          greeting: d.brief.greetingFor?.[period] || d.brief.greeting,
        };
      },
    });
  }
  add("/brief/details", { key: "", actionable: false, items: d.briefDetails || [] });

  // MPWA-12e — the capture pipeline, simulated. The real backend queues a
  // BackgroundTask and walks the note queued -> transcribing -> structuring ->
  // done, and §5.6's "understanding" state exists to show that happening. A
  // fixture that answered `done` instantly, or not at all, would leave the only
  // screen where the founder sees the AI being smart untested.
  const DEX_NOTE = "vn_fixture";
  const DEX_DECISION = "dec_fixture";
  const dexTasks = (d.tasks || []).slice(0, 2);
  R.push({
    match: `/voice-notes/${DEX_NOTE}`,
    data: () => {
      dexReads += 1;
      const status = dexReads === 1 ? "transcribing" : dexReads === 2 ? "structuring" : "done";
      const ending = dexEnding();
      if (status === "done" && ending === "nothing") {
        return {
          id: DEX_NOTE, kind: "text", status: "done", outcome: "nothing_to_decide", decision_id: null,
          transcript: "How much profit did we make this month?",
          summary: "The founder asked how much profit the company made this month. That is a question, not a decision.",
        };
      }
      if (status === "done" && (ending === "consent" || ending === "failed" || ending === "failed_long")) {
        return {
          id: DEX_NOTE, kind: "text", status: "failed",
          transcript: dexSaid(),
          error: ending === "consent"
            ? "451: {'code': 'ai_consent_required', 'message': 'This AI feature is unavailable until your workspace owner grants consent for AI data processing.'}"
            : ending === "failed_long"
              ? "HTTPSConnectionPool(host='structuring.internal.decisionos.example', port=443): Max retries exceeded with url: /v1/structure?note=vn_fixture&trace=7f3c2a9e1b4d4c0f8a6e5d2c1b0a9f8e7d6c5b4a (Caused by NewConnectionError('<urllib3.connection.HTTPSConnection object at 0x7f9c2b3d4e50>: Failed to establish a new connection: [Errno 111] Connection refused'))"
              : "The structuring service did not answer within 60 seconds",
        };
      }
      return {
        id: DEX_NOTE,
        kind: "text",
        status,
        transcript: dexSaid(),
        detected_language_name: "English",
        ...(status === "done"
          ? {
              outcome: "decision",
              decision_id: DEX_DECISION,
              execution_summary: { tasks: dexTasks.length, assignees: dexTasks.length, approvals: 1, workflows: 0, meetings: 0, reminders: 0 },
            }
          : {}),
      };
    },
  });
  R.push({
    match: `/decisions/${DEX_DECISION}`,
    data: () => ({
      id: DEX_DECISION,
      title: "Ship the indigo lot to Tirupur before Friday",
      summary: "Suresh owns the dispatch; the lot is already dyed and waiting on packing.",
      dtype: "directive",
      confidence: 0.91,
      status: dexApproved ? "approved" : "pending_approval",
      draft: dexDraft,
      task_ids: dexTasks.map((t) => t.id),
      // ASK-33 — the ASK-32 shape: who decides, and the proposal nothing is
      // created from until approval.
      created_by: OWNER.id,
      approver_id: "u_fixture_sunita",
      approver_name: "Sunita Rao",
      execution_summary: { tasks: dexTasks.length, assignees: dexTasks.length, approvals: dexTasks.length ? 1 : 0, workflows: 1, meetings: 0, reminders: 0 },
      proposal: {
        tasks: dexTasks.map((t, i) => ({
          key: `t${i + 1}`, title: t.title, assignee_id: t.assignee_id || `u_fixture_${i + 1}`,
          assignee_name: t.assignee_name || null, due_date: t.due_date || null, priority: t.priority || "medium",
        })),
        workflows: [{
          key: "w1", mode: "existing", pipeline_label: "Dispatch", title: "Indigo lot for Tirupur",
          counterparty: "Tirupur Knits", stage: "ready_to_dispatch", move_to: "dispatched",
        }],
        meetings: [], reminders: [], memory_notes: [],
      },
    }),
  });

  add("/tasks", d.tasks);
  // A fire IS a task (`target_kind: "task"`), so GET /tasks/<fire id> has to
  // resolve — otherwise a `?focus=fire:f_0` deep link renders the "this item is
  // gone" state against data that plainly exists in the same fixture.
  add(/^\/tasks\/[^/]+$/, ({ path }) => {
    const id = path.split("/").pop();
    const fromTasks = (d.tasks || []).find((t) => t.id === id);
    if (fromTasks) return fromTasks;
    const fire = (d.desk?.cards?.on_fire || []).find((c) => (c.target_id || c.id) === id);
    if (!fire) return {};
    return {
      id,
      title: fire.title,
      description: fire.context_line || null,
      status: "in_progress",
      due_date: fire.due_date || null,
      assignee_name: fire.from_name || null,
      amount: fire.amount ?? null,
    };
  });
  add("/decisions", d.decisions);
  add(/^\/decisions\/[^/]+$/, ({ path }) => (d.decisions || []).find((x) => path.endsWith(x.id)) || {});
  add("/contacts", d.contacts);
  add(/^\/contacts\/[^/]+\/profile$/, ({ path }) => {
    const id = path.split("/")[2];
    const c = (d.contacts || []).find((x) => x.id === id) || (d.contacts || [])[0];
    return c ? (d.contactProfile ? d.contactProfile(c) : { contact: c, summary: {}, invoices: [], payments: [], complaints: [], workflows: [], pending_deliveries: [], follow_ups: [], price_history: [], documents: [], tasks: [] }) : {};
  });
  add("/workflows", d.workflows);
  add("/leaves", d.leaves);
  add("/complaints", d.complaints);
  add("/attendance", d.attendance || []);
  add("/ledger/summary", d.ledger);
  add(/^\/ledger\/ai\/[^/]+$/, d.financeAi);
  add("/expenses", d.expenses);
  add("/revenue", d.revenue);
  add("/assets", d.assets);
  add("/inventory", d.inventory);
  add("/invoices", d.invoices || []);
  add("/payments", d.payments || []);
  add("/calendar", d.calendar || []);
  add("/operating-score", d.operatingScore);
  add("/work-coach", d.workCoach);
  add("/journal", d.journal);
  add("/brain/documents", d.documents || []);
  add("/ingest", d.captures || []);
  add("/whatsapp/status", d.whatsapp || { connected: false, number: null });
  add("/tenant", d.tenant || TENANT);
  add("/tenant/settings", d.tenant || TENANT);
  add("/tenant/operating-model", d.operatingModel || { pipelines: [] });
  add("/tenant/roles", d.roles || []);

  return R;
}
