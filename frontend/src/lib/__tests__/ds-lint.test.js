/**
 * Proves the design-system lint enforcement actually bites.
 *
 * Without this, eslint.config.mjs could silently stop matching (a renamed folder, a
 * changed glob, an eslint upgrade) and the semantic rules would quietly become
 * review opinions again — which is the exact failure mode the enforcement exists to
 * prevent. So the rules are tested like any other behaviour.
 */
import { execFileSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const VIOLATIONS = 'src/components/ds/__fixtures__/lint-violations.jsx';
const ALLOWED = 'src/components/ds/__fixtures__/terminal-allowed.jsx';

/** @returns {Array<{ruleId: string, message: string}>} */
function lint(file) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['eslint', '--no-config-lookup', '--config', 'eslint.config.mjs', '--format', 'json', file],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    // eslint exits non-zero when it reports errors; the JSON is still on stdout.
    raw = err.stdout;
  }
  const [result] = JSON.parse(raw);
  return result.messages;
}

describe('design-system lint enforcement', () => {
  let messages;
  beforeAll(() => {
    messages = lint(VIOLATIONS);
  });

  test('raw hex colours are rejected inside components/ds', () => {
    expect(messages.some((m) => /Raw hex colour/.test(m.message))).toBe(true);
  });

  test('legacy brand-red/blue/yellow is rejected inside components/ds', () => {
    expect(messages.some((m) => /Legacy brand-red/.test(m.message))).toBe(true);
  });

  test('font-mono is rejected outside the terminal block', () => {
    expect(messages.some((m) => /Monospace is reserved/.test(m.message))).toBe(true);
  });

  test('rounded-full is rejected — the scale ends at rounded-pill', () => {
    expect(messages.some((m) => /rounded-full is Tailwind/.test(m.message))).toBe(true);
  });

  test('uppercase and tracking-wide are rejected', () => {
    expect(messages.some((m) => /No uppercase anywhere/.test(m.message))).toBe(true);
  });

  test('every violation is an error, not a warning', () => {
    expect(messages.length).toBeGreaterThanOrEqual(5);
    messages.forEach((m) => expect(m.severity).toBe(2));
  });

  test('the allowlisted terminal file may use monospace', () => {
    const allowed = lint(ALLOWED);
    expect(allowed.filter((m) => /Monospace is reserved/.test(m.message))).toHaveLength(0);
  });

  /* The bans were scoped to components/ds/** while four shadcn primitives were
     already wired into the app and policed by nothing. This proves the glob
     reaches ui/ — the rule this file exists to defend is that enforcement is
     mechanical, and a glob that silently stops matching is how it stops being. */
  test('the bans reach components/ui, not just components/ds', () => {
    const config = require('fs').readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    expect(JSON.parse(config).scripts['lint:ds']).toContain('src/components/ui/**');
  });

  test('Lucide imports are rejected in adopted primitives — this app uses Phosphor', () => {
    const wired = ['dialog', 'sheet', 'popover', 'sonner', 'tooltip'];
    wired.forEach((name) => {
      const file = path.join(ROOT, 'src/components/ui', `${name}.jsx`);
      if (!require('fs').existsSync(file)) return;
      expect(require('fs').readFileSync(file, 'utf8')).not.toContain('lucide-react');
    });
  });
});
