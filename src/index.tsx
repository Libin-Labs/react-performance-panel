import { useId, type CSSProperties } from 'react';

export interface MetricSample {
  timestamp: number;
  value: number;
}

export interface PerformanceMetric {
  id: string;
  label: string;
  unit?: string;
  samples: readonly MetricSample[];
}

export interface SampleSummary {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p95: number | null;
  latest: number | null;
}

export function boundSamples(samples: readonly MetricSample[], limit = 120): MetricSample[] {
  const count = Number.isFinite(limit) ? Math.max(0, Math.min(10000, Math.floor(limit))) : 120;
  if (!count) return [];
  return samples
    .filter((sample) => Number.isFinite(sample.timestamp) && Number.isFinite(sample.value))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-count);
}

export function summarizeSamples(samples: readonly MetricSample[]): SampleSummary {
  const valid = samples.filter(
    (sample) => Number.isFinite(sample.timestamp) && Number.isFinite(sample.value),
  );
  const values = valid.map((sample) => sample.value).sort((a, b) => a - b);
  const count = values.length;
  const latest = valid.reduce<MetricSample | undefined>(
    (previous, sample) => (!previous || sample.timestamp >= previous.timestamp ? sample : previous),
    undefined,
  );
  return {
    count,
    min: values[0] ?? null,
    max: values[count - 1] ?? null,
    mean: count ? values.reduce((sum, value) => sum + value / count, 0) : null,
    p95: values[Math.max(0, Math.ceil(count * 0.95) - 1)] ?? null,
    latest: latest?.value ?? null,
  };
}

export interface TimelinePoint extends MetricSample {
  x: number;
  y: number;
}

export function buildTimeline(samples: readonly MetricSample[], limit = 120): TimelinePoint[] {
  const bounded = boundSamples(samples, limit);
  if (!bounded.length) return [];
  const first = bounded[0]?.timestamp ?? 0;
  const last = bounded[bounded.length - 1]?.timestamp ?? first;
  const values = bounded.map((sample) => sample.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return bounded.map((sample) => ({
    ...sample,
    x: last === first ? 50 : ((sample.timestamp - first) / (last - first)) * 100,
    y: max === min ? 50 : 100 - ((sample.value - min) / (max - min)) * 100,
  }));
}

export interface BrowserSnapshot {
  supported: boolean;
  timestamp: number | null;
  navigationDuration: number | null;
  resourceCount: number | null;
  usedJSHeapSize: number | null;
}

export function measureBrowser(): BrowserSnapshot {
  const result: BrowserSnapshot = {
    supported: false,
    timestamp: null,
    navigationDuration: null,
    resourceCount: null,
    usedJSHeapSize: null,
  };
  if (typeof window === 'undefined') return result;
  try {
    const performance = window.performance;
    if (!performance || typeof performance.now !== 'function') return result;
    result.timestamp = performance.now();
    result.supported = true;
    if (typeof performance.getEntriesByType === 'function') {
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation && Number.isFinite(navigation.duration)) {
        result.navigationDuration = navigation.duration;
      }
      result.resourceCount = performance.getEntriesByType('resource').length;
    }
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    if (typeof memory?.usedJSHeapSize === 'number' && Number.isFinite(memory.usedJSHeapSize)) {
      result.usedJSHeapSize = memory.usedJSHeapSize;
    }
  } catch {
    // Restricted browser implementations may deny individual timing APIs.
  }
  return result;
}

export interface PerformancePanelProps {
  metrics: readonly PerformanceMetric[];
  selectedMetricId?: string | null;
  onMetricSelect?: (id: string) => void;
  sampleLimit?: number;
  onMeasure?: (snapshot: BrowserSnapshot) => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const display = (value: number | null) =>
  value === null ? 'N/A' : String(Number(value.toFixed(3)));

export function PerformancePanel({
  metrics,
  selectedMetricId = null,
  onMetricSelect,
  sampleLimit = 120,
  onMeasure,
  className = '',
  style,
  ariaLabel = 'Performance panel',
}: PerformancePanelProps) {
  const titleId = useId();
  const selected = metrics.find((metric) => metric.id === selectedMetricId);
  const samples = boundSamples(selected?.samples ?? [], sampleLimit);
  const points = buildTimeline(samples, sampleLimit);
  const summary = summarizeSamples(samples);
  return (
    <section className={`lp-performance ${className}`} style={style} aria-label={ariaLabel}>
      {onMeasure && (
        <button type="button" onClick={() => onMeasure(measureBrowser())}>
          Measure browser now
        </button>
      )}
      <ul className="lp-performance-metrics" aria-label="Metrics">
        {metrics.map((metric) => {
          const stats = summarizeSamples(boundSamples(metric.samples, sampleLimit));
          return (
            <li key={metric.id}>
              <button
                type="button"
                disabled={!onMetricSelect}
                aria-pressed={metric.id === selectedMetricId}
                onClick={() => onMetricSelect?.(metric.id)}
              >
                {metric.label}: {display(stats.latest)} {metric.unit ?? ''}
              </button>
            </li>
          );
        })}
      </ul>
      {!metrics.length && <p>No metrics supplied.</p>}
      {selected ? (
        <article aria-label="Metric details">
          <h3>
            {selected.label} {selected.unit ? `(${selected.unit})` : ''}
          </h3>
          <dl className="lp-performance-summary">
            {Object.entries(summary).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{display(value)}</dd>
              </div>
            ))}
          </dl>
          {points.length ? (
            <svg
              viewBox="-2 -2 104 104"
              role="img"
              aria-labelledby={titleId}
              className="lp-performance-timeline"
              preserveAspectRatio="none"
            >
              <title id={titleId}>{selected.label} timeline; exact values in table below</title>
              <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
              {points.map((point, index) => (
                <circle key={index} cx={point.x} cy={point.y} r="1" />
              ))}
            </svg>
          ) : (
            <p>No finite samples.</p>
          )}
          <div className="lp-performance-scroll">
            <table>
              <caption>Retained samples (timestamp in supplied time base)</caption>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Value {selected.unit ?? ''}</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((sample, index) => (
                  <tr key={index}>
                    <td>{sample.timestamp}</td>
                    <td>{sample.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : (
        <p>Select a metric for its timeline.</p>
      )}
    </section>
  );
}
