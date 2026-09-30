from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.analytics import router as analytics_router
from app.analytics_overview import router as analytics_overview_router
from app.appointments import router as appointments_router
from app.availability import router as availability_router
from app.cases import router as cases_router
from app.content import router as content_router
from app.db import init_db
from app.demo_auth import router as demo_router
from app.errors import register_error_handlers
from app.intake import router as intake_router
from app.matching import router as matching_router
from app.patient_portal import router as patient_portal_router
from app.plans import router as plans_router
from app.results import router as results_router
from app.rules import router as rules_router
from app.scheduling import router as scheduling_router
from app.staff_reads import router as staff_router
from app.tasks import router as tasks_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="PRIME Check-up demo", lifespan=lifespan)
register_error_handlers(app)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


for module_router in (
    content_router,
    analytics_router,
    analytics_overview_router,
    demo_router,
    cases_router,
    intake_router,
    rules_router,
    matching_router,
    availability_router,
    appointments_router,
    staff_router,
    plans_router,
    scheduling_router,
    results_router,
    tasks_router,
    patient_portal_router,
):
    app.include_router(module_router)
