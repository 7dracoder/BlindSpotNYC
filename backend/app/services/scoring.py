"""BlindSpot hazard index: min(100, S_fire + S_shed + S_env + S_repeat)."""

from __future__ import annotations

from typing import Any

FIRE_KEYWORDS = (
    "SELF-CLOSING",
    "SELF CLOSING",
    "FIRE ESCAPE",
    "EGRESS",
    "FIRE STOP",
    "FIRE-STOP",
    "FIRE RETARD",
    "SMOKE DETECT",
    "CARBON MONOXIDE",
    "SPRINKLER",
    "EXIT",
)
FIRE_DOB_DEVICES = ("Sprinklers", "Emergency Power", "Photoluminescent")


def is_fire_violation(v: dict[str, Any]) -> bool:
    if v.get("source") == "HPD":
        # Class C = immediately hazardous under the Housing Maintenance Code
        desc = (v.get("description") or "").upper()
        return v.get("class") == "C" and any(k in desc for k in FIRE_KEYWORDS)
    return v.get("category") in FIRE_DOB_DEVICES


def score_breakdown(
    shed: dict[str, Any],
    violations: list[dict[str, Any]],
    complaint_total: int,
) -> dict[str, int]:
    return {
        "S_fire": 40 if any(v["fire"] for v in violations) else 0,
        "S_shed": 25 if shed.get("active") and shed.get("age_days", 0) > 730 else 0,
        "S_env": 15 if complaint_total >= 3 else 0,
        "S_repeat": 20 if len(violations) + complaint_total > 5 else 0,
    }


def risk_label_for_score(score: int) -> str:
    if score <= 20:
        return "LOW"
    if score <= 59:
        return "MODERATE"
    return "HIGH"


def risk_reason(
    shed: dict[str, Any],
    violations: list[dict[str, Any]],
    complaint_total: int,
) -> str:
    clauses: list[str] = []
    fire = sum(1 for v in violations if v["fire"])
    if fire:
        clauses.append(f"{fire} open fire/egress violation{'s' if fire > 1 else ''}")
    if shed.get("active") and shed.get("age_days", 0) > 730:
        clauses.append(f"sidewalk shed up {shed['age_days'] // 365}+ years")
    if complaint_total >= 3:
        clauses.append(f"{complaint_total} heat/flood 311 complaints in the past year")
    if len(clauses) < 2 and len(violations) + complaint_total > 5:
        clauses.append(f"{len(violations)} open violations on file")
    if not clauses:
        return "No fire/egress violations, chronic shed, or repeat heat/flood complaints on record."
    text = "; ".join(clauses[:2])
    return text[0].upper() + text[1:] + "."
