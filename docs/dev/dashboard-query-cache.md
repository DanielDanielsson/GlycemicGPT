# Dashboard query cache

The authenticated dashboard uses an in memory TanStack Query cache.

This document is the detailed cache policy reference. See [Dashboard performance architecture](dashboard-performance.md) for the complete data flow, resolution aware series, server aggregation, rendering ownership, regression checks, and server response caching behavior.

## Ownership

`AuthenticatedQueryProvider` owns one `QueryClient` for the lifetime of the authenticated application shell. It is mounted below `UserProvider`, so dashboard queries wait for a stable user ID.

Every dashboard key begins with `dashboard` and the authenticated user ID. The provider clears the complete cache when the user ID changes. The sign out control also clears it before redirecting to login.

No query data is written to local storage, session storage, IndexedDB, or another durable browser store.

## Keys

The key factory lives in `apps/web/src/lib/query/dashboard.ts`. Keys contain every input supported by the API contract. These inputs include the raw time range, periods, limits, offsets, time zone, and the server selected source marker.

Dashboard ranges use `from`, `to`, and `timezone` URL parameters. Relative ranges keep their original expressions, for example `from=now-24h&to=now&timezone=browser`. Absolute and zoomed ranges use ISO timestamps. This makes every committed range shareable and restorable.

Query keys use the raw range expressions rather than the timestamps produced when `now` is resolved. A previously loaded relative range therefore reuses the same cache entry when selected again. Absolute ranges remain isolated by their exact timestamps.

The API chooses the primary source on the server. A successful source mutation invalidates every affected query family. Resolution aware series keys also include the requested point budget so responses with different display resolutions remain isolated.

## Policies

| Resource                        | Fresh time | Inactive retention | Focus refresh | Reconnect refresh | Polling                                  |
| ------------------------------- | ---------: | -----------------: | ------------- | ----------------- | ---------------------------------------- |
| Historical series and summaries |  5 minutes |          5 minutes | Disabled      | Disabled          | Existing centralized stream invalidation |
| Pump status and forecast        | 30 seconds |          5 minutes | Disabled      | Enabled           | Existing centralized stream invalidation |
| Connection freshness            | 30 seconds |          5 minutes | Disabled      | Enabled           | 30 seconds while visible and active      |
| Dashboard settings reads        |  5 minutes |          5 minutes | Disabled      | Disabled          | None                                     |

Read queries retry one transient network or server failure. Client errors, authentication errors, cancellations, and mutations are not retried.

Parameterized reads keep the previous successful data while a new key loads. Affected panels expose an accessible updating state. A background failure preserves cached data and reports that previously loaded data is still shown.

The dashboard query functions intentionally do not consume TanStack cancellation signals. Next development Strict Mode otherwise cancels the first mounted request and causes the remount to issue the same request again. Range specific keys isolate late responses so an obsolete result cannot replace data for the active selection.

## Refresh and invalidation

The glucose stream remains outside TanStack Query. Its five minute throttle centrally invalidates active glucose history, bolus review, pump events, pump status, and forecast queries. Response revisions are metadata only and do not control client refresh decisions.

Successful mutations invalidate only affected resource families. Primary source changes invalidate dependent histories and summaries. Forecast preference changes invalidate forecast. Target range changes invalidate thresholds and derived glucose summaries. Connection changes invalidate connection state and dependent dashboard resources. A user data purge invalidates every dashboard query.

The shell does not prefetch dashboard data from unrelated routes. Queries begin when the dashboard has active consumers, then remain available during navigation until their five minute inactivity timer expires.

## Responsive chart measurements

The responsive chart measurements cover the timeline resources for one committed dashboard window. The focused tests instrument the glucose history, bolus review, and pump history API clients together with the responsive presentation mounts. Independent dashboard resources such as statistics, connection status, forecast, and pump status are not part of these counts.

| Measure | Expected value |
| --- | ---: |
| Dashboard timeline data owners | 1 |
| Initial glucose history client calls | 1 |
| Initial bolus review client calls | 1 |
| Initial pump history client calls | 1 |
| SSE invalidations scheduled during initial loading | 0 |
| Mounted timeline chart runtimes | 1 |
| Additional raw glucose history calls from AGP for the same window | 0 |

`DashboardChartPanels` owns one query result for each timeline resource. It passes that data into the single active responsive presentation. The first SSE reading initializes the five minute refresh throttle without invalidating the initial requests.

The viewport coverage is:

1. Below 768 pixels, one mobile merged runtime mounts.
2. From 768 through 1023 pixels, one desktop merged runtime mounts.
3. From 1024 pixels, one desktop timeline runtime mounts.

The server snapshot renders a loading shell. No chart runtime mounts until the browser breakpoint is available, which keeps hydration stable.
