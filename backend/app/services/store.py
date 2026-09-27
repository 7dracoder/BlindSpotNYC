"""Buildings + AI analyses. MongoDB Atlas when configured, in-memory otherwise."""

from __future__ import annotations

import math
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import get_db

BUILDING_TTL = timedelta(hours=12)

_buildings: dict[str, dict[str, Any]] = {}
_analyses: dict[str, dict[str, Any]] = {}


def _fresh(doc: dict[str, Any] | None) -> bool:
    if not doc or not doc.get("fetched_at"):
        return False
    return datetime.now(timezone.utc) - datetime.fromisoformat(doc["fetched_at"]) < BUILDING_TTL


async def get_building(bin_id: str, fresh_only: bool = True) -> dict[str, Any] | None:
    db = get_db()
    doc = await db.buildings.find_one({"bin": bin_id}, {"_id": 0}) if db is not None else deepcopy(_buildings.get(bin_id))
    if fresh_only and not _fresh(doc):
        return None
    return doc


async def save_building(doc: dict[str, Any]) -> None:
    db = get_db()
    if db is None:
        _buildings[doc["bin"]] = deepcopy(doc)
        return
    await db.buildings.replace_one({"bin": doc["bin"]}, doc, upsert=True)


async def get_analysis(bin_id: str, fetched_at: str) -> dict[str, Any] | None:
    db = get_db()
    doc = await db.analyses.find_one({"bin": bin_id}, {"_id": 0}) if db is not None else deepcopy(_analyses.get(bin_id))
    # An analysis is only valid for the building snapshot it was written from
    if doc and doc.get("fetched_at") == fetched_at:
        return doc
    return None


async def save_analysis(doc: dict[str, Any]) -> None:
    db = get_db()
    if db is None:
        _analyses[doc["bin"]] = deepcopy(doc)
        return
    await db.analyses.replace_one({"bin": doc["bin"]}, doc, upsert=True)


async def scanned_locations(limit: int = 25) -> list[tuple[float, float]]:
    db = get_db()
    if db is None:
        docs = list(_buildings.values())[:limit]
    else:
        docs = await db.buildings.find({}, {"_id": 0, "location": 1}).limit(limit).to_list(length=limit)
    return [tuple(d["location"]["coordinates"]) for d in docs]


def _meters(a: list[float], b: list[float]) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(h))


async def nearby(lng: float, lat: float, meters: int, limit: int = 50) -> list[dict[str, Any]]:
    fields = {"_id": 0, "bin": 1, "address": 1, "location": 1, "hazard_score": 1, "risk_label": 1}
    db = get_db()
    if db is not None:
        query = {
            "location": {
                "$near": {"$geometry": {"type": "Point", "coordinates": [lng, lat]}, "$maxDistance": meters}
            }
        }
        return await db.buildings.find(query, fields).limit(limit).to_list(length=limit)

    rows = [
        {k: b[k] for k in fields if k != "_id"}
        for b in _buildings.values()
        if _meters([lng, lat], b["location"]["coordinates"]) <= meters
    ]
    rows.sort(key=lambda b: _meters([lng, lat], b["location"]["coordinates"]))
    return rows[:limit]
