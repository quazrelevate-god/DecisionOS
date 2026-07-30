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

  test('every violation is an error, not a warning', () => {
    expect(messages.length).toBeGreaterThanOrEqual(3);
    messages.forEach((m) => expect(m.severity).toBe(2));
  });

  test('the allowlisted terminal file may use monospace', () => {
    const allowed = lint(ALLOWED);
    expect(allowed.filter((m) => /Monospace is reserved/.test(m.message))).toHaveLength(0);
  });
});
