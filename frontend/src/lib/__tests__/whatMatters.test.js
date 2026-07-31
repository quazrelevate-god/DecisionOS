import { whatMatters, summarise } from "../whatMatters";

const day = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * day).toISOString();
const inDays = (n) => new Date(Date.now() + n * day).toISOString();
const today = () => new Date().toISOString();

describe("whatMatters — tier order", () => {
  test("an approval outranks an escalation, an overdue task and today's work", () => {
    const { items } = whatMatters({
      decisions: [{ id: "d1", status: "pending_approval", title: "Approve payment" }],
      tasks: [
        { id: "t1", source: "escalation", title: "Escalated", assignee_name: "Ravi" },
        { id: "t2", due_date: daysAgo(9), title: "Very late" },
        { id: "t3", due_date: today(), title: "Due today" },
      ],
    });
    expect(items.map((i) => i.tier)).toEqual(["approval", "escalation", "overdue"]);
  });

  test("within overdue, the latest leads — and amount breaks a tie on the same day", () => {
    const { items } = whatMatters({
      tasks: [
        { id: "a", due_date: daysAgo(2), title: "Two days", amount: 100 },
        { id: "b", due_date: daysAgo(9), title: "Nine days", amount: 1 },
        { id: "c", due_date: daysAgo(2), title: "Two days, bigger", amount: 500000 },
      ],
      limit: 3,
    });
    expect(items.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});

describe("whatMatters — lateness outranks amount, whatever the amount", () => {
  /* The packed-integer sort this replaced assumed amounts below ten lakh.
     ₹18,00,000 three days late then beat a task four days late, because the
     amount had escaped its tie-break role into the day ordering. */
  test("a very large amount does not jump a day boundary", () => {
    const { items } = whatMatters({
      tasks: [
        { id: "big", due_date: daysAgo(3), title: "Huge but newer", amount: 1800000 },
        { id: "later", due_date: daysAgo(4), title: "Older, no amount", amount: null },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["later", "big"]);
  });

  test("amount still breaks a tie on the same day, at any scale", () => {
    const { items } = whatMatters({
      tasks: [
        { id: "small", due_date: daysAgo(3), title: "Small", amount: 95000 },
        { id: "huge", due_date: daysAgo(3), title: "Huge", amount: 18000000 },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["huge", "small"]);
  });
});

describe("whatMatters — handoffs share the escalation tier", () => {
  test("a handoff is tier 2, with its own verb", () => {
    const { items, counts } = whatMatters({
      tasks: [{ id: "t1", source: "handoff", title: "Take this over", raised_by_name: "Ravi Kumar" }],
    });
    expect(items[0].tier).toBe("escalation");
    expect(items[0].reason).toBe("Ravi Kumar handed this to you");
    expect(counts.escalation).toBe(1);
  });

  test("an escalation keeps its own verb", () => {
    const { items } = whatMatters({
      tasks: [{ id: "t1", source: "escalation", title: "Decide", raised_by_name: "Meena Raghavan" }],
    });
    expect(items[0].reason).toBe("Meena Raghavan escalated this to you");
  });

  test("the person who raised it is named, not the person it sits with", () => {
    const { items } = whatMatters({
      tasks: [{ id: "t1", source: "escalation", title: "x", raised_by_name: "Meena", assignee_name: "Prasanna" }],
    });
    expect(items[0].reason).toContain("Meena");
    expect(items[0].reason).not.toContain("Prasanna");
  });
});

describe("whatMatters — one slot per tier before any tier takes a second", () => {
  test("six approvals cannot crowd out an overdue item", () => {
    const decisions = Array.from({ length: 6 }, (_, i) => ({
      id: `d${i}`,
      status: "pending_approval",
      title: `Approve ${i}`,
    }));
    const { items } = whatMatters({
      decisions,
      tasks: [
        { id: "esc", source: "escalation", title: "Escalated", raised_by_name: "Ravi" },
        { id: "late", due_date: daysAgo(5), title: "Five days late" },
      ],
    });
    expect(items.map((i) => i.tier)).toEqual(["approval", "escalation", "overdue"]);
    expect(items.map((i) => i.id)).toEqual(["d0", "esc", "late"]);
  });

  test("with one tier populated it still fills the list from that tier", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, due_date: daysAgo(i + 1), title: `T${i}` }));
    const { items } = whatMatters({ tasks });
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.tier === "overdue")).toBe(true);
    // Worst first is unchanged within the tier.
    expect(items.map((i) => i.id)).toEqual(["t4", "t3", "t2"]);
  });

  test("spare slots after every tier is represented go to the best of the rest", () => {
    const { items } = whatMatters({
      decisions: [{ id: "d1", status: "pending_approval", title: "Approve" }],
      tasks: [
        { id: "a", due_date: daysAgo(2), title: "Two days" },
        { id: "b", due_date: daysAgo(9), title: "Nine days" },
      ],
      limit: 3,
    });
    // Two populated tiers, three slots: approval, worst overdue, then the next overdue.
    expect(items.map((i) => i.id)).toEqual(["d1", "b", "a"]);
  });

  test("the shortlist is still displayed in tier order, not allocation order", () => {
    const { items } = whatMatters({
      decisions: [{ id: "d1", status: "pending_approval", title: "Approve" }],
      tasks: [
        { id: "t1", due_date: today(), title: "Today" },
        { id: "t2", due_date: daysAgo(3), title: "Late" },
      ],
    });
    expect(items.map((i) => i.tier)).toEqual(["approval", "overdue", "today"]);
  });
});

describe("whatMatters — what it refuses to surface", () => {
  test("completed and cancelled work never appears, however late", () => {
    const { items, counts } = whatMatters({
      tasks: [
        { id: "t1", due_date: daysAgo(30), status: "done", title: "Done but late" },
        { id: "t2", due_date: daysAgo(30), status: "cancelled", title: "Cancelled" },
      ],
    });
    expect(items).toHaveLength(0);
    expect(counts.overdue).toBe(0);
  });

  test("undated work is never called overdue", () => {
    const { items, counts } = whatMatters({ tasks: [{ id: "t1", title: "No due date" }] });
    expect(items).toHaveLength(0);
    expect(counts.overdue).toBe(0);
  });

  test("future work is not today's problem", () => {
    const { counts } = whatMatters({ tasks: [{ id: "t1", due_date: inDays(5), title: "Next week" }] });
    expect(counts.today).toBe(0);
    expect(counts.overdue).toBe(0);
  });

  test("a decision that is not pending approval is not an approval", () => {
    const { counts } = whatMatters({
      decisions: [
        { id: "d1", status: "approved", title: "Already approved" },
        { id: "d2", status: "rejected", title: "Rejected" },
      ],
    });
    expect(counts.approval).toBe(0);
  });
});

describe("whatMatters — subtraction is never concealment", () => {
  test("it shows at most three and reports how many it held back", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      due_date: daysAgo(i + 1),
      title: `Task ${i}`,
    }));
    const { items, hidden, counts } = whatMatters({ tasks });
    expect(items).toHaveLength(3);
    expect(hidden).toBe(9);
    expect(counts.overdue).toBe(12);
    expect(items.length + hidden).toBe(12);
  });

  test("fewer than three is fine — it does not pad the list", () => {
    const { items, hidden } = whatMatters({ tasks: [{ id: "t1", due_date: daysAgo(1), title: "One" }] });
    expect(items).toHaveLength(1);
    expect(hidden).toBe(0);
  });
});

describe("whatMatters — every item says why", () => {
  test("each surfaced item carries a human reason", () => {
    const { items } = whatMatters({
      decisions: [{ id: "d1", status: "pending_approval", title: "Approve" }],
      tasks: [
        { id: "t1", source: "escalation", title: "Esc", assignee_name: "Ravi Kumar" },
        { id: "t2", due_date: daysAgo(3), title: "Late" },
      ],
    });
    expect(items[0].reason).toMatch(/blocked/i);
    expect(items[1].reason).toContain("Ravi Kumar");
    expect(items[2].reason).toBe("3 days overdue");
    items.forEach((i) => expect(i.reason.length).toBeGreaterThan(0));
  });

  test("one day overdue is singular", () => {
    const { items } = whatMatters({ tasks: [{ id: "t1", due_date: daysAgo(1), title: "x" }] });
    expect(items[0].reason).toBe("1 day overdue");
  });
});

describe("summarise", () => {
  test("an empty day says so, plainly", () => {
    expect(summarise({ approval: 0, escalation: 0, overdue: 0, today: 0 })).toMatch(/nothing needs you/i);
  });

  test("one thing reads as one sentence", () => {
    expect(summarise({ approval: 1, escalation: 0, overdue: 0, today: 0 })).toBe("1 decision needs you.");
  });

  test("several are joined readably, not as a list of counters", () => {
    const s = summarise({ approval: 2, escalation: 0, overdue: 3, today: 1 });
    expect(s).toBe("2 decisions need you, 3 overdue and 1 due today.");
  });
});
