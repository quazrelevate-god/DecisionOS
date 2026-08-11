/* DecisionOS AI Onboarding Evaluation — APM
 * 8-slide corporate deck. Screenshots are read from ./deck_assets/<name>.png.
 * Missing assets render as labeled placeholder frames so the layout is always
 * complete; drop the real screenshots in and re-run to finalize.
 */
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const ASSETS = path.join(__dirname, "deck_assets");

// ---- palette (Midnight Executive, blue & white) --------------------------
const DEEP = "0B1437"; // darkest navy — title/close backgrounds
const NAVY = "1E2761"; // primary navy
const ACCENT = "2E6BE6"; // bright blue — icons, highlights
const ICE = "CADCFC"; // ice blue
const TINT = "EEF3FF"; // light card fill
const TINT2 = "E3ECFF"; // slightly deeper card fill
const WHITE = "FFFFFF";
const INK = "1A2340"; // body text on light
const MUTE = "6A7592"; // muted captions
const GOLD = "F5B301"; // stars
const LINE = "D9E2F5"; // hairlines / card borders

const HEAD = "Calibri";
const BODY = "Calibri";

const pptx = new pptxgen();
pptx.defineLayout({ name: "W", width: 13.33, height: 7.5 });
pptx.layout = "W";
const W = 13.33, H = 7.5;

// ---- helpers -------------------------------------------------------------
function shadow(opts = {}) {
  return Object.assign({ type: "outer", color: "9FB0D0", blur: 9, offset: 3, angle: 90, opacity: 0.45 }, opts);
}

function assetPath(name) {
  for (const ext of [".png", ".jpg", ".jpeg", ".PNG", ".JPG"]) {
    const p = path.join(ASSETS, name + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Image inside a framed card; falls back to a labeled placeholder.
function framedImage(slide, name, label, box) {
  const { x, y, w, h } = box;
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.1,
    fill: { color: WHITE }, line: { color: LINE, width: 1 }, shadow: shadow(),
  });
  const p = assetPath(name);
  const pad = 0.12;
  if (p) {
    slide.addImage({
      path: p, x: x + pad, y: y + pad, w: w - 2 * pad, h: h - 2 * pad,
      sizing: { type: "contain", w: w - 2 * pad, h: h - 2 * pad },
    });
  } else {
    slide.addShape("roundRect", {
      x: x + pad, y: y + pad, w: w - 2 * pad, h: h - 2 * pad, rectRadius: 0.08,
      fill: { color: TINT }, line: { color: ACCENT, width: 1, dashType: "dash" },
    });
    slide.addText([
      { text: "▣\n", options: { fontSize: 26, color: ACCENT } },
      { text: "SCREENSHOT\n", options: { fontSize: 12, color: NAVY, bold: true } },
      { text: label, options: { fontSize: 10, color: MUTE } },
    ], { x: x + pad, y: y, w: w - 2 * pad, h, align: "center", valign: "middle", fontFace: BODY, lineSpacingMultiple: 1.05 });
  }
}

// section title used on light content slides (no accent underline — whitespace only)
function slideTitle(slide, kicker, title) {
  slide.addText(kicker.toUpperCase(), {
    x: 0.7, y: 0.42, w: 11, h: 0.32, fontFace: BODY, fontSize: 12.5, bold: true,
    color: ACCENT, charSpacing: 2, margin: 0,
  });
  slide.addText(title, {
    x: 0.66, y: 0.72, w: 12, h: 0.8, fontFace: HEAD, fontSize: 32, bold: true,
    color: NAVY, margin: 0,
  });
}

// small filled circle with a white glyph
function glyphCircle(slide, x, y, d, glyph, fill = ACCENT, gsize = 14) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: fill } });
  slide.addText(glyph, { x, y, w: d, h: d, align: "center", valign: "middle", color: WHITE, bold: true, fontFace: BODY, fontSize: gsize, margin: 0 });
}

// process pill
function pill(slide, x, y, w, h, text, fill, txtColor) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: h / 2, fill: { color: fill }, line: { color: LINE, width: 1 } });
  slide.addText(text, { x, y, w, h, align: "center", valign: "middle", color: txtColor, bold: true, fontFace: BODY, fontSize: 11, margin: 0 });
}

function arrowRight(slide, x, y, w) {
  slide.addText("→", { x, y: y - 0.18, w, h: 0.4, align: "center", valign: "middle", color: ACCENT, bold: true, fontFace: BODY, fontSize: 18, margin: 0 });
}

// dark background node-network motif (subtle)
function nodeMotif(slide) {
  const nodes = [
    [10.7, 1.2], [11.9, 2.1], [10.3, 2.9], [12.2, 3.6], [11.1, 4.2],
    [12.6, 5.1], [10.9, 5.6], [11.8, 0.9],
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [3, 5], [4, 6], [5, 6], [7, 1]];
  edges.forEach(([a, b]) => {
    slide.addShape("line", {
      x: nodes[a][0], y: nodes[a][1], w: nodes[b][0] - nodes[a][0], h: nodes[b][1] - nodes[a][1],
      line: { color: NAVY, width: 1.25 },
    });
  });
  nodes.forEach(([x, y], i) => {
    const d = i % 3 === 0 ? 0.22 : 0.14;
    slide.addShape("ellipse", { x: x - d / 2, y: y - d / 2, w: d, h: d, fill: { color: i % 2 ? ACCENT : ICE } });
  });
}

// ============================================================ SLIDE 1 TITLE
(() => {
  const s = pptx.addSlide();
  s.background = { color: DEEP };
  nodeMotif(s);
  s.addText("AI ONBOARDING EVALUATION", { x: 0.8, y: 1.9, w: 9, h: 0.4, fontFace: BODY, fontSize: 14, bold: true, color: ACCENT, charSpacing: 3, margin: 0 });
  s.addText("DecisionOS AI\nOnboarding Evaluation", { x: 0.75, y: 2.35, w: 9.2, h: 1.9, fontFace: HEAD, fontSize: 44, bold: true, color: WHITE, lineSpacingMultiple: 0.98, margin: 0 });
  s.addText([
    { text: "Case Study  ", options: { color: ICE } },
    { text: "—  APM", options: { color: WHITE, bold: true } },
  ], { x: 0.8, y: 4.35, w: 9, h: 0.6, fontFace: BODY, fontSize: 22, margin: 0 });
  s.addText("Understanding a business through an adaptive AI interview and\nauto-generating its operational blueprint.", { x: 0.8, y: 5.0, w: 8.4, h: 0.8, fontFace: BODY, fontSize: 13.5, color: ICE, lineSpacingMultiple: 1.1, margin: 0 });

  // logo placeholders
  const logo = (x, txt) => {
    s.addShape("roundRect", { x, y: 6.35, w: 2.5, h: 0.72, rectRadius: 0.1, fill: { color: "12204A" }, line: { color: NAVY, width: 1 } });
    s.addText(txt, { x, y: 6.35, w: 2.5, h: 0.72, align: "center", valign: "middle", color: ICE, fontFace: BODY, fontSize: 12, italic: true, margin: 0 });
  };
  logo(0.8, "APM logo");
  logo(3.5, "DecisionOS logo");
  s.addNotes("Title slide — DecisionOS AI Onboarding Evaluation, Case Study APM.");
})();

// ====================================================== SLIDE 2 ABOUT APM
(() => {
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideTitle(s, "Company Overview", "About APM");

  const cards = [
    ["✦", "Company Overview", "APM builds government-certified vehicle safety hardware for fleet, school and transport operators across India."],
    ["⚙", "Industry", "Automotive — commercial vehicle safety & telematics (B2B / fleet)."],
    ["▣", "Core Products", "AIS 140 GPS Tracker, Speed Governor, Vehicle Safety Solutions, Prime Load Monitoring."],
    ["↻", "Business Operations", "Order → quotation → procurement → production → QC → installation → delivery."],
  ];
  let cy = 1.75;
  const cardH = 1.02, gap = 0.18;
  cards.forEach(([g, title, body]) => {
    s.addShape("roundRect", { x: 0.7, y: cy, w: 6.35, h: cardH, rectRadius: 0.1, fill: { color: TINT }, line: { color: LINE, width: 1 } });
    glyphCircle(s, 0.92, cy + 0.24, 0.54, g, ACCENT, 16);
    s.addText(title, { x: 1.62, y: cy + 0.12, w: 5.3, h: 0.32, fontFace: BODY, fontSize: 14.5, bold: true, color: NAVY, margin: 0 });
    s.addText(body, { x: 1.62, y: cy + 0.42, w: 5.3, h: 0.55, fontFace: BODY, fontSize: 10.5, color: INK, margin: 0, lineSpacingMultiple: 0.98 });
    cy += cardH + gap;
  });

  // right: website screenshot
  framedImage(s, "website", "APM website", { x: 7.45, y: 1.75, w: 5.15, h: 3.55 });

  // bottom process: Website -> AI Website Intelligence -> Business Understanding
  const py = 6.35, ph = 0.66, pw = 3.55;
  pill(s, 0.7, py, pw, ph, "Website", TINT2, NAVY);
  arrowRight(s, 4.25, py + ph / 2, 0.8);
  pill(s, 5.05, py, pw, ph, "AI Website Intelligence", ACCENT, WHITE);
  arrowRight(s, 8.6, py + ph / 2, 0.8);
  pill(s, 9.4, py, pw, ph, "Business Understanding", NAVY, WHITE);
  s.addNotes("About APM — overview, industry, products, operations, plus website-intelligence process.");
})();

// ================================================ SLIDE 3 ADAPTIVE INTERVIEW
(() => {
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideTitle(s, "AI Discovery", "Adaptive Interview");

  // two tall interview screenshots side by side
  framedImage(s, "interview_1", "Interview Q1–A3", { x: 0.7, y: 1.7, w: 3.35, h: 4.35 });
  framedImage(s, "interview_2", "Interview Q4–A6", { x: 4.15, y: 1.7, w: 3.35, h: 4.35 });

  // right explanation
  s.addText("The AI progressively understands operations by asking context-aware questions — not a fixed questionnaire.", {
    x: 7.75, y: 1.75, w: 4.85, h: 1.0, fontFace: BODY, fontSize: 13.5, color: INK, margin: 0, lineSpacingMultiple: 1.05,
  });
  const checks = ["Daily Operations", "Procurement", "Quality Control (QC)", "Installation", "Approval Process", "Communication Channels"];
  let yy = 2.95;
  checks.forEach((c) => {
    glyphCircle(s, 7.75, yy, 0.34, "✓", ACCENT, 12);
    s.addText(c, { x: 8.22, y: yy - 0.03, w: 4.3, h: 0.4, fontFace: BODY, fontSize: 12.5, bold: true, color: NAVY, valign: "middle", margin: 0 });
    yy += 0.5;
  });

  // bottom result band
  s.addShape("roundRect", { x: 0.7, y: 6.35, w: 11.93, h: 0.66, rectRadius: 0.1, fill: { color: DEEP } });
  s.addText([
    { text: "RESULT   ", options: { color: ACCENT, bold: true, fontSize: 12, charSpacing: 2 } },
    { text: "6 adaptive questions answered successfully.", options: { color: WHITE, bold: true, fontSize: 14 } },
  ], { x: 1.0, y: 6.35, w: 11.3, h: 0.66, valign: "middle", fontFace: BODY, margin: 0 });
  s.addNotes("Adaptive interview — 6 context-aware questions across operations, procurement, QC, installation, approvals, comms.");
})();

// ============================================ SLIDE 4 ORGANIZATION STRUCTURE
(() => {
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideTitle(s, "Organization Understanding", "Business Structure Identified");

  framedImage(s, "departments", "Departments", { x: 0.7, y: 1.7, w: 4.2, h: 4.35 });

  s.addText("DecisionOS automatically identified APM's operational departments from the interview responses.", {
    x: 5.2, y: 1.72, w: 7.4, h: 0.7, fontFace: BODY, fontSize: 13.5, color: INK, margin: 0, lineSpacingMultiple: 1.05,
  });

  const depts = [
    ["01", "Sales & Quotation"],
    ["02", "Procurement & Supplier Management"],
    ["03", "Production & Quality Control"],
    ["04", "Installation & Device Activation"],
  ];
  const gx = 5.2, gy = 2.6, cw = 3.6, ch = 1.55, gcol = 0.2, grow = 0.22;
  depts.forEach(([n, label], i) => {
    const x = gx + (i % 2) * (cw + gcol);
    const y = gy + Math.floor(i / 2) * (ch + grow);
    s.addShape("roundRect", { x, y, w: cw, h: ch, rectRadius: 0.1, fill: { color: TINT }, line: { color: LINE, width: 1 }, shadow: shadow({ blur: 7, offset: 2, opacity: 0.3 }) });
    s.addText(n, { x: x + 0.2, y: y + 0.16, w: 1, h: 0.5, fontFace: HEAD, fontSize: 24, bold: true, color: ICE, margin: 0 });
    s.addText(label, { x: x + 0.22, y: y + 0.7, w: cw - 0.44, h: 0.7, fontFace: BODY, fontSize: 14, bold: true, color: NAVY, margin: 0, lineSpacingMultiple: 0.95 });
  });

  s.addText("The AI inferred the organizational structure directly from interview responses.", {
    x: 5.2, y: 6.45, w: 7.4, h: 0.4, fontFace: BODY, fontSize: 12, italic: true, color: MUTE, margin: 0,
  });
  s.addNotes("Business structure — four departments inferred automatically from interview answers.");
})();

// ======================================= SLIDE 5 WORKFLOW & APPROVAL INTEL
(() => {
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideTitle(s, "Process Intelligence", "Workflow & Approval Intelligence");

  // left: workflow
  s.addText("Operational Workflow", { x: 0.7, y: 1.65, w: 5.8, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  framedImage(s, "workflows", "Workflows", { x: 0.7, y: 2.1, w: 5.75, h: 2.75 });
  // 7-step flow ribbon below
  const steps = ["Customer Order", "Quotation", "Procurement", "Production", "QC", "Installation", "Delivery"];
  let sx = 0.7; const sy = 5.05; const sh = 0.5;
  const sw = [1.15, 0.9, 1.0, 0.95, 0.55, 0.95, 0.8];
  steps.forEach((t, i) => {
    pill(s, sx, sy, sw[i], sh, t, i === steps.length - 1 ? NAVY : TINT2, i === steps.length - 1 ? WHITE : NAVY);
    if (i < steps.length - 1) s.addText("›", { x: sx + sw[i] - 0.02, y: sy, w: 0.2, h: sh, align: "center", valign: "middle", color: ACCENT, bold: true, fontSize: 14, margin: 0 });
    sx += sw[i] + 0.16;
  });

  // right: approvals
  s.addText("Approval Intelligence", { x: 6.85, y: 1.65, w: 5.8, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  framedImage(s, "approval_rules", "Approval Rules", { x: 6.85, y: 2.1, w: 5.78, h: 2.75 });
  const rules = ["Major Purchase Approval", "New Supplier Approval", "Urgent Shortage Escalation"];
  let ry = 5.05;
  rules.forEach((r) => {
    glyphCircle(s, 6.85, ry, 0.32, "✓", ACCENT, 11);
    s.addText(r, { x: 7.3, y: ry - 0.02, w: 5.2, h: 0.36, fontFace: BODY, fontSize: 12.5, bold: true, color: NAVY, valign: "middle", margin: 0 });
    ry += 0.46;
  });

  s.addText("The AI discovered end-to-end workflow stages and their approval policies from the conversation alone.", {
    x: 0.7, y: 6.62, w: 11.9, h: 0.4, fontFace: BODY, fontSize: 12, italic: true, color: MUTE, margin: 0,
  });
  s.addNotes("Workflow extraction + approval-rule detection, both derived from the interview.");
})();

// ============================================ SLIDE 6 PRODUCTS & TASKS
(() => {
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideTitle(s, "Catalogue & Operations", "Products & Operational Tasks");

  // left products
  s.addText("Products Identified", { x: 0.7, y: 1.65, w: 5.8, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  framedImage(s, "products", "Products", { x: 0.7, y: 2.1, w: 5.75, h: 3.25 });
  const prods = ["AIS 140 GPS Tracker", "Speed Governor", "Vehicle Safety Solutions", "Prime Load Monitoring System"];
  let py = 5.5;
  prods.forEach((p, i) => {
    const x = 0.7 + (i % 2) * 2.95;
    const y = py + Math.floor(i / 2) * 0.6;
    s.addShape("roundRect", { x, y, w: 2.8, h: 0.5, rectRadius: 0.25, fill: { color: TINT2 }, line: { color: LINE, width: 1 } });
    s.addText(p, { x: x + 0.1, y, w: 2.6, h: 0.5, align: "center", valign: "middle", color: NAVY, bold: true, fontFace: BODY, fontSize: 10.5, margin: 0 });
  });

  // right tasks
  s.addText("Operational Tasks", { x: 6.85, y: 1.65, w: 5.8, h: 0.4, fontFace: BODY, fontSize: 15, bold: true, color: NAVY, margin: 0 });
  framedImage(s, "operational_tasks", "Operational Tasks", { x: 6.85, y: 2.1, w: 5.78, h: 3.25 });
  s.addText("DecisionOS identified recurring activities — procurement follow-ups, QC reviews, installation scheduling, compliance verification, and status consolidation.", {
    x: 6.85, y: 5.5, w: 5.78, h: 1.1, fontFace: BODY, fontSize: 12, color: INK, margin: 0, lineSpacingMultiple: 1.08,
  });
  s.addNotes("Products and recurring operational tasks extracted automatically.");
})();

// ================================================= SLIDE 7 EVALUATION SUMMARY
(() => {
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideTitle(s, "Scorecard", "Evaluation Summary");

  const rows = [
    "Website Understanding", "Adaptive Interview", "Business Understanding",
    "Workflow Extraction", "Approval Rule Detection", "Operational Blueprint",
  ];
  const rx = 0.7, rw = 7.4; let ry = 1.75; const rh = 0.62, rgap = 0.14;
  rows.forEach((r) => {
    s.addShape("roundRect", { x: rx, y: ry, w: rw, h: rh, rectRadius: 0.08, fill: { color: TINT }, line: { color: LINE, width: 1 } });
    s.addText(r, { x: rx + 0.25, y: ry, w: 4.6, h: rh, valign: "middle", fontFace: BODY, fontSize: 13, bold: true, color: NAVY, margin: 0 });
    s.addText("★★★★★", { x: rx + 4.7, y: ry, w: 2.5, h: rh, align: "right", valign: "middle", fontFace: BODY, fontSize: 16, color: GOLD, margin: 0 });
    ry += rh + rgap;
  });

  // right: overall result panel
  s.addShape("roundRect", { x: 8.4, y: 1.75, w: 4.23, h: 3.94, rectRadius: 0.12, fill: { color: DEEP }, shadow: shadow({ color: "6B7BA8", blur: 12, offset: 4, opacity: 0.5 }) });
  s.addText("OVERALL RESULT", { x: 8.4, y: 2.15, w: 4.23, h: 0.4, align: "center", fontFace: BODY, fontSize: 13, bold: true, color: ICE, charSpacing: 2, margin: 0 });
  s.addText("★★★★★", { x: 8.4, y: 2.75, w: 4.23, h: 0.9, align: "center", valign: "middle", fontFace: BODY, fontSize: 40, color: GOLD, margin: 0 });
  s.addText("Excellent", { x: 8.4, y: 3.8, w: 4.23, h: 0.7, align: "center", fontFace: HEAD, fontSize: 30, bold: true, color: WHITE, margin: 0 });
  s.addText("5.0 / 5.0", { x: 8.4, y: 4.6, w: 4.23, h: 0.5, align: "center", fontFace: BODY, fontSize: 15, color: ACCENT, bold: true, margin: 0 });

  // note band
  s.addShape("roundRect", { x: 0.7, y: 6.05, w: 11.93, h: 0.95, rectRadius: 0.1, fill: { color: TINT2 } });
  s.addText("DecisionOS successfully transformed unstructured business conversations into a structured operational blueprint — with no manual configuration.", {
    x: 1.0, y: 6.05, w: 11.3, h: 0.95, valign: "middle", fontFace: BODY, fontSize: 13, italic: true, color: NAVY, margin: 0,
  });
  s.addNotes("Evaluation scorecard — every dimension rated five stars; overall Excellent.");
})();

// ==================================================== SLIDE 8 CONCLUSION
(() => {
  const s = pptx.addSlide();
  s.background = { color: DEEP };
  nodeMotif(s);
  s.addText("SUMMARY", { x: 0.8, y: 0.7, w: 9, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: ACCENT, charSpacing: 3, margin: 0 });
  s.addText("Key Outcomes", { x: 0.75, y: 1.05, w: 9, h: 0.8, fontFace: HEAD, fontSize: 34, bold: true, color: WHITE, margin: 0 });

  const outcomes = [
    "Understood company operations",
    "Identified departments automatically",
    "Generated end-to-end workflows",
    "Extracted the approval hierarchy",
    "Recognized recurring operational tasks",
    "Built a complete business blueprint",
  ];
  const ox = 0.8, ow = 5.7; let oy = 2.25; const oh = 0.62, og = 0.16;
  outcomes.forEach((o) => {
    s.addShape("roundRect", { x: ox, y: oy, w: ow, h: oh, rectRadius: 0.1, fill: { color: "12204A" }, line: { color: NAVY, width: 1 } });
    glyphCircle(s, ox + 0.16, oy + 0.14, 0.34, "✓", ACCENT, 12);
    s.addText(o, { x: ox + 0.66, y: oy, w: ow - 0.8, h: oh, valign: "middle", fontFace: BODY, fontSize: 12.5, bold: true, color: WHITE, margin: 0 });
    oy += oh + og;
  });

  // right closing
  s.addText("DecisionOS onboards organizations using conversational intelligence and AI-driven business understanding.", {
    x: 6.95, y: 2.4, w: 5.6, h: 1.6, fontFace: HEAD, fontSize: 19, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 1.1,
  });
  s.addShape("line", { x: 6.98, y: 4.2, w: 2.2, h: 0, line: { color: ACCENT, width: 2 } });
  s.addText("Thank You", { x: 6.9, y: 4.7, w: 5.6, h: 1.0, fontFace: HEAD, fontSize: 46, bold: true, color: ACCENT, margin: 0 });
  s.addText("DecisionOS  ·  AI Onboarding Evaluation  ·  APM", { x: 6.95, y: 5.85, w: 5.7, h: 0.4, fontFace: BODY, fontSize: 12, color: ICE, margin: 0 });
  s.addNotes("Key outcomes and thank-you close.");
})();

pptx.writeFile({ fileName: path.join(__dirname, "DecisionOS_APM_Evaluation.pptx") }).then((f) => {
  console.log("WROTE", f);
});
