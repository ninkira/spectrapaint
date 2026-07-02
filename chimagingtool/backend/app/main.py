from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# AFTER
from .api.routes_classification import router as classification_router
from .api.routes_datasets import router as datasets_router
from .api.routes_spectra import router as spectra_router
from .core.config import settings
from .paths import FRONTEND_DIR

app = FastAPI(title="HSI Service")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes live under /api so the SAME urls work in dev (via the Vite proxy) and in the
# packaged single-process app (where FastAPI also serves the built frontend at "/").
app.include_router(datasets_router, prefix="/api")
app.include_router(spectra_router, prefix="/api")
app.include_router(classification_router, prefix="/api")


@app.get("/healthz")
def health():
    return {"ok": True}


# Serve the built React app (imaging-app/dist) when it exists. In pure dev you run the
# Vite dev server instead, so this is simply skipped if no build has been produced yet.
# IMPORTANT: mount LAST so it does not shadow the API routes or /healthz above.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
