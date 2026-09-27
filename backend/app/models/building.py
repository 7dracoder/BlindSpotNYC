from typing import Any, Literal

from pydantic import BaseModel, Field

RiskLabel = Literal["LOW", "MODERATE", "HIGH"]


class Place(BaseModel):
    label: str
    name: str
    borough: str
    bin: str
    bbl: str | None = None
    coordinates: list[float]


class Building(BaseModel):
    bin: str
    bbl: str | None = None
    address: str
    borough: str
    location: dict[str, Any]
    footprint: list[list[float]]
    height_m: float | None = None
    ground_m: float | None = None
    year_built: int | None = None
    shed: dict[str, Any]
    shed_permits: list[dict[str, Any]] = Field(default_factory=list)
    violations: list[dict[str, Any]] = Field(default_factory=list)
    complaints: list[dict[str, Any]] = Field(default_factory=list)
    complaint_counts: dict[str, int]
    complaint_trend: list[dict[str, int]] = Field(default_factory=list)
    trend_insight: str | None = None
    trend_source: Literal["nyc_open_data", "tiger"] = "nyc_open_data"
    hazard_score: int
    risk_label: RiskLabel
    risk_reason: str
    score_breakdown: dict[str, int]
    data_gaps: list[str] = Field(default_factory=list)
    fetched_at: str


class Analysis(BaseModel):
    bin: str
    fetched_at: str
    briefing: str
    engine: str
    news: list[dict[str, Any]] = Field(default_factory=list)
    audio_url: str | None = None
    audio_engine: str | None = None


class NearbyBuilding(BaseModel):
    bin: str
    address: str
    location: dict[str, Any]
    hazard_score: int
    risk_label: RiskLabel


class SmsLookupRequest(BaseModel):
    text: str


class SmsLookupResponse(BaseModel):
    matched: bool
    reply_text: str
    bin: str | None = None
    map_url: str | None = None
    audio_url: str | None = None
