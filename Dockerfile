# SpectraPaint in a container.
#
# This is the "no toolchain" install route: one image that already contains Python, the built
# React frontend and every dependency, so nothing has to be set up on the host. It is still the
# same single-user, local-first application as the desktop build — one container, its own SQLite
# database, no shared server — just started with `docker compose up` instead of a double-click.
#
# Two things are deliberately NOT in the final image:
#   * Node and the frontend toolchain — they live in the build stage only;
#   * pywebview and `launcher.py` — a container has no display to open a desktop window on.
#     The container serves the app over HTTP and the user opens it in their own browser.

# ---------------------------------------------------------------------------------------------
# Stage 1 — build the React frontend.
# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend

WORKDIR /build

# Copy the manifests first so the (slow) dependency install is cached independently of source
# edits: changing a .tsx file must not re-download node_modules.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# `npm run build` is `tsc -b && vite build`, so a type error fails the image build here rather
# than producing an image that serves a stale or missing bundle.
RUN npm run build


# ---------------------------------------------------------------------------------------------
# Stage 2 — the Python runtime that serves the API and the built frontend.
# ---------------------------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# UID/GID of the user the app runs as. Override at build time to match the owner of the folders
# you bind-mount on a Linux host, where bind-mount ownership is real:
#   docker compose build --build-arg APP_UID=$(id -u) --build-arg APP_GID=$(id -g)
# On Docker Desktop (Windows/macOS) bind-mount ownership is remapped for you and this can stay
# as it is.
ARG APP_UID=1000
ARG APP_GID=1000

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# --- Python dependencies -----------------------------------------------------------------
# requirements-runtime.txt is the lean, packaging-grade list (requirements.txt is a dev
# mega-dump with torch/jupyter and must not be used here). pywebview is dropped: it is the
# desktop-window wrapper, needs GTK/Qt plus an X display, and the container never opens a
# window. Filtering the one line keeps a single source of truth for the runtime dependencies
# instead of a container-only copy that would quietly drift.
WORKDIR /app
COPY backend/requirements-runtime.txt ./
RUN grep -ivE '^[[:space:]]*pywebview([[:space:]=<>!;#].*)?$' requirements-runtime.txt \
        > /tmp/requirements-container.txt \
    && pip install --no-cache-dir -r /tmp/requirements-container.txt \
    && pip install --no-cache-dir "uvicorn[standard]" \
    && ! python -c "import webview" 2>/dev/null

# --- Application code ---------------------------------------------------------------------
# app/paths.py resolves the frontend as <backend>/../frontend/dist and the alembic scripts as
# <backend>/alembic, so the container keeps the repository's own layout under /app.
COPY backend/ /app/backend/
COPY --from=frontend /build/dist/ /app/frontend/dist/

# --- Where state lives --------------------------------------------------------------------
# Everything writable is under /data, which is mounted from the host (see compose.yaml):
#   /data/imaging  the user's HSI cubes and images — multi-gigabyte, never baked into the image
#   /data/state    the SQLite database, which holds every project, ROI and annotation
#
# TMPDIR matters more than it looks: FastAPI spools an upload over ~1 MB to a temporary file,
# and an HSI cube is several gigabytes. Left at /tmp that would fill the container's writable
# layer, so the spool is pointed at the same volume the cube is being uploaded to.
# MPLCONFIGDIR keeps matplotlib (imported for polygon hit-testing) from warning about an
# unwritable config cache; it sits on the state volume so it stays writable whatever UID the
# container is told to run as.
ENV SPECTRAPAINT_HOME=/data \
    SPECTRAPAINT_DATA_DIR=/data/imaging \
    SPECTRAPAINT_DB=/data/state \
    TMPDIR=/data/imaging/.spectrapaint-tmp \
    MPLCONFIGDIR=/data/state/.matplotlib \
    HOME=/var/cache/spectrapaint \
    SPECTRAPAINT_PORT=8000

RUN groupadd --gid "${APP_GID}" spectrapaint \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --no-log-init --create-home \
        --home-dir /var/cache/spectrapaint spectrapaint \
    && mkdir -p /data/imaging /data/state \
    && chown -R spectrapaint:spectrapaint /data /var/cache/spectrapaint

COPY docker/entrypoint.sh /usr/local/bin/spectrapaint-entrypoint
RUN chmod +x /usr/local/bin/spectrapaint-entrypoint

# Declared so that a plain `docker run` without -v still keeps the data and the database in
# anonymous volumes rather than in the container's own layer, where `docker rm` would take them.
VOLUME ["/data/imaging", "/data/state"]

USER spectrapaint
WORKDIR /app/backend
EXPOSE 8000

# No curl or wget in the slim image, so health is checked with the interpreter that is here.
# `start-period` is generous: the first boot runs the Alembic migrations that create the schema.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('SPECTRAPAINT_PORT','8000'), timeout=4).status == 200 else 1)"]

ENTRYPOINT ["/usr/local/bin/spectrapaint-entrypoint"]
