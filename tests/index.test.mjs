import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import * as api from '../dist/esm/index.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

const samples = [
  { timestamp: 30, value: 30 },
  { timestamp: 10, value: 10 },
  { timestamp: 20, value: 20 },
  { timestamp: 40, value: NaN },
];

test('sample bounding filters invalid values, sorts and never mutates', () => {
  assert.deepEqual(api.boundSamples(samples, 2), [
    { timestamp: 20, value: 20 },
    { timestamp: 30, value: 30 },
  ]);
  assert.deepEqual(api.boundSamples(samples, 0), []);
  assert.equal(samples[0].timestamp, 30);
  assert.equal(api.boundSamples([{ timestamp: NaN, value: 1 }]).length, 0);
  assert.equal(
    api.boundSamples(
      Array.from({ length: 10005 }, (_, i) => ({ timestamp: i, value: i })),
      Infinity,
    ).length,
    120,
  );
});

test('summary uses nearest-rank p95 and latest timestamp', () => {
  assert.deepEqual(api.summarizeSamples(samples), {
    count: 3,
    min: 10,
    max: 30,
    mean: 20,
    p95: 30,
    latest: 30,
  });
  assert.deepEqual(api.summarizeSamples([]), {
    count: 0,
    min: null,
    max: null,
    mean: null,
    p95: null,
    latest: null,
  });
  const many = Array.from({ length: 100 }, (_, i) => ({ timestamp: i, value: i + 1 }));
  assert.equal(api.summarizeSamples(many).p95, 95);
});

test('timeline handles empty, single, constant and irregular-time samples', () => {
  assert.deepEqual(api.buildTimeline([]), []);
  assert.deepEqual(api.buildTimeline([{ timestamp: 1, value: 2 }]), [
    { timestamp: 1, value: 2, x: 50, y: 50 },
  ]);
  const points = api.buildTimeline(samples);
  assert.equal(points[0].x, 0);
  assert.equal(points[0].y, 100);
  assert.equal(points[2].x, 100);
  assert.equal(points[2].y, 0);
  assert.equal(
    api.buildTimeline([
      { timestamp: 0, value: 2 },
      { timestamp: 1, value: 2 },
    ])[0].y,
    50,
  );
});

test('browser snapshot is explicit, guarded and safe during SSR import', () => {
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const m = await import('./dist/esm/index.js'); if (m.measureBrowser().supported !== false) process.exit(1);",
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  const actualWindow = globalThis.window;
  try {
    globalThis.window = {
      performance: {
        now: () => 12,
        getEntriesByType: (type) => (type === 'navigation' ? [{ duration: 22 }] : [{}, {}]),
        memory: { usedJSHeapSize: 1024 },
      },
    };
    assert.deepEqual(api.measureBrowser(), {
      supported: true,
      timestamp: 12,
      navigationDuration: 22,
      resourceCount: 2,
      usedJSHeapSize: 1024,
    });
    globalThis.window = {
      performance: {
        now: () => {
          throw new Error('Denied');
        },
      },
    };
    assert.equal(api.measureBrowser().supported, false);
    globalThis.window = { performance: { now: () => 1 } };
    assert.equal(api.measureBrowser().resourceCount, null);
  } finally {
    globalThis.window = actualWindow;
  }
});

test('controlled metric selection, bounded timeline table and explicit measurement', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let measurements = 0;
  function App() {
    const [selectedMetricId, onMetricSelect] = useState(null);
    return React.createElement(api.PerformancePanel, {
      metrics: [{ id: 'latency', label: 'Latency', unit: 'ms', samples }],
      selectedMetricId,
      onMetricSelect,
      sampleLimit: 2,
      onMeasure: () => {
        measurements++;
      },
    });
  }
  try {
    await act(async () => root.render(React.createElement(App)));
    assert.equal(measurements, 0);
    await act(async () => host.querySelector('li button').click());
    assert.equal(host.querySelectorAll('tbody tr').length, 2);
    assert.equal(host.querySelector('button[aria-pressed="true"]').textContent, 'Latency: 30 ms');
    assert.match(host.querySelector('svg title').textContent, /Latency timeline/);
    await act(async () => host.querySelector('button').click());
    assert.equal(measurements, 1);
    await act(async () => root.render(React.createElement(api.PerformancePanel, { metrics: [] })));
    assert.match(host.textContent, /No metrics supplied/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test('CommonJS exports match ESM', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(api).sort());
  assert.equal(cjs.summarizeSamples(samples).count, 3);
});
