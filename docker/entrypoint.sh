#!/bin/sh
# Start the SpectraPaint server inside the container.
#
# The job here is to fail with a sentence someone can act on, rather than with a 500 twenty
# minutes into uploading a cube. Everything this app keeps — the imaging files and the SQLite
# database holding every project, ROI and annotation — lives on mounted volumes, so the one
# thing worth checking before serving a single request is that those volumes are writable by
# the user this container runs as.
set -eu

PORT="${SPECTRAPAINT_PORT:-8000}"
HOST="${SPECTRAPAINT_HOST:-0.0.0.0}"

require_writable() {
    dir="$1"
    what="$2"
    if ! mkdir -p "$dir" 2>/dev/null; then
        echo "SpectraPaint: cannot create $what at $dir." >&2
        mount_hint "$dir"
        exit 1
    fi
    if ! probe="$(mktemp "$dir/.writable-XXXXXX" 2>/dev/null)"; then
        echo "SpectraPaint: $what at $dir is not writable by uid $(id -u):$(id -g)." >&2
        mount_hint "$dir"
        exit 1
    fi
    rm -f "$probe"
}

mount_hint() {
    cat >&2 <<EOF

  Two things cause this. Either the mount is read-only — check for a ":ro" on the -v flag or
  in compose.yaml, and remove it; SpectraPaint writes uploads into the imaging folder and
  memory-maps the cubes back out of it.

  Or, on Linux, the folder belongs to a different user than the one this container runs as.
  Give the container your own ids, from the directory holding compose.yaml:

      echo "SPECTRAPAINT_UID=\$(id -u)" >> .env
      echo "SPECTRAPAINT_GID=\$(id -g)" >> .env
      docker compose up --build

  Current ownership of $1, as this container sees it (uid $(id -u):$(id -g)):
EOF
    ls -ld "$1" >&2 2>/dev/null || true
}

# The imaging folder has to be writable, not just readable: uploads are written into it, and
# `spectral` memory-maps the cubes it reads back.
require_writable "${SPECTRAPAINT_DATA_DIR:-/data/imaging}" "the imaging data folder"
require_writable "${SPECTRAPAINT_DB:-/data/state}" "the database folder"
require_writable "${TMPDIR:-/tmp}" "the upload scratch folder"
mkdir -p "${MPLCONFIGDIR:-/data/state/.matplotlib}" 2>/dev/null || true

# A cube upload interrupted by a restart can leave a part-written spool file behind. It is
# unreferenced by then, and these are gigabyte-sized, so clear them at boot.
find "${TMPDIR:-/tmp}" -mindepth 1 -maxdepth 1 -name 'tmp*' -delete 2>/dev/null || true

# `docker run <image> <anything>` runs that instead, which is how you get a shell in here:
#   docker compose run --rm spectrapaint sh
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "SpectraPaint: serving on http://localhost:${PORT} (data ${SPECTRAPAINT_DATA_DIR:-/data/imaging}, database ${SPECTRAPAINT_DB:-/data/state}/app.db)"

# One worker, deliberately. This is a single-user local application backed by SQLite, and the
# dataset registry is cached in process memory — a second worker would hold a stale copy of it
# and fight the first over the database. Scaling out is not a goal here.
# The schema is created and migrated by the FastAPI lifespan hook (app/startup.py), so there is
# no migration step to run first.
exec python -m uvicorn app.main:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers 1 \
    --proxy-headers \
    --timeout-keep-alive 120 \
    --log-level info
