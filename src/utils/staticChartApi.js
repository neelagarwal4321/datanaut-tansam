import { BACKEND_URL } from "../config.js";

// L6: named constants for magic numbers
const PREVIEW_SAMPLE_SIZE = 5_000;

// H3: in-memory TTL cache for exact (non-sampled) aggregate results.
// Keys are JSON-encoded param objects; TTL is 5 minutes.
const CACHE_TTL_MS = 5 * 60 * 1_000;
const _cache = new Map(); // key → { payload, ts }

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return entry.payload;
}

function _cacheSet(key, payload) {
  // Evict oldest entry when cache exceeds 200 items
  if (_cache.size >= 200) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [k, v] of _cache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) _cache.delete(oldestKey);
  }
  _cache.set(key, { payload, ts: Date.now() });
}

// Map a chart type to its backend aggregate "mode".
export function chartTypeToMode(chartType) {
  if (["line", "area"].includes(chartType)) return "series";
  if (["bar", "pie", "donut", "radar"].includes(chartType)) return "category";
  if (chartType === "scatter") return "scatter";
  if (chartType === "histogram") return "histogram";
  if (chartType === "box") return "stats";
  if (chartType === "gauge") return "gauge";
  return "series";
}

// Resolve the x-axis field for a chart type from its mappings.
export function getXField(chartType, mappings) {
  if (["line", "bar", "area", "scatter", "scatter3d", "surface3d", "line3d"].includes(chartType)) return mappings?.xField || "";
  if (["pie", "donut"].includes(chartType)) return mappings?.categoryField || "";
  if (chartType === "radar") return mappings?.angleField || "";
  return "";
}

// Resolve the y-axis field(s) for a chart type from its mappings.
export function getYField(chartType, mappings) {
  if (["line", "bar", "area"].includes(chartType)) return (mappings?.yFields || []).join(",");
  if (["scatter"].includes(chartType)) return mappings?.yField || "";
  if (["scatter3d", "surface3d", "line3d"].includes(chartType)) {
    return `${mappings?.yField || ""},${mappings?.zField || ""}`;
  }
  if (["pie", "donut"].includes(chartType)) return mappings?.valueField || "";
  if (chartType === "radar") return mappings?.radiusField || "";
  if (["histogram", "box", "gauge"].includes(chartType)) return mappings?.yField || "";
  return "";
}

// True when both required axis params are present for a given chart type.
export function hasRequiredFields(chartType, mappings) {
  const y = getYField(chartType, mappings);
  if (!y) return false;

  if (["scatter3d", "surface3d", "line3d"].includes(chartType)) {
    return Boolean(mappings?.xField && mappings?.yField && mappings?.zField);
  }

  const mode = chartTypeToMode(chartType);
  if (["series", "category", "scatter"].includes(mode)) {
    return Boolean(getXField(chartType, mappings));
  }
  return true; // histogram/stats/gauge need only y
}

/**
 * Fetch chart-ready data for a static dataset.
 * Returns { rows, serverComputed, approximate } where:
 *   - serverComputed: { histogram } | { stats } | { gauge } | null
 *   - approximate: true when result was computed over a spread sample (preview mode)
 *
 * Exact (non-sampled) results are cached for CACHE_TTL_MS to speed up Dashboard.
 */
export async function fetchStaticChartData({ datasetId, chartType, mappings, options = {}, filters = [], sample = 0, signal } = {}) {
  if (!datasetId || !hasRequiredFields(chartType, mappings)) {
    return { rows: [], serverComputed: null, approximate: false };
  }

  const mode = chartTypeToMode(chartType);
  const xField = getXField(chartType, mappings);
  const yField = getYField(chartType, mappings);

  const params = new URLSearchParams();
  params.set("mode", mode);
  if (xField) params.set("xField", xField);
  params.set("yField", yField);
  params.set("aggregation", options.aggregation || "none");
  if (options.topN) params.set("limit", String(options.topN));
  if (mode === "histogram") params.set("bins", String(options.bins || 10));
  if (sample > 0) params.set("sample", String(sample));
  if (Array.isArray(filters) && filters.length > 0) {
    const clean = filters.filter((f) => f && f.field && f.op);
    if (clean.length > 0) params.set("filters", JSON.stringify(clean));
  }

  const url = `${BACKEND_URL}/api/datasets/${datasetId}/aggregate?${params.toString()}`;

  // H3: serve from cache for exact (non-sampled) fetches only
  const cacheKey = sample === 0 ? url : null;
  if (cacheKey) {
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(url, { signal });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Failed to load chart data.");

  const approximate = !!json.sampled;
  let result;
  if (mode === "histogram") result = { rows: [], serverComputed: { histogram: json.data || [] }, approximate };
  else if (mode === "stats") result = { rows: [], serverComputed: { stats: json.data || {} }, approximate };
  else if (mode === "gauge") result = { rows: [], serverComputed: { gauge: json.data || {} }, approximate };
  else result = { rows: json.data || [], serverComputed: null, approximate };

  if (cacheKey) _cacheSet(cacheKey, result);
  return result;
}

// Expose the preview sample size so callers use the named constant (L6).
export { PREVIEW_SAMPLE_SIZE };
