"""Citywide map layers for the left panel.

Building layers are JSON records keyed by BIN that Blocklight joins onto
footprints to color them. Area layers are small GeoJSON overlays.
"""

from __future__ import annotations

import asyncio
import time
from datetime import date, timedelta
from typing import Any

import httpx

SODA = "https://data.cityofnewyork.us/resource"
TTL_SECONDS = 12 * 3600

_cache: dict[str, tuple[float, Any]] = {}


async def _soda(dataset: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.get(f"{SODA}/{dataset}.json", params={"$limit": 50000, **params})
        r.raise_for_status()
        return r.json()


async def _unsafe_facades() -> list[dict[str, Any]]:
    # Facade inspections run in 5-year cycles; a cycle-9 UNSAFE only counts if the building hasn't refiled in cycle 10
    c10 = await _soda("xubg-57si", {"$select": "bin, current_status", "$where": "cycle='10'"})
    c9 = await _soda("xubg-57si", {"$select": "bin", "$where": "current_status='UNSAFE' AND cycle='9'", "$group": "bin"})
    refiled = {r["bin"] for r in c10}
    unsafe = {r["bin"] for r in c10 if r.get("current_status") == "UNSAFE"} | {r["bin"] for r in c9 if r["bin"] not in refiled}
    return [{"bin": b, "n": 1} for b in unsafe if b]


async def _active_sheds() -> list[dict[str, Any]]:
    today = date.today().isoformat()
    rows = await _soda(
        "rbx6-tga4",
        {
            "$select": "bin, min(issued_date) as since",
            "$where": f"work_type='Sidewalk Shed' AND expired_date > '{today}' AND permit_status != 'Signed-off'",
            "$group": "bin",
        },
    )
    return [{"bin": r["bin"], "n": 1, "since": r.get("since", "")[:10]} for r in rows if r.get("bin")]


async def _vacate_orders() -> list[dict[str, Any]]:
    rows = await _soda(
        "tb8q-a3ar",
        {"$select": "bin, sum(number_of_vacated_units) as n", "$where": "actual_rescind_date IS NULL", "$group": "bin"},
    )
    return [{"bin": r["bin"], "n": max(1, int(float(r.get("n") or 0)))} for r in rows if r.get("bin")]


async def _rat_activity() -> list[dict[str, Any]]:
    since = (date.today() - timedelta(days=365)).isoformat()
    rows = await _soda(
        "p937-wjvj",
        {
            "$select": "bin, count(*) as n",
            "$where": f"result like 'Failed for Rat Activity%' AND inspection_date > '{since}'",
            "$group": "bin",
        },
    )
    return [{"bin": r["bin"], "n": int(r["n"])} for r in rows if r.get("bin")]


async def _tallest_building(bbls: list[str]) -> dict[str, str]:
    """BBL -> BIN of the tallest building on that lot (the apartment building, not the garage)."""
    sem = asyncio.Semaphore(8)

    async def chunk(part: list[str]) -> list[dict[str, Any]]:
        async with sem:
            return await _soda(
                "5zhs-2jue",
                {"$select": "bin, base_bbl, height_roof", "$where": "base_bbl in(" + ",".join(f"'{b}'" for b in part) + ")"},
            )

    parts = [bbls[i : i + 300] for i in range(0, len(bbls), 300)]
    best: dict[str, tuple[float, str]] = {}
    for rows in await asyncio.gather(*(chunk(p) for p in parts)):
        for r in rows:
            height = float(r.get("height_roof") or 0)
            if r.get("bin") and height >= best.get(r["base_bbl"], (-1.0, ""))[0]:
                best[r["base_bbl"]] = (height, r["bin"])
    return {bbl: b for bbl, (_, b) in best.items()}


async def _heat_complaints() -> list[dict[str, Any]]:
    since = (date.today() - timedelta(days=365)).isoformat()
    rows = await _soda(
        "erm2-nwe9",
        {
            "$select": "bbl, count(*) as n",
            "$where": f"complaint_type='HEAT/HOT WATER' AND created_date > '{since}' AND bbl IS NOT NULL",
            "$group": "bbl",
        },
    )
    # 311 files heat complaints against the tax lot; attribute them to the lot's main building
    to_bin = await _tallest_building([r["bbl"] for r in rows])
    return [{"bin": to_bin[r["bbl"]], "n": int(r["n"])} for r in rows if r["bbl"] in to_bin]


def _thin(coords: Any) -> Any:
    """Round to ~10 m and drop repeated vertices; overlays don't need survey precision."""
    if isinstance(coords[0][0], (int, float)):
        out: list[list[float]] = []
        for x, y in coords:
            p = [round(x, 4), round(y, 4)]
            if not out or out[-1] != p:
                out.append(p)
        return out if len(out) >= 4 else None
    parts = [_thin(c) for c in coords]
    return [p for p in parts if p]


def _features(rows: list[dict[str, Any]], props) -> dict[str, Any]:
    features = []
    for r in rows:
        geom = r.get("geom")
        coords = _thin(geom["coordinates"]) if geom else None
        if coords:
            features.append({"type": "Feature", "properties": props(r), "geometry": {"type": geom["type"], "coordinates": coords}})
    return {"type": "FeatureCollection", "features": features}


async def _sandy_extent() -> dict[str, Any]:
    rows = await _soda("5xsi-dfpx", {"$select": "the_geom as geom"})
    return _features(rows, lambda r: {})


async def _evacuation_zones() -> dict[str, Any]:
    rows = await _soda(
        "epne-qv9x",
        {"$select": "hurricane_ as zone, the_geom as geom", "$where": "hurricane_ in('1','2','3')"},
    )
    return _features(rows, lambda r: {"zone": int(r["zone"])})


LAYERS = {
    "unsafe-facades": _unsafe_facades,
    "active-sheds": _active_sheds,
    "vacate-orders": _vacate_orders,
    "rat-activity": _rat_activity,
    "heat-complaints": _heat_complaints,
    "sandy-2012": _sandy_extent,
    "evacuation-zones": _evacuation_zones,
}


async def layer(layer_id: str) -> Any:
    hit = _cache.get(layer_id)
    if hit and time.time() - hit[0] < TTL_SECONDS:
        return hit[1]
    data = await LAYERS[layer_id]()
    _cache[layer_id] = (time.time(), data)
    return data
