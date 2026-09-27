import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.db import close_db, connect_db
from app.routers.api import router
from app.services import city_tiles, map_layers, store, tiger


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await connect_db()
    except Exception as exc:
        print(f"[blindspot] MongoDB unavailable, caching in memory: {exc}")
    warmup = asyncio.gather(
        city_tiles.warm_around(await store.scanned_locations()),
        # The two layers that take ~20s to build cold
        map_layers.layer("sandy-2012"),
        map_layers.layer("heat-complaints"),
        return_exceptions=True,
    )
    try:
        await tiger.connect()
    except Exception as exc:
        print(f"[blindspot] Tiger Data unavailable, trends come from NYC Open Data: {exc}")
    yield
    warmup.cancel()
    await tiger.close()
    await close_db()


settings = get_settings()
app = FastAPI(title="BlindSpot NYC", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.include_router(router)

audio_dir = Path(settings.audio_dir)
audio_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/audio", StaticFiles(directory=audio_dir), name="audio")

# Production uses one origin for the UI and API; keep this after API routes.
if settings.frontend_dist:
    app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")
