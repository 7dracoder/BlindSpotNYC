"""NYC data sources: GeoSearch for addresses, Socrata (SODA) for building records."""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from app.services.scoring import is_fire_violation, risk_label_for_score, risk_reason, score_breakdown

GEOSEARCH = "https://geosearch.planninglabs.nyc/v2"
SODA = "https://data.cityofnewyork.us/resource"

SHEDS_DOB_NOW = f"{SODA}/rbx6-tga4.json"  # DOB NOW: Build approved permits
SHEDS_LEGACY = f"{SODA}/ipu4-2q9a.json"  # DOB BIS permit issuance (pre-DOB NOW)
HPD_VIOLATIONS = f"{SODA}/wvxf-dwi5.json"  # Housing Maintenance Code violations
DOB_SAFETY = f"{SODA}/855j-jady.json"  # DOB safety violations
COMPLAINTS_311 = f"{SODA}/erm2-nwe9.json"
FOOTPRINTS = f"{SODA}/5zhs-2jue.json"

# Compliance filings, not physical hazards
PAPERWORK_DEVICES = ("LL84", "LL33", "LL97", "LL87")

COMPLAINT_FILTER = (
    "(complaint_type='HEAT/HOT WATER'"
    " OR upper(descriptor) like '%SEWER BACKUP%'"
    " OR upper(descriptor) like '%CATCH BASIN%')"
)


class AddressNotFound(Exception):
    pass


def _q(value: str) -> str:
    return value.replace("'", "''")


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value[:23] if "T" in value else value[:10], fmt).date()
        except ValueError:
            continue
    return None


def _place(feature: dict[str, Any]) -> dict[str, Any] | None:
    props = feature.get("properties") or {}
    pad = (props.get("addendum") or {}).get("pad") or {}
    bin_id = pad.get("bin")
    # BINs like 1000000 are placeholders for lots without a building
    if not bin_id or bin_id.endswith("000000"):
        return None
    return {
        "label": props.get("label", ""),
        "name": props.get("name", ""),
        "borough": props.get("borough", ""),
        "bin": bin_id,
        "bbl": pad.get("bbl"),
        "coordinates": feature["geometry"]["coordinates"],
    }


async def autocomplete(client: httpx.AsyncClient, text: str) -> list[dict[str, Any]]:
    r = await client.get(f"{GEOSEARCH}/autocomplete", params={"text": text})
    r.raise_for_status()
    places = [_place(f) for f in r.json().get("features", [])]
    return [p for p in places if p][:6]


GENERIC_WORDS = {
    "st", "street", "ave", "av", "avenue", "pl", "place", "blvd", "boulevard", "rd", "road",
    "dr", "drive", "pkwy", "parkway", "ln", "lane", "ct", "court", "ter", "terrace", "saint",
    "w", "west", "e", "east", "n", "north", "s", "south", "ny", "nyc", "new", "york",
    "manhattan", "bronx", "brooklyn", "queens", "staten", "island", "usa",
}


def _tokens(text: str) -> list[str]:
    return [re.sub(r"^(\d+)(st|nd|rd|th)$", r"\1", w) for w in re.findall(r"[a-z0-9]+", text.lower())]


def _same_building(query: str, place: dict[str, Any]) -> bool:
    """GeoSearch fuzzy-matches aggressively ("99999 nowhere blvd" -> a real Queens lot)."""
    house = re.match(r"\s*(\d+(?:-\d+)?)\b", query)
    if not house:
        return True
    if not place["name"].startswith(house.group(1) + " "):
        return False
    street = [t for t in _tokens(query[house.end():]) if t not in GENERIC_WORDS]
    return not street or any(t in _tokens(place["name"]) for t in street)


async def reverse(client: httpx.AsyncClient, lng: float, lat: float, bin_id: str) -> dict[str, Any]:
    """Address for a building clicked on the map; only accept a result carrying that BIN."""
    r = await client.get(f"{GEOSEARCH}/reverse", params={"point.lat": lat, "point.lon": lng, "size": 10})
    r.raise_for_status()
    for feature in r.json().get("features", []):
        place = _place(feature)
        if place and place["bin"] == bin_id:
            return place
    raise AddressNotFound(bin_id)


async def reverse_nearest(client: httpx.AsyncClient, lng: float, lat: float) -> dict[str, Any]:
    """Closest building to a Google-map click (no BIN from the photorealistic tiles)."""
    r = await client.get(f"{GEOSEARCH}/reverse", params={"point.lat": lat, "point.lon": lng, "size": 8})
    r.raise_for_status()
    for feature in r.json().get("features", []):
        place = _place(feature)
        if place:
            return place
    raise AddressNotFound(f"{lng},{lat}")


async def resolve(client: httpx.AsyncClient, text: str) -> dict[str, Any]:
    r = await client.get(f"{GEOSEARCH}/search", params={"text": text, "size": 5})
    r.raise_for_status()
    for feature in r.json().get("features", []):
        place = _place(feature)
        if place and _same_building(text, place):
            return place
    raise AddressNotFound(text)


async def _soda(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    r = await client.get(url, params=params)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []


async def _sheds(client: httpx.AsyncClient, bin_id: str) -> list[dict[str, Any]]:
    now_rows, legacy_rows = await asyncio.gather(
        _soda(
            client,
            SHEDS_DOB_NOW,
            {
                "$where": f"bin='{bin_id}' AND work_type='Sidewalk Shed'",
                "$select": "work_permit,issued_date,expired_date,permit_status",
                "$order": "issued_date DESC",
                "$limit": 200,
            },
        ),
        _soda(
            client,
            SHEDS_LEGACY,
            {
                "$where": f"bin__='{bin_id}' AND permit_type='EQ' AND permit_subtype='SH'",
                "$select": "job__,issuance_date,expiration_date,permit_status",
                "$limit": 200,
            },
        ),
    )
    permits = [
        {
            "source": "DOB NOW",
            "permit": r.get("work_permit"),
            "issued": r.get("issued_date", "")[:10],
            "expires": r.get("expired_date", "")[:10],
            "status": r.get("permit_status", ""),
        }
        for r in now_rows
    ]
    for r in legacy_rows:
        issued, expires = _parse_date(r.get("issuance_date")), _parse_date(r.get("expiration_date"))
        permits.append(
            {
                "source": "DOB BIS",
                "permit": r.get("job__"),
                "issued": issued.isoformat() if issued else "",
                "expires": expires.isoformat() if expires else "",
                "status": r.get("permit_status", ""),
            }
        )
    return permits


def shed_summary(permits: list[dict[str, Any]], today: date) -> dict[str, Any]:
    """Active shed + how long the sidewalk has been continuously covered."""
    active = [
        p
        for p in permits
        if p["expires"] and date.fromisoformat(p["expires"]) >= today and "signed" not in p["status"].lower()
    ]
    if not active:
        return {"active": False, "since": None, "age_days": 0, "permit_count": len(permits)}

    since = min(date.fromisoformat(p["issued"]) for p in active if p["issued"])
    # Walk back through older permits; renewals within 90 days count as one continuous shed
    spans = sorted(
        (
            (date.fromisoformat(p["issued"]), date.fromisoformat(p["expires"]))
            for p in permits
            if p["issued"] and p["expires"]
        ),
        key=lambda s: s[1],
        reverse=True,
    )
    for start, end in spans:
        if start < since and end >= since - timedelta(days=90):
            since = start
    return {
        "active": True,
        "since": since.isoformat(),
        "age_days": (today - since).days,
        "permit_count": len(permits),
    }


async def _violations(client: httpx.AsyncClient, bin_id: str) -> list[dict[str, Any]]:
    hpd, dob = await asyncio.gather(
        _soda(
            client,
            HPD_VIOLATIONS,
            {
                "$where": f"bin='{bin_id}' AND violationstatus='Open' AND class in('B','C')",
                "$select": "violationid,class,novdescription,inspectiondate,apartment,story",
                "$order": "inspectiondate DESC",
                "$limit": 150,
            },
        ),
        _soda(
            client,
            DOB_SAFETY,
            {
                "$where": f"bin='{bin_id}' AND violation_status='Active'",
                "$select": "violation_number,violation_remarks,device_type,violation_issue_date",
                "$limit": 50,
            },
        ),
    )
    out = [
        {
            "source": "HPD",
            "id": r.get("violationid"),
            "class": r.get("class"),
            "category": "Housing",
            "description": r.get("novdescription", ""),
            "date": r.get("inspectiondate", "")[:10],
            "apartment": r.get("apartment"),
            "story": r.get("story"),
        }
        for r in hpd
    ]
    for r in dob:
        device = r.get("device_type", "")
        if any(tag in device for tag in PAPERWORK_DEVICES):
            continue
        out.append(
            {
                "source": "DOB",
                "id": r.get("violation_number"),
                "class": None,
                "category": device,
                "description": r.get("violation_remarks", ""),
                "date": r.get("violation_issue_date", "")[:10],
            }
        )
    for v in out:
        v["fire"] = is_fire_violation(v)
    return out


def _complaint_kind(row: dict[str, Any]) -> str:
    return "heat" if row.get("complaint_type") == "HEAT/HOT WATER" else "flood"


def _where_place(bbl: str | None, street_address: str) -> str:
    # Condo units carry their own BBLs in 311, so match the street address too
    return f"(bbl='{_q(bbl or '')}' OR incident_address='{_q(street_address.upper())}')"


def _street(place: dict[str, Any]) -> str:
    return place.get("name") or place.get("label", "").split(",")[0]


async def complaint_history(place: dict[str, Any], first_year: int) -> list[dict[str, Any]]:
    """Every heat/flood 311 row for the building since Jan 1 of first_year (for Tiger Data)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        rows = await _soda(
            client,
            COMPLAINTS_311,
            {
                "$where": f"{_where_place(place.get('bbl'), _street(place))} AND {COMPLAINT_FILTER}"
                f" AND created_date >= '{first_year}-01-01'",
                "$select": "unique_key,created_date,complaint_type,descriptor",
                "$limit": 50000,
            },
        )
    return [
        {
            "id": r.get("unique_key"),
            "created_at": r.get("created_date"),
            "type": r.get("complaint_type"),
            "descriptor": r.get("descriptor"),
            "kind": _complaint_kind(r),
        }
        for r in rows
    ]


async def _complaints(
    client: httpx.AsyncClient, bbl: str | None, street_address: str, today: date
) -> tuple[list[dict[str, Any]], dict[str, int], list[dict[str, int]]]:
    where_place = _where_place(bbl, street_address)
    year_ago = (today - timedelta(days=365)).isoformat()
    decade_ago = date(today.year - 9, 1, 1).isoformat()
    last_year = f"{where_place} AND {COMPLAINT_FILTER} AND created_date > '{year_ago}'"
    recent, by_type, trend = await asyncio.gather(
        _soda(
            client,
            COMPLAINTS_311,
            {
                "$where": last_year,
                "$select": "unique_key,created_date,complaint_type,descriptor,status",
                "$order": "created_date DESC",
                "$limit": 100,
            },
        ),
        _soda(
            client,
            COMPLAINTS_311,
            {"$select": "complaint_type, count(*) as n", "$where": last_year, "$group": "complaint_type"},
        ),
        _soda(
            client,
            COMPLAINTS_311,
            {
                "$select": "date_extract_y(created_date) as year, count(*) as n",
                "$where": f"{where_place} AND {COMPLAINT_FILTER} AND created_date > '{decade_ago}'",
                "$group": "year",
                "$order": "year",
            },
        ),
    )
    complaints = [
        {
            "id": r.get("unique_key"),
            "date": r.get("created_date", "")[:10],
            "type": r.get("complaint_type"),
            "descriptor": r.get("descriptor"),
            "status": r.get("status"),
            "kind": _complaint_kind(r),
        }
        for r in recent
    ]
    counts = {"heat": 0, "flood": 0}
    for r in by_type:
        counts[_complaint_kind(r)] += int(r["n"])
    by_year = {int(r["year"]): int(r["n"]) for r in trend if r.get("year")}
    series = [{"year": y, "n": by_year.get(y, 0)} for y in range(today.year - 9, today.year + 1)]
    return complaints, counts, series


async def _footprint(client: httpx.AsyncClient, bin_id: str) -> dict[str, Any]:
    rows = await _soda(
        client,
        FOOTPRINTS,
        {
            "$where": f"bin='{bin_id}'",
            "$select": "the_geom,height_roof,ground_elevation,construction_year",
            "$limit": 1,
        },
    )
    if not rows:
        return {}
    row = rows[0]
    geom = row.get("the_geom") or {}
    ring = None
    if geom.get("type") == "MultiPolygon" and geom.get("coordinates"):
        ring = geom["coordinates"][0][0]
    elif geom.get("type") == "Polygon" and geom.get("coordinates"):
        ring = geom["coordinates"][0]
    height_ft = float(row["height_roof"]) if row.get("height_roof") else None
    ground_ft = float(row["ground_elevation"]) if row.get("ground_elevation") else None
    year = row.get("construction_year")
    return {
        "footprint": ring,
        "height_m": round(height_ft * 0.3048, 1) if height_ft else None,
        "ground_m": round(ground_ft * 0.3048, 1) if ground_ft is not None else None,
        "year_built": int(year) if year and year.isdigit() and int(year) > 1700 else None,
    }


def _box(lng: float, lat: float, half: float = 0.00012) -> list[list[float]]:
    return [
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
    ]


async def _safe(name: str, coro, default, gaps: list[str]):
    try:
        return await coro
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        print(f"[nyc_data] {name} failed: {exc}")
        gaps.append(name)
        return default


def _pretty_address(place: dict[str, Any]) -> str:
    name = place.get("name") or place.get("label", "").split(",")[0]
    borough = place.get("borough") or ""
    return f"{name.title()}, {borough}".strip(", ")


async def build_building(place: dict[str, Any]) -> dict[str, Any]:
    today = date.today()
    gaps: list[str] = []
    bin_id, bbl = place["bin"], place.get("bbl")
    lng, lat = place["coordinates"]
    street = _street(place)

    async with httpx.AsyncClient(timeout=30.0) as client:
        permits, violations, (complaints, counts, trend), shape = await asyncio.gather(
            _safe("sidewalk sheds", _sheds(client, bin_id), [], gaps),
            _safe("violations", _violations(client, bin_id), [], gaps),
            _safe("311 complaints", _complaints(client, bbl, street, today), ([], {"heat": 0, "flood": 0}, []), gaps),
            _safe("footprint", _footprint(client, bin_id), {}, gaps),
        )

    shed = shed_summary(permits, today)
    complaint_total = counts["heat"] + counts["flood"]
    breakdown = score_breakdown(shed, violations, complaint_total)
    score = min(100, sum(breakdown.values()))
    return {
        "bin": bin_id,
        "bbl": bbl,
        "address": _pretty_address(place),
        "borough": place.get("borough", ""),
        "location": {"type": "Point", "coordinates": [lng, lat]},
        "footprint": shape.get("footprint") or _box(lng, lat),
        "height_m": shape.get("height_m"),
        "ground_m": shape.get("ground_m"),
        "year_built": shape.get("year_built"),
        "shed": shed,
        "shed_permits": permits[:20],
        "violations": violations,
        "complaints": complaints,
        "complaint_counts": counts,
        "complaint_trend": trend,
        "trend_source": "nyc_open_data",
        "hazard_score": score,
        "risk_label": risk_label_for_score(score),
        "risk_reason": risk_reason(shed, violations, complaint_total),
        "score_breakdown": breakdown,
        "data_gaps": gaps,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
