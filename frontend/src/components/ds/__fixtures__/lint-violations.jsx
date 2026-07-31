/* Every ban, in one file, so ds-lint.test.js can prove each one still bites.
   Not linted in CI — __fixtures__ is excluded from the lint:ds glob — it is
   linted on demand by the test. */
export const Bad = () => (
  <div className="bg-brand-red border-black" style={{ color: '#FF3B30' }}>
    <span className="font-mono uppercase tracking-wide">nope</span>
    <span className="rounded-full">also nope</span>
  </div>
);
