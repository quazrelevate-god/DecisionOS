"""Streamlit UI over the extracted onboarding logic — styled to match the real
DecisionOS founder onboarding (brutalist: ink/red/yellow on paper, Geist + IBM
Plex Mono, uppercase headlines, mono eyebrows, the Dex mascot, progress dots).

Standalone: no FastAPI, no MongoDB. All state in st.session_state; all LLM +
voice calls go directly through onboarding.py using the keys in ./ .env.

Run:  streamlit run streamlit_onboarding/app.py
"""
import streamlit as st

import onboarding as ob

st.set_page_config(page_title="DecisionOS · Onboarding", page_icon="🟥", layout="centered")

# ---------------------------------------------------------------------------
# Brand tokens (from frontend/tailwind.config.js + index.css)
# ---------------------------------------------------------------------------
INK = "#0A0A0B"
RED = "#FF3B30"
YELLOW = "#FFCC00"
PAPER = "#F4F4F5"
MUTED = "#52525b"

PHASES = [("basics", "Basics"), ("website", "Your world"),
          ("interview", "Interview"), ("blueprint", "Your OS")]
SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"]
MODELS = ob.BUSINESS_MODELS


def inject_css():
    st.markdown(f"""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Chivo:wght@700;800;900&family=Geist:wght@300;400;500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

    .stApp {{ background: {PAPER}; }}
    [data-testid="stHeader"], [data-testid="stToolbar"], #MainMenu, footer {{ display: none !important; }}
    .block-container {{ max-width: 900px; padding-top: 1.2rem; padding-bottom: 3rem; }}
    html, body, [class*="css"] {{ font-family: 'Geist', system-ui, sans-serif; color: {INK}; }}

    /* ---- headline system ---- */
    .dos-eyebrow {{ font-family:'IBM Plex Mono',monospace; text-transform:uppercase; letter-spacing:.14em;
        font-size:.72rem; font-weight:600; color:{RED}; margin:.2rem 0 .55rem; display:flex; gap:.6rem; align-items:center; }}
    .dos-eyebrow .num {{ color:{MUTED}; }}
    .dos-h1 {{ font-family:'Geist',sans-serif; font-weight:900; text-transform:uppercase; letter-spacing:-.03em;
        line-height:1.02; font-size:2.55rem; color:{INK}; margin:0 0 .35rem; }}
    .dos-sub {{ color:{MUTED}; font-size:.92rem; margin:0 0 1.4rem; line-height:1.5; }}
    .dos-mono {{ font-family:'IBM Plex Mono',monospace; font-size:.75rem; color:{MUTED}; }}

    /* ---- buttons ---- */
    .stButton > button {{ font-family:'IBM Plex Mono',monospace; text-transform:uppercase; letter-spacing:.08em;
        font-weight:600; font-size:.72rem; border:1px solid {INK}; border-radius:0; background:{INK}; color:#fff;
        padding:.72rem 1.3rem; box-shadow:0 1px 2px rgba(10,10,11,.06); transition:transform .15s, box-shadow .15s; }}
    .stButton > button:hover {{ transform:translateY(-2px); box-shadow:0 8px 20px -8px rgba(10,10,11,.28);
        background:{INK}; color:#fff; border-color:{INK}; }}
    .stButton > button[kind="primary"], [data-testid="stBaseButton-primary"] {{ background:{RED}; border-color:{INK}; color:#fff; }}
    .stButton > button[kind="primary"]:hover, [data-testid="stBaseButton-primary"]:hover {{ background:{RED}; }}
    .stButton > button:disabled {{ opacity:.4; transform:none; }}

    /* ---- inputs ---- */
    .stTextInput input, .stTextArea textarea {{ border-radius:0 !important; border:1px solid {INK} !important;
        background:#fff !important; font-family:'Geist',sans-serif !important; color:{INK} !important; font-size:1rem; }}
    .stTextInput input:focus, .stTextArea textarea:focus {{ border-color:{RED} !important; box-shadow:none !important; }}
    .stTextInput label, .stTextArea label, .stSelectbox label {{ font-family:'IBM Plex Mono',monospace !important;
        text-transform:uppercase; letter-spacing:.1em; font-size:.7rem !important; color:{MUTED} !important; font-weight:500 !important; }}
    .stSelectbox div[data-baseweb="select"] > div {{ border-radius:0 !important; border:1px solid {INK} !important;
        background:#fff !important; font-family:'IBM Plex Mono',monospace; }}

    /* ---- chips (radio) ---- */
    div[role="radiogroup"] {{ gap:.55rem !important; flex-wrap:wrap; }}
    div[role="radiogroup"] > label {{ border:1px solid {INK}; padding:.5rem 1.05rem; margin:0 !important; background:#fff;
        border-radius:0; cursor:pointer; font-family:'IBM Plex Mono',monospace; text-transform:uppercase;
        font-size:.72rem; letter-spacing:.06em; font-weight:600; transition:all .15s; }}
    div[role="radiogroup"] > label:hover {{ transform:translateY(-1px); box-shadow:0 6px 14px -8px rgba(10,10,11,.3); }}
    div[role="radiogroup"] > label:has(input:checked) {{ background:{INK}; color:#fff; }}
    div[role="radiogroup"] > label > div:first-child {{ display:none !important; }}

    /* ---- cards / containers ---- */
    [data-testid="stVerticalBlockBorderWrapper"] {{ border-radius:0 !important; }}
    .dos-card {{ border:1px solid {INK}; background:#fff; padding:1.3rem 1.4rem; color:{INK};
        box-shadow:0 1px 2px rgba(10,10,11,.04), 0 4px 16px -6px rgba(10,10,11,.08); margin-bottom:1rem; }}
    .dos-card p {{ color:{INK}; }}
    .dos-chip {{ display:inline-block; border:1px solid {INK}; padding:.32rem .7rem; margin:.15rem; color:{INK};
        font-family:'IBM Plex Mono',monospace; font-size:.72rem; background:#fff; }}
    .dos-chip.yellow {{ background:{YELLOW}33; }}
    .dos-chip.paper {{ background:{PAPER}; }}

    /* ---- top header ---- */
    .dos-top {{ display:flex; align-items:center; justify-content:space-between; padding:.2rem 0 1.1rem;
        border-bottom:1px solid rgba(10,10,11,.12); margin-bottom:1.8rem; }}
    .dos-logo {{ display:flex; align-items:center; gap:.55rem; }}
    .dos-logo .mark {{ width:30px; height:30px; background:{RED}; display:flex; align-items:center; justify-content:center; }}
    .dos-logo .mark span {{ font-family:'Chivo',sans-serif; font-weight:900; color:#fff; font-size:1.05rem; }}
    .dos-logo .word {{ font-family:'Chivo',sans-serif; font-weight:900; text-transform:uppercase; letter-spacing:-.02em; font-size:1.05rem; color:{INK}; }}
    .dos-logo .word .os {{ color:{RED}; }}
    .dos-phases {{ display:flex; gap:1.15rem; }}
    .dos-phase {{ display:flex; align-items:center; gap:.45rem; }}
    .dos-seg {{ width:22px; height:6px; border:1px solid {INK}; }}
    .dos-seg.done {{ background:{INK}; }}
    .dos-seg.now {{ background:{RED}; }}
    .dos-seg.todo {{ background:#fff; }}
    .dos-phase .lbl {{ font-family:'IBM Plex Mono',monospace; font-size:.62rem; text-transform:uppercase; letter-spacing:.1em; color:{MUTED}; }}
    .dos-phase.now .lbl {{ color:{INK}; font-weight:600; }}

    /* ---- interview orb ---- */
    .dos-orb-wrap {{ display:flex; align-items:center; gap:1rem; margin-bottom:1.4rem; }}
    .dos-orb {{ position:relative; width:58px; height:58px; flex:none; }}
    .dos-orb .ring {{ position:absolute; inset:0; border-radius:50%; border:2px solid {RED}; animation:orbpulse 1.7s ease-in-out infinite; }}
    .dos-orb .core {{ position:absolute; inset:6px; border-radius:50%; border:1px solid {INK}; background:{INK}; color:#fff;
        display:flex; align-items:center; justify-content:center; font-size:1.2rem; }}
    @keyframes orbpulse {{ 0%,100%{{ transform:scale(1); opacity:.7; }} 50%{{ transform:scale(1.12); opacity:.3; }} }}
    .dos-orb-name {{ font-family:'Geist',sans-serif; font-weight:900; text-transform:uppercase; letter-spacing:-.01em; font-size:.95rem; color:{INK}; }}

    .dos-dots {{ display:flex; gap:.4rem; }}
    .dos-dot {{ width:30px; height:6px; border:1px solid {INK}; }}
    .dos-dot.done {{ background:{INK}; }} .dos-dot.now {{ background:{RED}; }} .dos-dot.todo {{ background:#fff; }}

    /* ---- Dex mascot ---- */
    .dex {{ position:relative; width:220px; height:170px; margin:1.2rem auto .4rem; }}
    .dex .floor {{ position:absolute; bottom:12px; left:8px; right:8px; border-bottom:2px solid {INK}; }}
    .dex .bot {{ position:absolute; left:28px; bottom:14px; width:92px; height:120px; animation:bob 2s ease-in-out infinite; }}
    @keyframes bob {{ 0%,100%{{ transform:translateY(0); }} 50%{{ transform:translateY(-3px); }} }}
    .dex .ant {{ position:absolute; left:50%; transform:translateX(-50%); top:0; width:2px; height:15px; background:{INK}; }}
    .dex .bulb {{ position:absolute; left:50%; transform:translateX(-50%); top:-8px; width:11px; height:11px; border-radius:50%;
        background:{RED}; border:1px solid {INK}; animation:blinkbulb 1.2s infinite; }}
    @keyframes blinkbulb {{ 0%,100%{{ transform:translateX(-50%) scale(1); opacity:1; }} 50%{{ transform:translateX(-50%) scale(1.3); opacity:.6; }} }}
    .dex .head {{ position:absolute; top:12px; left:50%; transform:translateX(-50%); width:60px; height:44px; background:#fff;
        border:2px solid {INK}; display:flex; align-items:center; justify-content:center; gap:9px; }}
    .dex .eye {{ width:8px; height:10px; background:{INK}; border-radius:2px; animation:blink 3.4s infinite; }}
    @keyframes blink {{ 0%,45%,55%,100%{{ transform:scaleY(1); }} 50%{{ transform:scaleY(.1); }} }}
    .dex .body {{ position:absolute; top:58px; left:50%; transform:translateX(-50%); width:74px; height:52px; background:{INK};
        border:2px solid {INK}; display:flex; align-items:center; justify-content:center; }}
    .dex .gear {{ width:16px; height:16px; background:{YELLOW}; border:1px solid {INK}; animation:spin 3.2s ease-in-out infinite; }}
    @keyframes spin {{ from{{ transform:rotate(0); }} to{{ transform:rotate(360deg); }} }}
    .dex .arm {{ position:absolute; top:62px; right:-14px; width:38px; height:7px; background:{INK}; transform-origin:left center; animation:hammer .9s ease-in-out infinite; }}
    .dex .arm .hammer {{ position:absolute; right:-6px; top:-9px; width:13px; height:26px; background:{RED}; border:2px solid {INK}; }}
    @keyframes hammer {{ 0%,100%{{ transform:rotate(-32deg); }} 50%{{ transform:rotate(20deg); }} }}
    .dex .leg {{ position:absolute; bottom:0; width:9px; height:15px; background:{INK}; }}
    .dex .leg.l {{ left:18px; }} .dex .leg.r {{ right:18px; }}
    .dex .blk {{ position:absolute; right:26px; width:34px; height:34px; border:2px solid {INK}; }}
    .dex .blk.b0 {{ bottom:14px; background:#fff; animation:stack 4s infinite; }}
    .dex .blk.b1 {{ bottom:48px; background:{YELLOW}; animation:stack 4s infinite 1.3s; }}
    .dex .blk.b2 {{ bottom:82px; background:{RED}; animation:stack 4s infinite 2.6s; }}
    @keyframes stack {{ 0%{{ opacity:0; transform:translateY(-26px); }} 12%,92%{{ opacity:1; transform:translateY(0); }} 100%{{ opacity:1; }} }}

    /* ---- contrast hardening: force readable dark text on native widgets even in OS dark mode ---- */
    html {{ color-scheme: light; }}
    .stApp, .stApp .stMarkdown {{ color:{INK}; }}
    div[role="radiogroup"] > label, div[role="radiogroup"] > label * {{ color:{INK} !important; }}
    div[role="radiogroup"] > label:has(input:checked), div[role="radiogroup"] > label:has(input:checked) * {{ color:#fff !important; }}
    .stTextInput label, .stTextArea label, .stSelectbox label, .stRadio label {{ color:#3f3f46 !important; }}
    .stTextInput input, .stTextArea textarea {{ color:{INK} !important; }}
    .stSelectbox div[data-baseweb="select"] div {{ color:{INK} !important; }}
    [data-baseweb="popover"] li, [data-baseweb="menu"] li {{ color:{INK} !important; background:#fff !important; }}
    [data-testid="stCaptionContainer"], [data-testid="stCaptionContainer"] * {{ color:#52525b !important; }}
    [data-testid="stExpander"] summary, [data-testid="stExpander"] summary *,
    [data-testid="stExpander"] [data-testid="stMarkdownContainer"] p {{ color:{INK} !important; }}
    .stAlert p, .stAlert div {{ color:{INK} !important; }}
    .stTextInput input::placeholder, .stTextArea textarea::placeholder {{ color:#9a9aa2 !important; }}
    </style>
    """, unsafe_allow_html=True)


def top_header(active_key):
    idx = [k for k, _ in PHASES].index(active_key) if active_key in [k for k, _ in PHASES] else 0
    segs = ""
    for i, (k, label) in enumerate(PHASES):
        cls = "done" if i < idx else ("now" if i == idx else "todo")
        segs += (f'<div class="dos-phase {"now" if i==idx else ""}">'
                 f'<div class="dos-seg {cls}"></div><div class="lbl">{label}</div></div>')
    st.markdown(f"""
    <div class="dos-top">
      <div class="dos-logo"><div class="mark"><span>D</span></div>
        <div class="word">Decision<span class="os">OS</span></div></div>
      <div class="dos-phases">{segs}</div>
      <div class="dos-mono">standalone</div>
    </div>
    """, unsafe_allow_html=True)


def eyebrow(text, num=None):
    n = f'<span class="num">{num}</span>' if num else ""
    st.markdown(f'<div class="dos-eyebrow">{n}{text}</div>', unsafe_allow_html=True)


def headline(text):
    st.markdown(f'<div class="dos-h1">{text}</div>', unsafe_allow_html=True)


def sub(text):
    st.markdown(f'<div class="dos-sub">{text}</div>', unsafe_allow_html=True)


def dex_mascot():
    st.markdown("""
    <div class="dex">
      <div class="floor"></div>
      <div class="blk b0"></div><div class="blk b1"></div><div class="blk b2"></div>
      <div class="bot">
        <div class="ant"></div><div class="bulb"></div>
        <div class="head"><div class="eye"></div><div class="eye"></div></div>
        <div class="body"><div class="gear"></div></div>
        <div class="arm"><div class="hammer"></div></div>
        <div class="leg l"></div><div class="leg r"></div>
      </div>
    </div>
    """, unsafe_allow_html=True)


def init_state():
    d = {
        "step": "basics",
        "company_name": "", "founder_name": "", "email": "", "team_size": "1-10",
        "language_code": "en-IN", "website_url": "",
        "world": None, "world_url": "",
        "manual_industry": "", "manual_business_model": "", "description": "",
        "iv_phase": "pick", "iv_session": None,
        "iv_question": "", "iv_why": "", "iv_index": 0, "iv_max": 0,
        "iv_done": False, "iv_qa_log": [],
        "blueprint": None, "refinement_text": "", "refine_box": "", "wf_nonce": 0, "last_error": "",
    }
    for k, v in d.items():
        st.session_state.setdefault(k, v)


def hard_reset():
    for k in list(st.session_state.keys()):
        del st.session_state[k]
    init_state()


def goto(step):
    st.session_state.step = step
    st.rerun()


inject_css()
init_state()

# --------------------------------------------------------------------------
# Sidebar — branded, key status
# --------------------------------------------------------------------------
with st.sidebar:
    st.markdown('<div class="dos-eyebrow">Test harness</div>', unsafe_allow_html=True)
    st.caption("Standalone onboarding — no backend. Keys from `streamlit_onboarding/.env`.")
    st.markdown(
        f"- LLM (Anthropic): {'✅' if ob.ANTHROPIC_KEY else '—'}\n"
        f"- LLM (Emergent): {'✅' if ob.EMERGENT_LLM_KEY else '—'}\n"
        f"- Voice (Sarvam): {'✅' if ob.SARVAM_KEY else '—'}"
    )
    if not (ob.ANTHROPIC_KEY or ob.EMERGENT_LLM_KEY):
        st.error("No LLM key found. Fill in `.env`.")
    if st.button("Reset session", use_container_width=True):
        hard_reset()
        st.rerun()

top_header(st.session_state.step)

if st.session_state.last_error:
    st.error(st.session_state.last_error)

# ==========================================================================
# STEP 1 — BASICS
# ==========================================================================
if st.session_state.step == "basics":
    eyebrow("Your company", "01")
    headline("Let's set up your workspace.")
    sub("A few basics, then Dex reads your website and interviews you — we build your OS around how you actually run.")

    c1, c2 = st.columns(2)
    with c1:
        st.session_state.company_name = st.text_input("Company name", st.session_state.company_name, placeholder="e.g. Sharma Textiles")
        st.session_state.founder_name = st.text_input("Your name", st.session_state.founder_name, placeholder="Full name")
    with c2:
        st.session_state.email = st.text_input("Work email", st.session_state.email, placeholder="you@company.com")
        st.markdown('<div style="height:.35rem"></div>', unsafe_allow_html=True)

    st.markdown('<div class="dos-eyebrow" style="margin-top:1rem">How many people work here?</div>', unsafe_allow_html=True)
    # `key=` lets the widget own its selection so a click never resets to the
    # previous option on rerun. (init_state seeds team_size to a valid SIZES value.)
    st.radio("team", SIZES, key="team_size", horizontal=True, label_visibility="collapsed")

    st.markdown('<div style="height:1rem"></div>', unsafe_allow_html=True)
    if st.button("Continue  →", type="primary", disabled=not st.session_state.company_name.strip()):
        goto("website")

# ==========================================================================
# STEP 2 — WEBSITE INTELLIGENCE
# ==========================================================================
elif st.session_state.step == "website":
    company = st.session_state.company_name.strip() or "your company"
    eyebrow("Your world")
    headline(f"Does {company} live on the web?")
    sub("Drop your website — our AI reads it so you don't have to explain yourself twice.")

    st.session_state.website_url = st.text_input(
        "Company website", st.session_state.website_url, placeholder="yourcompany.com", label_visibility="collapsed",
        help="Analysis runs automatically once you press Enter or click out of the field.")

    current_url = st.session_state.website_url.strip()

    # State machine: idle | loading | success | error. Prevents the previous
    # infinite-retry bug where a failed analysis kept re-triggering itself
    # on every Streamlit rerun (world_url wasn't being locked on failure).
    # Now we ALWAYS lock world_url after an attempt — retry is explicit via
    # the "Try analyzing again" button below.
    st.session_state.setdefault("website_analysis_status", "idle")

    if current_url and current_url != st.session_state.get("world_url", ""):
        st.session_state.website_analysis_status = "loading"
        with st.spinner("Reading your website…"):
            try:
                result = ob.analyze_website(current_url, st.session_state.company_name)
                st.session_state.world = result
                if isinstance(result, dict) and result.get("fetched"):
                    st.session_state.website_analysis_status = "success"
                    st.session_state.last_error = ""
                else:
                    st.session_state.website_analysis_status = "error"
                    st.session_state.last_error = (result or {}).get("error") or (result or {}).get("reason") or "analysis_failed"
            except ob.LLMError as e:
                st.session_state.world = {"fetched": False, "reason": "llm_error", "error": str(e)}
                st.session_state.website_analysis_status = "error"
                st.session_state.last_error = str(e)
            except Exception as e:
                st.session_state.world = {"fetched": False, "reason": "exception",
                                          "error": f"{type(e).__name__}: {e}"}
                st.session_state.website_analysis_status = "error"
                st.session_state.last_error = f"{type(e).__name__}: {e}"
            finally:
                # ALWAYS lock world_url to this URL after an attempt. Without
                # this, a failure leaves world_url stale, so the very next
                # Streamlit rerun re-enters this block and re-runs analysis
                # — an infinite "Reading your website…" spinner loop.
                st.session_state.world_url = current_url
        st.rerun()

    world = st.session_state.world

    # Visible failure card when analysis didn't succeed. Previously silent,
    # which is why the Industry dropdown stayed at "Choose an option" with
    # no explanation. Also offers a Retry button.
    if world and not world.get("fetched"):
        reason = world.get("reason", "unknown")
        friendly = {
            "empty_url":        "Enter a website URL to analyze.",
            "fetch_failed":     "Couldn't reach that website. Check the URL and try again.",
            "too_little_text":  "That page has very little readable text (often the case for JS-only single-page apps). Try a different page URL, or fill the fields manually below.",
            "analysis_failed":  "The AI couldn't read the page this time. Try again or fill the fields manually below.",
            "llm_error":        "The AI is temporarily unavailable. Try again or fill the fields manually below.",
            "exception":        "Something went wrong while reading the page. Try again or fill the fields manually below.",
        }.get(reason, "The website analysis did not complete. Fill the fields manually below.")
        err_detail = world.get("error") or ""
        st.markdown(
            f'<div class="dos-card" style="border-color:#FF3B30">'
            f'<p style="color:#FF3B30;margin:0 0 .3rem;font-weight:600">⚠ Website analysis didn\'t auto-fill the fields</p>'
            f'<p style="margin:0 0 .4rem;font-size:.9rem">{friendly}</p>'
            f'{"<p style=font-size:.75rem;color:#6b6b73;margin:0>detail: " + err_detail + "</p>" if err_detail else ""}'
            f'</div>',
            unsafe_allow_html=True,
        )
        if st.button("Try analyzing again", key="retry_website_intel"):
            # Force re-run by resetting the tracker.
            st.session_state.world_url = ""
            st.rerun()

    if world and world.get("fetched"):
        eyebrow("We did our homework")
        chips = ""
        for p in (world.get("products") or []):
            chips += f'<span class="dos-chip yellow">{p.get("name","")}</span>'
        hl = ""
        for h in (world.get("highlights") or []):
            hl += f'<div style="font-size:.85rem;margin:.2rem 0;color:{INK}">✓ {h}</div>'
        st.markdown(f"""
        <div class="dos-card">
          <p style="font-size:1rem;line-height:1.55;margin:0 0 .6rem">{world.get('summary','')}</p>
          {hl}
          <div style="margin-top:.6rem">{chips}</div>
        </div>""", unsafe_allow_html=True)

    st.markdown('<div class="dos-eyebrow" style="margin-top:.6rem">Confirm the essentials</div>', unsafe_allow_html=True)
    # Auto-filled from the website analysis (world.industry / world.business_model).
    ind_default = st.session_state.manual_industry or (world or {}).get("industry", "")
    ind_opts = [""] + ob.INDUSTRIES
    st.session_state.manual_industry = st.selectbox(
        "Industry", ind_opts, index=ind_opts.index(ind_default) if ind_default in ind_opts else 0)

    st.markdown('<div class="dos-eyebrow">You sell to</div>', unsafe_allow_html=True)
    # Auto-select from the website analysis whenever a NEW site is analysed
    # (bm_seed_url tracks which site we already seeded for, so a manual pick
    # afterwards isn't overwritten, and analysing a different site re-seeds).
    if world and world.get("fetched") and world.get("business_model") in MODELS \
            and st.session_state.get("bm_seed_url") != st.session_state.get("world_url"):
        st.session_state.manual_business_model = world["business_model"]
        st.session_state.bm_seed_url = st.session_state.get("world_url")
    if st.session_state.manual_business_model not in MODELS:
        st.session_state.manual_business_model = MODELS[0]
    st.radio("model", MODELS, key="manual_business_model", horizontal=True, label_visibility="collapsed")

    # Auto-fill the description box with the AI-generated summary (still editable).
    # Re-seeds when a NEW website is analysed; the founder's edits persist otherwise.
    if world and world.get("fetched") and world.get("summary") \
            and st.session_state.get("desc_seed_url") != st.session_state.get("world_url"):
        st.session_state.description = world["summary"]
        st.session_state.desc_seed_url = st.session_state.get("world_url")
    st.text_area("Anything else about what you do? (optional)", key="description", height=80)

    st.markdown('<div style="height:.6rem"></div>', unsafe_allow_html=True)
    cc1, cc2 = st.columns([1, 3])
    with cc1:
        if st.button("←  Back"):
            goto("basics")
    with cc2:
        if st.button("That's us  →", type="primary", disabled=not st.session_state.manual_industry):
            goto("interview")

# ==========================================================================
# STEP 3 — ADAPTIVE INTERVIEW
# ==========================================================================
elif st.session_state.step == "interview":
    world = st.session_state.world or {}

    # ---- 3a: language pick ----
    if st.session_state.iv_session is None and st.session_state.iv_phase == "pick":
        eyebrow("Your interview")
        headline("Which language should Dex speak?")
        sub("Dex asks every question — voice and text — in the language you pick. Answer by speaking or typing.")
        langs = list(ob.SUPPORTED_TTS_LANGS.items())
        cols = st.columns(4)
        for i, (code, name) in enumerate(langs):
            with cols[i % 4]:
                if st.button(name, key=f"lang_{code}", use_container_width=True):
                    st.session_state.language_code = code
                    payload = {
                        "company_name": st.session_state.company_name,
                        "founder_name": st.session_state.founder_name,
                        "team_size": st.session_state.team_size,
                        "industry": st.session_state.manual_industry or world.get("industry", ""),
                        "business_model": st.session_state.manual_business_model or world.get("business_model", ""),
                        "description": st.session_state.description,
                        "website_summary": world.get("summary", ""),
                        "products": world.get("products") or [],
                        "language_code": code,
                    }
                    with st.spinner("Dex is warming up…"):
                        try:
                            r = ob.start_interview(payload)
                            st.session_state.iv_session = r["session"]
                            st.session_state.iv_question = r["question"]
                            st.session_state.iv_why = r["why"]
                            st.session_state.iv_index = r["index"]
                            st.session_state.iv_max = r["max"]
                            st.session_state.iv_phase = "live"
                            st.session_state.last_error = ""
                        except Exception as e:
                            st.session_state.last_error = f"{type(e).__name__}: {e}"
                    st.rerun()
        st.markdown('<div style="height:.5rem"></div>', unsafe_allow_html=True)
        if st.button("←  Back to Your world"):
            goto("website")

    # ---- 3b: live interview ----
    else:
        idx = st.session_state.iv_index
        mx = st.session_state.iv_max
        # Dex orb header
        st.markdown(f"""
        <div class="dos-orb-wrap">
          <div class="dos-orb"><div class="ring"></div><div class="core">🎙</div></div>
          <div>
            <div class="dos-orb-name">Dex · your COO interview</div>
            <div class="dos-mono">Question {idx} · up to {mx} · {ob.SUPPORTED_TTS_LANGS.get(st.session_state.language_code,'English')}</div>
          </div>
        </div>""", unsafe_allow_html=True)

        if not st.session_state.iv_done:
            st.markdown('<div class="dos-mono" style="text-transform:uppercase;letter-spacing:.14em;margin-bottom:.4rem">Read or listen</div>', unsafe_allow_html=True)
            headline(st.session_state.iv_question)
            if st.session_state.iv_why:
                st.markdown(f'<div class="dos-mono" style="margin-bottom:1rem">Why we ask — {st.session_state.iv_why}</div>', unsafe_allow_html=True)

            if ob.SARVAM_KEY:
                if st.button("🔊  Play question", key=f"tts_{idx}"):
                    with st.spinner("Fetching audio…"):
                        try:
                            audio, _ = ob.speak(st.session_state.iv_question, st.session_state.language_code)
                            st.session_state[f"tts_audio_{idx}"] = audio
                            st.session_state.last_error = ""
                        except ob.VoiceError as e:
                            st.session_state.last_error = f"TTS: {e}"
                    st.rerun()
                if st.session_state.get(f"tts_audio_{idx}"):
                    st.audio(st.session_state[f"tts_audio_{idx}"], format="audio/wav", autoplay=True)

            # answer box
            answer_key = f"answer_{idx}"
            pending_key = f"pending_transcript_{idx}"
            if pending_key in st.session_state:
                st.session_state[answer_key] = st.session_state.pop(pending_key)
            answer = st.text_area("Your answer", key=answer_key,
                                  placeholder="Tap the mic and speak, or type your answer…", height=110)

            if ob.SARVAM_KEY:
                rec = st.audio_input("🎤 Or record your answer", key=f"rec_{idx}")
                if rec is not None and st.button("Transcribe recording → answer box", key=f"tr_{idx}"):
                    with st.spinner("Transcribing (Sarvam saaras:v3)…"):
                        try:
                            transcript, detected = ob.transcribe(rec.getvalue(), rec.name or "answer.wav", rec.type or "audio/wav")
                            st.session_state[pending_key] = transcript
                            if detected and detected != st.session_state.language_code:
                                st.info(f"Detected `{detected}` — translated to English by STT (same as backend).")
                            st.session_state.last_error = ""
                        except ob.VoiceError as e:
                            st.session_state.last_error = f"STT: {e}"
                    st.rerun()

            # dots + controls
            dots = ""
            for i in range(mx):
                c = "done" if i + 1 < idx else ("now" if i + 1 == idx else "todo")
                dots += f'<span class="dos-dot {c}"></span>'
            st.markdown(f'<div style="height:.4rem"></div><div class="dos-dots">{dots}</div>', unsafe_allow_html=True)

            b1, b2, b3 = st.columns([1, 1, 2])
            with b1:
                if st.button("←  Back", disabled=not st.session_state.iv_qa_log):
                    try:
                        r = ob.back_question(st.session_state.iv_session)
                        st.session_state.iv_question = r["question"]
                        st.session_state.iv_index = r["index"]
                        st.session_state.iv_max = r["max"]
                        if st.session_state.iv_qa_log:
                            st.session_state.iv_qa_log.pop()
                    except Exception as e:
                        st.session_state.last_error = f"{type(e).__name__}: {e}"
                    st.rerun()
            with b3:
                if st.button("Answer  →", type="primary"):
                    if not answer.strip():
                        st.warning("Type or transcribe an answer first.")
                    else:
                        with st.spinner("Dex is thinking…"):
                            try:
                                r = ob.answer_question(st.session_state.iv_session, answer, st.session_state.language_code)
                                st.session_state.iv_qa_log.append({"q": st.session_state.iv_question, "a": answer})
                                if r.get("done"):
                                    st.session_state.iv_done = True
                                else:
                                    st.session_state.iv_question = r["question"]
                                    st.session_state.iv_why = r["why"]
                                    st.session_state.iv_index = r["index"]
                                    st.session_state.iv_max = r["max"]
                                st.session_state.last_error = ""
                            except Exception as e:
                                st.session_state.last_error = f"{type(e).__name__}: {e}"
                        st.rerun()

        else:
            headline("That's everything Dex needs.")
            sub("Dex has a clear operational picture. Time to build your OS.")
            if st.button("Build my OS  →", type="primary"):
                goto("blueprint")

        # transcript
        if st.session_state.iv_qa_log:
            with st.expander(f"Transcript · {len(st.session_state.iv_qa_log)} answered"):
                for i, qa in enumerate(st.session_state.iv_qa_log, 1):
                    st.markdown(f"**Q{i}:** {qa['q']}")
                    st.markdown(f"**A{i}:** {qa['a']}")

# ==========================================================================
# STEP 4 — BUILD & REVEAL
# ==========================================================================
elif st.session_state.step == "blueprint":
    if st.session_state.blueprint is None:
        eyebrow("Meet Dex — your build engineer", "✦")
        headline(f"Dex is building {st.session_state.company_name or 'your'} OS.")
        dex_mascot()
        st.markdown('<div class="dos-mono" style="text-align:center">Built from your answers — not a template.</div>', unsafe_allow_html=True)
        with st.spinner("Assembling your workspace…"):
            try:
                st.session_state.blueprint = ob.generate_blueprint(st.session_state.iv_session, st.session_state.language_code)
                st.session_state.last_error = ""
            except Exception as e:
                st.session_state.last_error = f"{type(e).__name__}: {e}"
        st.rerun()

    bp = st.session_state.blueprint
    if bp:
        eyebrow("Draft ready · review before you enter")
        headline(f"Here's how {st.session_state.company_name or 'you'} will run on DecisionOS.")
        if bp.get("welcome_line"):
            st.markdown(f'<p style="font-size:1.05rem;line-height:1.55;margin:0 0 1.2rem;max-width:640px;color:{INK}">{bp["welcome_line"]}</p>', unsafe_allow_html=True)

        # count cards
        counts = [
            (len(bp.get("departments") or []), "Departments"),
            (len(bp.get("workflows") or []), "Workflows"),
            (len(bp.get("operational_tasks") or []), "Recurring tasks"),
            (len(bp.get("approval_rules") or []), "Approval rules"),
        ]
        cells = ""
        for n, label in counts:
            cells += (f'<div style="border:1px solid {INK};background:#fff;padding:1rem;text-align:center;'
                      f'box-shadow:0 1px 2px rgba(10,10,11,.06)">'
                      f'<div style="font-family:Geist;font-weight:900;font-size:1.9rem;color:{INK}">{n}</div>'
                      f'<div class="dos-mono" style="text-transform:uppercase;letter-spacing:.1em;margin-top:.2rem">{label}</div></div>')
        st.markdown(f'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem;margin-bottom:1.4rem">{cells}</div>', unsafe_allow_html=True)

        def chip_block(title, items, klass):
            if not items:
                return
            chips = "".join(f'<span class="dos-chip {klass}">{s}</span>' for s in items[:10])
            st.markdown(f'<div class="dos-eyebrow" style="color:{MUTED}">{title}</div><div style="margin-bottom:1rem">{chips}</div>', unsafe_allow_html=True)

        chip_block("Departments", [d.get("label", "") for d in (bp.get("departments") or [])], "")
        chip_block("Workflows — named after how you actually work", [w.get("name", "") for w in (bp.get("workflows") or [])], "yellow")

        # --- Add a workflow (workflows only) ---
        st.markdown(f'<div class="dos-eyebrow" style="color:{MUTED};margin-top:-.3rem">Add a workflow</div>', unsafe_allow_html=True)
        aw1, aw2 = st.columns([4, 1.2])
        with aw1:
            st.text_input("new workflow", key=f"new_wf_{st.session_state.wf_nonce}",
                          placeholder="e.g. Weekly production review", label_visibility="collapsed")
        with aw2:
            if st.button("+  Add", use_container_width=True):
                name = (st.session_state.get(f"new_wf_{st.session_state.wf_nonce}") or "").strip()
                if name:
                    st.session_state.blueprint.setdefault("workflows", []).append({"name": name})
                    st.session_state.wf_nonce += 1  # fresh widget key -> clears the input
                    st.rerun()
                else:
                    st.warning("Type a workflow name first.")
        st.markdown('<div style="height:.7rem"></div>', unsafe_allow_html=True)

        chip_block("Recurring tasks Dex keeps on rails", [t.get("title", "") for t in (bp.get("operational_tasks") or [])][:8], "paper")

        if bp.get("approval_rules"):
            with st.expander("Approval rules Dex discovered"):
                for r in bp["approval_rules"]:
                    st.markdown(f"**{r.get('name','')}** — {r.get('description','')}")
        if bp.get("products"):
            with st.expander("Products"):
                for p in bp["products"]:
                    st.markdown(f"**{p.get('name','')}** — {p.get('description','')}")

        # refine — voice OR text (mirrors the real BuildReveal refine panel)
        st.markdown('<div class="dos-eyebrow" style="margin-top:.8rem">✎ Missing something? Tell Dex.</div>', unsafe_allow_html=True)
        # drain a voice transcript into the box BEFORE the widget renders (Streamlit
        # forbids assigning a widget's key after it is instantiated in the same run)
        if "pending_refine" in st.session_state:
            st.session_state.refine_box = st.session_state.pop("pending_refine")
        st.text_area("Speak or type any workflow, approval, or team detail Dex missed — he'll rewire the OS.",
                     key="refine_box", height=90,
                     placeholder="e.g. Every Monday I review pending orders; anything over ₹50k needs my approval.")

        if ob.SARVAM_KEY:
            rrec = st.audio_input("🎤 Or speak your refinement", key="refine_rec")
            if rrec is not None and st.button("Transcribe → refinement box", key="refine_tr"):
                with st.spinner("Transcribing (Sarvam saaras:v3)…"):
                    try:
                        tr, _ = ob.transcribe(rrec.getvalue(), rrec.name or "refine.wav", rrec.type or "audio/wav")
                        existing = st.session_state.get("refine_box", "")
                        st.session_state["pending_refine"] = (f"{existing} {tr}".strip() if existing else tr)
                        st.session_state.last_error = ""
                    except ob.VoiceError as e:
                        st.session_state.last_error = f"STT: {e}"
                st.rerun()

        rc1, rc2 = st.columns([1, 3])
        with rc1:
            if st.button("Apply to my OS"):
                if not st.session_state.get("refine_box", "").strip():
                    st.warning("Speak or type a refinement first.")
                else:
                    with st.spinner("Dex is rewiring your OS…"):
                        try:
                            st.session_state.blueprint = ob.refine_blueprint(
                                st.session_state.iv_session, st.session_state.refine_box, st.session_state.language_code)
                            st.session_state["pending_refine"] = ""  # clears the box next run
                            st.session_state.last_error = ""
                        except Exception as e:
                            st.session_state.last_error = f"{type(e).__name__}: {e}"
                    st.rerun()

        st.markdown('<div style="height:.6rem"></div>', unsafe_allow_html=True)
        bb1, bb2 = st.columns([1, 3])
        with bb1:
            if st.button("←  Interview"):
                goto("interview")
        with bb2:
            st.markdown('<div class="dos-mono" style="padding-top:.7rem">Registration is disabled in this test harness — nothing is saved.</div>', unsafe_allow_html=True)
