#!/usr/bin/env node
/**
 * Legacy → token sweep for the migration.
 *
 *   node scripts/sweep.js --dry src/pages/MyWork.js
 *   node scripts/sweep.js src/pages/MyWork.js
 *
 * Handles ONLY the mappings that carry no semantic judgement — structure,
 * surfaces, hairlines, radii, legacy type classes. Every one of these means the
 * same thing in every context, so replacing them mechanically is safe and
 * replacing them by hand 1,455 times is not.
 *
 * It deliberately does NOT touch the colour-semantic classes. `bg-brand-red` on
 * a delete button is danger; on a category label it is decoration; on the
 * wordmark it is identity. A codemod cannot tell those apart, so it reports
 * them and leaves them alone — the report is the worklist for the human pass.
 */
const fs = require("fs");

/** Unambiguous: same meaning in every context. */
const SAFE = [
  // Hairlines — the old hard-black frame is the system's hairline everywhere.
  [/\bborder-black\/(\d+)\b/g, "border-hairline"],
  [/\bborder-black\b/g, "border-hairline"],
  [/\bborder-border\b/g, "border-hairline"],

  // Surfaces
  [/\bbg-white\b/g, "bg-surface"],
  [/\bbg-brand-paper\b/g, "bg-background"],
  [/\bbg-card\b/g, "bg-surface"],
  [/\bbg-black\/5\b/g, "bg-surface-hover"],
  [/\bbg-black\/10\b/g, "bg-surface-sunken"],
  [/\bhover:bg-black\/5\b/g, "hover:bg-surface-hover"],
  [/\bhover:bg-black\/10\b/g, "hover:bg-surface-sunken"],

  // Text
  [/\btext-muted-foreground\b/g, "text-text-secondary"],
  [/\btext-foreground\b/g, "text-text"],
  [/\btext-black\/40\b/g, "text-text-tertiary"],
  [/\btext-black\/30\b/g, "text-text-tertiary"],
  [/\btext-black\b/g, "text-text"],

  // Type — label-mono was monospace metadata; the system's equivalent is
  // text-label, which is Inter, uppercase and tracked.
  [/\blabel-mono\b/g, "text-label uppercase"],
  [/\bfont-heading\b/g, ""],

  // Structure
  [/\bcard-brutal\b/g, "rounded-lg border border-hairline bg-surface"],
  [/\bshadow-brutal-lg\b/g, "shadow-lg"],
  [/\bshadow-brutal-sm\b/g, "shadow-xs"],
  [/\bshadow-brutal\b/g, "shadow-sm"],
  [/\brounded-none\b/g, "rounded-md"],
];

/** Needs a human: the same class means different things in different places. */
const REPORT = [
  [/\bbg-brand-red\b/g, "solid red fill — danger, identity, or decoration?"],
  [/\btext-brand-red\b/g, "red text — danger or decoration?"],
  [/\bborder-brand-red\b/g, "red border — danger or decoration?"],
  [/\bbg-brand-blue\b/g, "blue fill — was it a primary action, or a category?"],
  [/\btext-brand-blue\b/g, "blue text — link, primary, or category?"],
  [/\bbg-brand-yellow\b/g, "yellow fill — caution, or a category?"],
  [/\bbg-brand-ink\b/g, "ink fill — was this the screen's primary action?"],
  [/\bfont-mono\b/g, "monospace outside the terminal block"],
  [/\btext-green-\d+\b/g, "raw green — success, or decoration?"],
  [/\btext-(purple|orange|amber)-\d+\b/g, "raw palette colour"],
];

const dry = process.argv.includes("--dry");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let totalSafe = 0;
const worklist = [];

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  let n = 0;

  for (const [pattern, replacement] of SAFE) {
    after = after.replace(pattern, (m) => {
      n += 1;
      return replacement;
    });
  }
  // Collapse whitespace the removals leave behind, inside className strings only.
  after = after.replace(/className="([^"]*)"/g, (m, cls) => `className="${cls.replace(/\s+/g, " ").trim()}"`);

  const notes = [];
  for (const [pattern, why] of REPORT) {
    const hits = (after.match(pattern) || []).length;
    if (hits) notes.push(`${hits}x ${pattern.source.replace(/\\b/g, "")} — ${why}`);
  }

  totalSafe += n;
  if (notes.length) worklist.push({ file, notes });
  if (!dry && n) fs.writeFileSync(file, after);
  console.log(`${dry ? "would rewrite" : "rewrote"} ${n} safe classes in ${file}`);
}

if (worklist.length) {
  console.log("\nNeeds a human decision (left untouched):");
  for (const { file, notes } of worklist) {
    console.log(`  ${file}`);
    notes.forEach((x) => console.log(`    - ${x}`));
  }
}
console.log(`\n${dry ? "would rewrite" : "rewrote"} ${totalSafe} classes across ${files.length} file(s)`);
