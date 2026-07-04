# Installing Imaging Tool

Imaging Tool is a desktop app for viewing and analysing hyperspectral (HSI) image data.
This guide is written for non-technical users — no command line needed.

---

## 1. Install (Windows)

1. Get the installer file **`ImagingToolSetup.exe`** (from your provider, or build it using the
   developer steps at the bottom of this page).
2. **Double-click** it to start the installer.
3. If Windows shows a blue **"Windows protected your PC"** box, click **More info → Run anyway**.
   (This appears for apps that aren't signed with a paid certificate — it's expected here.)
4. Follow the prompts and click **Install**. It installs for the current user only, so **no
   administrator password is needed**.
5. Optionally tick **Create a desktop shortcut**.

## 2. Launch the app

- Open it from the **Start menu** (search for "Imaging Tool") or from the desktop shortcut.
- The app opens in its own window. Its database is created automatically the first time you run
  it — there is nothing to set up.

## 3. Add your data

The app reads imaging data from a data folder:

1. In the Start menu, click the shortcut **"Imaging Tool Data Folder"** to open that folder.
2. Copy your project folder into it (for example an `old_man` folder containing the HSI files).
3. Restart the app — your data now appears in the list.

## 4. Uninstall

Windows **Settings → Apps → Imaging Tool → Uninstall**. Your data folder is left untouched.

---

## For developers: running and building from source

Requires **Python 3.12+** and **Node.js 22+** on Windows. Run these from the project root
(the `spectrapaint` folder).

### Run from source

```
cd spectrapaint/imaging-app
npm install
npm run build          # or: npm run dev  (live-reload frontend on http://localhost:5173)

cd ../backend
python -m venv .venv
.venv\Scripts\pip install -r requirements-runtime.txt pywebview
.venv\Scripts\python launcher.py
```

`launcher.py` starts the backend and opens the app in a native window. The SQLite database
(`app.db`) is created **at the repo top level** when run from source.

### Build the installer

1. Build the frontend (`npm run build`, as above) so `imaging-app/dist` exists.
2. Build the app with **PyInstaller** — output goes to the repo top level:

   ```
   cd spectrapaint/backend
   .venv\Scripts\pip install pyinstaller
   .venv\Scripts\pyinstaller --distpath ../../dist --workpath ../../build ImagingTool.spec
   ```

   This produces `dist/ImagingTool/ImagingTool.exe` at the repo top level.

   > ⚠️ The repo lives inside OneDrive, which can lock files mid-build. **Pause OneDrive sync**
   > (OneDrive tray icon → gear → *Pause syncing*) before building, then resume afterwards.

3. Build the installer with **Inno Setup**:

   ```
   ISCC.exe spectrapaint/installer/ImagingTool.iss
   ```

   This produces **`ImagingToolSetup.exe`** at the repo top level.

### Where things live

| Item | Location |
|------|----------|
| App executable (built) | `dist/ImagingTool/ImagingTool.exe` (repo top level) |
| Installer (built) | `ImagingToolSetup.exe` (repo top level) |
| Database — run from source | `app.db` at the repo top level |
| Database — installed app | next to `ImagingTool.exe` in the install folder |
| Imaging data folder | `%LOCALAPPDATA%\NTNU\ImagingTool\data` |

Build artifacts (`dist/`, `build/`, `*Setup.exe`) and the local `app.db` are git-ignored.
