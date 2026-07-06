# SpectraPaint

A desktop app for viewing and analysing hyperspectral (HSI) image data — RGB / false-colour
viewing, spectral plotting, region and probe annotation, and pigment / material classification
for cultural-heritage imaging. The built desktop app is called **SpectraPaint**.

## Quick start

**Just want to run the app?** See **[INSTALL.md](INSTALL.md)** — download the installer,
double-click, done. No command line needed.

**Running from source (developers):**

```
# Frontend
cd frontend
npm install
npm run build          # or: npm run dev   (http://localhost:5173)

# Backend — opens the app in a native window
cd ../backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-runtime.txt pywebview
.venv\Scripts\python launcher.py
```

Full build / installer-packaging steps are in [INSTALL.md](INSTALL.md).

## Structure

```
backend/     FastAPI service + analysis (Python); launcher.py opens the desktop window
frontend/    React + Vite UI (TypeScript)
installer/   Inno Setup script for the Windows installer
```

## Tech

FastAPI · SQLAlchemy + SQLite (auto-created on first run) · spectral (ENVI cubes) ·
React + Vite · packaged with PyInstaller + pywebview + Inno Setup.

The SQLite database is created next to the app (repo top level in dev, next to the executable
when installed). See [INSTALL.md](INSTALL.md) for details.
