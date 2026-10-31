# @lp-labs/react-performance-panel

A controlled React metric selector, bounded timeline, exact sample table and
summary statistics. Data is supplied by the application. Browser snapshots are
optional and explicit, never automatically collected. React 18 or 19 is the only
peer dependency; there are no runtime dependencies.

## Installation

```sh
npm install @lp-labs/react-performance-panel react
```

```tsx
import { useState } from "react";
import {
  PerformancePanel, type PerformanceMetric, type BrowserSnapshot,
} from "@lp-labs/react-performance-panel";
import "@lp-labs/react-performance-panel/styles.css";

const metrics: PerformanceMetric[] = [{
  id: "latency", label: "Request latency", unit: "ms",
  samples: [
    { timestamp: 1000, value: 34 },
    { timestamp: 2000, value: 41 },
    { timestamp: 3000, value: 28 },
  ],
}];

export function Dashboard() {
  const [selectedMetricId, onMetricSelect] = useState<string | null>("latency");
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  return (
    <>
      <PerformancePanel
        metrics={metrics}
        selectedMetricId={selectedMetricId}
        onMetricSelect={onMetricSelect}
        sampleLimit={120}
        onMeasure={setSnapshot}
      />
      {snapshot && <p>Resource entries: {snapshot.resourceCount ?? "unavailable"}</p>}
    </>
  );
}
```

Named ESM and CommonJS exports are equivalent:
`const { PerformancePanel } = require("@lp-labs/react-performance-panel")`.
There is no default export. CSS needs a CSS-aware application bundler.
Module imports are SSR-safe and do not read browser globals or install observers.

## PerformancePanel props

`PerformancePanelProps` is the exported component interface.

| Prop | Type | Default / behavior |
| --- | --- | --- |
| `metrics` | `readonly PerformanceMetric[]` | Required; stable unique IDs |
| `selectedMetricId` | `string \| null` | `null`; controlled selection |
| `onMetricSelect` | `(id: string) => void` | Absent; selection buttons disabled |
| `sampleLimit` | `number` | `120`; newest finite samples per metric; hard cap 10000 |
| `onMeasure` | `(snapshot: BrowserSnapshot) => void` | Absent; browser measurement button hidden |
| `className` | `string` | `""`; appended to `lp-performance` |
| `style` | `CSSProperties` | Absent; outer section |
| `ariaLabel` | `string` | `"Performance panel"` |

Update selected props in response to callbacks. Missing IDs show a selection
prompt. Empty metrics show `No metrics supplied.` Invalid samples are omitted;
no valid samples show `N/A` statistics and `No finite samples.` Callback exceptions
are not caught; use your application error boundary. There are no custom error classes.
Statistics and the timeline use the same bounded sample window.

## Exported data types

- `MetricSample`: `{ timestamp: number; value: number }`. Timestamps use any
  consistent numeric clock; they need not be epoch times. Nonfinite fields are invalid.
- `PerformanceMetric`: `{ id: string; label: string; unit?: string;
  samples: readonly MetricSample[] }`. Units are display labels, not conversions.
- `SampleSummary`: `count: number`, plus `min`, `max`, `mean`, `p95`, `latest`
  each `number | null`.
- `TimelinePoint`: extends `MetricSample` with `x: number; y: number`, percentage
  coordinates from 0 to 100 for ordinary finite ranges.
- `BrowserSnapshot`: `supported: boolean`, `timestamp`, `navigationDuration`,
  `resourceCount`, `usedJSHeapSize`, each `number | null`.
- `PerformancePanelProps`: props interface above.

## Pure helpers

### boundSamples(samples, limit = 120): MetricSample[]

Accepts `readonly MetricSample[]`. Filters nonfinite timestamp/value pairs, stably
sorts by timestamp ascending and retains the newest N. Returns a new array without
mutating records or input. Finite limits are floored/clamped to 0..10000;
nonfinite limits use 120. Zero returns `[]`. Duplicate timestamps are retained.

### summarizeSamples(samples): SampleSummary

Accepts `readonly MetricSample[]`, filters invalid pairs, does not impose a sample
limit and does not mutate input. Returns count, min, max, arithmetic mean,
nearest-rank p95 (`ceil(0.95 * count)` in sorted value order) and the value at the
latest timestamp. On equal latest timestamps the last input sample wins.
Empty input returns count 0 and all other fields `null`. Bound your input first
when a windowed summary is desired.

### buildTimeline(samples, limit = 120): TimelinePoint[]

Accepts `readonly MetricSample[]`, applies `boundSamples` and returns new points
in timestamp order. X uses elapsed timestamp, not sample index. Y is inverted:
maximum value is y=0, minimum is y=100. Constant time or value ranges are centered
at 50 along that axis. Empty input returns `[]`. Records include the original
timestamp/value so exact values remain available independently of visual scale.

```ts
import {
  boundSamples, summarizeSamples, buildTimeline,
  type MetricSample, type SampleSummary, type TimelinePoint,
} from "@lp-labs/react-performance-panel";

const input: MetricSample[] = [{ timestamp: 0, value: 2 }, { timestamp: 100, value: 5 }];
const retained = boundSamples(input, 60);
const summary: SampleSummary = summarizeSamples(retained);
const points: TimelinePoint[] = buildTimeline(retained);
console.log(summary.p95, points);
```

## Explicit browser helper

### measureBrowser(): BrowserSnapshot

This is the only non-pure helper. Call it explicitly, or provide `onMeasure` and
let the user press **Measure browser now**. It does not retain data, update metrics,
start timers, create observers, clear timing buffers or make network requests.

It feature-checks `window.performance.now`, `getEntriesByType` and the nonstandard
`performance.memory` property. A successful `now()` sets `supported: true` and
`timestamp` (milliseconds since the performance time origin). When available:

- `navigationDuration`: duration of the first navigation entry, in ms.
- `resourceCount`: count of currently buffered resource entries, not all requests.
- `usedJSHeapSize`: heap bytes from a browser-specific memory extension.

SSR/missing performance returns `supported: false` and all numbers `null`.
Unavailable fields remain `null`; guarded API failures do not throw. A failure
partway through can leave a partial snapshot. A zero navigation duration can mean
navigation is still in progress. Memory support and accuracy differ across browsers.

```ts
import { measureBrowser } from "@lp-labs/react-performance-panel";

const snapshot = measureBrowser(); // call in a user action, not a render loop
if (snapshot.supported) console.log(snapshot.timestamp);
```

## Customization, accessibility and real limits

Override `--lp-performance-accent` and `--lp-performance-border` on
`.lp-performance`, or pass `className` / `style`. Metric buttons use
`aria-pressed` with visible focus. The SVG has an accessible title and the exact
retained samples are also in a captioned table. Empty/error-support states are text,
not color-only signals. Selection does not steal focus or install global keys.

There are no automatic FPS, CPU, React render-cost, web-vitals, long-task or
continuous memory measurements. Supply such values from instrumentation you own.
The snapshot is descriptive, not a benchmark, profiler or production certification.
Timeline axes normalize each selected series independently, so visual slopes are
not comparable between different units/windows.

Bounding sorts all supplied samples (O(n log n)) before retaining the window.
The caller must bound storage and update frequency; display limits are not an
ingestion memory limit. Up to 10000 points/table rows per metric can still be
expensive. There is no worker, virtualization, persistence or polling.
Use realistic finite magnitudes; JavaScript floating-point precision still applies.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
