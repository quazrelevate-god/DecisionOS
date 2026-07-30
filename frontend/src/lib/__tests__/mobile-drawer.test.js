/**
 * MobileDrawer focus and scroll behaviour, in jsdom.
 *
 * These are the parts that are easy to get wrong, invisible when wrong, and
 * expensive to retrofit: a drawer you cannot leave by keyboard is a trap, and
 * one that lets the page scroll behind your thumb feels detached from the app.
 *
 * Written as a unit test rather than checked in the browser because keyboard
 * focus could not be driven reliably in the automation environment — jsdom
 * models focus faithfully enough to assert the contract, and it runs in CI.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MobileDrawer } from "../../components/ds/MobileDrawer";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

const Drawer = ({ open, onClose = () => {} }) => (
  <>
    <button type="button" data-testid="trigger">
      Open
    </button>
    <MobileDrawer open={open} onClose={onClose} title="Navigation">
      <button type="button">First item</button>
      <button type="button">Second item</button>
    </MobileDrawer>
  </>
);

describe("MobileDrawer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  test("is not rendered while closed", () => {
    mount(<Drawer open={false} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("is a labelled modal dialog when open", () => {
    mount(<Drawer open />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Navigation");
  });

  test("locks body scroll while open and restores it on close", () => {
    const view = mount(<Drawer open />);
    expect(document.body.style.overflow).toBe("hidden");
    view.rerender(<Drawer open={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  test("moves focus into the panel on open", async () => {
    mount(<Drawer open />);
    // Focus is deferred a frame so it cannot lose a race with the click that
    // opened the drawer; wait for that frame.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test("Escape closes it", () => {
    const onClose = jest.fn();
    mount(<Drawer open onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape still works after the parent re-renders with a new onClose identity", () => {
    // The effect deliberately does not depend on onClose — an inline arrow gives
    // it a new identity every render, which would otherwise tear down and re-run
    // the whole effect (re-locking scroll, yanking focus) on each render.
    const first = jest.fn();
    const second = jest.fn();
    const view = mount(<Drawer open onClose={first} />);
    view.rerender(<Drawer open onClose={second} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("Tab from the last focusable wraps to the first — focus cannot escape", () => {
    mount(<Drawer open />);
    const dialog = document.querySelector('[role="dialog"]');
    const items = dialog.querySelectorAll("button");
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
  });

  test("Shift+Tab from the first wraps to the last", () => {
    mount(<Drawer open />);
    const dialog = document.querySelector('[role="dialog"]');
    const items = dialog.querySelectorAll("button");
    const first = items[0];
    const last = items[items.length - 1];

    first.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  test("returns focus to whatever was focused before it opened", async () => {
    const view = mount(<Drawer open={false} />);
    const trigger = document.querySelector('[data-testid="trigger"]');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    view.rerender(<Drawer open />);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(document.activeElement).not.toBe(trigger);

    view.rerender(<Drawer open={false} />);
    expect(document.activeElement).toBe(trigger);
  });
});
