"""Story 3.2: Glucose reading schemas.

Pydantic schemas for glucose reading API responses.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from src.models.glucose import TrendDirection

CANONICAL_MGDL_NOTE = (
    "Canonical API value in mg/dL. Clients render with the user's glucose_unit "
    "preference."
)


class GlucoseReadingResponse(BaseModel):
    """Response schema for a single glucose reading."""

    model_config = {"from_attributes": True}

    value: int = Field(
        ...,
        description=f"Glucose value in mg/dL. {CANONICAL_MGDL_NOTE}",
        ge=20,
        le=600,
    )
    reading_timestamp: datetime = Field(..., description="When the reading was taken")
    trend: TrendDirection = Field(..., description="Trend direction")
    trend_rate: float | None = Field(None, description="Rate of change in mg/dL/min")
    received_at: datetime = Field(..., description="When we received the reading")
    source: str = Field(..., description="Source device/integration")


class CurrentGlucoseResponse(BaseModel):
    """Response schema for current glucose status."""

    value: int = Field(
        ..., description=f"Current glucose value in mg/dL. {CANONICAL_MGDL_NOTE}"
    )
    trend: TrendDirection = Field(..., description="Current trend direction")
    trend_rate: float | None = Field(None, description="Rate of change in mg/dL/min")
    reading_timestamp: datetime = Field(..., description="When the reading was taken")
    minutes_ago: int = Field(..., description="Minutes since reading")
    is_stale: bool = Field(
        ..., description="True if reading is more than 10 minutes old"
    )


class GlucoseHistoryResponse(BaseModel):
    """Response schema for glucose history."""

    readings: list[GlucoseReadingResponse]
    count: int = Field(..., description="Number of readings returned")


class GlucoseSeriesWindow(BaseModel):
    """Exact UTC window applied to a glucose series request."""

    start: datetime
    end: datetime


class GlucoseSeriesSourceSelection(BaseModel):
    """Requested and resolved CGM source filtering for a glucose series."""

    requested: Literal["primary", "primary_and_secondary"]
    excluded_sources: list[str]


class GlucoseSeriesContinuityGap(BaseModel):
    """A real gap between consecutive raw sensor readings."""

    start: datetime
    end: datetime


class GlucoseSeriesContinuity(BaseModel):
    """Continuity information retained independently from point reduction."""

    max_gap_ms: int = Field(..., ge=1)
    gaps: list[GlucoseSeriesContinuityGap]


class GlucoseSeriesMetadata(BaseModel):
    """Resolution and source metadata for a glucose series response."""

    requested_max_data_points: int = Field(..., ge=4, le=2_000)
    raw_reading_count: int = Field(..., ge=0)
    returned_point_count: int = Field(..., ge=0, le=2_000)
    reduction_mode: Literal["raw", "reduced"]
    bucket_interval_ms: int | None = Field(default=None, ge=1)
    timeline_revision: str = Field(..., min_length=64, max_length=64)
    applied_window: GlucoseSeriesWindow
    source_selection: GlucoseSeriesSourceSelection
    continuity: GlucoseSeriesContinuity


class GlucoseSeriesResponse(BaseModel):
    """Resolution aware glucose readings for timeline rendering."""

    readings: list[GlucoseReadingResponse]
    metadata: GlucoseSeriesMetadata


class TimeInRangeResponse(BaseModel):
    """Response schema for time-in-range statistics."""

    low_pct: float = Field(..., description="Percentage of readings below range")
    in_range_pct: float = Field(..., description="Percentage of readings in range")
    high_pct: float = Field(..., description="Percentage of readings above range")
    readings_count: int = Field(..., description="Total readings analyzed")
    low_threshold: float = Field(
        ..., description=f"Low target threshold in mg/dL. {CANONICAL_MGDL_NOTE}"
    )
    high_threshold: float = Field(
        ..., description=f"High target threshold in mg/dL. {CANONICAL_MGDL_NOTE}"
    )


TirLabel = Literal["urgent_low", "low", "in_range", "high", "urgent_high"]


class TirBucket(BaseModel):
    """A single TIR bucket for 5-bucket clinical breakdown."""

    label: TirLabel = Field(
        ...,
        description="Bucket label: urgent_low, low, in_range, high, urgent_high",
    )
    pct: float = Field(
        ..., ge=0, le=100, description="Percentage of readings in this bucket"
    )
    readings: int = Field(..., ge=0, description="Number of readings in this bucket")
    threshold_low: float | None = Field(
        None,
        ge=20,
        le=500,
        description=f"Lower bound in mg/dL, or null for urgent_low. {CANONICAL_MGDL_NOTE}",
    )
    threshold_high: float | None = Field(
        None,
        ge=20,
        le=500,
        description=f"Upper bound in mg/dL, or null for urgent_high. {CANONICAL_MGDL_NOTE}",
    )


class TirThresholds(BaseModel):
    """Threshold values used for TIR bucket boundaries."""

    urgent_low: float = Field(
        ...,
        ge=20,
        le=500,
        description=f"Urgent low threshold in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    low: float = Field(
        ...,
        ge=20,
        le=500,
        description=f"Low threshold in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    high: float = Field(
        ...,
        ge=20,
        le=500,
        description=f"High threshold in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    urgent_high: float = Field(
        ...,
        ge=20,
        le=500,
        description=f"Urgent high threshold in mg/dL. {CANONICAL_MGDL_NOTE}",
    )


class TimeInRangeDetailResponse(BaseModel):
    """Response schema for 5-bucket TIR with previous-period comparison."""

    buckets: list[TirBucket] = Field(
        ..., description="5 buckets ordered urgent_low -> urgent_high"
    )
    readings_count: int = Field(
        ..., ge=0, description="Total readings in current period"
    )
    previous_buckets: list[TirBucket] | None = Field(
        None, description="Previous period buckets (null if insufficient data)"
    )
    previous_readings_count: int | None = Field(
        None, ge=0, description="Total readings in previous period"
    )
    thresholds: TirThresholds = Field(
        ...,
        description="Threshold values used for bucket boundaries",
    )


class GlucoseStatsResponse(BaseModel):
    """Response schema for aggregate glucose statistics (Story 30.1)."""

    mean_glucose: float = Field(
        ..., ge=0, le=500, description=f"Mean glucose in mg/dL. {CANONICAL_MGDL_NOTE}"
    )
    std_dev: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"Standard deviation in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    min_glucose: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"Minimum glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    max_glucose: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"Maximum glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    cv_pct: float = Field(..., ge=0, description="Coefficient of variation (%)")
    gmi: float = Field(
        ..., ge=0, description="Glucose Management Indicator (est. A1C %)"
    )
    cgm_active_pct: float = Field(
        ...,
        ge=0,
        le=100,
        description="CGM active time as % of period (assumes 5-min intervals, capped at 100)",
    )
    readings_count: int = Field(..., ge=0, description="Total readings in period")
    period_minutes: int = Field(..., ge=1, description="Analysis window in minutes")


class GlucoseAggregationWindow(BaseModel):
    """Exact UTC window applied to a derived glucose calculation."""

    start: datetime
    end: datetime


class GlucoseAggregationSourceSelection(BaseModel):
    """Requested and resolved source filtering for a derived calculation."""

    requested: Literal["primary", "primary_and_secondary"]
    excluded_sources: list[str]


class GlucoseTargetRangeSnapshot(BaseModel):
    """Configured thresholds used by the response snapshot."""

    urgent_low: float = Field(..., ge=20, le=500)
    low: float = Field(..., ge=20, le=500)
    high: float = Field(..., ge=20, le=500)
    urgent_high: float = Field(..., ge=20, le=500)

    @model_validator(mode="after")
    def validate_threshold_ordering(self) -> "GlucoseTargetRangeSnapshot":
        """Keep response metadata consistent with stored range invariants."""
        if not self.urgent_low < self.low < self.high < self.urgent_high:
            raise ValueError(
                "Thresholds must satisfy urgent_low < low < high < urgent_high"
            )
        return self


class GlucoseAggregationMetadata(BaseModel):
    """Accuracy, identity, and input metadata for derived glucose data."""

    applied_window: GlucoseAggregationWindow
    comparison_window: GlucoseAggregationWindow | None = None
    time_zone: str
    readings_count: int = Field(..., ge=0)
    is_truncated: bool
    glucose_revision: str = Field(..., min_length=64, max_length=64)
    target_range_revision: str = Field(..., min_length=64, max_length=64)
    calculation_revision: str = Field(..., min_length=64, max_length=64)
    source_selection: GlucoseAggregationSourceSelection
    target_range: GlucoseTargetRangeSnapshot


class AGPBucket(BaseModel):
    """A single hourly AGP bucket with percentile values."""

    hour: int = Field(..., description="Hour of day (0-23)", ge=0, le=23)
    p10: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"10th percentile glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    p25: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"25th percentile glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    p50: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"Median glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    p75: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"75th percentile glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    p90: float = Field(
        ...,
        ge=0,
        le=500,
        description=f"90th percentile glucose in mg/dL. {CANONICAL_MGDL_NOTE}",
    )
    count: int = Field(..., ge=0, description="Number of readings in this hour")


class GlucosePercentilesResponse(BaseModel):
    """Response schema for AGP percentile bands (Story 30.1)."""

    buckets: list[AGPBucket] = Field(
        ..., description="Hourly AGP percentile buckets (0-23)"
    )
    period_days: int = Field(..., ge=1, description="Number of days analyzed")
    readings_count: int = Field(..., ge=0, description="Total readings used")
    is_truncated: bool = Field(
        False,
        description="False for complete results. Incomplete aggregates fail instead of returning partial data.",
    )
    metadata: GlucoseAggregationMetadata


class DashboardGlucoseSummaryResponse(BaseModel):
    """Atomic V2 glucose statistics and detailed time in range snapshot."""

    statistics: GlucoseStatsResponse
    time_in_range: TimeInRangeDetailResponse
    metadata: GlucoseAggregationMetadata


class SyncResponse(BaseModel):
    """Response schema for sync operation."""

    message: str = Field(..., description="Status message")
    readings_fetched: int = Field(
        ..., description="Number of readings fetched from Dexcom"
    )
    readings_stored: int = Field(..., description="Number of new readings stored")
    last_reading: GlucoseReadingResponse | None = Field(
        None, description="Most recent reading"
    )


class SyncStatusResponse(BaseModel):
    """Response schema for sync status."""

    integration_status: str = Field(..., description="Integration connection status")
    last_sync_at: datetime | None = Field(None, description="Last successful sync time")
    last_error: str | None = Field(None, description="Last error message if any")
    readings_available: int = Field(..., description="Number of readings in database")
    latest_reading: GlucoseReadingResponse | None = Field(
        None, description="Most recent reading"
    )
