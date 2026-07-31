/**
 * TodayBrief rendering contract.
 *
 * Two of these branches cannot be reached from the preview fixture — a clear
 * day and a day with three or fewer items — and "verified" for a branch nobody
 * has rendered is a claim, not a check. They are asserted here instead.
 *
 * The disclosure rule is the one worth defending in a test: shortening a list
 * is only legitimate while the remainder is counted. If the hidden count ever
 * stops rendering, subtraction has quietly become concealment.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { TodayBrief } from "../../components/TodayBrief";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, unmount: () => act(() => root.unmount()) };
}

const day = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * day).toISOString();
const q = (c, sel) => c.querySelector(`[data-testid="${sel}"]`);

describe("TodayBrief — a clear day", () => {
  test("says so plainly and renders no cards", () => {
    const { container, unmount } = mount(<TodayBrief decisions={[]} tasks={[]} />);
    expect(q(container, "today-brief-summary").textContent).toBe("Nothing needs you right now. You're clear.");
    expect(q(container, "today-brief-clear")).not.toBeNull();
    expect(q(container, "today-brief-items")).toBeNull();
    expect(q(container, "today-brief-show-rest")).toBeNull();
    unmount();
  });

  test("a done task that is long past due does not disturb a clear day", () => {
    const { container, unmount } = mount(
      <TodayBrief decisions={[]} tasks={[{ id: "t1", title: "Old", status: "done", due_date: daysAgo(30) }]} />
    );
    expect(q(container, "today-brief-clear")).not.toBeNull();
    unmount();
  });
});

describe("TodayBrief — the disclosure rule", () => {
  const tasks = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, due_date: daysAgo(i + 1) }));

  test("three or fewer items means nothing is hidden, so no count is shown", () => {
    const { container, unmount } = mount(<TodayBrief decisions={[]} tasks={tasks(3)} />);
    expect(container.querySelectorAll('[data-testid^="today-brief-item-"]')).toHaveLength(3);
    expect(q(container, "today-brief-show-rest")).toBeNull();
    unmount();
  });

  test("more than three shows exactly three and names the remainder", () => {
    const { container, unmount } = mount(<TodayBrief decisions={[]} tasks={tasks(9)} />);
    expect(container.querySelectorAll('[data-testid^="today-brief-item-"]')).toHaveLength(3);
    expect(q(container, "today-brief-show-rest").textContent).toContain("6");
    unmount();
  });
});

describe("TodayBrief — every item says why it is there", () => {
  test("each card renders its reason", () => {
    const { container, unmount } = mount(
      <TodayBrief
        decisions={[{ id: "d1", status: "pending_approval", title: "Approve payment" }]}
        tasks={[
          { id: "t1", source: "escalation", title: "Escalated", assignee_name: "Ravi Kumar" },
          { id: "t2", title: "Late", due_date: daysAgo(4) },
        ]}
      />
    );
    const reasons = [...container.querySelectorAll('[data-testid^="today-brief-reason-"]')].map((e) => e.textContent);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("Waiting on your approval");
    expect(reasons[1]).toContain("Ravi Kumar escalated this to you");
    expect(reasons[2]).toContain("4 days overdue");
    unmount();
  });
});

describe("TodayBrief — colour stays urgency-only", () => {
  /* The left edge is the only colour this component emits. It must appear on
     overdue and due-today and nowhere else: an edge on an approval would be a
     colour standing in for a category, which is the pattern this design system
     exists to have removed. */
  const edgeCount = (c) => c.querySelectorAll('span[aria-hidden="true"].w-\\[3px\\]').length;

  test("approvals and escalations carry no urgency edge", () => {
    const { container, unmount } = mount(
      <TodayBrief
        decisions={[{ id: "d1", status: "pending_approval", title: "Approve" }]}
        tasks={[{ id: "t1", source: "escalation", title: "Escalated", assignee_name: "Ravi" }]}
      />
    );
    expect(edgeCount(container)).toBe(0);
    unmount();
  });

  test("overdue and due-today do", () => {
    const { container, unmount } = mount(
      <TodayBrief decisions={[]} tasks={[{ id: "t1", title: "Late", due_date: daysAgo(2) }]} />
    );
    expect(edgeCount(container)).toBe(1);
    unmount();
  });
});
