# DEPLOY-1 — the PWA as a container, for Railway.
#
# The frontend had no production serving story at all: `npm start` is CRA's
# dev server (webpack-dev-server, source maps, no compression, single
# connection) and must never face a client. This builds the static bundle and
# serves it behind a tiny static server instead.
#
# THREE THINGS HERE ARE LOAD-BEARING, each one a real failure if dropped:
#
#   1. ARG before the build. Create React App inlines every REACT_APP_* var at
#      BUILD time — there is no runtime config. So REACT_APP_BACKEND_URL has to
#      arrive as a build argument, not an environment variable on the running
#      container. Railway passes service variables to Docker builds as build
#      args, which is why this is an ARG that then becomes an ENV for the build
#      step. Change the backend URL and the frontend must be REBUILT, not
#      restarted.
#
#   2. CI=false. Railway sets CI=true in its build environment, and CRA turns
#      every eslint warning into a build error when CI is true. This project
#      compiles "with warnings" — verified — so a default build would fail on
#      the platform while succeeding locally, which is the worst kind of
#      difference to debug.
#
#   3. `serve -s`. The -s (single-page) flag rewrites unknown paths to
#      index.html. Without it every deep link — /inbox, /my-work, /finance —
#      404s on refresh, because react-router owns those routes client-side and
#      the static server knows nothing about them.

# ---- Stage 1: build the bundle ----
FROM node:20-alpine AS builder

WORKDIR /app

ENV CI=false \
    NODE_OPTIONS=--max-old-space-size=3072 \
    GENERATE_SOURCEMAP=false

# Lockfile first, so a source-only change reuses the dependency layer.
#
# .npmrc COMES WITH THEM, and leaving it out failed the first Railway build.
# It carries `legacy-peer-deps=true`, which this dependency tree genuinely
# needs: react-day-picker@8.10.1 peer-requires date-fns@^2||^3 while the
# project is on date-fns@4, and npm 7+ refuses to resolve that by default.
# Copying it in the later `COPY . .` is too late — npm ci has already run and
# already failed with ERESOLVE. Locally it always worked because the file was
# simply sitting in the directory.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .

# Supplied by Railway at build time (see note 1 above).
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

RUN npm run build

# ---- Stage 2: serve it ----
FROM node:20-alpine AS runtime

# `serve` pinned, and installed globally rather than carried in package.json:
# it is a deployment concern, not an app dependency, and nothing in the build
# or the test suite should be able to import it.
RUN npm install -g serve@14.2.4

# Non-root, same posture as the backend image.
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=builder --chown=app:app /app/build ./build

USER app

# Railway injects $PORT and expects the process to bind it. The shell form is
# deliberate — $PORT has to be expanded at runtime, and exec keeps the server
# as PID 1 so SIGTERM reaches it on a redeploy instead of being swallowed.
ENV PORT=3000
CMD ["sh", "-c", "exec serve -s build -l tcp://0.0.0.0:${PORT} --no-clipboard"]
