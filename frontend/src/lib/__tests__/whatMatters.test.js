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
