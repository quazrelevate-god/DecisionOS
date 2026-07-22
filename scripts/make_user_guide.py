"""Generate the DecisionOS User Guide PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, ListFlowable, ListItem
)

RED = colors.HexColor("#E63946")
INK = colors.HexColor("#1E1E24")
PAPER = colors.HexColor("#FAF7F2")
GREY = colors.HexColor("#6D6875")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                    fontSize=26, textColor=INK, leading=30, spaceAfter=4)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], fontName="Helvetica",
                     fontSize=11, textColor=GREY, leading=15, spaceAfter=2)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                    fontSize=15, textColor=RED, leading=19, spaceBefore=14, spaceAfter=4)
H3 = ParagraphStyle("H3", parent=styles["Heading3"], fontName="Helvetica-Bold",
                    fontSize=11.5, textColor=INK, leading=15, spaceBefore=6, spaceAfter=2)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontName="Helvetica",
                      fontSize=10, textColor=INK, leading=15, alignment=TA_LEFT, spaceAfter=3)
SMALL = ParagraphStyle("SMALL", parent=styles["Normal"], fontName="Helvetica",
                       fontSize=8.5, textColor=GREY, leading=12)
BULLET = ParagraphStyle("BULLET", parent=BODY, leftIndent=6, spaceAfter=1)

story = []

def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(x, BULLET), leftIndent=10, value="•") for x in items],
        bulletType="bullet", start="•", leftIndent=12, bulletColor=RED, spaceAfter=4,
    )

def rule():
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E5E1DA")))
    story.append(Spacer(1, 4))

# ---------------- Cover ----------------
story.append(Spacer(1, 8))
logo = Table([[Paragraph('<font color="#FFFFFF"><b>D</b></font>', ParagraphStyle("L", fontName="Helvetica-Bold", fontSize=20, alignment=1)),
               Paragraph('<b>Decision<font color="#E63946">OS</font></b>', ParagraphStyle("LG", fontName="Helvetica-Bold", fontSize=22, textColor=INK))]],
              colWidths=[12*mm, 60*mm])
logo.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, 0), RED),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (0, 0), (0, 0), "CENTER"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(logo)
story.append(Spacer(1, 14))
story.append(Paragraph("Product Guide", H1))
story.append(Paragraph("Every menu, every feature, and how it works — for founders and their teams.", SUB))
rule()
story.append(Paragraph(
    "DecisionOS is an AI operating system for founder-led businesses. It captures spoken or typed "
    "decisions, turns them into structured tasks, and gives your whole team one shared operational "
    "brain. This guide walks through each item in the left-hand menu and explains what it does, who "
    "can see it, and how to use it day to day.", BODY))
story.append(Spacer(1, 6))

# Access model box
acc = Table([[Paragraph("<b>How access works</b>", H3)],
             [Paragraph("DecisionOS uses <b>role-based access</b>. The Owner sees everything. Each employee "
                        "only sees the menus they have permission for (e.g. a Finance role sees Finance, a "
                        "Sales role may not). Menu items automatically hide when you don't have access, so "
                        "your team only ever sees what's relevant to them.", BODY)]],
            colWidths=[170*mm])
acc.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PAPER),
    ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#E5E1DA")),
    ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story.append(acc)

# ---------------- Menu quick map ----------------
story.append(Paragraph("Menu at a glance", H2))
data = [["Menu", "What it's for", "Who sees it"]]
rows = [
    ["Decision Desk", "Unified inbox — capture & triage everything", "Anyone with Inbox access"],
    ["CEO Brief", "Daily AI summary of what needs attention", "All users (owner-focused)"],
    ["My Work", "Your tasks, board, workflows & leave", "All users"],
    ["People", "Team, customers & vendors (CRM-lite)", "People access"],
    ["Company Brain", "Ask AI & search everything the company knows", "Brain access"],
    ["Finance", "Expenses, assets, inventory & AI finance brief", "Finance/Ledger access"],
    ["Capture", "Upload files, invoices, notes for AI processing", "Data-input access"],
    ["Meeting Notes", "Record/transcribe meetings into actions", "All users"],
    ["Settings", "Company rules, vocabulary, language, security", "Owner only"],
]
data += rows
tbl = Table(data, colWidths=[32*mm, 92*mm, 46*mm])
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), INK),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
    ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
    ("TEXTCOLOR", (0, 1), (0, -1), RED),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E1DA")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(tbl)

# ---------------- Detailed sections ----------------
def section(title, purpose, how, tips=None):
    story.append(Paragraph(title, H2))
    story.append(Paragraph("<b>What it does.</b> " + purpose, BODY))
    story.append(Paragraph("<b>How it works</b>", H3))
    story.append(bullets(how))
    if tips:
        story.append(Paragraph("<b>Tips</b>", H3))
        story.append(bullets(tips))
    rule()

section(
    "1. Decision Desk (Unified Inbox)",
    "Your single front door for everything coming into the business — spoken decisions, typed "
    "directives, uploads, invoices, payments and complaints. AI reads each item, classifies it, and "
    "routes it to the right department review queue.",
    [
        "<b>Tap to speak</b> a decision, or type a directive in the box. AI structures it into a clean summary with tasks.",
        "<b>Decision Approvals</b>: review AI-extracted decisions, then Approve, Reject, or Discuss who raised it.",
        "<b>Needs Your Attention</b>: items the AI flagged for you specifically.",
        "<b>Tasks &amp; Activity</b>: a live feed of everything happening — filter by type.",
        "On mobile, <b>swipe right</b> on a feed row to view it, <b>swipe left</b> to dismiss.",
        "Reassign an auto-assigned task to another member or a whole team/role right from the desk.",
    ],
    ["'Inbox zero' means you're fully caught up — captured items appear here automatically, already classified."],
)

section(
    "2. CEO Brief",
    "A daily, AI-generated executive summary that tells the founder what actually needs attention — "
    "fires to put out, decisions pending, workflows stuck, and money that needs a decision.",
    [
        "Opens with a plain-language headline of the day's priorities.",
        "Counters show open 'fires' and items needing action.",
        "Every line is a <b>deep link</b> — click a task or workflow to jump straight to that exact record.",
        "Use <b>Send Daily Digest</b> (top-right) to email the brief to yourself or the team.",
    ],
    ["Check this first thing each morning — it replaces scrolling through everything manually."],
)

section(
    "3. My Work",
    "Your personal operational cockpit. Everything assigned to you, plus team views, live workflows "
    "and leave — all in one place.",
    [
        "<b>My Work / All Tasks</b>: switch between just your tasks and the whole team's.",
        "<b>AI Priority</b>: let AI score and order tasks by what matters most right now.",
        "<b>Board</b>: a kanban view of tasks by status.",
        "<b>Workflows</b>: track flagship operational pipelines (e.g. Sales Orders, Procurement) as cards moving through stages; advance a card with one click.",
        "<b>Leave</b>: request time off; AI routes the impact of your absence to the right people.",
    ],
    ["Tasks created from decisions, finance insights or meetings all land here automatically."],
)

section(
    "4. People",
    "A lightweight CRM for everyone your business deals with — your team, your customers and your "
    "vendors. (Labels adapt to your industry, e.g. 'Dealers' or 'Suppliers'.)",
    [
        "<b>Employees</b> tab (managers/owners): add team members, set their role and module permissions, and assign a reporting manager.",
        "<b>Customers</b> tab: add and manage customer/dealer records.",
        "<b>Vendors</b> tab: manage suppliers/vendors.",
        "Click any contact to open a full profile with linked history.",
        "New members can be invited with email + password, or set as mobile-OTP (passwordless) users.",
    ],
    ["Promote a trusted partner to co-owner from the Employees tab — at least one owner must always remain."],
)

section(
    "5. Company Brain",
    "The shared memory of your business. Ask questions in plain language, or search for the exact "
    "records behind any decision.",
    [
        "<b>Ask</b>: get an AI answer grounded only in your company's real data, with source citations.",
        "<b>Search</b>: find exact records — decisions, tasks, workflows, contacts and company memory — that match your words.",
        "Both Ask and Search support <b>voice dictation</b> — tap the mic and speak.",
        "Rule of thumb: <b>Ask</b> = get an answer; <b>Search</b> = find the records.",
    ],
    ["Trace any founder decision all the way to the tasks and workflows it created."],
)

section(
    "6. Finance",
    "All your money in one place, with an AI finance analyst on top. Track spend, assets and inventory, "
    "and get proactive alerts.",
    [
        "<b>Overview</b>: KPIs (total spend, outstanding, asset value, inventory value), monthly spend chart, category breakdown and top vendors.",
        "<b>AI Finance Brief</b>: a headline plus prioritised action items (urgent / important / FYI). Turn any insight into a task, or Ask AI about it.",
        "<b>Expenses / Assets / Inventory</b> tabs: add records manually, or attach a bill/invoice photo or PDF and AI reads it and fills the details.",
        "Ask AI questions about your finances (e.g. 'Which vendor did I spend most on?').",
        "Approved purchase bills and outgoing payments auto-flow in from WhatsApp/uploads.",
    ],
    ["Set your high-value threshold and owner sign-off rules in Settings → Money &amp; Approvals."],
)

section(
    "7. Capture",
    "The intake tool for feeding the AI. Drop in files, invoices, screenshots or notes and let the "
    "pipeline classify and route them.",
    [
        "Upload documents, images, invoices or payment screenshots.",
        "AI extracts the key data and creates a draft in the right department's review queue.",
        "Money items route to Finance; operational items route to the relevant team.",
        "A badge in the sidebar shows how many captured items are pending review.",
    ],
    ["WhatsApp messages sent to your workspace number also flow in here automatically."],
)

section(
    "8. Meeting Notes",
    "Turn meetings into structured outcomes. Record or dictate, and DecisionOS transcribes and pulls "
    "out decisions and action items.",
    [
        "Capture a meeting by voice; AI transcribes it.",
        "Decisions and tasks are extracted and can be pushed into My Work and the Company Brain.",
        "Everything stays searchable later from Company Brain.",
    ],
)

section(
    "9. Settings (Owner only)",
    "Where the owner configures how the whole company operates — rules, terminology, language and "
    "account security.",
    [
        "<b>Company Details</b>: name, industry and business description (sharpens AI accuracy).",
        "<b>Business Vocabulary</b>: the words your industry actually uses (customer vs. dealer, etc.).",
        "<b>Operating Model</b>: your AI-generated workflow pipelines and task categories — editable.",
        "<b>Language</b>: pick your interface language (English, हिन्दी, தமிழ்). This applies to you only.",
        "<b>Your Profile</b>: name, mobile number and sign-in details.",
        "<b>Password &amp; Security</b>: change your account password.",
        "<b>Money &amp; Approvals</b>: default currency, high-value threshold and owner sign-off rules.",
    ],
    ["The interface language is per-user — each teammate can choose their own without affecting others."],
)

# ---------------- Header tools ----------------
story.append(Paragraph("Top bar & shared tools", H2))
story.append(bullets([
    "<b>Send Daily Digest</b>: email the current brief to yourself or the team.",
    "<b>Language switcher</b> (globe icon): change your interface language on the fly.",
    "<b>Light / Dark theme</b> toggle.",
    "<b>Notifications</b> (bell): see follow-ups, escalations and mentions; click one to jump to the item.",
    "<b>Profile / Sign out</b>: manage your account or log out.",
    "<b>Voice everywhere</b>: mic buttons let you dictate instead of typing in most input areas.",
]))

story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E5E1DA")))
story.append(Spacer(1, 4))
story.append(Paragraph("DecisionOS — one shared operational brain for founder-led teams. "
                       "Multi-tenant, role-based, AI-native. This guide reflects the current product.", SMALL))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#E5E1DA"))
    canvas.line(20*mm, 14*mm, 190*mm, 14*mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY)
    canvas.drawString(20*mm, 9*mm, "DecisionOS — Product Guide")
    canvas.drawRightString(190*mm, 9*mm, "Page %d" % doc.page)
    canvas.restoreState()


doc = SimpleDocTemplate(
    "/app/DecisionOS_User_Guide.pdf", pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=20*mm,
    title="DecisionOS User Guide", author="DecisionOS",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("PDF written to /app/DecisionOS_User_Guide.pdf")
