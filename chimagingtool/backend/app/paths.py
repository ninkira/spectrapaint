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
    BACKEND_DIR = Path(__file__).resolve().parents[1]          # .../backend
    FRONTEND_DIR = BACKEND_DIR.parent / "frontend" / "dist"    # produced by `npm run build`
    ALEMBIC_DIR = BACKEND_DIR / "alembic"

# --- Writable per-user data --------------------------------------------------------------
# A double-clicked / installed app usually cannot write to its own install folder
# (e.g. C:\Program Files, /Applications), so user data goes to the OS-standard per-user
# location that platformdirs resolves for us.
#
# Resolve the writable root:
#   1. IMAGINGTOOL_HOME env var, if set (explicit override);
#   2. else, when running under the Microsoft Store build of Python (which silently redirects
#      %LOCALAPPDATA% writes into a hidden ...\Packages\...\LocalCache\ sandbox, making the DB
#      impossible to find), fall back to a plain, findable folder in the user's profile;
#   3. else the OS-standard per-user location (correct for a normal Python and the packaged app).
_home = os.environ.get("IMAGINGTOOL_HOME")
if _home:
    DATA_ROOT = Path(_home).expanduser()
elif "windowsapps" in sys.base_prefix.lower():
    DATA_ROOT = Path.home() / "ImagingTool"
else:
    DATA_ROOT = Path(user_data_dir("ImagingTool", "NTNU"))
DATA_ROOT.mkdir(parents=True, exist_ok=True)

# --- Database location: kept next to the app ("portable") ---------------------------------
# The SQLite DB lives beside the app rather than in a hidden per-user folder:
#   * dev (run from source) -> the repo top level,
#   * packaged (frozen)     -> next to the executable.
# Override with IMAGINGTOOL_DB to force a specific folder (e.g. the old per-user location).
_db_override = os.environ.get("IMAGINGTOOL_DB")
if _db_override:
    _db_dir = Path(_db_override).expanduser()
elif getattr(sys, "frozen", False):
    _db_dir = Path(sys.executable).resolve().parent
else:
    _db_dir = Path(__file__).resolve().parents[2]  # repo top level (…/<repo root>)
_db_dir.mkdir(parents=True, exist_ok=True)

DB_PATH = _db_dir / "app.db"
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
