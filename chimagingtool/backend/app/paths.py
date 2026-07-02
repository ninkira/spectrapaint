"""Filesystem locations for the app, correct in BOTH dev and a PyInstaller build.

Two kinds of location:
  * Read-only bundled resources (the built frontend, the alembic scripts).
  * Writable per-user data (the SQLite DB, imported files).

Keeping this logic in one place means the rest of the app never has to care whether it is
running from source or from a frozen executable.
"""
import os
import sys
from pathlib import Path

from platformdirs import user_data_dir

# --- Read-only bundled resources ---------------------------------------------------------
if getattr(sys, "frozen", False):
    # PyInstaller unpacks bundled data files into this temp dir at runtime.
    RESOURCE_DIR = Path(sys._MEIPASS)  # type: ignore[attr-defined]
    FRONTEND_DIR = RESOURCE_DIR / "frontend"
    ALEMBIC_DIR = RESOURCE_DIR / "alembic"
else:
    BACKEND_DIR = Path(__file__).resolve().parents[1]          # .../chimagingtool/backend
    FRONTEND_DIR = BACKEND_DIR.parent / "imaging-app" / "dist"  # produced by `npm run build`
    ALEMBIC_DIR = BACKEND_DIR / "alembic"

# --- Writable per-user data --------------------------------------------------------------
# A double-clicked / installed app usually cannot write to its own install folder
# (e.g. C:\Program Files, /Applications), so user data goes to the OS-standard per-user
# location that platformdirs resolves for us.
DATA_ROOT = Path(user_data_dir("ImagingTool", "NTNU"))
DATA_ROOT.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_ROOT / "app.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# --- Imaging data directory (the HSI cubes / images the app reads) ------------------------
# This data is large (multi-GB) and is intentionally NOT bundled into the executable.
# Resolution order:
#   1) IMAGINGTOOL_DATA_DIR env var  -> point the app at any folder (e.g. your existing data),
#   2) frozen build                  -> a writable per-user "data" folder next to the DB,
#   3) running from source (dev)     -> the repo's backend/app/data.
_env_data_dir = os.environ.get("IMAGINGTOOL_DATA_DIR")
if _env_data_dir:
    APP_DATA_DIR = Path(_env_data_dir)
elif getattr(sys, "frozen", False):
    APP_DATA_DIR = DATA_ROOT / "data"
else:
    APP_DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "data"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
