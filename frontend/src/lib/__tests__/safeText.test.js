/**
 * The guard exists to stop a class of bug, so it is tested against the class —
 * the four observed leaks plus the shapes they belong to.
 */
import { safeText, containsMachinery } from "../safeText";

describe("safeText — the observed leaks", () => {
  test("rewrites the WhatsApp fallback message", () => {
    expect(safeText("no fallback (WA_TENANT_ID) is set")).toBe("No default workspace is set");
  });

  test("rewrites the production env instruction", () => {
    const out = safeText("Paste this into your production env variable.");
    expect(out).not.toMatch(/env/i);
    expect(out).toMatch(/administrator/i);
  });

  test("drops unresolved template tokens from AI copy", () => {
    expect(safeText("Hi answer_0, your invoice is ready")).toBe("Hi, your invoice is ready");
    expect(safeText("Owner is {{owner_name}} today")).toBe("Owner is today");
  });

  test("drops raw UUIDs", () => {
    expect(safeText("Workspace 3f7a1c22-91bd-4c0e-9a7e-2d5b8f0c1e44 updated")).toBe("Workspace updated");
  });
});

describe("safeText — the class, not just the instances", () => {
  test.each([
    "REACT_APP_BACKEND_URL",
    "STRIPE_SECRET_KEY",
    "SOME_NEW_VAR_WE_HAVE_NOT_SEEN",
  ])("strips env identifiers it has never been told about: %s", (id) => {
    expect(safeText(`Set ${id} to continue`)).not.toContain(id);
  });

  test("strips stack frames and source paths", () => {
    expect(safeText("Failed at handleSubmit (bundle.js:1200)")).not.toMatch(/\(|bundle/);
    expect(safeText("Error in /app/backend/routers/ledger.py")).not.toMatch(/\.py/);
  });

  test("ordinary copy is untouched", () => {
    const copy = "Move the ₹4,80,000 payment to Friday to preserve payroll headroom.";
    expect(safeText(copy)).toBe(copy);
  });

  test("single capitalised words are not mistaken for identifiers", () => {
    expect(safeText("OK, the WhatsApp number is saved")).toContain("WhatsApp");
    expect(safeText("Your CEO Brief is ready")).toContain("CEO Brief");
  });

  test("a message that is entirely machinery falls back rather than blanking", () => {
    const out = safeText("WA_TENANT_ID");
    expect(out.length).toBeGreaterThan(3);
    expect(out).not.toContain("WA_TENANT_ID");
  });

  test("null and undefined are empty, not the string 'undefined'", () => {
    expect(safeText(null)).toBe("");
    expect(safeText(undefined)).toBe("");
  });
});

describe("containsMachinery", () => {
  test("detects what safeText would strip", () => {
    expect(containsMachinery("no fallback (WA_TENANT_ID) is set")).toBe(true);
    expect(containsMachinery("answer_3")).toBe(true);
    expect(containsMachinery("Approve supplier payment timing")).toBe(false);
  });

  test("is stable across repeated calls (global regex lastIndex)", () => {
    const s = "WA_TENANT_ID";
    expect(containsMachinery(s)).toBe(true);
    expect(containsMachinery(s)).toBe(true);
    expect(containsMachinery(s)).toBe(true);
  });
});
