"""Epic 3 Sprint 4 (E3-11.x + E3-12.1): the bounded Company-Brain agent.

Covers the tool registry's RBAC filtering, the complexity gate, and the agent loop
itself (mocked tool-calling): tools execute, results feed back, propose actions are
captured, and the HARD step budget stops a runaway loop.
"""
import asyncio

import services.ai.agent as agent
import services.ai.agent_tools as at


def _run(c):
    return asyncio.run(c)


# --- tool registry RBAC -----------------------------------------------------
def test_owner_sees_all_tools():
    owner = {"role": "owner", "id": "o", "tenant_id": "t"}
    assert len(at.tools_for(owner)) == len(at.all_tools())


def test_employee_tools_are_permission_filtered():
    emp = {"role": "sales", "id": "e", "tenant_id": "t", "permissions": ["ask", "brain"]}
    names = {t.name for t in at.tools_for(emp)}
    assert "finance_summary" not in names        # needs 'finance'
    assert "propose_task" not in names           # needs 'voice_capture'
    assert "search_brain" in names               # needs 'brain' (granted)


def test_to_schema_shape():
    schema = at.to_schema(at.tools_for({"role": "owner", "id": "o", "tenant_id": "t"}))
    assert all(s["type"] == "function" and s["function"]["name"] for s in schema)
    assert all("parameters" in s["function"] for s in schema)


# --- complexity gate (pure) -------------------------------------------------
def test_gate_structured_is_deterministic():
    for q in ["how much does Kumar owe", "how many overdue tasks", "show me unpaid invoices",
              "list open tasks", "what is the total outstanding"]:
        assert agent.should_use_agent(q) is False, q


def test_gate_open_ended_is_agent():
    for q in ["why did our margins drop last quarter", "what should I do about slow payers",
              "recommend how to improve cash flow", "help me figure out the supplier issue"]:
        assert agent.should_use_agent(q) is True, q


def test_gate_empty():
    assert agent.should_use_agent("") is False


# --- agent loop (mocked tool-calling) ---------------------------------------
class _FakeToolCall:
    def __init__(self, id, name, args):
        self.id, self.name, self.arguments = id, name, args


class _FakeResp:
    def __init__(self, content="", tool_calls=None):
        self.content, self.tool_calls = content, tool_calls or []


class _FakeChat:
    def __init__(self, script):
        self.script, self.i, self.added = script, 0, []

    def with_model(self, *m):
        return self

    def with_tools(self, tools):
        return self

    def add_tool_result(self, tid, content):
        self.added.append((tid, content))

    async def send_message_with_tools(self, msg=None):
        r = self.script[min(self.i, len(self.script) - 1)]
        self.i += 1
        return r


def _wire(monkeypatch, script, tools):
    fake = _FakeChat(script)
    monkeypatch.setattr(agent, "LlmChat", lambda **k: fake)
    monkeypatch.setattr(at, "tools_for", lambda user: tools)
    monkeypatch.setattr(agent.agent_tools, "tools_for", lambda user: tools)
    monkeypatch.setattr(agent.agent_tools, "to_schema", lambda tools: [])
    import services.ai.llm_limits as lim
    async def _g(coro, label=""):
        return await coro
    monkeypatch.setattr(lim, "guarded_llm", _g)
    async def _noop(**k):
        return None
    monkeypatch.setattr(agent, "record_ai_call", _noop)
    async def _noop_save(*a, **k):
        return None
    monkeypatch.setattr(agent, "_save_turn", _noop_save)
    async def _no_hist(*a, **k):
        return []
    monkeypatch.setattr(agent, "_load_history", _no_hist)   # keep the loop tests DB-free
    return fake


def _tool(name, fn, access="read"):
    return at.Tool(name, name, {"type": "object", "properties": {}}, fn, access, None)


def test_agent_calls_tool_then_answers(monkeypatch):
    calls = {"n": 0}
    async def fake_list(user, **a):
        calls["n"] += 1
        return {"count": 3, "tasks": []}
    tools = [_tool("list_open_tasks", fake_list)]
    script = [_FakeResp(tool_calls=[_FakeToolCall("1", "list_open_tasks", {})]),
              _FakeResp(content="You have 3 open tasks.")]
    _wire(monkeypatch, script, tools)
    out = _run(agent.run_agent("what's open", {"id": "u", "tenant_id": "t", "role": "owner"}))
    assert out["answer"] == "You have 3 open tasks."
    assert out["tools_used"] == ["list_open_tasks"] and calls["n"] == 1 and out["steps"] == 1


def test_agent_captures_proposed_action(monkeypatch):
    async def fake_propose(user, **a):
        return {"proposed": True, "decision_id": "dec1", "status": "pending_approval"}
    tools = [_tool("propose_task", fake_propose, access="propose")]
    script = [_FakeResp(tool_calls=[_FakeToolCall("1", "propose_task", {"title": "Call Kumar"})]),
              _FakeResp(content="I've proposed a task for your approval.")]
    _wire(monkeypatch, script, tools)
    out = _run(agent.run_agent("ask Kumar to pay", {"id": "u", "tenant_id": "t", "role": "owner"}))
    assert out["proposed"] == [{"tool": "propose_task", "decision_id": "dec1"}]


def test_step_budget_stops_runaway_loop(monkeypatch):
    async def fake(user, **a):
        return {"ok": True}
    tools = [_tool("list_open_tasks", fake)]
    # model ALWAYS asks for a tool -> would loop forever without the budget
    always = _FakeResp(tool_calls=[_FakeToolCall("1", "list_open_tasks", {})])
    _wire(monkeypatch, [always], tools)
    out = _run(agent.run_agent("loop", {"id": "u", "tenant_id": "t", "role": "owner"}, max_steps=3))
    assert out["steps"] == 3   # capped, did not run away


def test_unknown_tool_is_handled(monkeypatch):
    tools = [_tool("list_open_tasks", lambda user, **a: None)]
    script = [_FakeResp(tool_calls=[_FakeToolCall("1", "no_such_tool", {})]),
              _FakeResp(content="done")]
    fake = _wire(monkeypatch, script, tools)
    out = _run(agent.run_agent("x", {"id": "u", "tenant_id": "t", "role": "owner"}))
    assert out["answer"] == "done"
    # the unknown-tool error was fed back as a tool result, not crashed
    assert fake.added and "not available" in fake.added[0][1]
