/**
 * Render-layer guard against internal strings reaching the founder's screen.
 *
 * The observed leaks were `WA_TENANT_ID`, "paste into your production env
 * variable", raw UUIDs on Settings, and unresolved template tokens like
 * `answer_0` appearing inside AI-generated copy. Fixing those four individually
 * fixes four bugs; the class of bug is "something internal escaped into a view
 * built for a business owner", and new instances arrive every time a prompt,
 * an error path or a config field changes.
 *
 * So this is a guard at the boundary rather than a set of patches. Anything that
 * looks like machinery — an env var name, a UUID, an unfilled placeholder, a
 * stack frame — is either replaced with plain language or dropped before display.
 *
 * It is deliberately conservative: it only strips things that cannot be
 * meaningful to a reader. When a whole message turns out to be machinery, the
 * caller gets a plain fallback rather than an empty string, because a blank
 * error is worse than a generic one.
 */

/** Things a business owner should never be shown. */
const MACHINERY = [
  // Unfilled template placeholders: answer_0, {{name}}, ${value}, <placeholder>
  { re: /\banswer_\d+\b/gi, why: "unresolved template token" },
  { re: /\{\{[^}]*\}\}/g, why: "unresolved template token" },
  { re: /\$\{[^}]*\}/g, why: "unresolved template token" },
  // SCREAMING_SNAKE env/config identifiers, 2+ segments so ordinary words survive
  { re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/g, why: "internal identifier" },
  // Bare UUIDs
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, why: "internal id" },
  // Stack frames and module paths
  { re: /\bat\s+\w+\s+\([^)]*\)/g, why: "stack frame" },
  { re: /\b(?:\/[\w.-]+){2,}\.(?:js|jsx|py|ts)\b/g, why: "source path" },
];

/** Phrases that are developer instructions, rewritten for the reader. */
const REPHRASE = [
  [/paste (?:this )?into your production env(?:ironment)? variable[s]?\.?/gi, "your administrator will add this during setup."],
  [/set (?:the )?environment variable[s]?/gi, "complete setup"],
  [/no fallback \([^)]*\) is set/gi, "no default workspace is set"],
  [/traceback \(most recent call last\):?/gi, ""],
];

/**
 * Strip machinery from a string meant for a human.
 *
 * @param {unknown} value
 * @param {{fallback?: string}} [opts] Used when nothing readable survives.
 * @returns {string}
 *
 * @example
 * safeText("no fallback (WA_TENANT_ID) is set")  // "no default workspace is set"
 * safeText("Hi answer_0, your invoice is ready") // "Hi, your invoice is ready"
 */
export function safeText(value, { fallback = "Something went wrong. Please try again." } = {}) {
  if (value == null) return "";
  let out = String(value);

  for (const [re, replacement] of REPHRASE) out = out.replace(re, replacement);
  for (const { re } of MACHINERY) out = out.replace(re, "");

  // Tidy the seams the removals leave: doubled spaces, orphaned punctuation,
  // empty brackets.
  out = out
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();

  // A message that was entirely machinery is worse blank than generic.
  if (!out || out.length < 3) return fallback;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * True when a string contains anything that should never reach a user. Used by
 * the test suite and available for asserting on AI output before it is stored.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function containsMachinery(value) {
  if (value == null) return false;
  const s = String(value);
  return MACHINERY.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(s);
  });
}
