"""Desktop launcher: starts the FastAPI server and opens the app in a native window.

Run it from the backend/ folder (with the venv active):

    pip install pywebview      # one-time extra dependency
    python launcher.py

This is also the entry point PyInstaller freezes into the double-click executable.
"""
import threading
import time
import urllib.request

import uvicorn
import webview  # pip install pywebview

from app.main import app

HOST = "127.0.0.1"
PORT = 8756  # uncommon port, to avoid clashing with other local dev servers


def _serve() -> None:
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


def _wait_until_up(timeout_seconds: int = 30) -> bool:
    """Poll /healthz so we don't open the window before the server can answer."""
    url = f"http://{HOST}:{PORT}/healthz"
    for _ in range(timeout_seconds * 10):
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.1)
    return False


def main() -> None:
    # When you add the database (see docs/database-tutorial.md), create app/startup.py with
    # an init_app() that runs Alembic, then uncomment these two lines so the DB is created
    # and migrated to the latest schema before the server starts serving requests:
    #
    #     from app.startup import init_app
    #     init_app()

    threading.Thread(target=_serve, daemon=True).start()
    _wait_until_up()
    webview.create_window("Imaging Tool", f"http://{HOST}:{PORT}", width=1400, height=900)
    webview.start()


if __name__ == "__main__":
    main()
