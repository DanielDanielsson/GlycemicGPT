"""Complete glucose aggregations for V2 dashboard derived panels."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Integer, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.glucose import GlucoseReading
from src.services.cgm_source import glucose_source_exclusion_clause


@dataclass(frozen=True)
class AgpHourAggregation:
    """Percentiles and source metadata for one local hour."""

    hour: int
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    count: int
    newest_reading_timestamp: datetime | None
    newest_received_at: datetime | None


@dataclass(frozen=True)
class DashboardGlucoseAggregation:
    """One statement result for current statistics and current/previous TIR."""

    current_count: int
    mean: float
    stddev: float
    minimum: float
    maximum: float
    current_bucket_counts: dict[str, int]
    previous_count: int
    previous_bucket_counts: dict[str, int]
    newest_reading_timestamp: datetime | None
    newest_received_at: datetime | None
    previous_newest_reading_timestamp: datetime | None
    previous_newest_received_at: datetime | None


def glucose_revision(
    *,
    start: datetime,
    end: datetime,
    excluded_sources: list[str],
    readings_count: int,
    newest_reading_timestamp: datetime | None,
    newest_received_at: datetime | None,
) -> str:
    """Return an opaque identity for the eligible glucose snapshot."""
    return opaque_revision(
        {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "excluded_sources": sorted(excluded_sources),
            "readings_count": readings_count,
            "newest_reading_timestamp": (
                newest_reading_timestamp.isoformat()
                if newest_reading_timestamp is not None
                else None
            ),
            "newest_received_at": (
                newest_received_at.isoformat()
                if newest_received_at is not None
                else None
            ),
        }
    )


def opaque_revision(payload: dict[str, object]) -> str:
    """Hash revision inputs without exposing ordering semantics to clients."""
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _eligible_filters(
    user_id: uuid.UUID,
    *,
    excluded_sources: list[str],
) -> list:
    return [
        GlucoseReading.user_id == user_id,
        GlucoseReading.value >= 20,
        GlucoseReading.value <= 500,
        *glucose_source_exclusion_clause(excluded_sources),
    ]


async def get_complete_agp_aggregation(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    start: datetime,
    end: datetime,
    time_zone: str,
    excluded_sources: list[str],
) -> list[AgpHourAggregation]:
    """Calculate hourly percentiles inside PostgreSQL without a row cap."""
    local_hour = cast(
        func.extract(
            "hour",
            func.timezone(time_zone, GlucoseReading.reading_timestamp),
        ),
        Integer,
    )
    result = await db.execute(
        select(
            local_hour.label("hour"),
            func.percentile_cont(0.10).within_group(GlucoseReading.value).label("p10"),
            func.percentile_cont(0.25).within_group(GlucoseReading.value).label("p25"),
            func.percentile_cont(0.50).within_group(GlucoseReading.value).label("p50"),
            func.percentile_cont(0.75).within_group(GlucoseReading.value).label("p75"),
            func.percentile_cont(0.90).within_group(GlucoseReading.value).label("p90"),
            func.count(GlucoseReading.id).label("readings_count"),
            func.max(GlucoseReading.reading_timestamp).label(
                "newest_reading_timestamp"
            ),
            func.max(GlucoseReading.received_at).label("newest_received_at"),
        )
        .where(
            *_eligible_filters(user_id, excluded_sources=excluded_sources),
            GlucoseReading.reading_timestamp >= start,
            GlucoseReading.reading_timestamp < end,
        )
        .group_by(local_hour)
        .order_by(local_hour)
    )
    return [
        AgpHourAggregation(
            hour=int(row.hour),
            p10=round(float(row.p10), 1),
            p25=round(float(row.p25), 1),
            p50=round(float(row.p50), 1),
            p75=round(float(row.p75), 1),
            p90=round(float(row.p90), 1),
            count=int(row.readings_count),
            newest_reading_timestamp=row.newest_reading_timestamp,
            newest_received_at=row.newest_received_at,
        )
        for row in result.all()
    ]


def _bucket_condition(
    label: str,
    *,
    urgent_low: float,
    low: float,
    high: float,
    urgent_high: float,
):
    if label == "urgent_low":
        return GlucoseReading.value < urgent_low
    if label == "low":
        return and_(GlucoseReading.value >= urgent_low, GlucoseReading.value < low)
    if label == "in_range":
        return and_(GlucoseReading.value >= low, GlucoseReading.value <= high)
    if label == "high":
        return and_(GlucoseReading.value > high, GlucoseReading.value <= urgent_high)
    return GlucoseReading.value > urgent_high


async def get_dashboard_glucose_aggregation(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    start: datetime,
    end: datetime,
    urgent_low: float,
    low: float,
    high: float,
    urgent_high: float,
    excluded_sources: list[str],
) -> DashboardGlucoseAggregation:
    """Scan current and comparison glucose windows in one SQL statement."""
    duration = end - start
    previous_start = start - duration
    current_window = and_(
        GlucoseReading.reading_timestamp >= start,
        GlucoseReading.reading_timestamp < end,
    )
    previous_window = and_(
        GlucoseReading.reading_timestamp >= previous_start,
        GlucoseReading.reading_timestamp < start,
    )
    labels = ("urgent_low", "low", "in_range", "high", "urgent_high")
    bucket_conditions = {
        label: _bucket_condition(
            label,
            urgent_low=urgent_low,
            low=low,
            high=high,
            urgent_high=urgent_high,
        )
        for label in labels
    }
    current_bucket_columns = [
        func.count(GlucoseReading.id)
        .filter(current_window, bucket_conditions[label])
        .label(f"current_{label}")
        for label in labels
    ]
    previous_bucket_columns = [
        func.count(GlucoseReading.id)
        .filter(previous_window, bucket_conditions[label])
        .label(f"previous_{label}")
        for label in labels
    ]

    row = (
        await db.execute(
            select(
                func.count(GlucoseReading.id)
                .filter(current_window)
                .label("current_count"),
                func.avg(GlucoseReading.value).filter(current_window).label("mean"),
                func.stddev_pop(GlucoseReading.value)
                .filter(current_window)
                .label("stddev"),
                func.min(GlucoseReading.value).filter(current_window).label("minimum"),
                func.max(GlucoseReading.value).filter(current_window).label("maximum"),
                func.count(GlucoseReading.id)
                .filter(previous_window)
                .label("previous_count"),
                func.max(GlucoseReading.reading_timestamp)
                .filter(current_window)
                .label("newest_reading_timestamp"),
                func.max(GlucoseReading.received_at)
                .filter(current_window)
                .label("newest_received_at"),
                func.max(GlucoseReading.reading_timestamp)
                .filter(previous_window)
                .label("previous_newest_reading_timestamp"),
                func.max(GlucoseReading.received_at)
                .filter(previous_window)
                .label("previous_newest_received_at"),
                *current_bucket_columns,
                *previous_bucket_columns,
            ).where(
                *_eligible_filters(user_id, excluded_sources=excluded_sources),
                GlucoseReading.reading_timestamp >= previous_start,
                GlucoseReading.reading_timestamp < end,
            )
        )
    ).one()

    return DashboardGlucoseAggregation(
        current_count=int(row.current_count or 0),
        mean=float(row.mean or 0),
        stddev=float(row.stddev or 0),
        minimum=float(row.minimum or 0),
        maximum=float(row.maximum or 0),
        current_bucket_counts={
            label: int(getattr(row, f"current_{label}") or 0) for label in labels
        },
        previous_count=int(row.previous_count or 0),
        previous_bucket_counts={
            label: int(getattr(row, f"previous_{label}") or 0) for label in labels
        },
        newest_reading_timestamp=row.newest_reading_timestamp,
        newest_received_at=row.newest_received_at,
        previous_newest_reading_timestamp=row.previous_newest_reading_timestamp,
        previous_newest_received_at=row.previous_newest_received_at,
    )
