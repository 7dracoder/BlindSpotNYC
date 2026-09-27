"""311 history in Tiger Data (TimescaleDB): one hypertable, trends via time_bucket."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS complaints_311 (
    unique_key     text        NOT NULL,
    created_at     timestamptz NOT NULL,
    bin            text        NOT NULL,
    kind           text        NOT NULL,
    complaint_type text,
    descriptor     text,
    PRIMARY KEY (unique_key, created_at)
);
SELECT create_hypertable('complaints_311', by_range('created_at'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS complaints_311_bin_time ON complaints_311 (bin, created_at DESC);
"""

_pool: asyncpg.Pool | None = None


def enabled() -> bool:
    return _pool is not None


async def connect() -> None:
    global _pool
    url = get_settings().tiger_database_url
    if not url:
        return
    pool = await asyncpg.create_pool(url, min_size=1, max_size=4, command_timeout=30)
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA)
    _pool = pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def save_history(bin_id: str, rows: list[dict[str, Any]]) -> int:
    records = [
        (
            r["id"],
            datetime.fromisoformat(r["created_at"]).replace(tzinfo=timezone.utc),
            bin_id,
            r["kind"],
            r["type"],
            r["descriptor"],
        )
        for r in rows
        if r.get("id") and r.get("created_at")
    ]
    async with _pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO complaints_311 (unique_key, created_at, bin, kind, complaint_type, descriptor)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
            """,
            records,
        )
    return len(records)


async def yearly_trend(bin_id: str, first_year: int, last_year: int) -> list[dict[str, int]]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                extract(year FROM time_bucket('1 year', created_at))::int AS year,
                count(*)::int AS n,
                count(*) FILTER (WHERE kind = 'heat')::int AS heat,
                count(*) FILTER (WHERE kind = 'flood')::int AS flood
            FROM complaints_311
            WHERE bin = $1 AND created_at >= make_date($2, 1, 1)
            GROUP BY 1
            ORDER BY 1
            """,
            bin_id,
            first_year,
        )
    by_year = {r["year"]: r for r in rows}
    return [
        {
            "year": y,
            "n": by_year[y]["n"] if y in by_year else 0,
            "heat": by_year[y]["heat"] if y in by_year else 0,
            "flood": by_year[y]["flood"] if y in by_year else 0,
        }
        for y in range(first_year, last_year + 1)
    ]


async def trend_insight(bin_id: str, this_year: int) -> str | None:
    """Compare this year to the prior decade using time_bucket — that's the Tiger hook."""
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            WITH yearly AS (
                SELECT
                    extract(year FROM time_bucket('1 year', created_at))::int AS year,
                    count(*)::int AS n,
                    count(*) FILTER (WHERE kind = 'heat')::int AS heat
                FROM complaints_311
                WHERE bin = $1
                GROUP BY 1
            )
            SELECT
                coalesce((SELECT n FROM yearly WHERE year = $2), 0) AS this_n,
                coalesce((SELECT heat FROM yearly WHERE year = $2), 0) AS this_heat,
                coalesce((SELECT avg(n) FROM yearly WHERE year < $2), 0) AS prior_avg
            FROM (SELECT 1) _
            """,
            bin_id,
            this_year,
        )
    if not row or row["prior_avg"] < 5:
        return None
    this_n = int(row["this_n"])
    avg = float(row["prior_avg"])
    ratio = this_n / avg
    if ratio < 1.6 and this_n < avg * 0.5:
        return (
            f"Heat/flood 311 this year is running below the prior decade "
            f"({this_n} so far vs {avg:.0f}/yr typical)."
        )
    if ratio < 1.6:
        return None
    heat = int(row["this_heat"])
    what = "mostly no-heat calls" if heat >= this_n * 0.7 else "heat and flood calls"
    return (
        f"Tiger Data: {what} this year are {ratio:.1f}× the prior decade "
        f"({this_n} vs {avg:.0f}/yr)."
    )
