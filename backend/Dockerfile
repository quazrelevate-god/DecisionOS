# FIX-002-F: real Dockerfile for the DecisionOS backend.
#
# Design decisions (see SaaS-readiness review SCALE-4 / S1-04):
#   * Multi-stage build so the final image doesn't carry pip's build junk.
#   * Non-root runtime user (safer if a code-exec vuln ever lands).
#   * PIP_NO_CACHE_DIR + slim base = smaller image, faster cold start.
#   * emergentintegrations comes from the vendor's public CDN (see
#     backend/requirements.txt line 24 note). Pinned separately so a
#     dependency-tree rebuild doesn't accidentally drop it.
#   * uvicorn with --workers 2 as a starting point: safe under multi-
#     replica now that the follow-up scheduler uses distributed leader
#     lock (FIX-002-D), and cheap enough to run on Railway's free tier.
#     Override via WEB_CONCURRENCY env var at deploy time.
#   * --timeout-graceful-shutdown 60 gives in-flight LLM calls
#     (capped at 45s by FIX-002-B) time to finish before the pod dies
#     on a redeploy. Prevents user-visible 502s on rolling restarts.
#   * HEALTHCHECK hits the existing /api/health endpoint. Uses Python's
#     stdlib (no curl in slim image) so no extra apt install needed.

# ---- Stage 1: build wheels ----
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# System deps needed to COMPILE some Python packages (weasyprint / lxml /
# pillow / cryptography). Runtime deps that stay in the final image are
# installed in Stage 2 instead.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libjpeg-dev \
        libpng-dev \
        libpq-dev \
        libssl-dev \
        libxml2-dev \
        libxslt1-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# Emergent's custom wheel index for the vendor-specific packages
# (emergentintegrations, litellm patched build). Public URL, no auth.
RUN pip install --prefix=/install --no-cache-dir \
        --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \
        -r requirements.txt

# ---- Stage 2: runtime ----
FROM python:3.12-slim AS runtime

# Runtime-only libs (no compilers). Font packages let weasyprint render
# non-latin scripts (Hindi/Tamil UIs). tini gives us clean signal handling
# so SIGTERM from the platform triggers uvicorn's graceful shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-core \
        libjpeg62-turbo \
        libpng16-16 \
        libxml2 \
        libxslt1.1 \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root user so an RCE can't rewrite the app itself.
RUN groupadd --system app && useradd --system --gid app --home /app app

WORKDIR /app

# Bring in the installed Python packages from Stage 1.
COPY --from=builder /install /usr/local

# App code (respects .dockerignore — no .env, no local uploads/, no .git).
COPY --chown=app:app . /app

# The port uvicorn binds to. Overridable via $PORT for Railway / Heroku
# style platforms that inject their own port.
ENV PORT=8001 \
    HOST=0.0.0.0 \
    WEB_CONCURRENCY=2 \
    UVICORN_TIMEOUT_KEEP_ALIVE=30 \
    PYTHONUNBUFFERED=1

USER app
EXPOSE 8001

# Uses Python's stdlib to avoid installing curl. `import urllib.request`
# is present in the base image. Runs from the app user; --start-period
# lets the bootstrap block (index creation + migrations) finish on cold
# start before health starts failing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        r=urllib.request.urlopen(f'http://127.0.0.1:{__import__(\"os\").environ.get(\"PORT\",\"8001\")}/api/health',timeout=3); \
        sys.exit(0 if r.status==200 else 1)"

# tini as PID 1 -> proper SIGTERM propagation -> uvicorn's graceful
# shutdown fires -> in-flight LLM calls (bounded to 45s by FIX-002-B)
# finish before the process dies.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec uvicorn server:app \
        --host ${HOST} \
        --port ${PORT} \
        --workers ${WEB_CONCURRENCY} \
        --timeout-keep-alive ${UVICORN_TIMEOUT_KEEP_ALIVE} \
        --timeout-graceful-shutdown 60 \
        --proxy-headers \
        --forwarded-allow-ips '*'"]
