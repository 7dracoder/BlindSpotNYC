"""Pre-warm the golden-path buildings (records + briefing + audio) before a demo.

    uv run python scripts/ingest.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import close_db, connect_db
from app.routers.api import analyze_audio, _lookup
from app.services import tiger

GOLDEN_PATH = [
    "3605 Sedgwick Avenue, Bronx",
    "957 Woodycrest Avenue, Bronx",
    "76 Saint Nicholas Place, Manhattan",
    "225 West 86 Street, Manhattan",
]


async def main() -> None:
    try:
        await connect_db()
    except Exception as exc:
        print(f"MongoDB unavailable, nothing will persist: {exc}")
    await tiger.connect()
    for address in GOLDEN_PATH:
        b = await _lookup(address)
        a = await analyze_audio(b["bin"])
        print(
            f"{b['address']:40} {b['risk_label']:8} {b['hazard_score']:3}  "
            f"{a['engine']}/{a['audio_engine']}  trend:{b.get('trend_source')}"
        )
    await tiger.close()
    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
