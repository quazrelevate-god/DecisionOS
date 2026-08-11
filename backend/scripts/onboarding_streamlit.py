"""Manual test harness for the onboarding flow (BasicsFlow -> WebsiteIntel ->
VoiceInterview -> BuildReveal), built to exercise the real backend endpoints
after the INTERVIEW_SYSTEM / BLUEPRINT_SYSTEM / website-intel / OPENERS
prompt rewrites.

This is a THIN HTTP CLIENT ONLY. It calls the same /api/signup/* and
/api/auth/register endpoints the real React frontend calls -- it does not
reimplement any interview/blueprint/opener logic locally. Every question,
"why", blueprint field, and opener string you see here came straight from
the backend's actual response.

Run:
    1. Start the backend however you normally do (uvicorn server:app ...).
    2. streamlit run scripts/onboarding_streamlit.py
    3. Set the Base URL in the sidebar to wherever that backend is listening.
"""
import requests
import streamlit as st

st.set_page_config(page_title="DecisionOS Onboarding Test Harness", layout="wide")

DEFAULT_BASE_URL = "http://localhost:8001"


def api_post(path: str, payload: dict) -> dict | None:
    """POST to the real backend and return the parsed JSON, or None on failure.
    Never touches business logic -- just forwards payload -> response."""
    url = st.session_state.base_url.rstrip("/") + path
    try:
        r = requests.post(url, json=payload, timeout=30)
    except requests.RequestException as e:
        st.error(f"Could not reach {url}\n\n{e}")
        return None
    if r.status_code >= 400:
        st.error(f"{r.status_code} from {path}:\n\n{r.text[:1000]}")
        return None
    try:
        return r.json()
    except ValueError:
        st.error(f"Non-JSON response from {path}:\n\n{r.text[:1000]}")
        return None


def show_raw(label: str, data):
    with st.expander(f"Raw response — {label}"):
        st.json(data)


def init_state():
    defaults = {
        "base_url": DEFAULT_BASE_URL,
        "step": "basics",
        "company_name": "",
        "founder_name": "",
        "email": "",
        "password": "",
        "phone": "",
        "team_size": "",
        "language_code": "en-IN",
        "website_url": "",
        "world": None,  # last website-intel response
        "manual_industry": "",
        "manual_business_model": "",
        "description": "",
        "session_id": None,
        "current_question": "",
        "current_why": "",
        "current_index": 0,
        "current_max": 0,
        "interview_done": False,
        "qa_log": [],
        "blueprint": None,
        "refinement_text": "",
        "register_result": None,
    }
    for k, v in defaults.items():
        st.session_state.setdefault(k, v)


def reset_all():
    keys = list(st.session_state.keys())
    base_url = st.session_state.get("base_url", DEFAULT_BASE_URL)
    for k in keys:
        del st.session_state[k]
    init_state()
    st.session_state.base_url = base_url


init_state()

with st.sidebar:
    st.header("Backend connection")
    st.session_state.base_url = st.text_input(
        "Base URL", value=st.session_state.base_url,
        help="Host:port where `uvicorn server:app` (or main.py) is running. "
             "No /api suffix -- the routers already prefix their own paths.",
    )
    st.caption(f"Current step: **{st.session_state.step}**")
    if st.button("Reset session", use_container_width=True):
        reset_all()
        st.rerun()

st.title("Onboarding test harness")
st.caption(
    "Every action below calls the real /api/signup/* and /api/auth/register "
    "endpoints on the backend at the Base URL in the sidebar. Nothing here "
    "reimplements the interview, blueprint, or opener logic -- it only "
    "displays what the backend actually returned."
)

STEPS = ["basics", "website", "interview", "blueprint", "register"]
st.progress((STEPS.index(st.session_state.step)) / (len(STEPS) - 1))

# ---------------------------------------------------------------------------
# Step 1 — Basics
# ---------------------------------------------------------------------------
if st.session_state.step == "basics":
    st.subheader("1. Basics")
    col1, col2 = st.columns(2)
    with col1:
        st.session_state.company_name = st.text_input("Company name*", st.session_state.company_name)
        st.session_state.founder_name = st.text_input("Founder name", st.session_state.founder_name)
        st.session_state.team_size = st.text_input(
            "Team size", st.session_state.team_size,
            help="Free text, e.g. '3', '11-50', '200+' — the backend bands this server-side.",
        )
        st.session_state.language_code = st.text_input(
            "Language code", st.session_state.language_code,
            help="e.g. en-IN, hi-IN, ta-IN, te-IN — must be a code the backend's Sarvam config supports.",
        )
    with col2:
        st.session_state.email = st.text_input("Email", st.session_state.email)
        if st.button("Check email availability"):
            if not st.session_state.email:
                st.warning("Enter an email first.")
            else:
                data = api_post("/api/signup/check-email", {"email": st.session_state.email})
                if data is not None:
                    show_raw("check-email", data)
        st.session_state.password = st.text_input("Password (for later registration)", st.session_state.password, type="password")
        st.session_state.phone = st.text_input("Phone (optional)", st.session_state.phone)

    st.divider()
    if st.button("Continue to Website Intel →", type="primary", disabled=not st.session_state.company_name.strip()):
        st.session_state.step = "website"
        st.rerun()

# ---------------------------------------------------------------------------
# Step 2 — Website Intelligence
# ---------------------------------------------------------------------------
elif st.session_state.step == "website":
    st.subheader("2. Website intelligence")
    st.session_state.website_url = st.text_input("Company website URL", st.session_state.website_url)

    if st.button("Analyze website"):
        if not st.session_state.website_url.strip():
            st.warning("Enter a URL first.")
        else:
            data = api_post("/api/signup/website-intel", {
                "url": st.session_state.website_url,
                "company_name": st.session_state.company_name,
            })
            if data is not None:
                st.session_state.world = data
                show_raw("website-intel", data)

    world = st.session_state.world
    if world:
        if world.get("fetched"):
            st.success("Fetched and analyzed.")
            st.write("**Summary:**", world.get("summary") or "—")
            st.write("**Industry:**", world.get("industry") or "—")
            st.write("**Business model:**", world.get("business_model") or "—")
            if world.get("products"):
                st.write("**Products:**")
                st.table(world["products"])
            if world.get("highlights"):
                st.write("**Highlights:**", ", ".join(world["highlights"]))
        else:
            st.warning("Backend could not fetch/analyze this site — fall back to manual entry below.")

    st.markdown("**Manual override / fallback fields** (used if the analysis above is empty or wrong)")
    col1, col2 = st.columns(2)
    with col1:
        st.session_state.manual_industry = st.text_input(
            "Industry", st.session_state.manual_industry or (world or {}).get("industry", ""))
    with col2:
        st.session_state.manual_business_model = st.text_input(
            "Business model", st.session_state.manual_business_model or (world or {}).get("business_model", ""))
    st.session_state.description = st.text_area("Founder's own description (optional)", st.session_state.description)

    st.divider()
    c1, c2 = st.columns(2)
    with c1:
        if st.button("← Back to Basics"):
            st.session_state.step = "basics"
            st.rerun()
    with c2:
        if st.button("Continue to Interview →", type="primary"):
            st.session_state.step = "interview"
            st.rerun()

# ---------------------------------------------------------------------------
# Step 3 — Adaptive interview
# ---------------------------------------------------------------------------
elif st.session_state.step == "interview":
    st.subheader("3. Adaptive interview")

    if st.session_state.session_id is None:
        world = st.session_state.world or {}
        payload = {
            "company_name": st.session_state.company_name,
            "founder_name": st.session_state.founder_name,
            "team_size": st.session_state.team_size,
            "industry": st.session_state.manual_industry or world.get("industry", ""),
            "business_model": st.session_state.manual_business_model or world.get("business_model", ""),
            "description": st.session_state.description,
            "website_summary": world.get("summary", ""),
            "products": world.get("products") or [],
            "language_code": st.session_state.language_code,
        }
        data = api_post("/api/signup/interview/start", payload)
        if data is not None:
            st.session_state.session_id = data["session_id"]
            st.session_state.current_question = data["question"]
            st.session_state.current_why = data.get("why", "")
            st.session_state.current_index = data["index"]
            st.session_state.current_max = data["max"]
            show_raw("interview/start", data)
            st.rerun()

    if st.session_state.qa_log:
        with st.expander(f"Transcript so far ({len(st.session_state.qa_log)} answered)"):
            for i, qa in enumerate(st.session_state.qa_log, 1):
                st.markdown(f"**Q{i}:** {qa['q']}")
                st.markdown(f"**A{i}:** {qa['a']}")

    if not st.session_state.interview_done and st.session_state.session_id:
        st.info(f"Question {st.session_state.current_index} of up to {st.session_state.current_max}")
        st.markdown(f"### {st.session_state.current_question}")
        if st.session_state.current_why:
            st.caption(st.session_state.current_why)

        answer = st.text_area("Founder's answer", key=f"answer_{st.session_state.current_index}")

        c1, c2, c3 = st.columns([1, 1, 2])
        with c1:
            if st.button("Back", disabled=not st.session_state.qa_log):
                data = api_post("/api/signup/interview/back", {"session_id": st.session_state.session_id})
                if data is not None:
                    st.session_state.current_question = data["question"]
                    st.session_state.current_index = data["index"]
                    st.session_state.current_max = data["max"]
                    if st.session_state.qa_log:
                        st.session_state.qa_log.pop()
                    show_raw("interview/back", data)
                    st.rerun()
        with c2:
            if st.button("Submit answer", type="primary"):
                if not answer.strip():
                    st.warning("Enter an answer first.")
                else:
                    data = api_post("/api/signup/interview/answer", {
                        "session_id": st.session_state.session_id,
                        "answer": answer,
                        "language_code": st.session_state.language_code,
                    })
                    if data is not None:
                        st.session_state.qa_log.append({"q": st.session_state.current_question, "a": answer})
                        show_raw("interview/answer", data)
                        if data.get("done"):
                            st.session_state.interview_done = True
                        else:
                            st.session_state.current_question = data["question"]
                            st.session_state.current_why = data.get("why", "")
                            st.session_state.current_index = data["index"]
                            st.session_state.current_max = data["max"]
                        st.rerun()

    if st.session_state.interview_done:
        st.success("Interview marked done by the backend.")
        if st.button("Generate OS Blueprint →", type="primary"):
            st.session_state.step = "blueprint"
            st.rerun()

# ---------------------------------------------------------------------------
# Step 4 — Blueprint + refinement
# ---------------------------------------------------------------------------
elif st.session_state.step == "blueprint":
    st.subheader("4. OS blueprint")

    if st.session_state.blueprint is None:
        data = api_post("/api/signup/interview/blueprint", {
            "session_id": st.session_state.session_id,
            "language_code": st.session_state.language_code,
        })
        if data is not None:
            st.session_state.blueprint = data
            show_raw("interview/blueprint", data)
            st.rerun()

    bp = st.session_state.blueprint
    if bp:
        st.markdown(f"> {bp.get('welcome_line', '')}")
        col1, col2 = st.columns(2)
        with col1:
            st.write("**Departments**")
            st.write(bp.get("departments") or [])
            st.write("**Workflows**")
            st.write([w.get("name") for w in (bp.get("workflows") or [])])
        with col2:
            st.write("**Approval rules**")
            if bp.get("approval_rules"):
                st.table(bp["approval_rules"])
            st.write("**Products**")
            if bp.get("products"):
                st.table(bp["products"])
        st.write("**Operational tasks**")
        if bp.get("operational_tasks"):
            st.table(bp["operational_tasks"])

        st.divider()
        st.markdown("**Refine** (founder correction after seeing the draft)")
        st.session_state.refinement_text = st.text_area("Refinement", st.session_state.refinement_text)
        if st.button("Submit refinement", type="primary"):
            if not st.session_state.refinement_text.strip():
                st.warning("Enter a refinement first.")
            else:
                data = api_post("/api/signup/interview/refine", {
                    "session_id": st.session_state.session_id,
                    "refinement": st.session_state.refinement_text,
                    "language_code": st.session_state.language_code,
                })
                if data is not None:
                    st.session_state.blueprint = data
                    show_raw("interview/refine", data)
                    st.rerun()

    st.divider()
    if st.button("Continue to Registration (optional) →"):
        st.session_state.step = "register"
        st.rerun()

# ---------------------------------------------------------------------------
# Step 5 — Registration (optional, creates a real account)
# ---------------------------------------------------------------------------
elif st.session_state.step == "register":
    st.subheader("5. Registration")
    st.warning(
        "This calls the real POST /api/auth/register endpoint and will create "
        "an actual tenant + user in whatever database the backend at the Base "
        "URL is pointed at. Only continue if that's a test/dev database."
    )

    name = st.text_input("Founder name for the account", st.session_state.founder_name)
    email = st.text_input("Email", st.session_state.email)
    password = st.text_input("Password", st.session_state.password, type="password")
    phone = st.text_input("Phone", st.session_state.phone)

    if st.button("Register", type="primary"):
        if not (name and email and password):
            st.warning("Name, email, and password are required.")
        else:
            world = st.session_state.world or {}
            bp = st.session_state.blueprint or {}
            payload = {
                "company_name": st.session_state.company_name,
                "name": name,
                "email": email,
                "password": password,
                "phone": phone,
                "industry": st.session_state.manual_industry or world.get("industry", ""),
                "description": st.session_state.description,
                "company_size": st.session_state.team_size,
                "products": bp.get("products") or world.get("products") or [],
                "os_blueprint": {
                    "departments": bp.get("departments"),
                    "workflows": bp.get("workflows"),
                    "operational_tasks": bp.get("operational_tasks"),
                    "approval_rules": bp.get("approval_rules"),
                },
            }
            data = api_post("/api/auth/register", payload)
            if data is not None:
                st.session_state.register_result = data
                show_raw("auth/register", data)

    if st.session_state.register_result:
        st.success("Registered.")
        st.write("**os_summary:**", st.session_state.register_result.get("os_summary"))
        st.write("**tenant:**", st.session_state.register_result.get("tenant", {}).get("name"))

    st.divider()
    if st.button("← Back to Blueprint"):
        st.session_state.step = "blueprint"
        st.rerun()
