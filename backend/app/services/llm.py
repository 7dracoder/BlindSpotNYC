"""Tenant Danger Briefing — Gemini if a key is set, otherwise Grok."""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.config import get_settings

SYSTEM_PROMPT = (
    "You are a building safety inspector. Review this JSON data of building "
    "violations and shed permits. Generate a 3-sentence, plain-English "
    "'Tenant Danger Briefing' exposing the real risks (fire, structural decay, "
    "flooding) to a prospective renter. Only state facts present in the data. "
    "Keep it under 75 words, lead with the most dangerous issue, and don't repeat "
    "the numeric score or permit counts. No bullet points, no markdown, no preamble."
)


def _payload(b: dict[str, Any]) -> str:
    violations = b.get("violations") or []
    counts = b.get("complaint_counts") or {}
    fire = [v for v in violations if v["fire"]]
    return json.dumps(
        {
            "address": b.get("address"),
            "year_built": b.get("year_built"),
            "hazard_score": b.get("hazard_score"),
            "risk_label": b.get("risk_label"),
            "sidewalk_shed": b.get("shed"),
            "fire_egress_violations": [v["description"][:200] for v in fire[:6]],
            "other_open_violations": [
                f"{v['source']} {v.get('class') or v.get('category')}: {v['description'][:140]}"
                for v in violations
                if v not in fire
            ][:8],
            "open_violation_count": len(violations),
            "heat_complaints_last_12_months": counts.get("heat", 0),
            "sewer_or_flooding_complaints_last_12_months": counts.get("flood", 0),
            "complaints_per_year": b.get("complaint_trend"),
        },
        default=str,
    )


def fallback_briefing(b: dict[str, Any]) -> str:
    return (
        f"{b.get('address', 'This building')} screens {b.get('risk_label', 'MODERATE')} "
        f"on BlindSpot ({b.get('hazard_score', 0)}/100). {b.get('risk_reason', '')} "
        "Ask the landlord about open violations, the sidewalk shed, and recent heat or sewer complaints before signing."
    )


async def _gemini(key: str, model: str, prompt: str) -> str:
    async with httpx.AsyncClient(timeout=45.0) as http:
        r = await http.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json={
                "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.4},
            },
        )
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()


async def _grok(key: str, model: str, prompt: str) -> str:
    # grok-4.7 reasons before answering; ~30s on a full building is normal
    async with httpx.AsyncClient(timeout=90.0) as http:
        r = await http.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()


async def generate_briefing(building: dict[str, Any]) -> tuple[str, str]:
    """Returns (briefing, engine)."""
    s = get_settings()
    prompt = _payload(building)
    try:
        if s.gemini_api_key:
            return await _gemini(s.gemini_api_key, s.gemini_model, prompt), "gemini"
        if s.xai_api_key:
            return await _grok(s.xai_api_key, s.xai_model, prompt), "grok"
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        print(f"[llm] briefing failed: {type(exc).__name__} {exc}")
    return fallback_briefing(building), "rules"
