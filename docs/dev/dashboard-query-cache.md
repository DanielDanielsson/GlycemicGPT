# Dashboard query cache

GLY 212 adds an in memory TanStack Query cache for the redesigned authenticated dashboard. The legacy dashboard keeps its existing hooks and request state.

## Ownership

`AuthenticatedQueryProvider` owns one `QueryClient` for the lifetime of the authenticated redesigned application shell. It is mounted below `UserProvider`, so dashboard queries wait for a stable user ID.

Every dashboard key begins with `dashboard` and the authenticated user ID. The provider clears the complete cache when the user ID changes. The V2 sign out control also clears it before redirecting to login.

No query data is written to local storage, session storage, IndexedDB, or another durable browser store.

## Keys

The key factory lives in `apps/web/src/lib/query/dashboard.ts`. Keys contain every input supported by the current API contract. These inputs include the raw time range, periods, limits, offsets, time zone, and the server selected source marker.

Dashboard ranges use `from`, `to`, and `timezone` URL parameters. Relative ranges keep their original expressions, for example `from=now-24h&to=now&timezone=browser`. Absolute and zoomed ranges use ISO timestamps. This makes every committed range shareable and restorable.

Query keys use the raw range expressions rather than the timestamps produced when `now` is resolved. A previously loaded relative range therefore reuses the same cache entry when selected again. Absolute ranges remain isolated by their exact timestamps.

The current API chooses the primary source on the server. A successful source mutation invalidates every affected query family. GLY 214 will replace the server source marker with explicit source and resolution values when the resolution aware endpoint exists.

## Policies

| Resource                        | Fresh time | Inactive retention | Focus refresh | Reconnect refresh | Polling                                  |
| ------------------------------- | ---------: | -----------------: | ------------- | ----------------- | ---------------------------------------- |
| Historical series and summaries |  5 minutes |          5 minutes | Disabled      | Disabled          | Existing centralized stream invalidation |
| Pump status and forecast        | 30 seconds |          5 minutes | Disabled      | Enabled           | Existing centralized stream invalidation |
| Connection freshness            | 30 seconds |          5 minutes | Disabled      | Enabled           | 30 seconds while visible and active      |
| Dashboard settings reads        |  5 minutes |          5 minutes | Disabled      | Disabled          | None                                     |

Read queries retry one transient network or server failure. Client errors, authentication errors, cancellations, and mutations are not retried.

Parameterized reads keep the previous successful data while a new key loads. Affected panels expose an accessible updating state. A background failure preserves cached data and reports that previously loaded data is still shown.

TanStack cancellation signals are passed into the V2 API reads. An obsolete range request is cancelled when its observer switches to a different key.

## Refresh and invalidation

The current glucose stream remains outside TanStack Query. Its existing five minute throttle centrally invalidates active glucose history, bolus review, pump events, pump status, and forecast queries. GLY 217 will replace this broad refresh with resource revision checks.

Successful V2 mutations invalidate only affected resource families. Primary source changes invalidate dependent histories and summaries. Forecast preference changes invalidate forecast. Target range changes invalidate thresholds and derived glucose summaries. Connection changes invalidate connection state and dependent dashboard resources. A user data purge invalidates every dashboard query.

The shell does not prefetch dashboard data from unrelated routes. Queries begin when the dashboard has active consumers, then remain available during navigation until their five minute inactivity timer expires.

## Responsive chart measurements

GLY 213 measures the timeline resources for one committed dashboard window. The focused tests instrument the glucose history, bolus review, and pump history API clients together with the responsive presentation mounts. Independent dashboard resources such as statistics, connection status, forecast, and pump status are not part of these counts.

| Measure | Before GLY 213 | After GLY 213 |
| --- | ---: | ---: |
| Dashboard timeline data owners | 2 | 1 |
| Initial glucose history client calls | 1 | 1 |
| Initial bolus review client calls | 1 | 1 |
| Initial pump history client calls | 1 | 1 |
| SSE invalidations scheduled during initial loading | 1 | 0 |
| Mounted timeline chart runtimes | 3 | 1 |
| Additional raw glucose history calls from AGP for the same window | 0 | 0 |

Before GLY 213, TanStack Query coalesced identical requests from the hidden mobile and desktop consumers. The first SSE reading still invalidated the active resource families while their initial requests could be loading, which made the initial request lifecycle unnecessarily unstable even though the concurrent consumers shared a key.

After GLY 213, `DashboardChartPanels` owns one query result for each timeline resource. It passes that data into the single active responsive presentation and passes the same glucose result object to AGP. The first SSE reading initializes the five minute refresh throttle without invalidating the initial requests.

The viewport coverage is:

1. Below 768 pixels, one mobile merged runtime mounts.
2. From 768 through 1023 pixels, one desktop merged runtime mounts.
3. From 1024 pixels, one desktop timeline runtime mounts.

The server snapshot renders a loading shell. No chart runtime mounts until the browser breakpoint is available, which keeps hydration stable.
