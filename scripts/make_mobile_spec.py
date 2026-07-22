"""Generate the DecisionOS Mobile App Spec PDF (screenshots + feature notes)."""
import os
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    ListFlowable, ListItem, PageBreak, Image as RLImage, KeepTogether,
)

IMG = "/app/assets/mobile"
RED = colors.HexColor("#E63946"); INK = colors.HexColor("#1E1E24")
PAPER = colors.HexColor("#FAF7F2"); GREY = colors.HexColor("#6D6875"); LINE = colors.HexColor("#E5E1DA")

s = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=s["Heading1"], fontName="Helvetica-Bold", fontSize=25, textColor=INK, leading=29, spaceAfter=4)
SUB = ParagraphStyle("SUB", parent=s["Normal"], fontName="Helvetica", fontSize=10.5, textColor=GREY, leading=15)
H2 = ParagraphStyle("H2", parent=s["Heading2"], fontName="Helvetica-Bold", fontSize=15, textColor=RED, leading=19, spaceBefore=6, spaceAfter=3)
H3 = ParagraphStyle("H3", parent=s["Heading3"], fontName="Helvetica-Bold", fontSize=11.5, textColor=INK, leading=15, spaceBefore=4, spaceAfter=2)
BODY = ParagraphStyle("BODY", parent=s["Normal"], fontName="Helvetica", fontSize=9.6, textColor=INK, leading=14, alignment=TA_LEFT, spaceAfter=3)
BULLET = ParagraphStyle("BULLET", parent=BODY, leftIndent=2, spaceAfter=1)
SMALL = ParagraphStyle("SMALL", parent=s["Normal"], fontName="Helvetica", fontSize=8, textColor=GREY, leading=11)
TAG = ParagraphStyle("TAG", parent=s["Normal"], fontName="Courier", fontSize=8, textColor=GREY, leading=11)

story = []

def bullets(items, style=BULLET):
    return ListFlowable([ListItem(Paragraph(x, style), leftIndent=10, value="•") for x in items],
                        bulletType="bullet", start="•", leftIndent=12, bulletColor=RED, spaceAfter=3)

def scaled(path, max_h_mm):
    """Return an RLImage scaled so height <= max_h_mm, capped by column width."""
    im = Image.open(path); w, h = im.size
    max_w = 74 * mm
    max_h = max_h_mm * mm
    ratio = min(max_w / w, max_h / h)
    return RLImage(path, width=w * ratio, height=h * ratio)

def page_entry(num, fname, title, route, access, purpose, features, tips=None, tall=False):
    """One page per screen: image left (in a light frame), notes right."""
    img_h = 210 if tall else 210
    img = scaled(f"{IMG}/{fname}.png", img_h)
    frame = Table([[img]], colWidths=[img._width + 6])
    frame.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 1.0, INK),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("ALIGN", (0, 0), (-1, -1), "CENTER")]))

    notes = [Paragraph(f"{num}. {title}", H2),
             Paragraph(f"<font face='Courier'>{route}</font>", TAG),
             Paragraph(f"<b>Access:</b> {access}", SMALL),
             Spacer(1, 3),
             Paragraph(purpose, BODY),
             Paragraph("<b>On this screen</b>", H3),
             bullets(features)]
    if tips:
        notes.append(Paragraph("<b>Mobile build notes</b>", H3))
        notes.append(bullets(tips))
    notes_cell = notes

    row = Table([[frame, notes_cell]], colWidths=[img._width + 10, 92 * mm])
    row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (0, 0), 6)]))
    story.append(KeepTogether([row]))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=0.7, color=LINE))
    story.append(Spacer(1, 4))

# ---------- Cover ----------
logo = Table([[Paragraph('<font color="#FFFFFF"><b>D</b></font>', ParagraphStyle("L", fontName="Helvetica-Bold", fontSize=20, alignment=1)),
               Paragraph('<b>Decision<font color="#E63946">OS</font></b>', ParagraphStyle("LG", fontName="Helvetica-Bold", fontSize=22, textColor=INK))]],
              colWidths=[12*mm, 70*mm])
logo.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), RED), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                          ("ALIGN", (0, 0), (0, 0), "CENTER"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
story.append(logo)
story.append(Spacer(1, 12))
story.append(Paragraph("Mobile App Spec &amp; Screen Reference", H1))
story.append(Paragraph("Actual mobile-view screenshots of every page and menu in the web product, with a detailed "
                       "breakdown of the features on each screen. Use this as the source of truth so the mobile "
                       "build matches — same menus, same features, same layout order.", SUB))
story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=1, color=LINE))
story.append(Spacer(1, 6))
story.append(Paragraph("How to use this document", H3))
story.append(bullets([
    "Screenshots are captured at a <b>390 × 844</b> mobile viewport (iPhone-class), full-page, so every feature is visible.",
    "Each screen lists its <b>route</b>, <b>who can access it</b> (permission), its purpose, and every control on it.",
    "The mobile app must include <b>all 9 primary menus</b> plus the global header and bottom tab bar shown here.",
    "Navigation pattern: a <b>hamburger drawer</b> (full menu) + a <b>5-item bottom tab bar</b> (Desk · Brief · Work · People · Brain).",
]))
story.append(Spacer(1, 6))
# Menu checklist so the mobile build doesn't miss any
story.append(Paragraph("Menu checklist (must all exist in the mobile app)", H3))
chk = Table([
    ["1. Decision Desk", "4. People", "7. Capture"],
    ["2. CEO Brief", "5. Company Brain", "8. Meeting Notes"],
    ["3. My Work", "6. Finance", "9. Settings (owner)"],
], colWidths=[56*mm, 56*mm, 56*mm])
chk.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PAPER), ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 9.5), ("TEXTCOLOR", (0, 0), (-1, -1), INK),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
story.append(chk)
story.append(Spacer(1, 5))
story.append(Paragraph("Also required: global header (logo, language globe, light/dark, notifications bell with unread "
                       "badge, hamburger) and bottom tab bar. Owner sees all menus; employees only see menus their "
                       "permissions allow (Settings is owner-only).", SMALL))
story.append(PageBreak())

# ---------- Screens ----------
page_entry("1", "19_mobile_menu", "Navigation — drawer + bottom bar", "hamburger → drawer; bottom tab bar",
    "Owner sees all; employee sees permitted menus only",
    "The primary navigation. Tapping the hamburger opens a left drawer with the full menu; a persistent bottom bar gives 1-tap access to the five core areas.",
    ["Drawer header: company logo, workspace name, signed-in user + role badge (OWNER).",
     "Full menu list: Decision Desk, CEO Brief, My Work, People, Company Brain, Finance, Capture, Meeting Notes, Settings.",
     "Active item highlighted in red. Bottom of drawer: <b>Send Daily Digest</b> and <b>Sign out</b>.",
     "Bottom tab bar (always visible): Desk · Brief · Work · People · Brain."],
    ["Replicate this exact menu order and the 5-item bottom bar. Hide items the user has no permission for.",
     "Settings appears only for the owner."])

page_entry("2", "01_login", "Login", "/login", "Public",
    "Sign-in screen for returning users. New companies sign up (owner) to create a workspace.",
    ["Email + password fields and a submit button.",
     "Supports mobile-OTP (passwordless) members and email/password members.",
     "On success a JWT session is created and the user lands on Decision Desk (or My Work if no inbox access)."],
    ["Mobile app must support both password and OTP login. Store the session token securely."])

page_entry("3", "02_decision_desk", "Decision Desk (Unified Inbox)", "/inbox", "Requires 'inbox'",
    "The single front door: capture decisions by voice/text and triage everything the AI classifies.",
    ["Capture box: voice record (with timer, pause/resume/cancel/finalise) and a type-a-directive field + submit.",
     "Language selector for the capture; 'structuring…' banner while AI works.",
     "Sections: Decision Approvals, Needs Your Attention, and a live Tasks &amp; Activity feed with filters.",
     "Feed rows show type chips (TASK/DECISION/INVOICE/REMINDER…). Mobile: swipe right = view, swipe left = dismiss.",
     "Clarify panel when AI needs more info (submit / skip / cancel)."],
    ["This is the home screen. Prioritise the capture box + feed. Implement swipe gestures on feed rows."], tall=True)

page_entry("4", "03_ceo_brief", "CEO Brief", "/brief", "All users (owner-focused)",
    "A daily AI executive summary of what needs attention.",
    ["Headline of the day + counters (open 'fires').",
     "'Fires to put out today' list — each row deep-links to the exact record.",
     "Shortcuts: Operating Score, Work Coach, Journal (owner-only), and period controls (morning/evening)."],
    ["Deep links must open the specific task/workflow record on tap."])

page_entry("5", "04_my_work", "My Work", "/my-work", "All users",
    "Personal cockpit: your tasks with optional AI prioritisation, plus board/workflows/leave views.",
    ["Scope toggle: My Tasks vs All Tasks. AI Priority toggle (each task shows a priority score with bars).",
     "View toggle: My Work · Board · Workflows · Leave.",
     "Tasks grouped by category; per-task actions: respond, update, attach, mark done, reassign, approve/reject, AI execution plan.",
     "Access-restricted banner if you open an item you can't see."], tall=True)

page_entry("6", "05_my_work_board", "My Work — Board (Kanban)", "/my-work (Board view)", "All users",
    "Kanban view of tasks by status for quick drag-style triage.",
    ["Columns by status with task cards.",
     "Same task actions as the list view.",
     "Switch back to list / workflows / leave via the view toggle."],
    ["On mobile, columns scroll horizontally; keep cards tappable to open details."], tall=True)

page_entry("7", "06_workflows", "Workflows (Pipelines)", "/my-work?view=workflows", "Requires 'workflows'",
    "Track flagship operational pipelines as cards moving through stages (industry-specific).",
    ["Pipeline tabs come from the company Operating Model (e.g. Production, Distribution, Procurement).",
     "Kanban of stages; each card shows counterparty, amount, last update.",
     "Advance a card one stage with a tap; owners can delete cards; 'New' creates a card."],
    ["Pipeline names + stages are dynamic (tenant.operating_model) — do NOT hard-code them."], tall=True)

page_entry("8", "07_leave", "Leave &amp; Absence", "/my-work?view=leave", "All users; approve needs 'leave_approve'",
    "Request time off / report absence; AI computes impact and routes to approvers.",
    ["Tabs: My leaves · Approvals · Approver config.",
     "Request leave: type, from/to dates, half-day portion, reason.",
     "Report absence: reason, note. View AI Impact (tasks/workflows at risk) and 'apply all' reassignment.",
     "Approvers can approve/reject/request info; owner configures approvers."], tall=True)

page_entry("9", "08_people_employees", "People — Employees", "/contacts", "Requires 'people'",
    "CRM-lite for team, customers and vendors. Employees tab manages the team.",
    ["Tabs: Employees · Customers · Vendors (labels adapt to industry).",
     "Employees (needs team_manage): add user, set role, permissions, reporting manager; invite links (copy / WhatsApp share); login method toggle (password / OTP).",
     "Permission list + live menu preview so you see what a member will access."], tall=True)

page_entry("10", "09_people_customers", "People — Customers / Vendors", "/contacts (Customers tab)", "Requires 'people'",
    "Manage customer/dealer and vendor/supplier records.",
    ["Add contact; search; filter by status and type.",
     "Contact form: name, company, email, phone, birthday, status, assigned owner, type.",
     "Log a complaint against a contact. Tap a contact to open its profile (relationship score, signals, re-score)."], tall=True)

page_entry("11", "10_brain_ask", "Company Brain — Ask", "/brain", "Requires 'brain' (Ask uses 'ask')",
    "Ask questions in plain language; AI answers grounded in your data with citations.",
    ["Ask / Search tab switch with helper text (Ask = answer, Search = records).",
     "Suggestion chips, a text box, voice dictation (mic), and Send.",
     "Answers show source citations."])

page_entry("12", "11_brain_search", "Company Brain — Search", "/brain (Search tab)", "Requires 'brain'",
    "Find the exact records behind any decision.",
    ["Search box with voice dictation.",
     "Results grouped by Decisions, Tasks, Workflows, Contacts, and Company Memory with counts.",
     "Trace a decision to the tasks/workflows it created."])

page_entry("13", "12_finance_overview", "Finance — Overview", "/ledger", "Requires 'ledger'/'finance'",
    "All money in one place with an AI finance analyst.",
    ["KPIs: Total Spend, Outstanding, Asset Value, Inventory Value.",
     "Tabs: Overview · Expenses · Assets · Inventory.",
     "AI Finance Brief: headline + action items (Urgent/Important/FYI); create task or Ask AI from an insight; Refresh.",
     "Charts: Monthly Spend, By Category, Top Vendors. Ask-AI box for finance questions."], tall=True)

page_entry("14", "13_finance_expenses", "Finance — Expenses / Assets / Inventory", "/ledger (Expenses tab)", "Requires 'ledger'/'finance'",
    "Ledger tables; add records manually or by attaching a bill AI reads.",
    ["Add dialogs: Expense (bill attach, title, amount, paid/unpaid, vendor, AI suggest category, date, notes); Asset (name, amount, category, vendor, date, status); Inventory (item, SKU, qty, unit, unit cost).",
     "Tables list records with source chips, attachments, delete.",
     "Approved purchase bills &amp; payments auto-flow in from WhatsApp/uploads."], tall=True)

page_entry("15", "14_capture_import", "Capture — Import", "/ingest", "Requires 'data_input'",
    "Feed the AI pipeline: uploads, CSV import, and WhatsApp intake.",
    ["Main tabs: Import · Review.",
     "Upload document (image/PDF) and Import CSV drop-zones + pickers; direction banner + own-company warning.",
     "WhatsApp card: connection status, QR link, token-error hint, logs list + refresh."], tall=True)

page_entry("16", "15_capture_review", "Capture — Review", "/ingest (Review tab)", "Requires 'data_input'",
    "Review what AI extracted before committing to records.",
    ["Badge shows pending count.",
     "Sub-tabs: Invoices, Payments, Contacts, Tasks; records tables for invoices/payments.",
     "Approve/commit to turn drafts into real records."])

page_entry("17", "16_meetings", "Meeting Notes", "/meetings", "All users",
    "Turn meetings into minutes and actions.",
    ["Record by voice (recorder UI) or toggle paste/type to submit a transcript.",
     "AI writes Key Points and extracts decisions/tasks (searchable later in Company Brain).",
     "Meetings list of past sessions."])

page_entry("18", "17_settings", "Settings (Owner only)", "/settings", "Owner only",
    "Configure how the whole company operates.",
    ["Company Details (name, industry, description, currency, region, GST, branches).",
     "Business Vocabulary (labels; AI regenerate). Operating Model (edit pipelines/stages, owner sign-off stage, task categories; regenerate).",
     "Team Roles; Products &amp; Services; Approval rules.",
     "Language (per-user); Your Profile; Password &amp; Security (change password); Money &amp; Approvals (currency, high-value threshold, owner sign-off toggle)."], tall=True)

page_entry("19", "18_notifications", "Notifications", "/notifications", "All users",
    "Follow-ups, escalations and mentions from the follow-up engine.",
    ["Full list of notifications; unread badge in the header bell.",
     "'Mark all read'. Tapping a notification opens the related item.",
     "The bell dropdown shows the latest few from any screen."], tall=True)

# ---------- Closing parity checklist ----------
story.append(PageBreak())
story.append(Paragraph("Parity checklist for the mobile build", H2))
story.append(Paragraph("Use this to catch anything missing or styled differently in the Emergent mobile app.", BODY))
story.append(Paragraph("Navigation &amp; shell", H3))
story.append(bullets([
    "Hamburger drawer with the full 9-item menu in the same order.",
    "Bottom tab bar: Desk · Brief · Work · People · Brain.",
    "Header: logo, language globe (EN/HI/TA), light/dark toggle, notifications bell with unread badge.",
    "Role-based hiding: employees only see permitted menus; Settings owner-only.",
]))
story.append(Paragraph("Per-screen features that are often missed", H3))
story.append(bullets([
    "Decision Desk: voice capture (timer/pause/resume/finalise), swipe-to-view/dismiss, Clarify panel, Needs-Attention + Approvals sections.",
    "My Work: AI Priority scoring, all 4 views (list/board/workflows/leave), execution-plan generation.",
    "Workflows: dynamic pipelines/stages from the Operating Model (not hard-coded).",
    "Finance: AI Finance Brief with create-task/ask-AI, bill-reading uploads, all 4 tabs.",
    "Capture: both Import and Review tabs + WhatsApp intake.",
    "People: Employees management (roles, permissions, invites, OTP) + complaints + contact profile re-score.",
    "Company Brain: Ask (with citations) AND Search (grouped records), both with voice.",
    "Settings: full owner config incl. Operating Model editor, Vocabulary, Money &amp; Approvals, Password &amp; Security.",
    "Multi-language (EN/HI/TA) applied per user; industry-specific labels via lexicon.",
]))
story.append(Spacer(1, 6))
story.append(HRFlowable(width="100%", thickness=1, color=LINE))
story.append(Spacer(1, 3))
story.append(Paragraph("Screens captured from the live web app at 390×844. The mobile app should mirror these menus, "
                       "features and layout order (visual styling can follow native platform conventions).", SMALL))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.line(15*mm, 12*mm, 195*mm, 12*mm)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(GREY)
    canvas.drawString(15*mm, 7*mm, "DecisionOS — Mobile App Spec & Screen Reference")
    canvas.drawRightString(195*mm, 7*mm, "Page %d" % doc.page)
    canvas.restoreState()

doc = SimpleDocTemplate("/app/DecisionOS_Mobile_Spec.pdf", pagesize=A4,
                        leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=16*mm,
                        title="DecisionOS Mobile App Spec", author="DecisionOS")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("PDF written")
