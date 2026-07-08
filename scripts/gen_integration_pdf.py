"""Generate the DecisionOS Integration Setup Guide PDF (brutalist brand styling)."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, ListFlowable, ListItem,
)

OUT = "/app/backend/uploads/DecisionOS_Integration_Setup_Guide.pdf"
BASE_URL = "https://founder-os-58.preview.emergentagent.com"

RED = colors.HexColor("#E01E2B")
INK = colors.HexColor("#111111")
BLUE = colors.HexColor("#1D4ED8")
YELLOW = colors.HexColor("#F5C518")
GREY = colors.HexColor("#666666")
LIGHT = colors.HexColor("#F2F2F2")
GREEN = colors.HexColor("#16A34A")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=26,
                    textColor=INK, spaceAfter=2, leading=28)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], fontName="Helvetica", fontSize=10,
                     textColor=GREY, spaceAfter=10)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14,
                    textColor=INK, spaceBefore=14, spaceAfter=6, leading=17)
H3 = ParagraphStyle("H3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=11,
                    textColor=RED, spaceBefore=8, spaceAfter=3)
BODY = ParagraphStyle("BODY", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
                      textColor=INK, leading=14, spaceAfter=4)
SMALL = ParagraphStyle("SMALL", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5,
                       textColor=GREY, leading=12)
MONO = ParagraphStyle("MONO", parent=styles["Normal"], fontName="Courier-Bold", fontSize=8.5,
                      textColor=BLUE, leading=12)
LI = ParagraphStyle("LI", parent=BODY, leftIndent=2, spaceAfter=2)

story = []


def rule(color=INK, w=1.4, sp_before=2, sp_after=8):
    story.append(Spacer(1, sp_before))
    story.append(HRFlowable(width="100%", thickness=w, color=color, spaceAfter=sp_after))


def bullets(items, style=LI):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, style), leftIndent=12, value="\u203a") for t in items],
        bulletType="bullet", bulletColor=RED, bulletFontName="Helvetica-Bold", bulletFontSize=9,
    ))


def steps(items):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, LI), leftIndent=14) for t in items],
        bulletType="1", bulletFormat="%s.", bulletFontName="Helvetica-Bold", bulletColor=INK,
    ))


def send_line(txt):
    tbl = Table([[Paragraph(f"<b>Send to agent:</b> {txt}", SMALL)]], colWidths=[165 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.6, INK),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(Spacer(1, 4))
    story.append(tbl)
    story.append(Spacer(1, 6))


# ---- Header ----
logo = Table([[Paragraph('<font color="white"><b>D</b></font>', ParagraphStyle("L", fontName="Helvetica-Bold", fontSize=20, alignment=1)),
               Paragraph('<b>DecisionOS</b>', ParagraphStyle("N", fontName="Helvetica-Bold", fontSize=20, textColor=INK))]],
              colWidths=[11 * mm, 120 * mm])
logo.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, 0), RED),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (0, 0), 3), ("BOTTOMPADDING", (0, 0), (0, 0), 3),
    ("LEFTPADDING", (1, 0), (1, 0), 8),
]))
story.append(logo)
story.append(Spacer(1, 8))
story.append(Paragraph("Integration Setup Guide", H1))
story.append(Paragraph("How to get each API key and where it plugs in. Send the agent your values and it will wire &amp; test them.", SUB))
rule(RED, 2)

# ---- What's already live ----
story.append(Paragraph("What is already live (no keys needed)", H2))
story.append(Paragraph("Your AI operating brain runs entirely on the built-in <b>Emergent LLM key</b> — no setup required from you:", BODY))
bullets([
    "<b>Unified Inbox</b> — voice/text capture, PDF invoice OCR, CSV/Excel import (Gemini + Claude).",
    "<b>Decision Timeline &amp; CEO Journal</b> — git-style history per decision + a day-by-day diary.",
    "<b>AI Prioritization</b> — tasks scored on Impact / Revenue / Risk / Urgency and ranked automatically.",
    "<b>Relationship Intelligence</b> — AI relationship &amp; risk scores on every 360&deg; customer/supplier profile.",
    "<b>Business Calendar</b> — payments due, deadlines, deliveries, complaints and birthdays in one agenda.",
    "<b>Meeting Notes</b> — record or paste a meeting; AI writes the minutes and creates assigned action items (Whisper + Claude).",
    "<b>Operating Score</b> — company &amp; per-employee health scores (Execution / Finance / Sales / Responsiveness).",
])
story.append(Spacer(1, 2))
tip = Table([[Paragraph('<b>Tip:</b> Keep balance on your Emergent Universal Key (Profile &rarr; Universal Key &rarr; Add Balance, or enable auto top-up) so AI features keep running in production.', SMALL)]], colWidths=[165 * mm])
tip.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF7D6")), ("BOX", (0, 0), (-1, -1), 0.6, YELLOW),
                         ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                         ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
story.append(tip)
rule()

# ---- Status table ----
story.append(Paragraph("Optional integrations — status", H2))
data = [
    [Paragraph("<b>Integration</b>", SMALL), Paragraph("<b>Unlocks</b>", SMALL), Paragraph("<b>Status</b>", SMALL)],
    [Paragraph("Meta WhatsApp", SMALL), Paragraph("Forward invoices/POs to WhatsApp &rarr; auto-filed", SMALL), Paragraph('<font color="#B8860B"><b>Needs keys</b></font>', SMALL)],
    [Paragraph("Twilio", SMALL), Paragraph("Real SMS employee invites", SMALL), Paragraph('<font color="#B8860B"><b>Needs keys</b></font>', SMALL)],
    [Paragraph("Zoho Books", SMALL), Paragraph("Sync customers, invoices, payments, bills", SMALL), Paragraph('<font color="#B8860B"><b>Needs keys</b></font>', SMALL)],
    [Paragraph("Resend", SMALL), Paragraph("Real daily CEO digest emails", SMALL), Paragraph('<font color="#B8860B"><b>Needs keys</b></font>', SMALL)],
    [Paragraph("Tally", SMALL), Paragraph("Read-only accounting sync (local bridge)", SMALL), Paragraph('<font color="#666666"><b>P2 / later</b></font>', SMALL)],
]
t = Table(data, colWidths=[32 * mm, 98 * mm, 30 * mm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
    ("BOX", (0, 0), (-1, -1), 1, INK),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
]))
story.append(t)
story.append(Spacer(1, 6))
story.append(Paragraph(f"<b>Base URL used below (preview):</b>", BODY))
story.append(Paragraph(BASE_URL, MONO))
story.append(Paragraph("Your production URL changes after deployment (…emergent.host) — the agent updates webhooks/redirect URIs then.", SMALL))
rule(RED, 2)

# ---- 1. WhatsApp ----
story.append(Paragraph("1 &nbsp;&middot;&nbsp; WhatsApp Document Ingestion — Meta", H2))
story.append(Paragraph("<b>Enables:</b> employees forward an invoice / PO / payment screenshot to your WhatsApp number and DecisionOS reads &amp; files it automatically.", BODY))
story.append(Paragraph("Values to collect: WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET", MONO))
story.append(Paragraph("Steps", H3))
steps([
    "Go to <b>developers.facebook.com</b> and log in.",
    "Top-right &rarr; <b>My Apps</b> &rarr; <b>Create App</b>.",
    "Use case: <b>Other</b> &rarr; Next. App type: <b>Business</b> &rarr; Next.",
    'Enter an App name (e.g. "DecisionOS") + email &rarr; <b>Create App</b>.',
    "On the dashboard find <b>WhatsApp</b> &rarr; <b>Set up</b>.",
    "Sidebar &rarr; <b>WhatsApp &rarr; API Setup</b>: copy the <b>Temporary access token</b> (WA_ACCESS_TOKEN) and <b>Phone number ID</b> (WA_PHONE_NUMBER_ID).",
    "Invent your own verify token, e.g. <font face='Courier'>decisionos_verify_9f3k</font> &rarr; WA_VERIFY_TOKEN.",
    "Sidebar &rarr; <b>App settings &rarr; Basic</b> &rarr; Show <b>App secret</b> &rarr; WA_APP_SECRET.",
    "(Production) Permanent token: Business Settings &rarr; System users &rarr; Generate token with <font face='Courier'>whatsapp_business_messaging</font> + <font face='Courier'>whatsapp_business_management</font>.",
])
story.append(Paragraph("Connect the webhook (after the agent adds your keys)", H3))
steps([
    "Sidebar &rarr; <b>WhatsApp &rarr; Configuration &rarr; Webhook</b> &rarr; Edit.",
    f"Callback URL: <font face='Courier' color='#1D4ED8'>{BASE_URL}/api/webhooks/whatsapp</font>",
    "Verify token: the same WA_VERIFY_TOKEN &rarr; <b>Verify and save</b>.",
    "Webhook fields &rarr; <b>Manage</b> &rarr; Subscribe to <b>messages</b>.",
    "Test: send an invoice image to the test number from your phone.",
])
send_line("WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET, and which workspace should receive documents.")
rule()

# ---- 2. Twilio ----
story.append(Paragraph("2 &nbsp;&middot;&nbsp; SMS Employee Invites — Twilio", H2))
story.append(Paragraph("<b>Enables:</b> real SMS invitations to mobile numbers you add during onboarding / in Team.", BODY))
story.append(Paragraph("Values to collect: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER", MONO))
story.append(Paragraph("Steps", H3))
steps([
    "Sign up at <b>twilio.com/try-twilio</b> (free trial credit).",
    "Verify your email and phone number.",
    "Open the <b>Twilio Console</b> (console.twilio.com).",
    "Account Info: copy <b>Account SID</b> (TWILIO_ACCOUNT_SID) and reveal + copy <b>Auth Token</b> (TWILIO_AUTH_TOKEN).",
    "Phone Numbers &rarr; Manage &rarr; <b>Buy a number</b> with SMS capability. Copy in E.164 form e.g. <font face='Courier'>+14155551234</font> &rarr; TWILIO_FROM_NUMBER.",
    "(Trial) You can only text numbers verified under <b>Verified Caller IDs</b> until you upgrade.",
    "(Optional, better at scale) Create a <b>Messaging Service</b> and use its SID instead of a from-number.",
])
send_line("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.")
rule()

# ---- 3. Zoho ----
story.append(Paragraph("3 &nbsp;&middot;&nbsp; Zoho Books Connector — Zoho", H2))
story.append(Paragraph("<b>Enables:</b> pull customers, invoices, payments and bills from Zoho Books into DecisionOS.", BODY))
story.append(Paragraph("Values to collect: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, Organization ID", MONO))
story.append(Paragraph("Steps", H3))
steps([
    "Log in at <b>api-console.zoho.com</b>.",
    "<b>Add Client</b> &rarr; choose <b>Server-based Applications</b>.",
    "Client Name: DecisionOS.",
    f"Homepage URL: <font face='Courier'>{BASE_URL}</font>",
    f"Authorized Redirect URI: <font face='Courier' color='#1D4ED8'>{BASE_URL}/api/zoho/callback</font>",
    "<b>Create</b> &rarr; copy <b>Client ID</b> (ZOHO_CLIENT_ID) and <b>Client Secret</b> (ZOHO_CLIENT_SECRET).",
    "Find your <b>Organization ID</b>: Zoho Books &rarr; Settings &rarr; Organization &rarr; Profile.",
    "Note your data center domain (.com / .in / .eu) and tell the agent.",
])
send_line("ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, Organization ID, and Zoho domain. The agent guides the one-time OAuth consent to mint the refresh token.")
rule()

# ---- 4. Resend ----
story.append(Paragraph("4 &nbsp;&middot;&nbsp; Email Daily Digest — Resend", H2))
story.append(Paragraph("<b>Enables:</b> real daily CEO digest emails (currently logged/mocked).", BODY))
story.append(Paragraph("Values to collect: RESEND_API_KEY, RESEND_FROM_EMAIL (verified sender)", MONO))
story.append(Paragraph("Steps", H3))
steps([
    "Sign up at <b>resend.com</b>.",
    "<b>API Keys</b> &rarr; <b>Create API Key</b> &rarr; Full access &rarr; copy &rarr; RESEND_API_KEY (shown once).",
    "<b>Domains</b> &rarr; <b>Add Domain</b> &rarr; add the shown DNS records at your registrar &rarr; <b>Verify</b>.",
    "(No domain? Test-send from <font face='Courier'>onboarding@resend.dev</font>; production needs a verified domain.)",
    "Pick your from address e.g. <font face='Courier'>digest@yourcompany.com</font> &rarr; RESEND_FROM_EMAIL.",
])
send_line("RESEND_API_KEY and your verified from-email.")
rule()

# ---- 5. Tally ----
story.append(Paragraph("5 &nbsp;&middot;&nbsp; Tally Connector (P2 — no API key)", H2))
story.append(Paragraph("Tally has no cloud API. Integration needs a small local agent/bridge on the same machine/network as Tally (ODBC/XML on port 9000). No signup — tell the agent when you're ready and we'll plan the bridge.", BODY))
rule(RED, 2)

# ---- Where keys live + checklist ----
story.append(Paragraph("Where these values live", H2))
story.append(Paragraph("All keys go into <font face='Courier'>/app/backend/.env</font> — the agent adds them; never commit real secrets. Missing keys simply keep that integration dormant; the rest of the app runs normally.", BODY))
story.append(Paragraph("Quick checklist", H2))
bullets([
    "<b>Meta:</b> WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET",
    "<b>Twilio:</b> TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER",
    "<b>Zoho:</b> ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, Organization ID, domain",
    "<b>Resend:</b> RESEND_API_KEY, verified from-email",
])
story.append(Spacer(1, 10))
story.append(HRFlowable(width="100%", thickness=1, color=GREY))
story.append(Paragraph("DecisionOS — the operating brain for founder-led SMEs.", SMALL))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 12 * mm, "DecisionOS · Integration Setup Guide")
    canvas.drawRightString(190 * mm, 12 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(RED)
    canvas.setLineWidth(2)
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                        topMargin=16 * mm, bottomMargin=20 * mm,
                        title="DecisionOS — Integration Setup Guide", author="DecisionOS")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT)
