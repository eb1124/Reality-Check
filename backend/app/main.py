"""
FastAPI application entrypoint.

Session identity + server-side challenge assignment (Phase 1), plus
client-verdict finalization via POST /sessions/{id}/result (Phase 2). Still
no independent server-side verification, no auth, no media handling — see
backend/README.md for the exact list of what this deliberately omits.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .database import init_db
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Reality Check — Verification Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
