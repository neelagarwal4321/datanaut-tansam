import { useEffect, useState } from "react";
import ChartRenderer from "./ChartRenderer.jsx";
import { fetchStaticChartData } from "../utils/staticChartApi.js";

/**
 * Dashboard card body for a saved static chart.
 * Fetches the same full /aggregate data the Visualize preview uses, so saved
 * charts render identically (instead of the old 50-row rowsPreview path).
 */
export default function SavedStaticChart({ chart }) {
  const [rows, setRows] = useState([]);
  const [serverComputed, setServerComputed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    fetchStaticChartData({
      datasetId: chart.datasetId,
      chartType: chart.chartType,
      mappings: chart.mappings,
      options: chart.options,
      filters: chart.options?.filters || [],
      signal: controller.signal
    })
      .then((result) => {
        if (!active) return;
        setRows(result.rows);
        setServerComputed(result.serverComputed);
      })
      .catch((err) => {
        if (err.name !== "AbortError" && active) setError(err.message || "Failed to load chart.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [chart.datasetId, chart.chartType, chart.mappings, chart.options]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-xs text-zinc-400 dark:text-zinc-500 animate-pulse">Loading chart…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-64 items-center justify-center px-4 text-center">
        <span className="text-xs text-red-500">{error}</span>
      </div>
    );
  }

  return <ChartRenderer chart={chart} data={rows} serverComputed={serverComputed} compact />;
}
