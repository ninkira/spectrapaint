from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# AFTER
from .api.routes_dataset import router as datasets_router
from .core.config import settings

app = FastAPI(title="HSI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets_router)

@app.get("/healthz")
def health():
    return {"ok": True}
