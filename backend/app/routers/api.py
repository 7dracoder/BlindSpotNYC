from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path
from urllib.parse import quote

import asyncpg
import httpx
from fastapi import APIRouter, HTTPException, Query, Response

from app.config import get_settings
from app.models.building import (
    Analysis,
    Building,
    NearbyBuilding,
    Place,
    SmsLookupRequest,
    SmsLookupResponse,
)
from app.services import city_tiles, map_layers, nyc_data, store, tiger, voice
from app.services.llm import generate_briefing
from app.services.news import building_news
from app.services.tts import synthesize

router = APIRouter(prefix="/api")


async def _lookup(text: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        place = await nyc_data.resolve(client, text)
    return await _lookup_place(place)


async def _lookup_place(place: dict) -> dict:
    cached = await store.get_building(place["bin"])
    if cached:
        if tiger.enabled() and cached.get("trend_source") != "tiger":
            await _tiger_trend(place, cached)
            await store.save_building(cached)
        return cached
    doc = await nyc_data.build_building(place)
    if tiger.enabled():
        await _tiger_trend(place, doc)
    await store.save_building(doc)
    return doc


async def _tiger_trend(place: dict, doc: dict) -> None:
    """Load 10 years of 311 into the Tiger hypertable and chart it from there."""
    last = date.today().year
    first = last - 9
    try:
        await tiger.save_history(doc["bin"], await nyc_data.complaint_history(place, first))
        doc["complaint_trend"] = await tiger.yearly_trend(doc["bin"], first, last)
        doc["trend_insight"] = await tiger.trend_insight(doc["bin"], last)
        doc["trend_source"] = "tiger"
    except (httpx.HTTPError, asyncpg.PostgresError, OSError) as exc:
        print(f"[tiger] kept Open Data trend: {exc}")


async def _analysis(building: dict) -> dict:
    cached = await store.get_analysis(building["bin"], building["fetched_at"])
    if cached:
        # App Platform's filesystem is ephemeral. Atlas can retain an audio URL
        # after a deployment removes its MP3; clear it so the audio route retries.
        audio_url = cached.get("audio_url")
        if audio_url and audio_url.startswith("/api/audio/"):
            audio_file = Path(get_settings().audio_dir) / Path(audio_url).name
            if not audio_file.is_file():
                cached = {**cached, "audio_url": None, "audio_engine": None}
        return cached
    (briefing, engine), news = await asyncio.gather(
        generate_briefing(building),
        building_news(building["address"]),
    )
    doc = {
        "bin": building["bin"],
        "fetched_at": building["fetched_at"],
        "briefing": briefing,
        "engine": engine,
        "news": news,
        "audio_url": None,
        "audio_engine": None,
    }
    # Don't pin a fallback; the next request should retry the model
    if engine != "rules":
        await store.save_analysis(doc)
    return doc


@router.get("/health")
async def health():
    return {"ok": True}


@router.get("/search", response_model=list[Place])
async def search(q: str = Query(..., min_length=2)):
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await nyc_data.autocomplete(client, q)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NYC GeoSearch is unavailable")


@router.get("/lookup", response_model=Building)
async def lookup(
    q: str | None = Query(None, min_length=3),
    bin: str | None = None,
    lng: float | None = None,
    lat: float | None = None,
):
    """By address (`q`), a Blocklight click (`bin` + `lng`/`lat`), or a Google-map click (`lng`/`lat`)."""
    try:
        if q:
            return await _lookup(q)
        if lng is not None and lat is not None:
            async with httpx.AsyncClient(timeout=15.0) as client:
                place = (
                    await nyc_data.reverse(client, lng, lat, bin)
                    if bin
                    else await nyc_data.reverse_nearest(client, lng, lat)
                )
                return await _lookup_place(place)
    except nyc_data.AddressNotFound:
        raise HTTPException(status_code=404, detail="No NYC building matches that address")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NYC GeoSearch is unavailable")
    raise HTTPException(status_code=422, detail="Pass q, or bin with lng and lat")


@router.get("/map/buildings/manifest.json")
async def buildings_manifest():
    return city_tiles.manifest()


@router.get("/map/buildings/{x}/{y}.json")
async def buildings_tile(x: int, y: int, response: Response):
    response.headers["Cache-Control"] = "public, max-age=86400"
    try:
        return await city_tiles.buildings_tile(x, y)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NYC building footprints are unavailable")


@router.get("/map/streets/{x}/{y}.json")
async def streets_tile(x: int, y: int, response: Response):
    response.headers["Cache-Control"] = "public, max-age=86400"
    try:
        return await city_tiles.streets_tile(x, y)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NYC street centerlines are unavailable")


@router.get("/map/layers/{layer_id}.json")
async def map_layer(layer_id: str, response: Response):
    if layer_id not in map_layers.LAYERS:
        raise HTTPException(status_code=404, detail="Unknown layer")
    response.headers["Cache-Control"] = "public, max-age=3600"
    try:
        return await map_layers.layer(layer_id)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NYC Open Data is unavailable")


@router.get("/map/land.json")
async def land(response: Response):
    response.headers["Cache-Control"] = "public, max-age=86400"
    try:
        return await city_tiles.land()
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="NYC borough boundaries are unavailable")


@router.get("/nearby", response_model=list[NearbyBuilding])
async def nearby(lng: float, lat: float, meters: int = Query(1500, le=5000)):
    return await store.nearby(lng, lat, meters)


@router.get("/analyze/{bin_id}", response_model=Analysis)
async def analyze(bin_id: str):
    building = await store.get_building(bin_id, fresh_only=False)
    if not building:
        raise HTTPException(status_code=404, detail="Look up the address first")
    return await _analysis(building)


@router.post("/analyze/{bin_id}/audio", response_model=Analysis)
async def analyze_audio(bin_id: str):
    building = await store.get_building(bin_id, fresh_only=False)
    if not building:
        raise HTTPException(status_code=404, detail="Look up the address first")
    doc = await _analysis(building)
    if not doc.get("audio_url"):
        url, engine = await synthesize(doc["briefing"], f"{bin_id}-{doc['fetched_at'][:19].replace(':', '')}")
        doc = {**doc, "audio_url": url, "audio_engine": engine}
        if doc["engine"] != "rules":
            await store.save_analysis(doc)
    return doc


@router.get("/voice/{bin_id}/session")
async def voice_session(bin_id: str):
    """Short-lived ElevenLabs WebRTC token + the report the inspector agent talks from."""
    settings = get_settings()
    if not (settings.elevenlabs_api_key and settings.elevenlabs_agent_id):
        raise HTTPException(status_code=503, detail="Voice inspector isn't configured")
    building = await store.get_building(bin_id, fresh_only=False)
    if not building:
        raise HTTPException(status_code=404, detail="Look up the address first")
    try:
        token, report = await asyncio.gather(
            voice.conversation_token(),
            voice.building_report(building, await _analysis(building)),
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Couldn't reach ElevenLabs")
    return {
        "token": token,
        "dynamic_variables": {
            "address": building["address"],
            "risk_label": building["risk_label"],
            "building_report": report,
        },
    }


@router.post("/sms/lookup", response_model=SmsLookupResponse)
async def sms_lookup(body: SmsLookupRequest):
    """Entry point for the Photon iMessage agent."""
    settings = get_settings()
    try:
        building = await _lookup(body.text)
    except (nyc_data.AddressNotFound, httpx.HTTPError):
        return SmsLookupResponse(
            matched=False,
            reply_text="I couldn't find that NYC address. Try something like: 3605 Sedgwick Ave, Bronx",
        )

    analysis = await _analysis(building)
    map_url = f"{settings.public_app_url.rstrip('/')}/?q={quote(building['address'])}"
    shed = building["shed"]
    lines = [
        building["address"],
        f"Risk: {building['risk_label']} ({building['hazard_score']}/100)",
        building["risk_reason"],
        "",
        analysis["briefing"],
        "",
        f"Open violations: {len(building['violations'])}"
        + (f" · Shed up since {shed['since']}" if shed.get("active") else ""),
        f"See it in 3D: {map_url}",
    ]
    return SmsLookupResponse(
        matched=True,
        reply_text="\n".join(lines),
        bin=building["bin"],
        map_url=map_url,
        audio_url=analysis.get("audio_url"),
    )
