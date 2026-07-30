#!/usr/bin/env node
/**
 * Generates the design-token custom properties in `src/index.css` from the single
 * source of truth in `src/lib/tokens.js`.
 *
 *   node scripts/gen-tokens.js          # write
 *   node scripts/gen-tokens.js --check  # verify no drift (used by CI / the test suite)
 *
 * Only the region between the generated markers is touched; everything else in
 * index.css (base layer, legacy compatibility shims, keyframes) is left alone.
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const TOKENS = path.join(ROOT, 'src/lib/tokens.js');
const CSS = path.join(ROOT, 'src/index.css');

/** Load the ESM token module from a CommonJS script without a build step. */
function loadTokens() {
  const { code } = babel.transformFileSync(TOKENS, {
    configFile: false,
    babelrc: false,
    presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }]],
  });
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    module.exports,
    require,
    module,
    TOKENS,
    path.dirname(TOKENS)
  );
  return module.exports;
}

const { renderTokenCss, generatedMarkers } = loadTokens();

const css = fs.readFileSync(CSS, 'utf8');
const block = renderTokenCss();

const start = css.indexOf(generatedMarkers.start);
const end = css.indexOf(generatedMarkers.end);
if (start === -1 || end === -1) {
  console.error(
    `gen-tokens: could not find the generated markers in ${path.relative(ROOT, CSS)}.\n` +
      `Expected:\n  ${generatedMarkers.start}\n  ...\n  ${generatedMarkers.end}`
  );
  process.exit(1);
}

const next = css.slice(0, start) + block + css.slice(end + generatedMarkers.end.length);

if (process.argv.includes('--check')) {
  if (next !== css) {
    console.error(
      'gen-tokens: src/index.css is out of date with src/lib/tokens.js.\n' +
        'Run `node scripts/gen-tokens.js` and commit the result.'
    );
    process.exit(1);
  }
  console.log('gen-tokens: tokens are in sync.');
  process.exit(0);
}

if (next === css) {
  console.log('gen-tokens: already up to date.');
} else {
  fs.writeFileSync(CSS, next);
  console.log(`gen-tokens: wrote ${block.split('\n').length} lines of tokens to src/index.css`);
}
