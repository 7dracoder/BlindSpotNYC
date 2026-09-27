"""Citywide map geometry for Blocklight, straight from NYC Open Data.

Building footprints and street centerlines are served as static-style z15 GeoJSON
tiles (Blocklight's tile manifest format); borough shorelines as one small file.
"""

from __future__ import annotations

import asyncio
import math
from collections import OrderedDict
from typing import Any

import httpx

SODA = "https://data.cityofnewyork.us/resource"
FOOTPRINTS = f"{SODA}/5zhs-2jue.json"
CENTERLINES = f"{SODA}/inkn-q76z.json"
BOROUGHS = f"{SODA}/gthc-hcne.json"

TILE_ZOOM = 15
NYC_BOUNDS = (-74.26, 40.49, -73.69, 40.92)  # west, south, east, north
# Roadway types that read as streets (skip ramps, trails, ferry routes, etc.)
STREET_TYPES = "('1','2','3','4','10','11','13')"

_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
_locks: dict[str, asyncio.Lock] = {}
CACHE_SIZE = 400


def _tile_xy(lng: float, lat: float) -> tuple[int, int]:
    n = 2**TILE_ZOOM
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def _tile_bounds(x: int, y: int) -> tuple[float, float, float, float]:
    n = 2**TILE_ZOOM
    lat = lambda t: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / n))))  # noqa: E731
    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


def manifest() -> dict[str, Any]:
    west, south, east, north = NYC_BOUNDS
    x0, y0 = _tile_xy(west, north)
    x1, y1 = _tile_xy(east, south)
    tiles = {f"{x}/{y}": 1 for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
    return {
        "schemaVersion": 1,
        "zoom": TILE_ZOOM,
        "featureCount": 0,
        "geometryVersion": "nyc-open-data-live",
        "template": "{x}/{y}.json",
        "tiles": tiles,
    }


def _round(coords: Any) -> Any:
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 6), round(coords[1], 6)]
    return [_round(c) for c in coords]


async def _cached(key: str, load) -> dict[str, Any]:
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        if key not in _cache:
            _cache[key] = await load()
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
    _locks.pop(key, None)
    return _cache[key]


async def _soda(url: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()


def _box(x: int, y: int) -> str:
    west, south, east, north = _tile_bounds(x, y)
    return f"within_box(the_geom,{north},{west},{south},{east})"


async def buildings_tile(x: int, y: int) -> dict[str, Any]:
    async def load():
        rows = await _soda(
            FOOTPRINTS,
            {"$select": "bin,height_roof,the_geom", "$where": _box(x, y), "$limit": 50000},
        )
        features = []
        for r in rows:
            bin_id, geom = r.get("bin"), r.get("the_geom")
            if not bin_id or not geom:
                continue
            height = float(r["height_roof"]) * 0.3048 if r.get("height_roof") else 0.0
            features.append(
                {
                    "type": "Feature",
                    "id": int(bin_id),
                    "properties": {"source_id": bin_id, "height_m": round(height, 1)},
                    "geometry": {"type": geom["type"], "coordinates": _round(geom["coordinates"])},
                }
            )
        return {"type": "FeatureCollection", "features": features}

    return await _cached(f"b/{x}/{y}", load)


async def streets_tile(x: int, y: int) -> dict[str, Any]:
    async def load():
        rows = await _soda(
            CENTERLINES,
            {
                "$select": "the_geom",
                "$where": f"{_box(x, y)} AND rw_type in{STREET_TYPES}",
                "$limit": 50000,
            },
        )
        return {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {}, "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])}}
                for r in rows
                if (g := r.get("the_geom"))
            ],
        }

    return await _cached(f"s/{x}/{y}", load)


async def warm_around(points: list[tuple[float, float]]) -> None:
    """Pre-fetch the 3x3 tiles around each point so a demo fly-to lands on loaded blocks."""
    keys = {(x + dx, y + dy) for lng, lat in points for x, y in [_tile_xy(lng, lat)] for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    for x, y in keys:
        try:
            await asyncio.gather(buildings_tile(x, y), streets_tile(x, y))
        except httpx.HTTPError as exc:
            print(f"[tiles] warm {x}/{y} failed: {exc}")


async def land() -> dict[str, Any]:
    async def load():
        rows = await _soda(BOROUGHS, {"$select": "boroname,simplify_preserve_topology(the_geom,0.0002) as geom"})
        return {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"name": r["boroname"]}, "geometry": r["geom"]}
                for r in rows
                if r.get("geom")
            ],
        }

    return await _cached("land", load)
