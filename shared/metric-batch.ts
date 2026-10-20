import type { MetricOptions, MetricType } from "./observability.js";

const INTERVAL_MS = 30_000;
const MAX_SERIES = 256;
const MAX_DISTRIBUTION_SAMPLES = 16;
const MAX_VALUE = 1e9;

interface Series {
  type: MetricType;
  name: string;
  options: MetricOptions;
  value: number;
  observed: number;
  samples: number[];
}

/** Inputs have passed the shared privacy filter. Counters remain exact while
 * gauges and distributions have bounded storage and export volume. */
export function createMetricBatch(send: (type: MetricType, name: string, value: number, options: MetricOptions) => void) {
  const series = new Map<string, Series>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (item: Series, value: number) => {
    try { send(item.type, item.name, value, item.options); }
    catch { /* A monitoring failure must not interrupt application work or other metrics. */ }
  };

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const pending = [...series.values()];
    series.clear();
    for (const item of pending) {
      if (item.type === "distribution") {
        for (const value of item.samples) emit(item, value);
      } else emit(item, item.value);
    }
  }

  function record(type: MetricType, name: string, value: number, options: MetricOptions) {
    try {
      const attributes = Object.fromEntries(Object.entries(options.attributes ?? {})
        .filter(([, attribute]) => attribute !== undefined).sort(([left], [right]) => left.localeCompare(right)));
      const safeOptions: MetricOptions = { ...(options.unit !== undefined ? { unit: options.unit } : {}), attributes };
      const key = JSON.stringify([type, name, options.unit ?? "none", attributes]);
      let item = series.get(key);
      if (!item) {
        if (series.size >= MAX_SERIES) return;
        item = { type, name, options: safeOptions, value: 0, observed: 0, samples: [] };
        series.set(key, item);
      }
      if (type === "count") {
        // Individual source counts and each exported aggregate obey the same
        // numeric bound, even when many large increments share one series.
        if (item.value + value > MAX_VALUE) {
          emit(item, item.value);
          item.value = 0;
        }
        item.value += value;
      } else if (type === "gauge") item.value = value;
      else {
        item.observed++;
        if (item.samples.length < MAX_DISTRIBUTION_SAMPLES) item.samples.push(value);
        else {
          // Reservoir sampling gives every observed value the same probability
          // of inclusion, rather than retaining only the start of a busy burst.
          const index = Math.floor(Math.random() * item.observed);
          if (index < MAX_DISTRIBUTION_SAMPLES) item.samples[index] = value;
        }
      }
      if (timer === undefined) {
        timer = setTimeout(flush, INTERVAL_MS);
        const nodeTimer = timer as unknown as { unref?: () => void };
        if (typeof nodeTimer.unref === "function") nodeTimer.unref();
      }
    } catch { /* Inputs and host timer implementations cannot change application results. */ }
  }

  return { record, flush };
}
