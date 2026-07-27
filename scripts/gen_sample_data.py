import json

WS = "ws_0001"
def d(**k): return k

data = {}

data["workspace"] = d(
    id=WS, company_name="Northwind Handlooms (SAMPLE)", industry="Textile manufacturing",
    description="Fictional sample workspace for migration testing. Spins and dyes cotton yarn.",
    currency="INR", region="Sample-Region",
    high_value_threshold=50000, require_owner_signoff=True,
    created_at="2026-01-05T09:00:00Z",
)

data["departments"] = [
    d(key="sales", label="Sales"),
    d(key="operations", label="Operations"),
    d(key="finance", label="Finance"),
]

base = ["inbox","data_input","people","workflows","tasks","brain","ask"]
data["employees"] = [
    d(id="usr_owner", name="Asha Rao", email="owner@example.test", phone="+1-555-0100",
      role="owner", permissions=["ALL"], reporting_manager_id=None, language="en", passwordless=False),
    d(id="usr_sales1", name="Vikram Menon", email="vikram@example.test", phone="+1-555-0101",
      role="sales", permissions=base, reporting_manager_id="usr_owner", language="en", passwordless=False),
    d(id="usr_ops1", name="Priya Nair", email="priya@example.test", phone="+1-555-0102",
      role="operations", permissions=base, reporting_manager_id="usr_owner", language="hi", passwordless=False),
    d(id="usr_fin1", name="Rahul Das", email="rahul@example.test", phone="+1-555-0103",
      role="finance", permissions=base+["finance","ledger"], reporting_manager_id="usr_owner", language="en", passwordless=False),
    d(id="usr_sales2", name="Meera Iyer", email=None, phone="+1-555-0104",
      role="sales", permissions=base, reporting_manager_id="usr_sales1", language="ta", passwordless=True),
]

data["customers"] = [
    d(id="cus_1", name="Rivertown Retail", company="Rivertown Retail Pvt (SAMPLE)", phone="+1-555-0200", type="customer", status="active", assigned_to="usr_sales1"),
    d(id="cus_2", name="Blue Orchid Stores", company="Blue Orchid (SAMPLE)", phone="+1-555-0201", type="customer", status="active", assigned_to="usr_sales1"),
    d(id="cus_3", name="Green Valley Dealers", company="Green Valley (SAMPLE)", phone="+1-555-0202", type="dealer", status="active", assigned_to="usr_sales2"),
    d(id="cus_4", name="Sunrise Boutiques", company="Sunrise (SAMPLE)", phone="+1-555-0203", type="customer", status="inactive", assigned_to="usr_sales2"),
    d(id="cus_5", name="Metro Fabrics", company="Metro Fabrics (SAMPLE)", phone="+1-555-0204", type="customer", status="active", assigned_to="usr_sales1"),
]

data["suppliers"] = [
    d(id="ven_1", name="Cotton Source Co", company="Cotton Source (SAMPLE)", phone="+1-555-0300", type="vendor", status="active"),
    d(id="ven_2", name="DyeChem Supplies", company="DyeChem (SAMPLE)", phone="+1-555-0301", type="vendor", status="active"),
    d(id="ven_3", name="Packright Materials", company="Packright (SAMPLE)", phone="+1-555-0302", type="vendor", status="active"),
]

dec_titles = [
    "Approve revised quote for Rivertown Retail",
    "Switch festive-season yarn supplier",
    "Set 5% dealer discount for Q1",
    "Pause orders from inactive customers",
    "Approve overtime for dyeing unit this week",
    "Buy 200kg extra cotton for festive demand",
    "Renegotiate DyeChem payment terms",
    "Launch new hank-yarn product line",
    "Standardise complaint response within 24h",
    "Consolidate two small vendors into one",
]
data["decisions"] = [
    d(id=f"dec_{i+1}", workspace_id=WS, title=t,
      summary=f"Sample structured summary for: {t}.",
      status=["approved","pending","approved","rejected","pending","approved","pending","approved","approved","pending"][i],
      created_by="usr_owner", created_at="2026-02-1%d T10:00:00Z" % ((i%9)+1))
    for i, t in enumerate(dec_titles)
]

task_titles = [
    ("Send revised quote to Rivertown","sales","high","done","usr_sales1","dec_1"),
    ("Call Cotton Source for festive rate","operations","high","in_progress","usr_ops1","dec_6"),
    ("Prepare Q1 discount sheet","sales","medium","open","usr_sales1","dec_3"),
    ("Email inactive customers pause notice","sales","low","open","usr_sales2","dec_4"),
    ("Schedule overtime roster","operations","medium","pending_approval","usr_ops1","dec_5"),
    ("Raise PO for 200kg cotton","finance","high","in_progress","usr_fin1","dec_6"),
    ("Draft DyeChem terms proposal","finance","medium","open","usr_fin1","dec_7"),
    ("Create hank-yarn product spec","operations","medium","open","usr_ops1","dec_8"),
    ("Write 24h complaint SOP","operations","low","done","usr_ops1","dec_9"),
    ("Compare vendor quotes for consolidation","finance","medium","blocked","usr_fin1","dec_10"),
    ("Follow up Blue Orchid order","sales","medium","in_progress","usr_sales1",None),
    ("Confirm dispatch for Green Valley","operations","high","open","usr_ops1",None),
    ("Reconcile March expenses","finance","high","open","usr_fin1",None),
    ("Update inventory after dyeing batch","operations","medium","done","usr_ops1",None),
    ("Log complaint from Sunrise Boutiques","sales","low","done","usr_sales2",None),
    ("Prepare monthly sales summary","sales","medium","open","usr_sales1",None),
    ("Verify Packright delivery note","finance","low","open","usr_fin1",None),
    ("Call Metro Fabrics for reorder","sales","medium","open","usr_sales1",None),
    ("Fix mislabeled SKU in inventory","operations","low","open","usr_ops1",None),
    ("Send festive greetings to top dealers","sales","low","open","usr_sales2",None),
]
data["tasks"] = [
    d(id=f"tsk_{i+1}", workspace_id=WS, title=t[0], assignee_role=t[1], priority=t[2],
      status=t[3], assignee_id=t[4], decision_id=t[5], source="decision" if t[5] else "manual",
      created_at="2026-02-2%dT08:00:00Z" % ((i%9)+1))
    for i, t in enumerate(task_titles)
]

data["approvals"] = [
    d(id="apr_1", type="decision", ref_id="dec_1", decided_by="usr_owner", result="approved", at="2026-02-11T11:00:00Z"),
    d(id="apr_2", type="decision", ref_id="dec_4", decided_by="usr_owner", result="rejected", at="2026-02-12T11:00:00Z"),
    d(id="apr_3", type="task", ref_id="tsk_5", decided_by="usr_owner", result="pending", at=None),
    d(id="apr_4", type="capture", ref_id="cap_1", decided_by="usr_fin1", result="approved", at="2026-03-01T09:30:00Z"),
    d(id="apr_5", type="leave", ref_id="lev_1", decided_by="usr_owner", result="approved", at="2026-03-05T09:00:00Z"),
]

data["proof_submissions"] = [
    d(id="prf_1", task_id="tsk_1", kind="update", text="Quote emailed to Rivertown at 3pm.", at="2026-02-22T15:00:00Z"),
    d(id="prf_2", task_id="tsk_1", kind="attachment", filename="sample_quote.pdf", url="/api/files/sample_quote.pdf", at="2026-02-22T15:05:00Z"),
    d(id="prf_3", task_id="tsk_9", kind="attachment", filename="sample_sop.pdf", url="/api/files/sample_sop.pdf", at="2026-02-25T12:00:00Z"),
    d(id="prf_4", task_id="tsk_14", kind="update", text="Inventory updated: +120kg dyed yarn.", at="2026-02-26T10:00:00Z"),
    d(id="prf_5", task_id="tsk_15", kind="response", text="Complaint logged and acknowledged to customer.", at="2026-02-27T16:00:00Z"),
]

data["whatsapp_captures"] = [
    d(id="cap_1", workspace_id=WS, source="whatsapp", kind="invoice", from_phone="+1-555-0300",
      extracted=d(vendor="Cotton Source (SAMPLE)", amount=48000, currency="INR", status="unpaid"),
      confidence=0.86, reviewer_perm="finance", status="approved", created_at="2026-03-01T09:00:00Z"),
    d(id="cap_2", workspace_id=WS, source="whatsapp", kind="payment", from_phone="+1-555-0301",
      extracted=d(counterparty="DyeChem (SAMPLE)", amount=12000, direction="out"),
      confidence=0.78, reviewer_perm="finance", status="pending", created_at="2026-03-02T09:10:00Z"),
    d(id="cap_3", workspace_id=WS, source="whatsapp", kind="task", from_phone="+1-555-0101",
      extracted=d(title="Arrange transport for Green Valley dispatch"),
      confidence=0.72, reviewer_role="operations", status="pending", created_at="2026-03-02T10:00:00Z"),
    d(id="cap_4", workspace_id=WS, source="whatsapp", kind="contact", from_phone="+1-555-0205",
      extracted=d(name="New Lead - Harbour Textiles (SAMPLE)", type="customer"),
      confidence=0.65, reviewer_role="sales", status="pending", created_at="2026-03-03T11:00:00Z"),
    d(id="cap_5", workspace_id=WS, source="whatsapp", kind="invoice", from_phone="+1-555-0302",
      extracted=d(vendor="Packright (SAMPLE)", amount=9000, currency="INR", status="unpaid"),
      confidence=0.9, reviewer_perm="finance", status="approved", created_at="2026-03-04T08:30:00Z"),
]

data["meeting_notes"] = [
    d(id="mtg_1", workspace_id=WS, title="Weekly ops sync (SAMPLE)",
      key_points=["Festive demand up 20%", "Need extra cotton", "Dyeing unit at capacity"],
      created_by="usr_ops1", created_at="2026-02-18T17:00:00Z"),
    d(id="mtg_2", workspace_id=WS, title="Sales review (SAMPLE)",
      key_points=["Rivertown quote pending", "Approve Q1 dealer discount", "Reactivate Sunrise"],
      created_by="usr_sales1", created_at="2026-02-19T17:00:00Z"),
    d(id="mtg_3", workspace_id=WS, title="Finance check-in (SAMPLE)",
      key_points=["Outstanding to DyeChem", "March reconciliation", "Vendor consolidation"],
      created_by="usr_fin1", created_at="2026-02-20T17:00:00Z"),
]

data["leave_requests"] = [
    d(id="lev_1", workspace_id=WS, user_id="usr_sales2", leave_type="casual",
      from_date="2026-03-10", to_date="2026-03-11", portion="full", reason="Family function (SAMPLE)",
      status="approved", impact=d(tasks_at_risk=["tsk_4"], cover_suggestion="usr_sales1")),
    d(id="lev_2", workspace_id=WS, user_id="usr_ops1", leave_type="sick",
      from_date="2026-03-14", to_date="2026-03-14", portion="half", reason="Medical (SAMPLE)",
      status="requested", impact=d(tasks_at_risk=["tsk_2","tsk_12"], cover_suggestion="usr_owner")),
    d(id="lev_3", workspace_id=WS, user_id="usr_fin1", leave_type="casual",
      from_date="2026-03-20", to_date="2026-03-22", portion="full", reason="Travel (SAMPLE)",
      status="info_requested", impact=d(tasks_at_risk=["tsk_6","tsk_13"], cover_suggestion="usr_owner")),
]

data["_meta"] = d(
    note="FICTIONAL SAMPLE DATA ONLY. No real names, phone numbers, emails, IDs or customer info. "
         "Phone numbers use the reserved 555-01xx fiction range. Emails use the .test TLD. "
         "Do not load into production.",
    counts=d(workspace=1, departments=len(data["departments"]), employees=len(data["employees"]),
             customers=len(data["customers"]), suppliers=len(data["suppliers"]),
             decisions=len(data["decisions"]), tasks=len(data["tasks"]),
             approvals=len(data["approvals"]), proof_submissions=len(data["proof_submissions"]),
             whatsapp_captures=len(data["whatsapp_captures"]), meeting_notes=len(data["meeting_notes"]),
             leave_requests=len(data["leave_requests"])),
)

with open("/exports/decisionos_v2_migration_pack/12_SANITISED_SAMPLE_DATA.json", "w") as f:
    json.dump(data, f, indent=2)
print("counts:", data["_meta"]["counts"])
