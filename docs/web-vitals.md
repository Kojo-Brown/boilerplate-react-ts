# Core Web Vitals in the field

Lighthouse tells you what a metric was on one machine, on one network, with an
empty cache. Field data tells you what it is for the people using the app. The
two disagree constantly, and the field number is the one Google ranks on — so
this instrumentation exists to answer "how slow is this for real users, on which
screen, and which part of the metric is the slow part".

Three metrics are reported. Each measures a different way a page can be bad:

| Metric  | What it measures                             | Good    | Poor    |
| ------- | -------------------------------------------- | ------- | ------- |
| **LCP** | When the main content finished rendering     | ≤ 2.5s  | > 4.0s  |
| **INP** | How long the page took to respond to a click | ≤ 200ms | > 500ms |
| **CLS** | How much the layout moved under the user     | ≤ 0.1   | > 0.25  |

## The shape

```
shared/analytics/vitalsEvent.ts         shaping a metric into a row worth sending
shared/analytics/analyticsSink.ts       batching, transport, and when to send
shared/analytics/vitalsCollector.ts     subscribing, sampling, route attribution
shared/analytics/WebVitalsReporter.tsx  the React binding, mounted in RootLayout
e2e/web-vitals.spec.ts                  the whole pipeline, in a real browser
```

`web-vitals` (the attribution build) does the measuring. Everything above is
about what happens to a metric between the observer firing and a row landing in
a dashboard — which is where the interesting failure modes are.

## Configuration

```ini
VITE_ANALYTICS_URL=/__vitals   # blank disables reporting entirely
VITE_VITALS_SAMPLE_RATE=1      # share of visits reported, 0–1
```

With no endpoint the reporter subscribes to nothing at all — not "collects and
discards" — so an unconfigured build pays for no observers. In development with
devtools enabled, metrics are logged to the console instead.

## Five things that are not obvious

### 1. The report has to happen while the page is being hidden, and only then

LCP is not final until the page stops being visible: a larger element can always
paint later. CLS is the same — it accumulates for the whole visit. So
`web-vitals` flushes its last values on `visibilitychange → hidden`, which is
also the last moment a browser reliably runs script.

That rules out the obvious transport. A `fetch()` started there is cancelled
along with the document. `unload` and `beforeunload` are worse than useless:
they are ignored outright on iOS, and registering one makes the page ineligible
for the back/forward cache, so instrumenting performance would itself cost
performance.

`navigator.sendBeacon` is specified to outlive the document, with
`fetch(…, { keepalive: true })` as the fallback when it refuses — a beacon over
the user agent's queue limit (about 64KB) returns `false` rather than throwing,
which is why `beaconTransport` checks the return value.

`flushOnHidden` listens for both `visibilitychange` and `pagehide`, and neither
is redundant: backgrounding a tab fires the first and may be the last callback
the page ever gets, while a navigation into the bfcache fires the second without
ever hiding the page.

### 2. The body is JSON but goes out as `text/plain`

Sending `Content-Type: application/json` cross-origin makes the beacon a
non-simple request, and a non-simple request needs a CORS preflight — an extra
round trip the browser will not make while the document is being torn down. The
beacon is a plain string, and the collector parses it. Prefer a same-origin
endpoint anyway; an ad blocker will drop a third-party analytics host and you
will discover it as a quiet reporting gap.

### 3. Sampling is decided once per visit

The tempting implementation rolls the dice per metric. It produces a dataset
where one visit contributed its LCP and not its INP, and the moment you ask
"do the pages that load slowly also respond slowly?" the data cannot answer,
because no visit is complete. `startVitalsCollection` rolls once and either
reports everything from that visit or subscribes to nothing, and every row
carries the same `visitId` so the join is available on the other end.

### 4. The same metric is reported more than once

`onCLS` and `onINP` re-report the _same_ metric instance as its value grows —
same `id`, larger value. A queue that appended would send two rows for one
page's CLS and any backend that counts or sums would be wrong. The sink is
keyed by `id` and keeps the last report, and the collector's contract to the
backend is: **dedupe on `id`, keep the latest value**.

A back/forward-cache restore is the opposite case: it starts a genuinely new
metric instance with a new `id`, and its LCP is normally near zero. Those rows
carry `navigationType: "back-forward-cache"`, which is worth filtering out of a
percentile that is meant to describe page loads.

### 5. Route attribution is read when the metric arrives, not when it starts

These metrics land late. INP is finalised at page hide, by which time an SPA is
usually several routes from where it loaded — so the collector reads the path
through a callback at report time rather than capturing it at subscribe time.

The reporter is mounted in `RootLayout`, not in `main.tsx` and not inside a
page. It needs router context to know the route at all, and it must outlive
every navigation: a reporter that remounted per route would start a new visit on
each link click.

One caveat worth knowing before you point this at a real dashboard: `path` is
the concrete pathname, so `/users/42` and `/users/43` are separate rows. If the
app grows dynamic segments, map the location to its route _pattern_ before it
becomes a metric label — high-cardinality dimensions are how RUM bills get
surprising.

## The payload

One POST per flush, carrying the whole batch:

```json
{
  "events": [
    {
      "metric": "LCP",
      "value": 2500,
      "rating": "needs-improvement",
      "id": "v6-lcp-1",
      "navigationType": "navigate",
      "path": "/dashboard",
      "visitId": "0f9f…",
      "reportedAt": 1700000000000,
      "attribution": {
        "target": "main>img.hero",
        "url": "https://cdn.example.test/hero.avif",
        "timeToFirstByteMs": 211,
        "resourceLoadDelayMs": 40,
        "resourceLoadDurationMs": 1801,
        "elementRenderDelayMs": 449
      }
    }
  ]
}
```

The attribution is the part that turns a number into a task. LCP's four subparts
sum to the metric, so a 4-second LCP that is 3.4 seconds of `timeToFirstByteMs`
is a server problem and no amount of image optimisation will move it. INP's
three phases separate "the main thread was busy before your handler ran"
(`inputDelayMs`) from "your handler was slow" (`processingDurationMs`) from
"rendering the result was slow" (`presentationDelayMs`).

What is deliberately _not_ in the payload: `entries`, and the
`PerformanceNavigationTiming` / `PerformanceResourceTiming` objects the library
hangs off the attribution. They serialise to `{}` or to kilobytes of timings
nobody queries, and a beacon over the queue limit is not a large row — it is a
row that never arrives.

## Using a different sink

```tsx
<WebVitalsReporter sink={createBeaconSink({ endpoint: "/__vitals" })} />
<WebVitalsReporter sink={createConsoleSink()} />
<WebVitalsReporter sink={null} />           {/* off, whatever the env says */}
```

A sink is `{ record, flush }` and must never throw — telemetry that breaks the
app it measures is worse than no telemetry. `createMemorySink()` is the one to
use in tests: it keeps every event and groups them by flush.

## Testing this

jsdom implements none of `largest-contentful-paint`, `layout-shift`, `event`
timing or `navigator.sendBeacon`, so a unit test can never observe a real
metric. The split is therefore:

- **Unit** — shaping, coalescing, sampling, flush timing and the React wiring,
  driven by fixtures in `src/test/vitals.ts` that are typed as the library's own
  metric objects, so a renamed attribution field fails to compile.
- **E2E** (`e2e/web-vitals.spec.ts`, Chromium only) — the observers really
  firing, hiding the page really finalising the metrics, and a real beacon
  leaving with the route attached.

Two things about ending a visit in a test are worth knowing before you write
one, because both produce a green-looking test that asserts the wrong thing:

**LCP needs a trusted event.** `finalizeLCP` checks `event.isTrusted`, so a
synthetic `visibilitychange` gives you a beacon with the LCP row silently
missing. The spec's real click is that trusted event — `click` is one of LCP's
three finalisers, alongside `keydown` and `visibilitychange`.

**Hiding is not the same as unloading.** INP and CLS report through the
visibility watcher, which only asks whether the document reads hidden — so
redefining `document.visibilityState` and dispatching the event is enough, and
the page stays alive. That matters on CI: a beacon sent while the document is
being torn down is not reliably delivered or observable, and `page.route()`
handlers stop running for it. Unloading is the real-world path and is covered by
the `pagehide` unit test; the E2E hides without unloading so the assertion is
about the pipeline rather than about the runner's teardown timing.
