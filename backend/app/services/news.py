"""Past press coverage for an address via Tavily."""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.config import get_settings


async def building_news(address: str) -> list[dict[str, Any]]:
    key = get_settings().tavily_api_key
    if not key or not address:
        return []
    query = f'"{address}" NYC building (violation OR fire OR scaffold OR "sidewalk shed" OR flooding OR heat OR tenants)'
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            r = await http.post(
                "https://api.tavily.com/search",
                headers={"Authorization": f"Bearer {key}"},
                json={"query": query, "search_depth": "basic", "max_results": 5},
            )
            r.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"[news] tavily failed: {exc}")
        return []
    # Search engines happily return other buildings on the same street
    house, street = (address.split(",")[0].split() + ["", ""])[:2]
    return [
        {
            "title": row.get("title") or row.get("url", ""),
            "url": row.get("url", ""),
            "snippet": (row.get("content") or "")[:220],
            "published_date": row.get("published_date"),
        }
        for row in r.json().get("results", [])
        if _about(row.get("title", ""), row.get("content", ""), house.lower(), street.lower())
    ][:5]


def _norm(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9-]+", text.lower()))


def _about(title: str, content: str, house: str, street: str) -> bool:
    # Listing pages for a neighbour ("963 Woodycrest") often mention ours in the body
    named = re.search(rf"\b(\d[\d-]*) {re.escape(street)}", _norm(title))
    if named and named.group(1) != house:
        return False
    return f"{house} {street}" in _norm(f"{title} {content}")
