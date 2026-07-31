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
const ROUNDED_FULL = String.raw`\brounded-(?:[trbl]{1,2}-)?full\b`;
const UPPERCASE = String.raw`\b(?:uppercase|tracking-wider?|tracking-widest)\b`;

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
  'Everywhere else uses the single sans-serif — use text-label for metadata.';

const ROUNDED_FULL_MSG =
  'rounded-full is Tailwind\'s own value, not ours. The token scale is ' +
  'rounded-sm/md/lg/xl/pill — use rounded-pill. Anything shipped from a registry ' +
  'has to be re-authored onto the scale, not merely dropped in.';

const UPPERCASE_MSG =
  'No uppercase anywhere. The label tier reads as labels through size, weight and ' +
  'colour (12px / 600 / tertiary against 15px / 400 body) — use text-label. ' +
  'uppercase + tracking-wide is the registry default look this system replaced.';

const LUCIDE_MSG =
  'This app uses Phosphor (@phosphor-icons/react). Registry components ship Lucide ' +
  'imports; swap them at adoption time. Two icon families on one screen is the ' +
  'inconsistency that makes an adopted component look adopted.';

/** Ban a pattern in string literals, template strings and JSX text. */
const banPattern = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
  { selector: `JSXText[value=/${pattern}/]`, message },
];

export default [
  {
    /* ui/ is in scope as of the Tooltip adoption. It holds shadcn primitives,
       four of which are wired into the app, and it was entirely unpoliced —
       "skinned with our tokens" was a promise nobody checked. Anything adopted
       from a registry now has to pass the same bans as anything hand-written. */
    files: ['src/components/ds/**/*.{js,jsx}', 'src/components/ui/**/*.{js,jsx}'],
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
        ...banPattern(ROUNDED_FULL, ROUNDED_FULL_MSG),
        ...banPattern(UPPERCASE, UPPERCASE_MSG),
      ],
      'no-restricted-imports': ['error', { paths: [{ name: 'lucide-react', message: LUCIDE_MSG }] }],
    },
  },
  {
    /* Registry primitives that are present but wired into nothing.
     *
     * The TOKEN bans still apply to these — that is the point of covering ui/.
     * Only the Lucide import ban is lifted, because it is the one rule that
     * cannot be satisfied without rewriting sixteen files nobody imports, and
     * a lint that fails on dead code gets switched off rather than obeyed.
     *
     * This list is a to-do, not an exemption: clearing a file's Lucide imports
     * is part of adopting it, and it must leave this list at that point. If a
     * name here ever appears in an import, the ban must come back with it.
     * See MIGRATION-FOLLOWUPS.md — the standing recommendation is to delete
     * these outright rather than carry them.
     */
    files: [
      'src/components/ui/accordion.jsx',
      'src/components/ui/breadcrumb.jsx',
      'src/components/ui/calendar.jsx',
      'src/components/ui/carousel.jsx',
      'src/components/ui/checkbox.jsx',
      'src/components/ui/command.jsx',
      'src/components/ui/context-menu.jsx',
      'src/components/ui/dropdown-menu.jsx',
      'src/components/ui/input-otp.jsx',
      'src/components/ui/menubar.jsx',
      'src/components/ui/navigation-menu.jsx',
      'src/components/ui/pagination.jsx',
      'src/components/ui/radio-group.jsx',
      'src/components/ui/resizable.jsx',
      'src/components/ui/select.jsx',
      'src/components/ui/toast.jsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
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
        ...banPattern(ROUNDED_FULL, ROUNDED_FULL_MSG),
        ...banPattern(UPPERCASE, UPPERCASE_MSG),
      ],
    },
  },
];
