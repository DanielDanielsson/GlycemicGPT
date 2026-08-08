"""Resolution aware glucose series queries for dashboard timelines."""

import hashlib
import json
import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from src.models.glucose import GlucoseReading
from src.services.cgm_source import get_excluded_cgm_sources

GlucoseSeriesMode = Literal["raw", "reduced"]

MIN_GLUCOSE_SERIES_DATA_POINTS = 4
MAX_GLUCOSE_SERIES_DATA_POINTS = 2_000
GLUCOSE_SERIES_POINTS_PER_BUCKET = 4
GLUCOSE_SERIES_CONTINUITY_GAP_MS = 15 * 60 * 1_000

_DAY_MS = 86_400_000
_NICE_INTERVALS_MS = (
    1,
    10,
    50,
    100,
    200,
    500,
    1_000,
    2_000,
    5_000,
    10_000,
    30_000,
    60_000,
    120_000,
    300_000,
    600_000,
    900_000,
    1_800_000,
    3_600_000,
    7_200_000,
    21_600_000,
    43_200_000,
    86_400_000,
)


@dataclass(frozen=True)
class GlucoseSeriesResult:
    """Readings and metadata needed by the optimized series response."""

    readings: list[GlucoseReading]
    raw_reading_count: int
    reduction_mode: GlucoseSeriesMode
    bucket_interval_ms: int | None
    timeline_revision: str
    excluded_sources: list[str]
    continuity_gaps: list[tuple[datetime, datetime]]


async def _get_continuity_gaps(
    db: AsyncSession,
    filters: Sequence[ColumnElement[bool]],
) -> list[tuple[datetime, datetime]]:
    """Find real sensor gaps before resolution reduction removes cadence detail."""
    previous_timestamp = func.lag(GlucoseReading.reading_timestamp).over(
        order_by=(
            GlucoseReading.reading_timestamp.asc(),
            GlucoseReading.id.asc(),
        )
    )
    ordered = (
        select(
            GlucoseReading.reading_timestamp.label("current_timestamp"),
            previous_timestamp.label("previous_timestamp"),
        )
        .where(*filters)
        .subquery()
    )
    result = await db.execute(
        select(
            ordered.c.previous_timestamp,
            ordered.c.current_timestamp,
        )
        .where(
            ordered.c.previous_timestamp.is_not(None),
            ordered.c.current_timestamp - ordered.c.previous_timestamp
            > timedelta(milliseconds=GLUCOSE_SERIES_CONTINUITY_GAP_MS),
        )
        .order_by(ordered.c.current_timestamp.asc())
    )
    return [(row[0], row[1]) for row in result.all()]


def round_nice_interval_ms_up(interval_ms: int) -> int:
    """Round an interval up without making it more detailed."""
    if interval_ms <= 0:
        return 1

    for candidate in _NICE_INTERVALS_MS:
        if candidate >= interval_ms:
            return candidate

    return math.ceil(interval_ms / _DAY_MS) * _DAY_MS


def resolve_glucose_series_interval_ms(
    start: datetime,
    end: datetime,
    max_data_points: int,
) -> int:
    """Choose a start anchored interval whose candidates fit the point budget."""
    bucket_budget = max(
        1,
        max_data_points // GLUCOSE_SERIES_POINTS_PER_BUCKET,
    )
    duration_ms = max(1, math.ceil((end - start).total_seconds() * 1_000))
    return round_nice_interval_ms_up(math.ceil(duration_ms / bucket_budget))


def _timeline_revision(
    *,
    start: datetime,
    end: datetime,
    include_secondary: bool,
    excluded_sources: list[str],
    raw_reading_count: int,
    newest_reading_timestamp: datetime | None,
    newest_received_at: datetime | None,
) -> str:
    payload = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "include_secondary": include_secondary,
        "excluded_sources": sorted(excluded_sources),
        "raw_reading_count": raw_reading_count,
        "newest_reading_timestamp": (
            newest_reading_timestamp.isoformat()
            if newest_reading_timestamp is not None
            else None
        ),
        "newest_received_at": (
            newest_received_at.isoformat() if newest_received_at is not None else None
        ),
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def get_resolution_aware_glucose_series(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    start: datetime,
    end: datetime,
    max_data_points: int,
    include_secondary: bool = False,
) -> GlucoseSeriesResult:
    """Return a raw or excursion preserving glucose series for one user."""
    excluded_sources = await get_excluded_cgm_sources(
        db,
        user_id,
        include_secondary=include_secondary,
    )
    filters = [
        GlucoseReading.user_id == user_id,
        GlucoseReading.reading_timestamp >= start,
        GlucoseReading.reading_timestamp < end,
    ]
    if excluded_sources:
        filters.append(GlucoseReading.source.not_in(excluded_sources))

    aggregate = (
        await db.execute(
            select(
                func.count(GlucoseReading.id),
                func.max(GlucoseReading.reading_timestamp),
                func.max(GlucoseReading.received_at),
            ).where(*filters)
        )
    ).one()
    raw_reading_count = int(aggregate[0] or 0)
    timeline_revision = _timeline_revision(
        start=start,
        end=end,
        include_secondary=include_secondary,
        excluded_sources=excluded_sources,
        raw_reading_count=raw_reading_count,
        newest_reading_timestamp=aggregate[1],
        newest_received_at=aggregate[2],
    )
    continuity_gaps = await _get_continuity_gaps(db, filters)

    if raw_reading_count <= max_data_points:
        result = await db.execute(
            select(GlucoseReading)
            .where(*filters)
            .order_by(
                GlucoseReading.reading_timestamp.asc(),
                GlucoseReading.id.asc(),
            )
        )
        return GlucoseSeriesResult(
            readings=list(result.scalars().all()),
            raw_reading_count=raw_reading_count,
            reduction_mode="raw",
            bucket_interval_ms=None,
            timeline_revision=timeline_revision,
            excluded_sources=excluded_sources,
            continuity_gaps=continuity_gaps,
        )

    interval_ms = resolve_glucose_series_interval_ms(
        start,
        end,
        max_data_points,
    )
    bucket = func.floor(
        (func.extract("epoch", GlucoseReading.reading_timestamp - start) * 1_000)
        / interval_ms
    ).label("bucket")
    candidates = (
        select(
            GlucoseReading.id.label("reading_id"),
            GlucoseReading.value.label("value"),
            GlucoseReading.reading_timestamp.label("reading_timestamp"),
            bucket,
        )
        .where(*filters)
        .subquery()
    )
    ranked = select(
        candidates.c.reading_id,
        func.row_number()
        .over(
            partition_by=candidates.c.bucket,
            order_by=(
                candidates.c.reading_timestamp.asc(),
                candidates.c.reading_id.asc(),
            ),
        )
        .label("first_rank"),
        func.row_number()
        .over(
            partition_by=candidates.c.bucket,
            order_by=(
                candidates.c.reading_timestamp.desc(),
                candidates.c.reading_id.desc(),
            ),
        )
        .label("last_rank"),
        func.row_number()
        .over(
            partition_by=candidates.c.bucket,
            order_by=(
                candidates.c.value.asc(),
                candidates.c.reading_timestamp.asc(),
                candidates.c.reading_id.asc(),
            ),
        )
        .label("minimum_rank"),
        func.row_number()
        .over(
            partition_by=candidates.c.bucket,
            order_by=(
                candidates.c.value.desc(),
                candidates.c.reading_timestamp.asc(),
                candidates.c.reading_id.asc(),
            ),
        )
        .label("maximum_rank"),
    ).subquery()
    selected = (
        select(ranked.c.reading_id)
        .where(
            or_(
                ranked.c.first_rank == 1,
                ranked.c.last_rank == 1,
                ranked.c.minimum_rank == 1,
                ranked.c.maximum_rank == 1,
            )
        )
        .subquery()
    )
    result = await db.execute(
        select(GlucoseReading)
        .join(selected, selected.c.reading_id == GlucoseReading.id)
        .order_by(
            GlucoseReading.reading_timestamp.asc(),
            GlucoseReading.id.asc(),
        )
    )
    readings = list(result.scalars().all())

    if len(readings) > max_data_points:
        raise RuntimeError("Glucose series reduction exceeded its point budget")

    return GlucoseSeriesResult(
        readings=readings,
        raw_reading_count=raw_reading_count,
        reduction_mode="reduced",
        bucket_interval_ms=interval_ms,
        timeline_revision=timeline_revision,
        excluded_sources=excluded_sources,
        continuity_gaps=continuity_gaps,
    )
