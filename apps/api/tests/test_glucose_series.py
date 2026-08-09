"""Tests for the resolution aware V2 glucose timeline series."""

import uuid
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.main import app
from src.models.glucose import GlucoseReading, TrendDirection
from src.models.integration import (
    IntegrationCredential,
    IntegrationStatus,
    IntegrationType,
)
from src.models.nightscout_connection import (
    NightscoutApiVersion,
    NightscoutAuthType,
    NightscoutConnection,
    NightscoutSyncStatus,
)
from src.services.cgm_source import CGM_ROLE_PRIMARY, CGM_ROLE_SECONDARY
from src.services.glucose_series import resolve_glucose_series_interval_ms


async def _register(client: AsyncClient) -> tuple[str, uuid.UUID]:
    email = f"series-{uuid.uuid4().hex[:10]}@example.com"
    password = "SecurePass123"
    response = await client.post(
        "/api/auth/register",
        json={"email": email, "password": password},
    )
    assert response.status_code == 201, response.text
    login = await client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    cookie = login.cookies.get(settings.jwt_cookie_name)
    assert cookie is not None
    me = await client.get(
        "/api/auth/me",
        cookies={settings.jwt_cookie_name: cookie},
    )
    assert me.status_code == 200, me.text
    return cookie, uuid.UUID(me.json()["id"])


async def _seed_readings(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    start: datetime,
    values: list[int],
    source: str = "dexcom",
    spacing_minutes: int = 5,
) -> None:
    for index, value in enumerate(values):
        timestamp = start + timedelta(minutes=index * spacing_minutes)
        db.add(
            GlucoseReading(
                user_id=user_id,
                value=value,
                reading_timestamp=timestamp,
                trend=TrendDirection.FLAT,
                trend_rate=0.0,
                received_at=timestamp,
                source=source,
            )
        )
    await db.commit()


def _series_params(start: datetime, end: datetime, budget: int) -> dict[str, str]:
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "maxDataPoints": str(budget),
    }


def test_resolves_nice_interval_that_strictly_fits_budget() -> None:
    start = datetime(2026, 8, 1, tzinfo=UTC)
    end = start + timedelta(days=7)

    interval_ms = resolve_glucose_series_interval_ms(start, end, 640)

    assert interval_ms == 7_200_000
    bucket_count = (end - start) / timedelta(milliseconds=interval_ms)
    assert bucket_count * 4 <= 640


class TestGlucoseSeriesEndpoint:
    async def test_requires_authentication_and_exact_valid_inputs(self) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            unauthenticated = await client.get(
                "/api/integrations/glucose/series",
                params={
                    "start": "2026-08-01T00:00:00Z",
                    "end": "2026-08-01T01:00:00Z",
                    "maxDataPoints": "320",
                },
            )
            assert unauthenticated.status_code == 401

            cookie, _ = await _register(client)
            cookies = {settings.jwt_cookie_name: cookie}

            missing = await client.get(
                "/api/integrations/glucose/series",
                cookies=cookies,
            )
            assert missing.status_code == 422

            too_small = await client.get(
                "/api/integrations/glucose/series",
                params={
                    "start": "2026-08-01T00:00:00Z",
                    "end": "2026-08-01T01:00:00Z",
                    "maxDataPoints": "3",
                },
                cookies=cookies,
            )
            assert too_small.status_code == 422

            too_large = await client.get(
                "/api/integrations/glucose/series",
                params={
                    "start": "2026-08-01T00:00:00Z",
                    "end": "2026-08-01T01:00:00Z",
                    "maxDataPoints": "2001",
                },
                cookies=cookies,
            )
            assert too_large.status_code == 422

            supported_range = await client.get(
                "/api/integrations/glucose/series",
                params={
                    "start": "2026-05-03T00:00:00Z",
                    "end": "2026-08-01T00:00:00Z",
                    "maxDataPoints": "320",
                },
                cookies=cookies,
            )
            assert supported_range.status_code == 200

            oversized_range = await client.get(
                "/api/integrations/glucose/series",
                params={
                    "start": "2026-05-02T00:00:00Z",
                    "end": "2026-08-01T00:00:00Z",
                    "maxDataPoints": "320",
                },
                cookies=cookies,
            )
            assert oversized_range.status_code == 422

    async def test_returns_complete_raw_readings_in_chronological_order(self) -> None:
        start = datetime(2026, 8, 1, 10, tzinfo=UTC)
        end = start + timedelta(minutes=25)
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            cookie, user_id = await _register(client)
            async for db in get_db():
                await _seed_readings(
                    db,
                    user_id,
                    start=start,
                    values=[101, 102, 103, 104],
                )
                break

            response = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 4),
                cookies={settings.jwt_cookie_name: cookie},
            )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert [reading["value"] for reading in payload["readings"]] == [
            101,
            102,
            103,
            104,
        ]
        assert payload["metadata"] == {
            "requested_max_data_points": 4,
            "raw_reading_count": 4,
            "returned_point_count": 4,
            "reduction_mode": "raw",
            "bucket_interval_ms": None,
            "timeline_revision": payload["metadata"]["timeline_revision"],
            "applied_window": {
                "start": start.isoformat().replace("+00:00", "Z"),
                "end": end.isoformat().replace("+00:00", "Z"),
            },
            "source_selection": {
                "requested": "primary",
                "excluded_sources": [],
            },
            "continuity": {
                "max_gap_ms": 900000,
                "gaps": [],
            },
        }
        assert len(payload["metadata"]["timeline_revision"]) == 64
        assert payload["readings"][0]["source"] == "dexcom"
        assert payload["readings"][0]["trend"] == "flat"

    async def test_returns_a_stable_empty_raw_series(self) -> None:
        start = datetime(2026, 8, 1, 10, tzinfo=UTC)
        end = start + timedelta(hours=1)
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            cookie, _ = await _register(client)
            response = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 320),
                cookies={settings.jwt_cookie_name: cookie},
            )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["readings"] == []
        assert payload["metadata"]["raw_reading_count"] == 0
        assert payload["metadata"]["returned_point_count"] == 0
        assert payload["metadata"]["reduction_mode"] == "raw"
        assert payload["metadata"]["bucket_interval_ms"] is None
        assert payload["metadata"]["continuity"]["gaps"] == []
        assert len(payload["metadata"]["timeline_revision"]) == 64

    async def test_reduction_preserves_supported_glucose_boundaries(self) -> None:
        start = datetime(2026, 8, 1, 10, tzinfo=UTC)
        end = start + timedelta(minutes=20)
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            cookie, user_id = await _register(client)
            async for db in get_db():
                await _seed_readings(
                    db,
                    user_id,
                    start=start,
                    values=[100, 20, 500, 120, 125, 130],
                    spacing_minutes=3,
                )
                break

            response = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 4),
                cookies={settings.jwt_cookie_name: cookie},
            )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["metadata"]["reduction_mode"] == "reduced"
        assert [reading["value"] for reading in payload["readings"]] == [
            100,
            20,
            500,
            130,
        ]

    async def test_reduction_preserves_excursions_and_never_exceeds_budget(
        self,
    ) -> None:
        start = datetime(2026, 8, 2, 10, tzinfo=UTC)
        end = start + timedelta(minutes=20)
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            cookie, user_id = await _register(client)
            async for db in get_db():
                await _seed_readings(
                    db,
                    user_id,
                    start=start,
                    values=[100, 40, 300, 120, 125, 130, 135, 110],
                    spacing_minutes=2,
                )
                break

            first = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 4),
                cookies={settings.jwt_cookie_name: cookie},
            )
            second = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 4),
                cookies={settings.jwt_cookie_name: cookie},
            )

        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        payload = first.json()
        assert [reading["value"] for reading in payload["readings"]] == [
            100,
            40,
            300,
            110,
        ]
        timestamps = [reading["reading_timestamp"] for reading in payload["readings"]]
        assert timestamps == sorted(timestamps)
        assert len(payload["readings"]) <= 4
        assert payload["metadata"]["raw_reading_count"] == 8
        assert payload["metadata"]["returned_point_count"] == 4
        assert payload["metadata"]["reduction_mode"] == "reduced"
        assert payload["metadata"]["bucket_interval_ms"] == 1_800_000
        assert (
            payload["metadata"]["timeline_revision"]
            == second.json()["metadata"]["timeline_revision"]
        )

    async def test_preserves_user_and_primary_source_isolation(self) -> None:
        start = datetime(2026, 8, 3, 10, tzinfo=UTC)
        end = start + timedelta(hours=1)
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            cookie, user_id = await _register(client)
            _, other_user_id = await _register(client)

            async for db in get_db():
                db.add(
                    IntegrationCredential(
                        user_id=user_id,
                        integration_type=IntegrationType.DEXCOM,
                        encrypted_username="x",
                        encrypted_password="y",
                        status=IntegrationStatus.CONNECTED,
                        cgm_role=CGM_ROLE_PRIMARY,
                    )
                )
                secondary = NightscoutConnection(
                    user_id=user_id,
                    name="Series secondary",
                    base_url="https://series.example.com",
                    auth_type=NightscoutAuthType.TOKEN,
                    encrypted_credential="enc",
                    api_version=NightscoutApiVersion.V1,
                    last_sync_status=NightscoutSyncStatus.NEVER,
                    cgm_role=CGM_ROLE_SECONDARY,
                )
                db.add(secondary)
                await db.commit()
                await db.refresh(secondary)
                secondary_source = f"nightscout:{secondary.id}"
                await _seed_readings(
                    db,
                    user_id,
                    start=start,
                    values=[100, 110],
                    source="dexcom",
                    spacing_minutes=10,
                )
                await _seed_readings(
                    db,
                    user_id,
                    start=start + timedelta(minutes=5),
                    values=[200, 210],
                    source=secondary_source,
                    spacing_minutes=10,
                )
                await _seed_readings(
                    db,
                    other_user_id,
                    start=start + timedelta(minutes=2),
                    values=[500],
                )
                break

            primary = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 20),
                cookies={settings.jwt_cookie_name: cookie},
            )
            all_active = await client.get(
                "/api/integrations/glucose/series",
                params={
                    **_series_params(start, end, 20),
                    "include_secondary": "true",
                },
                cookies={settings.jwt_cookie_name: cookie},
            )

        assert [row["value"] for row in primary.json()["readings"]] == [100, 110]
        assert primary.json()["metadata"]["source_selection"] == {
            "requested": "primary",
            "excluded_sources": [secondary_source],
        }
        assert [row["value"] for row in all_active.json()["readings"]] == [
            100,
            200,
            110,
            210,
        ]
        assert all_active.json()["metadata"]["source_selection"] == {
            "requested": "primary_and_secondary",
            "excluded_sources": [],
        }

    async def test_reports_true_raw_gaps_for_raw_and_reduced_series(self) -> None:
        start = datetime(2026, 8, 4, 10, tzinfo=UTC)
        end = start + timedelta(hours=1)
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            cookie, user_id = await _register(client)
            async for db in get_db():
                await _seed_readings(
                    db,
                    user_id,
                    start=start,
                    values=[100, 110, 120],
                    spacing_minutes=5,
                )
                await _seed_readings(
                    db,
                    user_id,
                    start=start + timedelta(minutes=40),
                    values=[130, 140],
                    spacing_minutes=5,
                )
                break

            raw = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 20),
                cookies={settings.jwt_cookie_name: cookie},
            )
            reduced = await client.get(
                "/api/integrations/glucose/series",
                params=_series_params(start, end, 4),
                cookies={settings.jwt_cookie_name: cookie},
            )

        expected = {
            "max_gap_ms": 900000,
            "gaps": [
                {
                    "start": (start + timedelta(minutes=10))
                    .isoformat()
                    .replace("+00:00", "Z"),
                    "end": (start + timedelta(minutes=40))
                    .isoformat()
                    .replace("+00:00", "Z"),
                }
            ],
        }
        assert raw.json()["metadata"]["continuity"] == expected
        assert reduced.json()["metadata"]["continuity"] == expected
