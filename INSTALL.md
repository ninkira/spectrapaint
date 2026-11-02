# Installing SpectraPaint

SpectraPaint is an application for viewing and analysing hyperspectral (HSI) image data. It runs
on your own machine — your data and your database never leave it.

There are three ways to install it. Pick one:

| | Route | Good for | You need |
|---|---|---|---|
| **A** | [Windows installer](#a-windows-installer) | Not wanting to touch a command line | Nothing |
| **B** | [Docker](#b-docker) | Any OS, no Python or Node set-up | Docker Desktop |
| **C** | [From source](#c-from-source) | Developing SpectraPaint | Python 3.12+, Node.js 22+ |

Whichever you choose, the app ends up the same: one instance, yours alone, with its own SQLite
database created automatically on first run. There is no server to sign in to and no account.

---

## A. Windows installer

1. Get the installer file **`SpectraPaintSetup.exe`** (from your provider, or build it using the
   [developer steps](#building-the-windows-installer) at the bottom of this page).
2. **Double-click** it to start the installer.
3. If Windows shows a blue **"Windows protected your PC"** box, click **More info → Run anyway**.
   (This appears for apps that aren't signed with a paid certificate — it's expected here.)
4. Follow the prompts and click **Install**. It installs for the current user only, so **no
   administrator password is needed**.
5. Optionally tick **Create a desktop shortcut**.

### Launch it

Open it from the **Start menu** (search for "SpectraPaint") or from the desktop shortcut. The app
opens in its own window, and its database is created the first time you run it — nothing to set up.

### Add your data

Click **＋** in the Data Manager and choose your files. An HSI cube is two files — the ENVI header
(`.hdr`) and its binary (`.dat`, `.img` or `.raw`) — and you select both. MA-XRF maps and RGB
photographs go in as single TIFF/PNG/JPEG files.

### Uninstall

Windows **Settings → Apps → SpectraPaint → Uninstall**. Your data folder is left untouched.

---

## B. Docker

This is the route that needs nothing installed but Docker: the image already contains Python, the
built interface and every dependency. It works the same on Windows, macOS and Linux.

> It is still the same single-user local application — one container, your own database, reachable
> only from your own machine. It is **not** a server for a group to share: SpectraPaint has no
> login and no access control, so it must not be published to a network.

### 1. Install Docker Desktop

[docs.docker.com/get-started](https://docs.docker.com/get-started/get-docker/) — install it and
start it. You'll know it's ready when this prints a version:

```bash
docker compose version
```

### 2. Start SpectraPaint

From the folder you cloned this repository into:

```bash
docker compose up --build
```

The first run takes a few minutes: it builds the interface and downloads the Python packages.
Later runs start in seconds. When you see

```
SpectraPaint: serving on http://localhost:8000 (data /data/imaging, database /data/state/app.db)
```

open **<http://localhost:8756>** in your browser. (The container serves on its own port 8000
internally; 8756 is where it is published on your machine.)

### 3. Add your data

Click **＋** in the Data Manager and choose your files, exactly as in the other routes. An HSI
upload is two files — the `.hdr` header and its binary. The files are copied into the container's
imaging volume as they're uploaded, so they're safe to move or delete on your side afterwards.

**Dropping files into a folder does not register them.** SpectraPaint is upload-driven: a dataset
exists because it was added through the Data Manager, which writes both the file and its database
row. Mounting a folder of cubes you already have will not make them appear — upload them once, and
they stay.

### 4. Stop and start again

```bash
docker compose down     # stop; your data and database are kept
docker compose up       # back, with everything where you left it
```

### Everyday commands

| | |
|---|---|
| `docker compose up -d` | start in the background |
| `docker compose logs -f` | watch what the server is doing |
| `docker compose down` | stop (keeps your data) |
| `docker compose up --build` | rebuild after pulling new code |
| `docker compose exec spectrapaint sh` | a shell inside the container |

### Where your data lives

Two Docker **named volumes**, which `docker compose down` keeps and only `docker compose down -v`
deletes:

| Volume | Mounted at | Holds |
|---|---|---|
| `spectrapaint_imaging` | `/data/imaging` | your HSI cubes and images — this is the big one |
| `spectrapaint_state` | `/data/state` | `app.db` — **every project, ROI and annotation you have** |

`app.db` is small and irreplaceable. Back it up:

```bash
docker compose cp spectrapaint:/data/state/app.db ./app.db.backup
```

and restore it into a stopped container with the same command reversed:

```bash
docker compose cp ./app.db.backup spectrapaint:/data/state/app.db
```

To copy a cube back out, or to see what's in there:

```bash
docker compose exec spectrapaint ls -R /data/imaging
docker compose cp spectrapaint:/data/imaging/old_man/hsi ./recovered-cubes
```

### If you would rather see the files on your own disk

Named volumes are the default because they need no configuration and can't be broken by file
permissions. If you'd rather have the files in a folder you can open in Explorer or Finder —
to back them up by copying, or to put the cubes on a different disk — edit `compose.yaml`:
comment out the two named-volume lines, uncomment the two bind-mount lines below them, and put
your paths in a `.env` file (start from `.env.example`):

```
SPECTRAPAINT_DATA_DIR=D:/spectrapaint/imaging
SPECTRAPAINT_STATE_DIR=D:/spectrapaint/state
```

**On Linux only**, a bind-mounted folder keeps its real owner, and the container has to be allowed
to write it. Put your own ids in the same `.env` and rebuild:

```bash
echo "SPECTRAPAINT_UID=$(id -u)" >> .env
echo "SPECTRAPAINT_GID=$(id -g)" >> .env
docker compose up --build
```

If you get this wrong the container says so on startup and tells you what to run, rather than
failing later with an upload error. On Windows and macOS, Docker Desktop handles ownership for
you and there is nothing to set.

### Moving an existing install into Docker

A database from route A or C works as-is, because stored file paths are relative to the data
folder. Copy **both** halves together — the database and the files it refers to:

```bash
docker compose up -d
docker compose cp ./app.db spectrapaint:/data/state/app.db
docker compose cp ./backend/app/data/old_man spectrapaint:/data/imaging/old_man
docker compose restart
```

(Use the `app.db` from the repository top level for route C, or from the install folder next to
`SpectraPaint.exe` for route A.) The schema is migrated automatically on the next start.

### Troubleshooting

**Port 8756 is already in use.** Put a different one in `.env` — `SPECTRAPAINT_PORT=9000` — and
`docker compose up -d` again.

**The container stops while a large cube is loading.** Reading a cube memory-maps the file and
pulls whole bands into memory, and the Docker VM gets a fixed slice of your RAM. Raise it in
Docker Desktop → **Settings → Resources → Memory**; no limit is set in `compose.yaml` on purpose,
so the VM's allocation is the only ceiling.

**An upload of several gigabytes fails part-way.** Check there's room on the imaging volume —
`docker compose exec spectrapaint df -h /data/imaging`. Uploads are spooled onto that same volume
rather than into the container, so disk space there is what matters.

**`permission denied` writing to `/data/...`.** You're on Linux with bind mounts and mismatched
ids — see [above](#if-you-would-rather-see-the-files-on-your-own-disk).

**Starting over completely.** `docker compose down -v` deletes both volumes, database included.
There is no undo.

---

## C. From source

Requires **Python 3.12+** and **Node.js 22+**. All paths are relative to the project root.

```bash
cd frontend
npm install
npm run build          # or: npm run dev  (live-reload frontend on http://localhost:5173)

cd ../backend
python -m venv .venv
```

**Windows**

```bat
.venv\Scripts\pip install -r requirements-runtime.txt
.venv\Scripts\python launcher.py
```

**macOS / Linux**

```bash
.venv/bin/pip install -r requirements-runtime.txt
.venv/bin/python launcher.py
```

`launcher.py` starts the backend and opens the app in a native window. The SQLite database
(`app.db`) is created **at the repo top level** when run from source.

Use `requirements-runtime.txt`, not `requirements.txt` — the latter is a development mega-dump
(torch, jupyter, sphinx) that the app does not need.

### Run the tests

```bash
.venv/bin/pip install -r requirements-dev.txt
cd backend && ../backend/.venv/bin/python -m pytest
```

### Building the Windows installer

1. Build the frontend (`npm run build`, as above) so `frontend/dist` exists.
2. Build the app with **PyInstaller** — output goes to the repo top level:

   ```
   cd backend
   .venv\Scripts\pip install pyinstaller pywebview
   .venv\Scripts\pyinstaller --distpath ../dist --workpath ../build SpectraPaint.spec
   ```

   This produces `dist/SpectraPaint/SpectraPaint.exe` at the repo top level.

3. Build the installer with **Inno Setup**:

   ```
   ISCC.exe installer/SpectraPaint.iss
   ```

   This produces **`SpectraPaintSetup.exe`** at the repo top level.

---

## Where things live

| Item | Installer (A) | Docker (B) | From source (C) |
|------|---------------|------------|-----------------|
| Database | next to `SpectraPaint.exe` | `spectrapaint_state` volume, `/data/state/app.db` | `app.db` at the repo top level |
| Imaging data | `%LOCALAPPDATA%\NTNU\SpectraPaint\data` | `spectrapaint_imaging` volume, `/data/imaging` | `backend/app/data` |
| Opened at | its own window | <http://localhost:8756> | its own window |

All three honour the same three environment variables, which override the defaults above:
`SPECTRAPAINT_HOME`, `SPECTRAPAINT_DB` (the **folder** holding `app.db`) and
`SPECTRAPAINT_DATA_DIR`. The Docker image simply sets them to the mounted volumes.

Build artifacts (`dist/`, `build/`, `*Setup.exe`) and the local `app.db` are git-ignored.
