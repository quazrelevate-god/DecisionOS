/**
 * Design-system enforcement lint.
 *
 * Deliberately narrow: this config exists to make the semantic rules of the design
 * system *mechanically enforceable* rather than a code-review opinion. It does not
 * try to lint the whole app (the un-swept legacy code would drown the signal) — the
 * dev server's own CRA/CRACO eslint pass still handles general correctness.
 *
 *   yarn lint:ds        # check components/ds/** obey the token contract
 *
 * The three bans, all scoped to components/ds/**:
 *   1. Raw hex colours          → use a role token (bg-brand-600, text-danger-700, …)
 *   2. Legacy brand-* identity  → the old neo-brutalist palette is not the system
 *   3. font-mono                → monospace belongs to the Company Brain terminal only
 *
 * TerminalBlock.jsx is the single allowlisted exception to (3).
 */

const HEX = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;
const LEGACY_BRAND = String.raw`\bbrand-(?:red|blue|yellow|ink|paper)\b`;
const MONO = String.raw`\bfont-mono\b`;

const HEX_MSG =
  'Raw hex colour in the design system. Use a role token instead ' +
  '(bg-brand-600 / text-danger-700 / border-hairline). If the value is genuinely new, ' +
  'add it to src/lib/tokens.js and run `node scripts/gen-tokens.js`.';

const LEGACY_MSG =
  'Legacy brand-red/blue/yellow/ink/paper is the old neo-brutalist identity, not the ' +
  'design system. Use role tokens: brand-* for identity and the one primary action, ' +
  'danger-* for errors/overdue/destructive only, caution-* for waiting, success-* for done.';

const MONO_MSG =
  'Monospace is reserved for the Company Brain terminal block (components/ds/TerminalBlock.jsx). ' +
  'Everywhere else uses the single sans-serif — use text-label for uppercase metadata.';

/** Ban a pattern in string literals, template strings and JSX text. */
const banPattern = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
  { selector: `JSXText[value=/${pattern}/]`, message },
];

export default [
  {
    files: ['src/components/ds/**/*.{js,jsx}'],
    ignores: ['src/components/ds/__fixtures__/terminal-allowed.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...banPattern(HEX, HEX_MSG),
        ...banPattern(LEGACY_BRAND, LEGACY_MSG),
        ...banPattern(MONO, MONO_MSG),
      ],
    },
  },
  {
    // The one place monospace is the correct answer.
    files: [
      'src/components/ds/TerminalBlock.jsx',
      // Fixture standing in for TerminalBlock until Phase 4 lands it.
      'src/components/ds/__fixtures__/terminal-allowed.jsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...banPattern(HEX, HEX_MSG),
        ...banPattern(LEGACY_BRAND, LEGACY_MSG),
      ],
    },
  },
];
