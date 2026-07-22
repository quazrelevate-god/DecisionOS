"""Generate the DecisionOS Complete Product & Architecture Guide (detailed)."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    ListFlowable, ListItem, PageBreak, KeepTogether,
)

RED = colors.HexColor("#E63946")
INK = colors.HexColor("#1E1E24")
PAPER = colors.HexColor("#FAF7F2")
GREY = colors.HexColor("#6D6875")
LINE = colors.HexColor("#E5E1DA")
BLUE = colors.HexColor("#457B9D")

s = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=s["Heading1"], fontName="Helvetica-Bold", fontSize=26, textColor=INK, leading=30, spaceAfter=4)
SUB = ParagraphStyle("SUB", parent=s["Normal"], fontName="Helvetica", fontSize=11, textColor=GREY, leading=15)
H2 = ParagraphStyle("H2", parent=s["Heading2"], fontName="Helvetica-Bold", fontSize=16, textColor=RED, leading=20, spaceBefore=12, spaceAfter=4)
H3 = ParagraphStyle("H3", parent=s["Heading3"], fontName="Helvetica-Bold", fontSize=12, textColor=INK, leading=16, spaceBefore=8, spaceAfter=2)
H4 = ParagraphStyle("H4", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=10.5, textColor=BLUE, leading=14, spaceBefore=5, spaceAfter=1)
BODY = ParagraphStyle("BODY", parent=s["Normal"], fontName="Helvetica", fontSize=9.7, textColor=INK, leading=14.5, alignment=TA_LEFT, spaceAfter=3)
BULLET = ParagraphStyle("BULLET", parent=BODY, leftIndent=4, spaceAfter=1)
SMALL = ParagraphStyle("SMALL", parent=s["Normal"], fontName="Helvetica", fontSize=8, textColor=GREY, leading=11)
MONO = ParagraphStyle("MONO", parent=s["Normal"], fontName="Courier", fontSize=8, textColor=INK, leading=11)
CODEK = ParagraphStyle("CODEK", parent=s["Normal"], fontName="Courier-Bold", fontSize=8.2, textColor=INK, leading=11)

story = []

def bullets(items, style=BULLET):
    return ListFlowable(
        [ListItem(Paragraph(x, style), leftIndent=10, value="•") for x in items],
        bulletType="bullet", start="•", leftIndent=12, bulletColor=RED, spaceAfter=4)

def rule():
    story.append(Spacer(1, 3)); story.append(HRFlowable(width="100%", thickness=0.8, color=LINE)); story.append(Spacer(1, 3))

def kv_table(rows, w=(52, 118)):
    data = [[Paragraph(f"<b>{k}</b>", BODY), Paragraph(v, BODY)] for k, v in rows]
    t = Table(data, colWidths=[w[0]*mm, w[1]*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, PAPER]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t

def grid_table(header, rows, widths):
    data = [[Paragraph(f"<b>{h}</b>", ParagraphStyle('th', parent=BODY, textColor=colors.white, fontName='Helvetica-Bold', fontSize=9)) for h in header]]
    for r in rows:
        data.append([Paragraph(c, ParagraphStyle('td', parent=BODY, fontSize=8.7, leading=12)) for c in r])
    t = Table(data, colWidths=[w*mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t

def box(title, para):
    inner = [[Paragraph(f"<b>{title}</b>", H3)], [Paragraph(para, BODY)]]
    t = Table(inner, colWidths=[170*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER), ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    return t

# ============================ COVER ============================
story.append(Spacer(1, 6))
logo = Table([[Paragraph('<font color="#FFFFFF"><b>D</b></font>', ParagraphStyle("L", fontName="Helvetica-Bold", fontSize=20, alignment=1)),
               Paragraph('<b>Decision<font color="#E63946">OS</font></b>', ParagraphStyle("LG", fontName="Helvetica-Bold", fontSize=22, textColor=INK))]],
              colWidths=[12*mm, 70*mm])
logo.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), RED), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                          ("ALIGN", (0, 0), (0, 0), "CENTER"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
story.append(logo)
story.append(Spacer(1, 12))
story.append(Paragraph("Complete Product &amp; Architecture Guide", H1))
story.append(Paragraph("Every menu, every option, the full system architecture, and the end-to-end flow of data — "
                       "with a clear split of what Owners and Employees can do.", SUB))
rule()
story.append(Paragraph("<b>Contents</b>", H3))
story.append(bullets([
    "1. What DecisionOS is",
    "2. System architecture (frontend, backend, database, AI, multi-tenancy)",
    "3. Roles &amp; access model — the 14 module permissions, Owner vs Employee",
    "4. Onboarding: how an Owner's workspace is created",
    "5. End-to-end data flow (capture → AI → review → tasks → brain → alerts)",
    "6. Menu-by-menu deep dive — every single option",
    "7. Owner journey vs Employee journey",
    "8. Core data entities",
    "9. API reference (grouped)",
    "10. Integrations, AI models &amp; security",
]))

# ============================ 1. OVERVIEW ============================
story.append(Paragraph("1. What DecisionOS is", H2))
story.append(Paragraph(
    "DecisionOS is an AI operating system for founder-led small &amp; medium businesses. It captures spoken or typed "
    "decisions, reads incoming documents/invoices/messages, turns them into structured tasks and workflows, and "
    "gives the whole team one shared operational brain. It is <b>multi-tenant</b> (each company is an isolated "
    "workspace) with <b>strict role-based access</b>, and every screen adapts to the company's industry using an "
    "AI-generated <b>Operating Model</b> (workflow pipelines + task categories) and <b>Business Vocabulary</b> "
    "(the words your industry actually uses).", BODY))
story.append(box("The one-line mental model",
    "Anything that happens in the business enters through <b>Capture</b> or <b>Decision Desk</b> → AI structures and "
    "routes it → it becomes <b>Tasks / Decisions / Workflows / Finance</b> records → everyone acts in <b>My Work</b> → "
    "the <b>Company Brain</b> remembers it → the <b>CEO Brief</b> and <b>Notifications</b> surface what needs attention."))

# ============================ 2. ARCHITECTURE ============================
story.append(Paragraph("2. System architecture", H2))
story.append(Paragraph("DecisionOS is a three-tier web application with an AI layer on top.", BODY))
story.append(grid_table(
    ["Layer", "Technology", "Responsibility"],
    [["Frontend", "React, TailwindCSS, Shadcn UI, React Router, TanStack Query, react-i18next",
      "Renders all menus/pages; per-user language (EN/HI/TA); talks to the API via a single axios client using REACT_APP_BACKEND_URL."],
     ["Backend", "FastAPI (Python), all routes prefixed /api",
      "Auth &amp; RBAC, business logic, AI orchestration, WhatsApp webhook, follow-up/escalation engine, file storage."],
     ["Database", "MongoDB (Motor async)",
      "Stores every entity keyed by tenant_id for multi-tenant isolation. IDs are UUID strings."],
     ["AI layer", "Anthropic Claude, Google Gemini, OpenAI (transcribe/vision) with Emergent Universal LLM key as fallback (see core.py)",
      "Transcription, classification, extraction, structuring, finance analysis, Ask/Search answers, operating-model &amp; lexicon generation."]],
    [24, 66, 80]))
story.append(Spacer(1, 4))
story.append(Paragraph("<b>Key architectural ideas</b>", H3))
story.append(bullets([
    "<b>Multi-tenancy:</b> every document carries a <font face='Courier'>tenant_id</font>. Users only ever read/write their own tenant's data.",
    "<b>Dynamic UI:</b> tabs, pipeline stages and task categories are read from <font face='Courier'>tenant.operating_model</font>; contact/vendor labels from <font face='Courier'>tenant.lexicon</font> — so a textile mill and a clinic see different terminology on the same code.",
    "<b>Auth:</b> JWT bearer token (also set as a cookie) issued on register/login; passwords hashed with bcrypt.",
    "<b>Hot paths run in the background:</b> long AI jobs (transcription, structuring) are processed asynchronously; the UI shows a 'structuring…' banner and updates when ready.",
    "<b>Single source of config:</b> URLs, DB and keys come only from environment variables (frontend .env → REACT_APP_BACKEND_URL; backend .env → MONGO_URL/DB_NAME).",
]))

# ============================ 3. ROLES & ACCESS ============================
story.append(PageBreak())
story.append(Paragraph("3. Roles &amp; access model", H2))
story.append(Paragraph(
    "There are two conceptual levels: the <b>Owner</b> (full control) and <b>Employees</b> (granular, module-level "
    "access). Access is enforced on <b>both</b> the frontend (menus hide) and the backend (endpoints reject "
    "unauthorised calls). Employees are given a <b>role</b> (e.g. Sales, Finance, Operations — roles are "
    "customisable per company) plus an explicit list of <b>module permissions</b>.", BODY))

story.append(Paragraph("3.1 The 14 module permissions", H3))
story.append(Paragraph("Every menu/action maps to one of these permission keys. Owners implicitly hold all of them.", BODY))
story.append(grid_table(
    ["Permission key", "Grants access to"],
    [["inbox", "Decision Desk (unified inbox)"],
     ["voice_capture", "The voice/text capture box on the Decision Desk"],
     ["data_input", "Capture menu (uploads, CSV/doc ingest, WhatsApp intake)"],
     ["people", "People menu (team + customers + vendors)"],
     ["finance", "Finance 360° (invoices, payments)"],
     ["ledger", "Finance Ledger (expenses, assets, inventory)"],
     ["workflows", "Workflow pipelines"],
     ["tasks", "Tasks"],
     ["brain", "Company Brain (search)"],
     ["ask", "Ask AI"],
     ["approvals", "Approve tasks"],
     ["decisions_approve", "Approve decisions"],
     ["leave_approve", "Approve leave requests"],
     ["team_manage", "Manage team, roles, and company operating settings"]],
    [45, 125]))
story.append(Spacer(1, 4))
story.append(Paragraph("<b>Default permissions per role</b> (owner can override any of these per employee):", BODY))
story.append(bullets([
    "<b>Base (all employees):</b> inbox, data_input, people, workflows, tasks, brain, ask.",
    "<b>Sales:</b> the base set.",
    "<b>Finance:</b> base set + finance + ledger.",
    "<b>Owner:</b> all 14 permissions, always.",
]))

story.append(Paragraph("3.2 Owner vs Employee — side by side", H3))
story.append(grid_table(
    ["Capability", "Owner", "Employee"],
    [["See all menus", "Yes — nothing is hidden", "Only menus their permissions allow"],
     ["Settings menu", "Yes (owner-only)", "No"],
     ["Manage team &amp; roles / grant permissions", "Yes", "Only if given team_manage"],
     ["Promote someone to co-owner", "Yes (≥1 owner must remain)", "No"],
     ["Approve decisions / tasks / leave", "Yes", "Only with matching approve permission"],
     ["CEO Brief fires/counters &amp; Operating Score", "Yes (owner-focused)", "Limited / hidden owner-only pages"],
     ["Edit Operating Model, Vocabulary, Approval rules", "Yes", "No"],
     ["See finance", "Yes", "Only with finance/ledger permission"],
     ["Own tasks, workflows, brain, capture", "Yes", "Per permission (base set by default)"]],
    [70, 50, 50]))
story.append(Spacer(1, 3))
story.append(box("How hiding works in practice",
    "The sidebar builds itself from a permission-filtered list. If an employee lacks <font face='Courier'>people</font>, "
    "the People menu simply isn't rendered, its route is protected, and any direct API call is rejected with 403. "
    "Owner-only pages (Settings, Journal, Operating Score) are gated by <font face='Courier'>ownerOnly</font>."))

# ============================ 4. ONBOARDING ============================
story.append(Paragraph("4. Onboarding — how an Owner's workspace is created", H2))
story.append(Paragraph("Signing up creates the tenant (company) and the first Owner in one step:", BODY))
story.append(bullets([
    "Owner registers with <b>company name, their name, email, password, industry</b> and a short <b>business description</b>.",
    "AI immediately generates a tailored <b>Operating Model</b> (workflow pipelines with stages + task categories), a <b>Business Vocabulary</b> (lexicon), suggested <b>team roles/departments</b>, example <b>products/services</b>, <b>operational task templates</b> and <b>approval rules</b> — all specific to the industry.",
    "A workspace summary is returned (departments, workflows, operational tasks, approval rules counts).",
    "The Owner then invites employees, assigns each a role + permissions, and can edit any generated template in <b>Settings</b>.",
    "Employees join via an <b>invite link</b> (email + password) or as <b>mobile-OTP (passwordless)</b> users.",
]))

# ============================ 5. DATA FLOW ============================
story.append(PageBreak())
story.append(Paragraph("5. End-to-end flow of data", H2))
story.append(Paragraph("This is the heart of DecisionOS. Follow one item from entry to memory:", BODY))

flow = [
    ("A. Entry (many front doors)",
     ["<b>Decision Desk:</b> Owner/employee taps the mic and speaks, or types a directive.",
      "<b>Capture menu:</b> upload a document/image/PDF, import a CSV, or paste text.",
      "<b>WhatsApp:</b> a message/photo sent to the workspace number hits the WhatsApp webhook.",
      "<b>Meeting Notes:</b> a recorded/pasted meeting.",
      "<b>Voice notes / complaints / contacts</b> can also originate items."]),
    ("B. AI extraction pipeline",
     ["Audio is <b>transcribed</b> (OpenAI transcribe). Images/PDFs are <b>read</b> (vision).",
      "AI <b>classifies</b> the item (decision, task, invoice, payment, complaint, contact…) and <b>structures</b> it into a clean summary with fields, amounts, dates and suggested owners.",
      "A <b>confidence score</b> decides routing: high-confidence items can auto-process; lower-confidence items are flagged for human review."]),
    ("C. Department review queue (Captures)",
     ["A <b>draft capture</b> is created and routed to the correct reviewer: money items → the tenant's finance/accounts role (by <font face='Courier'>reviewer_perm=finance</font>); operational items → the relevant department.",
      "The Owner sees everything; an employee sees a draft if their role matches the reviewer role OR they hold the reviewer permission.",
      "Reviewer actions: <b>Approve</b>, <b>Reject</b>, <b>Clarify</b> (ask AI/askback), or <b>Reassign</b> to another member/role."]),
    ("D. Commit — records are created",
     ["On approval the draft becomes real records: <b>Decisions</b> (with linked <b>Tasks</b>), <b>Workflow</b> cards, <b>Expenses/Assets/Inventory</b>, <b>Invoices/Payments</b>, <b>Contacts</b>, or <b>Complaints</b>.",
      "High-value money items respect the company's <b>threshold</b> and <b>owner sign-off</b> rules from Settings."]),
    ("E. Action — My Work",
     ["Tasks land in the assignee's <b>My Work</b>. AI can <b>prioritise</b> them. Workflow cards advance stage-by-stage.",
      "Assignees respond, add updates, attach files, or generate an AI <b>execution plan</b>."]),
    ("F. Follow-up &amp; escalation engine",
     ["A background engine watches due dates and SLAs, sends <b>follow-ups</b>, and <b>escalates</b> overdue/at-risk items — producing <b>Notifications</b>."]),
    ("G. Surface — CEO Brief &amp; Notifications",
     ["The <b>CEO Brief</b> aggregates the day into a headline + 'fires to put out', with deep links to each record.",
      "The <b>bell</b> shows follow-ups, escalations and mentions; clicking one jumps to the item."]),
    ("H. Memory — Company Brain",
     ["Every decision, task, workflow, contact and 'company memory' note is indexed so <b>Ask</b> gives grounded answers with citations and <b>Search</b> finds exact records."]),
]
for title, items in flow:
    story.append(Paragraph(title, H4))
    story.append(bullets(items))

story.append(box("Leave &amp; absence — a parallel flow",
    "When someone requests leave or reports an absence, AI computes the <b>impact</b> (which tasks/workflows are at risk "
    "and who should cover), routes it to the configured <b>leave approvers</b>, and can apply reassignments in one click."))

# ============================ 6. MENU DEEP DIVE ============================
story.append(PageBreak())
story.append(Paragraph("6. Menu-by-menu deep dive (every option)", H2))
story.append(Paragraph("Below is each sidebar menu with all of its sub-tabs, buttons and controls. Interactive "
                       "elements are named exactly as they appear/behave in the product.", BODY))

def menu(title, route, perm, purpose, sections):
    story.append(Paragraph(title, H3))
    story.append(Paragraph(f"<b>Route:</b> <font face='Courier'>{route}</font> &nbsp;&nbsp; <b>Access:</b> {perm}", SMALL))
    story.append(Paragraph(purpose, BODY))
    for label, items in sections:
        story.append(Paragraph(label, H4))
        story.append(bullets(items))
    rule()

# Global top bar
menu("Top bar &amp; global tools", "(all screens)", "Everyone",
     "Always visible controls at the top and around the app.",
     [("Controls", [
        "<b>Send Daily Digest</b> — emails the current CEO Brief to you/the team.",
        "<b>Language switcher</b> (globe) — English / हिन्दी / தமிழ்; applies to you only.",
        "<b>Light / Dark theme</b> toggle.",
        "<b>Notifications bell</b> — unread count badge; dropdown of the latest items; click to open the item; 'Mark all read'.",
        "<b>Profile</b> — open profile dialog; <b>Sign out</b>.",
        "<b>Voice mic buttons</b> — dictate instead of typing in most inputs.",
        "<b>Mobile bottom tab bar</b> — quick access to Desk, Brief, Work, People, Brain.",
     ])])

menu("6.1 Decision Desk", "/inbox", "Requires 'inbox' permission",
     "The unified inbox — the single front door to capture and triage everything.",
     [("Capture box", [
         "<b>Voice record</b> button with a live <b>timer</b>; controls to <b>pause</b>, <b>resume</b>, <b>cancel</b> and <b>finalise</b> the recording.",
         "<b>Type a directive</b> text box + <b>submit</b> (e.g. 'Tell sales to send the revised quote to the Delhi retailer by Friday…').",
         "A <b>language selector</b> for the capture, and a <b>structuring banner / thinking overlay</b> while AI works — you can keep going.",
       ]),
      ("Triage sections", [
         "<b>Decision Approvals</b> — approve / reject / discuss AI-extracted decisions.",
         "<b>Needs Your Attention</b> — items AI flagged for you.",
         "<b>Tasks &amp; Activity feed</b> — live stream with <b>filters</b>; on mobile <b>swipe right = view, swipe left = dismiss</b> (a swipe hint is shown).",
         "<b>Clarify panel</b> — when AI needs more info: submit answer, skip, or cancel.",
         "<b>Owner-only notice</b> appears where an action is limited to owners.",
       ])])

menu("6.2 CEO Brief", "/brief", "All users (owner-focused; some counters owner-only)",
     "A daily AI executive summary of what needs attention.",
     [("On the page", [
         "<b>Brief controls</b> — switch period (e.g. morning/evening).",
         "<b>'Fires to put out today'</b> with a <b>fires count</b> and clickable <b>fire rows</b> (deep-link to the exact record).",
         "<b>Open Work Coach</b> — AI coaching on priorities.",
         "<b>Open Journal</b> — the owner's decision journal (owner-only).",
         "<b>Operating Score</b> — a health score for how the business is running (owner-only).",
       ])])

menu("6.3 My Work", "/my-work", "All users (items filtered to what you can access)",
     "Your personal operational cockpit: tasks, board, workflows and leave.",
     [("Scope &amp; priority", [
         "<b>My Tasks</b> vs <b>All Tasks</b> scope toggle.",
         "<b>AI Priority</b> toggle — AI scores &amp; orders tasks; each shows a <b>priority score</b> with bars.",
       ]),
      ("View toggle (4 views)", [
         "<b>My Work</b> — task list grouped by category.",
         "<b>Board</b> — kanban by status.",
         "<b>Workflows</b> — pipeline cards (see 6.x); advance stage, create, delete.",
         "<b>Leave</b> — opens the Leave &amp; Absence view.",
       ]),
      ("Per-task actions", [
         "Respond, add updates, attach files, mark done, reassign, approve/reject (with permission), generate/edit an AI <b>execution plan</b> and ask about steps.",
         "An <b>access-restricted banner</b> shows if you open an item you can't access.",
       ])])

menu("6.4 People", "/contacts", "Requires 'people' permission",
     "CRM-lite for your team, customers and vendors. Tab labels adapt to your industry.",
     [("Tabs", [
         "<b>Employees</b> (needs team_manage) — add users; set role, permissions, reporting manager; invite links.",
         "<b>Customers</b> — customer/dealer records.",
         "<b>Vendors</b> — supplier/vendor records.",
       ]),
      ("Contact tools", [
         "<b>Add contact</b>, <b>search</b>, filter by <b>status</b> and <b>type</b>.",
         "Contact form: <b>name, company, email, phone, birthday, status, assigned owner, type</b>.",
         "Log a <b>complaint</b> against a contact (text + save).",
       ]),
      ("Contact profile page", [
         "Header with back button, a <b>relationship card</b> and <b>relationship signals</b>, and a <b>Re-score</b> button (AI re-evaluates the relationship health).",
       ])])

menu("6.5 Company Brain", "/brain", "Requires 'brain' permission (Ask uses 'ask')",
     "The shared memory of the business.",
     [("Ask tab", [
         "Ask a question in plain language; AI answers grounded in your data with <b>source citations</b>.",
         "Suggestion chips (e.g. 'What purchases need my approval?'), a text box, <b>voice dictation</b>, and Send.",
       ]),
      ("Search tab", [
         "Full-text search across <b>Decisions, Tasks, Workflows, Contacts</b> and <b>Company Memory</b>; results grouped by type with counts.",
         "Voice dictation supported. Rule of thumb: <b>Ask = answer, Search = records</b>.",
       ])])

menu("6.6 Finance", "/ledger", "Requires 'ledger' or 'finance' permission",
     "All money in one place with an AI finance analyst.",
     [("Tabs", [
         "<b>Overview</b> — KPIs (Total Spend, Outstanding, Asset Value, Inventory Value), Monthly Spend chart, By-Category donut, Top Vendors bars.",
         "<b>Expenses</b>, <b>Assets</b>, <b>Inventory</b> — tables with delete; add via dialog or by attaching a bill/PDF that AI reads.",
       ]),
      ("AI Finance Brief / Analysis (each tab)", [
         "Headline + prioritised <b>action items</b> tagged Urgent / Important / FYI (expandable).",
         "From an insight: <b>Create task</b> (assign to member/role, set priority) or <b>Ask AI</b> about it.",
         "<b>Refresh</b> re-runs the analysis; <b>Ask AI</b> box for finance questions.",
       ]),
      ("Add dialogs", [
         "<b>Expense:</b> attach bill, title, amount, status (paid/unpaid), vendor, AI <b>suggest category</b>, date, notes.",
         "<b>Asset:</b> name, purchase amount, category, vendor, purchase date, status (active/maintenance/disposed).",
         "<b>Inventory:</b> item, SKU, quantity, unit, unit cost, category, vendor (value = qty × unit cost).",
         "Approved purchase bills &amp; outgoing payments auto-flow in from WhatsApp/uploads.",
       ])])

menu("6.7 Capture", "/ingest", "Requires 'data_input' permission",
     "The intake tool that feeds the AI pipeline.",
     [("Import tab", [
         "<b>Upload document</b> (image/PDF) drop-zone + file picker.",
         "<b>Import CSV</b> drop-zone + file picker.",
         "A <b>direction banner</b> and an <b>own-company warning</b> guard against mis-ingesting your own data.",
         "<b>WhatsApp card</b>: connection status, <b>QR link</b>, token-error hint, and a <b>logs list</b> with refresh.",
       ]),
      ("Review tab", [
         "A <b>badge</b> shows pending items. Sub-tabs to review extracted <b>Invoices, Payments, Contacts, Tasks</b> before committing.",
         "<b>Records</b> tables for Invoices and Payments; commit an ingestion to finalise.",
       ])])

menu("6.8 Meeting Notes", "/meetings", "All users",
     "Turn meetings into minutes and actions.",
     [("Options", [
         "<b>Record</b> a meeting by voice (recorder UI), or toggle <b>paste/type</b> to submit a transcript.",
         "AI writes <b>Key Points</b> and extracts decisions/tasks; everything becomes searchable in Company Brain.",
         "A <b>meetings list</b> of past sessions; open any to view its minutes.",
       ])])

menu("6.9 Settings", "/settings", "Owner only",
     "Where the Owner configures how the whole company operates.",
     [("Cards", [
         "<b>Company Details</b> — name, industry, description (sharpens AI), currency, region, GST, branches.",
         "<b>Business Vocabulary</b> — customer/vendor labels, task-type/department labels; <b>regenerate</b> with AI.",
         "<b>Operating Model</b> — edit <b>workflow pipelines</b> (add/rename/delete pipelines &amp; stages, set the owner sign-off stage) and <b>task categories</b>; add roles; <b>regenerate</b> with AI.",
         "<b>Team Roles</b> — create/rename/delete roles; <b>Products &amp; Services</b> list.",
         "<b>Approval rules</b> — company rules that govern sign-off.",
         "<b>Language</b> — your interface language (per-user).",
         "<b>Your Profile</b> — name, mobile, sign-in email.",
         "<b>Password &amp; Security</b> — change your password (current → new → confirm).",
         "<b>Money &amp; Approvals</b> — default currency, high-value threshold, and 'require owner sign-off above threshold' toggle.",
       ])])

menu("6.10 Additional / linked pages", "/journal, /operating-score, /coach, /calendar, /notifications", "Mixed",
     "Reachable from the CEO Brief, bell, or deep links.",
     [("Pages", [
         "<b>Journal</b> (owner-only) — the founder's decision journal.",
         "<b>Operating Score</b> (owner-only) — overall business-health score.",
         "<b>Work Coach</b> — AI coaching; refreshable.",
         "<b>Calendar</b> — time-based view of tasks/leave/events.",
         "<b>Notifications</b> — full list with <b>mark-all-read</b>.",
         "<b>Leave &amp; Absence</b> (via My Work) — tabs: <b>My leaves</b>, <b>Approvals</b>, <b>Approver config</b>; request leave (type, from/to, half-day portion, reason), report absence (reason, note), view AI <b>impact</b> and apply-all reassignment, save approvers.",
       ])])

# ============================ 7. JOURNEYS ============================
story.append(PageBreak())
story.append(Paragraph("7. Owner journey vs Employee journey", H2))
story.append(Paragraph("7.1 Owner — a typical day", H3))
story.append(bullets([
    "Open <b>CEO Brief</b> → read the headline and clear the 'fires' (each links to the record).",
    "Check <b>Decision Desk</b> → approve/reject AI-extracted decisions; reassign anything mis-routed.",
    "Review money in the <b>Capture → Review</b> queue and <b>Finance</b> (respecting the high-value threshold).",
    "Dictate new directives by voice; AI turns them into assigned tasks.",
    "Manage the team in <b>People → Employees</b>; tune rules in <b>Settings</b>.",
    "Ask the <b>Company Brain</b> anything; send the <b>Daily Digest</b>.",
]))
story.append(Paragraph("7.2 Employee — a typical day", H3))
story.append(bullets([
    "Lands on <b>Decision Desk</b> (or My Work if no inbox access) — sees only permitted menus.",
    "Works through <b>My Work</b> tasks (optionally AI-prioritised); advances <b>Workflow</b> cards.",
    "Captures field updates by voice/upload in <b>Capture</b>; logs customer issues in <b>People</b>.",
    "Requests <b>Leave</b> — AI shows who/what is impacted and routes it to approvers.",
    "Uses <b>Company Brain</b> to find past decisions instead of asking the founder.",
    "Never sees Settings, other departments' finance, or owner-only pages unless granted.",
]))

# ============================ 8. DATA ENTITIES ============================
story.append(Paragraph("8. Core data entities", H2))
story.append(grid_table(
    ["Entity", "Purpose / key fields"],
    [["tenant", "The company workspace: name, industry, description, currency, roles, products, lexicon, operating_model, approval_rules, threshold &amp; sign-off settings."],
     ["user", "Member: name, email, phone, role, permissions[], reporting_manager_id, language, passwordless flag, password_hash."],
     ["capture", "AI draft awaiting review: type, extracted fields, confidence, reviewer_role, reviewer_perm, status."],
     ["decision", "Structured decision: title, summary, status, linked tasks, timeline/comments."],
     ["task", "Work item: title, description, priority, status, assignee_id/role, updates, attachments, execution plan."],
     ["workflow", "Pipeline card: type, title, counterparty, amount, stage, stages[], history."],
     ["expense / asset / inventory", "Finance ledger records with source, attachment, amounts."],
     ["invoice / payment", "Money-360 records from ingest/WhatsApp."],
     ["contact", "Customer/vendor/dealer: name, company, phone, type, status, relationship score."],
     ["leave / attendance", "Time-off requests &amp; absences with AI impact."],
     ["meeting / voice-note", "Transcribed sessions and their extracted actions."],
     ["memory", "Company Brain notes/tags."],
     ["notification / activity", "Alerts and the audit log of who did what."]],
    [34, 136]))

# ============================ 9. API ============================
story.append(PageBreak())
story.append(Paragraph("9. API reference (grouped)", H2))
story.append(Paragraph("All endpoints are prefixed with <font face='Courier'>/api</font> and require a bearer token "
                       "except auth/login, auth/register and the public WhatsApp webhook.", BODY))

def api_group(name, items):
    story.append(Paragraph(name, H4))
    story.append(Paragraph("<br/>".join(items), MONO))
    story.append(Spacer(1, 3))

api_group("Auth &amp; profile", [
    "POST /auth/register", "POST /auth/login", "POST /auth/logout", "GET /auth/me",
    "PATCH /auth/profile", "POST /auth/change-password",
    "POST /auth/otp/request", "POST /auth/otp/verify",
    "GET /auth/invite/{token}", "POST /auth/invite/{token}/start"])
api_group("Decision Desk / Inbox", [
    "GET /inbox", "POST /inbox/{item_id}/status",
    "GET /decisions", "GET /decisions/{id}", "GET /decisions/{id}/timeline",
    "POST /decisions/{id}/approve", "POST /decisions/{id}/reject",
    "POST /decisions/{id}/comment", "POST /decisions/{id}/tasks"])
api_group("Captures (review queue) &amp; ingest", [
    "GET /captures", "GET /captures/pending-count", "PATCH /captures/{id}",
    "POST /captures/{id}/approve", "POST /captures/{id}/reject",
    "POST /captures/{id}/clarify", "POST /captures/{id}/reassign", "POST /capture/clarify",
    "GET /ingest", "GET /ingest/{id}", "POST /ingest/document", "POST /ingest/csv",
    "POST /ingest/{id}/commit"])
api_group("Tasks", [
    "GET /tasks", "GET /tasks/{id}", "POST /tasks", "PATCH /tasks/{id}", "DELETE /tasks/{id}",
    "POST /tasks/prioritize", "POST /tasks/{id}/approve", "POST /tasks/{id}/reject",
    "POST /tasks/{id}/reassign", "POST /tasks/{id}/respond", "POST /tasks/{id}/updates",
    "POST /tasks/{id}/attachment", "POST /tasks/{id}/clarify",
    "POST /tasks/{id}/execution-plan/generate", "PATCH|DELETE /tasks/{id}/execution-plan",
    "POST /tasks/{id}/steps/ask"])
api_group("Workflows", [
    "GET /workflows", "POST /workflows", "PATCH /workflows/{id}/advance", "DELETE /workflows/{id}"])
api_group("Finance (ledger &amp; 360)", [
    "GET /ledger/summary", "GET|POST|DELETE /expenses…", "expenses/with-file, assets/with-file, inventory/with-file",
    "POST /expenses/suggest-category", "GET /ledger/ai/{scope}", "POST /ledger/ai/{scope}/refresh",
    "POST /ledger/ask", "GET /invoices", "GET /payments"])
api_group("People, Company Brain, meetings, leave", [
    "GET|POST|PATCH|DELETE /contacts…", "GET /contacts/{id}/profile", "POST /contacts/{id}/rescore",
    "POST /complaints", "PATCH /complaints/{id}/resolve",
    "GET /brain/search", "POST /ask", "GET|POST /memory",
    "GET|POST /meetings", "POST /meetings/text", "POST /transcribe", "POST /voice-notes",
    "GET|POST /leaves…", "POST /leaves/absence", "POST /leaves/{id}/approve|reject|request-info",
    "GET /leaves/{id}/impact"])
api_group("Owner config, team &amp; system", [
    "PATCH /tenant", "PATCH /tenant/settings", "PATCH /tenant/lexicon", "POST /tenant/lexicon/regenerate",
    "PATCH /tenant/operating-model", "POST /tenant/operating-model/regenerate",
    "GET|POST|PATCH|DELETE /tenant/roles…", "PATCH /tenant/leave-approvers",
    "GET /users", "POST /users", "PATCH /users/{id}", "POST /users/{id}/invite", "GET|POST /invites",
    "GET /brief", "GET /brief/details", "POST /brief/send-digest",
    "GET /dashboard", "GET /operating-score", "GET /work-coach", "POST /work-coach/refresh",
    "GET /notifications", "POST /notifications/{id}/read", "POST /notifications/read-all",
    "POST /follow-up/run", "GET|POST /webhooks/whatsapp", "GET /whatsapp/status", "GET /whatsapp/logs"])

# ============================ 10. INTEGRATIONS ============================
story.append(PageBreak())
story.append(Paragraph("10. Integrations, AI models &amp; security", H2))
story.append(Paragraph("AI &amp; integrations", H3))
story.append(bullets([
    "<b>Anthropic Claude</b>, <b>Google Gemini</b>, and <b>OpenAI</b> (transcription + vision) power the AI. The <b>Emergent Universal LLM key</b> is the automatic fallback so AI keeps working even without your own keys.",
    "<b>WhatsApp Cloud API</b> — inbound messages/photos become captures automatically via the webhook.",
    "Company keys (OpenAI / Anthropic / Gemini) can be configured; otherwise the universal key is used.",
]))
story.append(Paragraph("Security &amp; isolation", H3))
story.append(bullets([
    "<b>Passwords</b> hashed with bcrypt; never stored or returned in plain text.",
    "<b>JWT bearer</b> tokens for every authenticated request; passwordless members sign in via mobile OTP.",
    "<b>Tenant isolation</b> — every query is scoped to the caller's tenant_id.",
    "<b>Server-side permission checks</b> — the backend re-validates permissions on every protected route (not just the hidden menu).",
    "<b>Audit trail</b> — an activity log records key actions (who did what, when).",
]))
story.append(Spacer(1, 6))
story.append(HRFlowable(width="100%", thickness=1, color=LINE))
story.append(Spacer(1, 3))
story.append(Paragraph("DecisionOS — one shared operational brain for founder-led teams. Multi-tenant, role-based, "
                       "AI-native. This guide reflects the current product build.", SMALL))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.line(20*mm, 13*mm, 190*mm, 13*mm)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(GREY)
    canvas.drawString(20*mm, 8*mm, "DecisionOS — Complete Product & Architecture Guide")
    canvas.drawRightString(190*mm, 8*mm, "Page %d" % doc.page)
    canvas.restoreState()

doc = SimpleDocTemplate("/app/DecisionOS_User_Guide.pdf", pagesize=A4,
                        leftMargin=20*mm, rightMargin=20*mm, topMargin=16*mm, bottomMargin=18*mm,
                        title="DecisionOS Complete Product & Architecture Guide", author="DecisionOS")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("PDF written to /app/DecisionOS_User_Guide.pdf")
