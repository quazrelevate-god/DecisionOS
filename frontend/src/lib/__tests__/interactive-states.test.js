/**
 * Guard against a defect that has already shipped twice.
 *
 * Button's `loading` and VoiceCapture's `processing` both rendered identically
 * to `disabled`, because both are non-interactive and the obvious
 * implementation is `disabled={disabled || busy}` followed by styling on that
 * same boolean. The component behaves correctly — it cannot be clicked — and
 * only the meaning is wrong, so nothing fails and nobody notices until someone
 * looks at a grey button and reads it as broken.
 *
 * Two layers here:
 *
 *   1. The contract: busy and disabled must never resolve to the same visual.
 *   2. The pattern: no ds component may reimplement the distinction by hand.
 *      Anything with a loading/processing concept must resolve through
 *      ./states, so a third occurrence fails this suite instead of shipping.
 */
import fs from "fs";
import path from "path";
import { interactiveState, DISABLED_VISUALS, BUSY_VISUALS } from "../../components/ds/states";

const DS_DIR = path.resolve(__dirname, "../../components/ds");

const componentFiles = () =>
  fs
    .readdirSync(DS_DIR)
    .filter((f) => f.endsWith(".jsx"))
    .map((f) => ({ name: f, source: fs.readFileSync(path.join(DS_DIR, f), "utf8") }));

describe("busy is never unavailable", () => {
  test("the three states are distinct", () => {
    const idle = interactiveState({});
    const busy = interactiveState({ busy: true });
    const disabled = interactiveState({ disabled: true });

    expect(idle.state).toBe("idle");
    expect(busy.state).toBe("busy");
    expect(disabled.state).toBe("disabled");
    expect(busy.className).not.toBe(disabled.className);
  });

  test("busy keeps its variant — it adds no neutral treatment of its own", () => {
    const busy = interactiveState({ busy: true });
    expect(busy.className).toBe(BUSY_VISUALS);
    expect(busy.className).not.toContain("bg-surface-sunken");
    expect(busy.className).not.toContain("text-text-disabled");
  });

  test("disabled is neutral-derived, never a tint of the primary", () => {
    const { className } = interactiveState({ disabled: true });
    expect(className).toBe(DISABLED_VISUALS);
    expect(className).toContain("bg-surface-sunken");
    expect(className).not.toMatch(/primary|brand/);
  });

  test("busy wins over disabled — a control that is working is not unavailable", () => {
    const both = interactiveState({ disabled: true, busy: true });
    expect(both.state).toBe("busy");
    expect(both.className).not.toBe(DISABLED_VISUALS);
  });

  test("both busy and disabled are inert; only idle accepts input", () => {
    expect(interactiveState({ busy: true }).inert).toBe(true);
    expect(interactiveState({ disabled: true }).inert).toBe(true);
    expect(interactiveState({}).inert).toBe(false);
  });
});

describe("no component reimplements the distinction by hand", () => {
  /** Declares its own busy-ish prop AND renders a control that can be disabled. */
  const isInteractiveWithBusy = (source) =>
    /(loading|processing|busy)\s*[=:,}]/.test(source) && /disabled=\{/.test(source);

  /**
   * ApprovalCard is exempt because it DELEGATES: it forwards `loading` to Button
   * and never styles a busy state itself. That is asserted below rather than
   * taken on trust — an exemption nobody checks is just a hole.
   */
  const DELEGATES = ["ApprovalCard.jsx"];

  test("every interactive ds component with a busy state resolves through ./states", () => {
    const offenders = componentFiles()
      .filter(({ name, source }) => isInteractiveWithBusy(source))
      .filter(({ name }) => !DELEGATES.includes(name))
      .filter(({ source }) => !/from "\.\/states"/.test(source))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test("the delegating component really does delegate", () => {
    const approval = componentFiles().find((f) => f.name === "ApprovalCard.jsx");
    expect(approval).toBeDefined();
    // Forwards the busy state to Button…
    expect(approval.source).toMatch(/loading=\{/);
    expect(approval.source).toMatch(/from "\.\/Button"/);
    // …and never styles one itself.
    expect(approval.source).not.toMatch(/bg-surface-sunken/);
    expect(approval.source).not.toMatch(/text-text-disabled/);
  });

  test("no component hardcodes the neutral disabled treatment inline", () => {
    // The treatment has exactly one definition. A component spelling it out
    // itself is how the two states drift back together.
    const offenders = componentFiles()
      .filter(({ source }) => source.includes("bg-surface-sunken text-text-disabled"))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test("non-interactive components are out of scope", () => {
    // TerminalBlock has a `loading` prop but renders no control — there is no
    // disabled state for it to be confused with.
    const terminal = componentFiles().find((f) => f.name === "TerminalBlock.jsx");
    expect(isInteractiveWithBusy(terminal.source)).toBe(false);
  });
});
