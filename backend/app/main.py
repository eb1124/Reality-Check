"""
FastAPI application entrypoint.

Session identity + server-side challenge assignment (Phase 1), plus
client-verdict finalization via POST /sessions/{id}/result (Phase 2), plus
continuous (multi-challenge, event-monitored) sessions under
/sessions/continuous/... (Phase 7). Still no independent server-side
verification, no auth, no media handling — see backend/README.md for the
exact list of what this deliberately omits.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .continuous_routes import router as continuous_router
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

# Phase 9: an embedding OA is a genuinely separate web app (its own origin/
# port), not another page of this same Vite dev server — unlike the existing
# demo-interview.html, it cannot rely on vite.config.js's same-origin /api
# proxy. There is still no authentication or cookie-based session anywhere
# in this backend (see backend/README.md), so a permissive allow-all-origins
# policy widens no existing trust boundary; it only stops the browser from
# blocking a cross-origin fetch that carries no credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(continuous_router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
