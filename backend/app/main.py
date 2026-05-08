from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.database import init_db
from app.routers import vehicles, records, upload, chat, manuals, settings, templates, dashboard, auth, admin_users

PHOTO_DIR = Path(__file__).resolve().parent.parent / "data" / "vehicle_photos"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="CarCare API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vehicles.router)
app.include_router(records.router)
app.include_router(upload.router)
app.include_router(chat.router)
app.include_router(manuals.router)
app.include_router(settings.router)
app.include_router(templates.router)
app.include_router(dashboard.router)
app.include_router(auth.router)
app.include_router(admin_users.router)

# Serve vehicle photos
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/vehicle-photos", StaticFiles(directory=str(PHOTO_DIR)), name="vehicle-photos")

# Serve frontend build in production
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
