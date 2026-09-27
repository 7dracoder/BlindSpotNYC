"""Voice inspector: the building report the ElevenLabs agent talks from, plus a session token."""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.config import get_settings


def _violation_line(v: dict[str, Any]) -> str:
    where = ", ".join(p for p in (v.get("story") and f"floor {v['story']}", v.get("apartment") and f"apt {v['apartment']}") if p)
    label = f"HPD class {v['class']}" if v["source"] == "HPD" else f"DOB {v['category']}"
    # HPD text opens with code citations ("§ 27-2005, 27-2007 HMC: ...") that would be read aloud
    text = re.sub(r"^\s*§.*?(HMC|MDL|RCNY|CODE)[^:]*:\s*", "", v["description"], flags=re.IGNORECASE)
    return f"- {label}{f' ({where})' if where else ''}, {v['date']}: {text[:170].capitalize()}"


async def building_report(b: dict[str, Any], analysis: dict[str, Any]) -> str:
    violations = b.get("violations") or []
    fire = [v for v in violations if v["fire"]]
    other = [v for v in violations if not v["fire"]]
    class_c = sum(1 for v in violations if v.get("class") == "C")
    shed = b.get("shed") or {}
    counts = b.get("complaint_counts") or {}
    trend = ", ".join(f"{t['year']}: {t['n']}" for t in b.get("complaint_trend") or [])

    lines = [
        f"Address: {b['address']} (BIN {b['bin']}). Built {b.get('year_built') or 'unknown'}, "
        f"about {round(b['height_m'] / 3.2) if b.get('height_m') else 'unknown'} stories tall.",
        f"BlindSpot hazard score: {b['hazard_score']}/100, {b['risk_label']} risk. Why: {b['risk_reason']}",
        "Sidewalk shed: "
        + (f"up continuously since {shed['since']} ({shed['age_days']} days)." if shed.get("active") else "none active right now.")
        + f" {shed.get('permit_count', 0)} shed permits on record.",
        f"Open violations: {len(violations)} total, {class_c} class C (immediately hazardous), {len(fire)} fire/egress related.",
        f"311 in the past 12 months: {counts.get('heat', 0)} heat/hot water complaints, "
        f"{counts.get('flood', 0)} sewer backup or catch basin complaints.",
        f"Heat/flood 311 complaints per year: {trend}.",
    ]
    if fire:
        lines.append("Fire and egress violations:")
        lines += [_violation_line(v) for v in fire[:8]]
    if other:
        lines.append("Other open violations (most recent first):")
        lines += [_violation_line(v) for v in other[:12]]
    lines.append(f"Written briefing already shown to the renter: {analysis.get('briefing', '')}")
    news = analysis.get("news") or []
    lines.append(
        "News and listings mentioning this address: " + "; ".join(n["title"] for n in news[:4])
        if news
        else "No news coverage found for this address."
    )
    return "\n".join(lines)


async def conversation_token() -> str:
    s = get_settings()
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(
            "https://api.elevenlabs.io/v1/convai/conversation/token",
            params={"agent_id": s.elevenlabs_agent_id},
            headers={"xi-api-key": s.elevenlabs_api_key},
        )
        r.raise_for_status()
        return r.json()["token"]
