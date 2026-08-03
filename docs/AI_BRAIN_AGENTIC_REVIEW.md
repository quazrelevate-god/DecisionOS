# DecisionOS — AI Orchestration, Knowledge Base & Agentic Readiness Review

**Date:** 2026-08-03
**Branch:** `Backend_optimization`
**Method:** Direct reads of the AI/Brain code (routers/brain.py, services/brain_context.py) + 3 parallel deep-dives (orchestration/agentic-readiness, knowledge-base/RAG, brain write-coverage/meta-workflow). Confidence scores are the auditors', grounded in file:line reads.
**Question:** Audit the AI orchestration layer, the knowledge base, and the dynamic-RAG approach. How well is it built, how do we make it materially better and genuinely agentic, and how should we store data in the Brain?

---

## TL;DR

**What's there is well-engineered but it is an AI *pipeline*, not an agent, and the "RAG" is keyword search, not semantic retrieval.** The single best design decision in the whole system: the LLM plans and writes prose, but **all numbers are computed in Python** — so the Brain never hallucinates a figure. Keep that forever.

The gaps that matter for your agentic goal, in priority order:
1. **No semantic retrieval.** Everything is Mongo `$text` (BM25) + regex, and the text index runs with `default_language="none"` so even "refund" vs "refunds" misses. No embeddings anywhere (deferred as "P5"). Conceptual/"why did we…" questions fail.
2. **Documents are never read at ingest.** Upload stores metadata + a user-typed summary only. The file body is never extracted, chunked, or embedded. A 25MB contract is findable only by its title/tags. No passage-level retrieval exists anywhere.
3. **The knowledge base is 5 fragmented stores**, and the two names `brain_context` (the memory) and `brain_contexts` (a query cache) are a dangerous near-collision. The primary `/ask` agent never reads the decision-memory store at all.
4. **The Brain is under-populated.** Only 6 write sites. It captures the decision/task-approval loop and complaints, but misses ALL finance, workflow-advance, meeting, contact, and ingestion events — exactly the durable operating memory a founder expects.
5. **The provenance chain is broken.** decision → tasks → outcome is not reconstructable from the Brain; rows are unlinked siblings. An agent cannot answer "what did we decide about X, and did it work out?"
6. **Not agentic.** `/ask` is single-shot. `/api/brain/agent` (the "Dex" router) is a genuine plan → parallel-tool-fanout → synthesize, but single-turn: no observe→re-plan loop, no native function-calling, fresh LLM session per call so no working memory. The AI never takes an autonomous action (the only autonomy is a deterministic rules scheduler).

**None of this is a rewrite.** The `_compute_*` handlers in brain.py are already a proto-tool-registry (10 typed functions, clean `(ctx, plan, recs) → (kpis, table, cites)` contract). Formalizing them + adding a loop + adding embeddings converts this into a real agent in a small number of moves.

---

## Part 1 — AI Orchestration & Agentic Maturity

### Maturity rating: **Advanced LLM pipeline with a thin single-turn planner-executor. Not agentic.** (confidence 9/10)

Two AI front doors exist:
- **`/api/ask`** (routers/brain.py): single-shot `plan → retrieve → deterministic compute → prose`. LLM emits a strict-JSON plan (9 fixed intents, 10 fixed entities); code retrieves via regex keyword match and computes every number; LLM writes 2-5 sentences using only the pre-computed KPIs. Numbers are trustworthy. One `primary_entity` per question, no multi-hop.
- **`/api/brain/agent`** (routers/brain_router.py, "Dex"): a real `plan → fan-out tools in parallel (asyncio.gather) → synthesize`. This is the closest thing to an agent and it works, but **the synthesizer output never feeds back into the planner** (brain_router.py:481-482). It is function-*selection*, not function-*calling*. No loop.

Everything else (`ai_extract` server.py:250, `process_voice_note` server.py:972) is a linear prompt→parse ETL chain with **no validation loop, no self-correction, no retry** — on JSON parse failure it silently degrades to empty arrays (server.py:326).

**No Anthropic tool-use anywhere.** Every "tool call" is freeform JSON in a prompt, parsed by `_extract_json` (core.py:392) which grabs the first `{…}`. No JSON-schema enforcement, no typed tool I/O.

**No agent memory.** Each LLM call gets a fresh random `session_id=f"...-{new_id()}"` (brain_router.py:95,353) — planner and synthesizer don't even share a conversation. The only persistence is a write-back provenance row.

**Autonomy is deterministic, not AI.** `_followup_scheduler_loop` (server.py:2765, started :4946) sweeps every tenant every 300s and autonomously creates tasks with `created_by:"system"` for overdue receivables/bills — but from pure `due_date < cutoff` rules. The AI never acts autonomously; every AI write is human-triggered and gated `status:"pending_approval"`. Boundary: **AI proposes, humans/rules dispose.** (A safe default — keep the approval gate as the guardrail when you add AI autonomy.)

### The 5 architectural gaps → smallest high-leverage fix

**G1 — No tool registry / typed I/O.** Tools are hardcoded `if name ==` branches (brain_router.py:268-276).
→ Extract `TOOLS = {name: {fn, input_model, output_model, rbac}}`. The four `_tool_*` fns + the 10 `_compute_*` handlers already have stable signatures — wrap each in a Pydantic in/out model and register. ~1 day. Unlocks G2-G5.

**G2 — Single-shot, no planner-executor loop.**
→ Wrap `_plan`/`_run_tools` in a bounded `for step in range(max_steps)` loop; planner emits either `tool_calls` or `final`; feed observations back into the next planner prompt. Reuses existing functions verbatim.

**G3 — No native function-calling; brittle JSON.**
→ Migrate `claude_chat` calls to Anthropic `tools=[...]` using each registered `input_model.model_json_schema()`. Kills the `_extract_json` failure mode and gives typed args for free.

**G4 — No agent memory.**
→ Thread one stable `session_id` per user question across plan→tools→synth; pass prior observations as a running scratchpad. Long-term memory (`brain_context`) already exists — add a per-conversation buffer.

**G5 — No reflection; no AI autonomous action with guardrails.**
→ Add a one-shot "critic" re-prompt when confidence is low or JSON parse fails (reuse `ai_extract` shape). For autonomy, let the follow-up engine optionally ask the agent to *draft* the action, keeping the existing `pending_approval` gate as the commit guardrail.

---

## Part 2 — Knowledge Base & Dynamic RAG

### Current state: 3 knowledge stores, 1 partial bridge, no embeddings

| Store | Written by | Read by | Retrieval | Visibility |
|---|---|---|---|---|
| `brain_context` | `record_context()` on decisions/approvals/resolutions (6 sites) | Dex `knowledge_lookup` + `/api/brain/context` | `$text` (title×6/tags×3/why×1) → regex | public / dept / private |
| `brain_documents` | `POST /api/brain/documents` (owner/mgr) | Dex `metadata_search`/`file_open`, list | `$text` (title×8/tags×4…) → regex/`$in` | public / dept / private + roles |
| `db.memory` | `/api/memory`, voice extraction, ledger | `/ask` `memory` entity | **regex only, no text index** | tenant-wide, no per-row visibility |

**Only `/api/brain/agent` fans out across all three. `/api/ask` never reads `brain_context` or `brain_documents`** (brain.py `KNOWN_ENTITIES` :52). So "why did we pick vendor X?" via Ask returns nothing — provenance answers only work on the Dex path. Two front doors, different reach, inconsistent answers. (confidence 9)

### Document ingestion is metadata-only (no RAG) — confidence 9
On upload (brain_docs.py:147-213): bytes → object storage; Mongo stores metadata + `keywords` derived from title/tags/filename + a **user-typed** `summary`. **The body is never opened, extracted, chunked, summarized, or embedded.** Text extraction happens only lazily in `file_open` (brain_router.py:202-224): first 10 PDF pages / 400 docx paragraphs, capped 6000 chars, used for one LLM turn and never persisted or indexed. **Retrieval granularity = whole-document metadata. No passage-level retrieval exists.** A founder can find "the Acme contract" but not "the indemnity clause."

### Retrieval-quality ceiling — keyword vs vector
Everything is BM25 + regex, and both text indexes use `default_language="none"` (server.py:4894) → **no stemming/stopwords, so "refund" ≠ "refunds"**. Three real founder questions that break today and would work with embeddings:
1. "How do we handle unhappy customers who want their money back?" (tagged `refund`/`complaint`, near-zero token overlap)
2. "Why did we walk away from the Bangalore expansion?" (the `why` says "lease terms too aggressive, cash runway" — no overlap with "walk away")
3. "What's our stance on remote work?" (a PDF titled "Hybrid Attendance SOP", no manual summary — zero keyword overlap)

### Metadata: good for filtering/citation, thin for reasoning
**Present & strong:** kind, title, why, outcome, tags, source_type/source_id, actor, department, visibility, created_at; docs add roles_allowed/content_type/size. Deep-linked citations with confidence labels work well.
**Missing:** embeddings; extracted/indexed body text; chunk structure (page/section); named entities & relations (vendor↔contract↔decision graph); recency decay / importance weighting; `superseded_by`/version pointers; a quality score on the knowledge itself.

### Freshness / dedup / correction — none (confidence 9)
No decay (2-year-old decisions rank equal to yesterday's). No dedup (`record_context` inserts unconditionally — same fact 5× = 5 rows). Correction is asymmetric: documents support PATCH + soft-delete, but **`brain_context` has no update or delete endpoint at all** — captured provenance is immutable, so a reversed/wrong decision lingers forever with no supersede path.

### Auto-tag vocabulary is textile-shaped (confidence 8)
`_TAG_VOCAB` (brain_context.py:36) is 10 hardcoded manufacturing buckets. Non-textile tenants silently under-tag: clinic ("patient","prescription","diagnosis") → no tag; restaurant ("menu","reservation","food cost","wastage") → mostly untagged; agency ("retainer","creative","sprint") → untagged. Since retrieval weights tags 3-4×, missing tags directly cut recall. This ties to the same textile-hardcoding found in the workflow review.

---

## Part 3 — How to store data in the Brain (the meta-workflow)

### Write coverage today: 6 sites, big gaps (confidence 9)
Captured: decision approved/rejected, task approved/rejected, task done (via PATCH), complaint resolved, Dex-suggestion→task.
**Missed (log_activity only or nothing):**
- Task done via **execution-plan 100% completion** (tasks.py:507) — same event as the captured path, inconsistently skipped. **Quick fix.**
- Decision **created** (only approve/reject recorded — the original rationale never enters the Brain).
- **All finance** — payments matched, income/expense/invoice/asset (ledger.py:521-838).
- **Workflow advance/create** (the actual "did it get done" signal).
- Meetings, contacts, ingestion, leaves, handoffs, task notes, manual `/memory` writes.

So the Brain remembers approvals and complaints but forgets money, fulfilment, and meetings.

### Provenance chain is BROKEN (confidence 9)
`source_id` points at a single entity. A `task_done` row records `source_id=task_id` but **never carries the parent `decision_id`**, even though `db.tasks.decision_id` exists. Nothing reconstructs decision → tasks → completion inside the Brain. An agent sees the decision-approved row and the task-done row as **unlinked siblings** and cannot answer "what did we decide about X and did it work out?" — which is the exact question an operating brain should nail.

### 5 overlapping stores + a dangerous name collision (confidence 9)
`brain_context` (the memory) vs `brain_contexts` (the `/ask` query-plan cache) vs `db.activity` (feed/counters) vs `db.memory` (free notes) vs `db.brain_audit` (RBAC log). No single "this is THE memory." Rename `brain_contexts` → `brain_query_cache` immediately to kill the near-collision.

### Write reliability: no durability (confidence 10)
`record_context` is fire-and-forget: any exception → `warning` + return `None`. No dead-letter, no retry, no reconciliation. Callers `await` it but ignore the return, so silent failure is indistinguishable from success. Dropped events vanish from the knowledge base permanently.

---

## Recommended roadmap (sequenced, reuse-first)

**Phase 1 — Cheap recall wins (days):**
- Fix `default_language="none"` → `"english"` on both text indexes; add a `$text` index on `db.memory`.
- Fix the task-done coverage gap (tasks.py:507); add `decision_id`/`parent_id` to `record_context` rows and backfill from `db.tasks.decision_id` so the provenance chain becomes queryable.
- Rename `brain_contexts` → `brain_query_cache`.
- Make `/api/ask` also retrieve from `brain_context`/`brain_documents` (or route Ask through the Dex agent) so both front doors have the same reach.

**Phase 2 — Real RAG (1-2 weeks):**
- At document upload, extract body text server-side, chunk (~500-token overlap), embed, store in a new `brain_chunks` collection with `doc_id`/page/department/visibility. Enables passage-level retrieval.
- Adopt **MongoDB Atlas Vector Search** (zero new infra, keeps tenant/visibility filters in the same `$match`) and fuse vector + `$text` via reciprocal-rank fusion. This single change fixes all three failing example queries.
- Embed `brain_context` rows too, so decision memory is semantically searchable.

**Phase 3 — Agentic (2-3 weeks, after Phase 1-2):**
- Formalize the tool registry (G1) from the existing `_compute_*` + `_tool_*` handlers.
- Add the bounded planner-executor loop (G2) and migrate to native Anthropic function-calling (G3).
- Add per-conversation working memory (G4) and a low-confidence critic pass (G5).
- Let the follow-up engine optionally have the agent *draft* actions, keeping `pending_approval` as the commit guardrail.

**Phase 4 — Knowledge quality (ongoing):**
- Dedup (content-hash on insert), `superseded_by` + PATCH/soft-delete on `brain_context`, recency-weighted ranking, `importance`/`amount` fields, `department` = event domain not actor role.
- Expand write coverage to finance/workflow/meeting/ingestion events.
- Make `_TAG_VOCAB` tenant/industry-configurable with an LLM fallback tagger when zero keyword hits.
- Durability: on `record_context` failure, write to `brain_context_dlq` + a reconciliation sweep.
- Entity/relation extraction → a light graph (vendor↔contract↔decision) for multi-hop "why" reasoning.

---

## What to keep (don't rewrite)
- **LLM plans + writes prose, code computes all numbers.** This is the core trust property. Every agentic addition must preserve it — the agent orchestrates tools, tools compute deterministically.
- The `_compute_*` handler pattern (a proto-tool-registry).
- Permission-gated retrieval + deep-linked citations with confidence labels.
- Fire-and-forget isolation so a Brain write can't 500 the parent request (just add a dead-letter path so failures are recoverable, not silent).

## Open decisions for you
1. **Are you on MongoDB Atlas?** If yes, Atlas Vector Search is the zero-infra path for Phase 2. If self-hosted Mongo, the choice is Qdrant / pgvector / Weaviate — changes the Phase 2 plan.
2. **Embedding model** — hosted (Voyage/OpenAI/Cohere) vs the Emergent key vs self-hosted. Ties to the per-tenant AI-key decision from the SaaS-readiness review.
3. **One brain or two front doors?** Consolidate `/ask` and `/brain/agent` into one agent, or keep the fast deterministic `/ask` for KPIs and the agent for open-ended questions? (I lean: keep both, but give them the same retrieval reach.)
4. **Sequencing vs go-live:** the go-live/security blockers from the other two reviews should land before this AI work — an agentic brain on an unshipped, insecure backend helps no one. This is the "make it great" track, not the "make it safe" track.
