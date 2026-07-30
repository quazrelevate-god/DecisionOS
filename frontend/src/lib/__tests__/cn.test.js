/**
 * Regression guard for a failure that produces no error anywhere.
 *
 * tailwind-merge treats unknown `text-*` classes as colours. Before the type
 * scale was registered, cn("text-label", "text-text-secondary") returned only
 * the colour — every label in the system silently rendered at the inherited
 * 16px instead of 11px, with the class present in the markup and absent from
 * the CSS. Nothing failed; it just looked subtly wrong.
 *
 * These assertions fail loudly if the registration is ever dropped.
 */
import { cn } from "../utils";
import { typography } from "../tokens";

describe("cn — type scale survives merging with colours", () => {
  test.each(Object.keys(typography.scale))("text-%s is not eaten by a text colour", (step) => {
    const out = cn(`text-${step}`, "text-text-secondary");
    expect(out).toContain(`text-${step}`);
    expect(out).toContain("text-text-secondary");
  });

  test("every type-scale step in tokens.js is registered with tailwind-merge", () => {
    // If a step is added to the scale but not to lib/utils.js, this catches it
    // before it reaches a component.
    Object.keys(typography.scale).forEach((step) => {
      expect(cn(`text-${step}`, "text-danger-700")).toContain(`text-${step}`);
    });
  });

  test("genuine conflicts still collapse to the last one", () => {
    expect(cn("text-body", "text-h1")).toBe("text-h1");
    expect(cn("text-text-secondary", "text-text-disabled")).toBe("text-text-disabled");
    expect(cn("bg-primary", "bg-surface")).toBe("bg-surface");
  });

  test("unrelated utilities are preserved", () => {
    expect(cn("text-label", "uppercase", "text-text-tertiary")).toContain("uppercase");
  });
});
