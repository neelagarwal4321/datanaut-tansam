import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { useNavigate } from "react-router-dom";
import GlassCard from "../ui/GlassCard.jsx";
import ChartWithRealTimeData from "../ui/ChartWithRealTimeData.jsx";
import ChartErrorBoundary from "../ui/ChartErrorBoundary.jsx";
import {
  classifyDynamicCharts,
  normalizeDynamicCharts,
  saveDynamicDashboardCache,
  loadDynamicDashboardCache
} from "../utils/dynamicChartUtils.js";
import { BACKEND_URL } from "../config.js";

const formatNumber = (value) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toString();
};

// Memoized chart card component to prevent unnecessary re-renders
const ChartCard = memo(({ chart, connections, onEdit, onDuplicate, onDelete }) => {
  const connection = connections.find(c => c.id === chart.dataSource);
  const connectionName = connection?.config?.name || chart.dataSource || "Unknown connection";
  
  return (
    <GlassCard className="flex flex-col gap-0">
      {/* Card header */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{chart.title}</h3>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
            {connectionName} · {chart.updatedAt ? new Date(chart.updatedAt).toLocaleString() : "—"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => onEdit(chart.id)} className="btn-action">Edit</button>
          <button onClick={() => onDuplicate(chart.id)} className="btn-action">Duplicate</button>
          <button onClick={() => onDelete(chart.id)} className="btn-action-danger">Delete</button>
        </div>
      </div>
      {/* Chart area */}
      <div className="rounded-md bg-zinc-50 dark:bg-zinc-900/60 p-3 border border-zinc-100 dark:border-zinc-800">
        <ChartWithRealTimeData
          chart={chart}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
      {/* Meta strip */}
      <div className="mt-3 flex gap-5 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-xs">
        <div>
          <span className="block text-[10px] font-medium uppercase tracking-widest text-zinc-400">Type</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-300 uppercase">{chart.type || chart.chartType || "line"}</span>
        </div>
        <div>
          <span className="block text-[10px] font-medium uppercase tracking-widest text-zinc-400">Dimension</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-300 uppercase">{chart.dimension || "2d"}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-zinc-400">Source</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate">{connectionName}</span>
        </div>
      </div>
    </GlassCard>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent re-renders when chart data hasn't changed
  return (
    prevProps.chart.id === nextProps.chart.id &&
    prevProps.chart.updatedAt === nextProps.chart.updatedAt &&
    prevProps.connections.length === nextProps.connections.length
  );
});

ChartCard.displayName = 'ChartCard';

export default function DynamicDashboard() {
  const [chartRecords, setChartRecords] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const navigate = useNavigate();
  const abortControllerRef = useRef(null);

  const normalizedCharts = useMemo(() => normalizeDynamicCharts(chartRecords), [chartRecords]);
  const { twoD: charts2D, threeD: charts3D } = useMemo(
    () => classifyDynamicCharts(normalizedCharts),
    [normalizedCharts]
  );

  const metrics = useMemo(() => {
    return [
      {
        label: "Connections",
        value: connections.length,
        trend: "Live data",
        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
      },
      {
        label: "Charts",
        value: normalizedCharts.length,
        trend: "Dynamic visualizations",
        color: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
      },
      {
        label: "Last update",
        value: lastUpdated ? new Date(lastUpdated).toLocaleString() : "N/A",
        trend: "Auto-saved",
        color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
      }
    ];
  }, [connections.length, normalizedCharts.length, lastUpdated]);

  const persistCache = useCallback(
    (charts, connectionList, fetchedAt = Date.now()) => {
      const normalized = normalizeDynamicCharts(charts);
      saveDynamicDashboardCache({
        charts: normalized,
        connections: connectionList,
        fetchedAt
      });
    },
    []
  );

  const fetchDashboardData = useCallback(async () => {
    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    setLoading(true);
    try {
      const [connectionsResponse, chartsResponse] = await Promise.all([
        fetch(`${BACKEND_URL}/api/connections`, { signal }),
        fetch(`${BACKEND_URL}/api/charts`, { signal })
      ]);

      const connectionsData = await connectionsResponse.json();
      const chartsData = await chartsResponse.json();

      const nextConnections = connectionsData?.success ? connectionsData.connections || [] : [];
      const nextCharts = chartsData?.success ? chartsData.charts || [] : [];
      const timestamp = Date.now();

      setConnections(nextConnections);
      setChartRecords(normalizeDynamicCharts(nextCharts));
      setLastUpdated(timestamp);
      setStatusMessage(null);
      persistCache(nextCharts, nextConnections, timestamp);
    } catch (error) {
      // Don't set error if request was aborted
      if (error.name === 'AbortError') {
        return;
      }
      console.error("Error fetching data:", error);
      const cached = loadDynamicDashboardCache();
      if (cached) {
        setConnections(cached.connections || []);
        setChartRecords(normalizeDynamicCharts(cached.charts || []));
        setLastUpdated(cached.fetchedAt || Date.now());
        setStatusMessage("Live data unavailable. Showing cached charts.");
      } else {
        setStatusMessage("Failed to load dashboard data. Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [persistCache]);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDashboardData]);

  const handleAddChart = () => {
    navigate("/dynamic-visualize");
  };

  const handleEditChart = (chartId) => {
    navigate(`/dynamic-visualize/${chartId}`);
  };

  const handleDeleteChart = async (chartId) => {
    if (!window.confirm("Are you sure you want to delete this chart?")) {
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/charts/${chartId}`, {
        method: "DELETE"
      });

      const data = await response.json();

      if (data.success) {
        setChartRecords((prev) => {
          const next = prev.filter((chart) => chart.id !== chartId);
          persistCache(next, connections);
          return next;
        });
        setStatusMessage(null);
      } else {
        setStatusMessage(data.error || "Failed to delete chart.");
      }
    } catch (err) {
      console.error("Error deleting chart:", err);
      setStatusMessage("Failed to delete chart. Please try again.");
    }
  };

  const handleDuplicateChart = async (chartId) => {
    try {
      const chartToDuplicate = normalizedCharts.find((chart) => chart.id === chartId);
      if (!chartToDuplicate) return;

      const duplicateConfig = {
        ...chartToDuplicate,
        title: `Copy of ${chartToDuplicate.title}`
      };

      delete duplicateConfig.id;

      const response = await fetch(`${BACKEND_URL}/api/charts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(duplicateConfig)
      });

      const data = await response.json();

      if (data.success) {
        await fetchDashboardData();
      } else {
        setStatusMessage(data.error || "Failed to duplicate chart.");
      }
    } catch (err) {
      console.error("Error duplicating chart:", err);
      setStatusMessage("Failed to duplicate chart. Please try again.");
    }
  };

  const handleRefresh = () => {
    fetchDashboardData();
  };

  const sortedCharts = useMemo(
    () => [...normalizedCharts].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
    [normalizedCharts]
  );

  const hasCharts = normalizedCharts.length > 0;
  const isLoading = loading;

  return (
    <div className="flex w-full flex-col gap-6 px-4 pb-10 pt-2 md:px-6 lg:px-8">
      {/* Header Section */}
      <section>
        <GlassCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Dynamic Dashboard</h1>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Real-time visualizations from your data connections.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                Live
              </span>
              <button onClick={handleRefresh} className="btn-action">Refresh</button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-md border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">{metric.label}</p>
                <div className="mt-1.5 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(metric.value)}</div>
                <span className={`mt-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${metric.color}`}>{metric.trend}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </section>

      {/* Status Messaging */}
      {statusMessage && (
        <div
          className={`rounded-md border px-4 py-3 text-xs font-medium ${
            statusMessage.includes("cached")
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
              : "border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
          }`}
          role="alert"
        >
          {statusMessage}
        </div>
      )}

      {/* Charts Section - Referenced from static dashboard */}
      <section aria-labelledby="saved-charts" className="mt-4 space-y-4 md:mt-6">
        <h2 id="saved-charts" className="sr-only">
          Saved charts
        </h2>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-heading text-base font-semibold text-zinc-900 dark:text-zinc-100">Saved charts</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Manage layouts, duplicate configurations, or jump back into edit mode.</p>
          </div>
          <div className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {normalizedCharts.length} charts
          </div>
        </header>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center rounded-md border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40">
            <div className="text-center">
              <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-500 mx-auto dark:border-zinc-700 dark:border-t-zinc-400"></div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading charts…</p>
            </div>
          </div>
        ) : !hasCharts ? (
          <GlassCard className="flex h-48 flex-col items-center justify-center gap-3 text-center">
            <svg className="h-8 w-8 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No charts yet.</p>
            <button onClick={handleAddChart} className="btn-action">
              + New Chart
            </button>
          </GlassCard>
        ) : (
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            {sortedCharts.map((chart) => (
              <ChartErrorBoundary key={chart.id}>
                <ChartCard
                  chart={chart}
                  connections={connections}
                  onEdit={handleEditChart}
                  onDuplicate={handleDuplicateChart}
                  onDelete={handleDeleteChart}
                />
              </ChartErrorBoundary>
            ))}
            <GlassCard className="flex h-[300px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                  <path d="M12 5v14M5 12h14"></path>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">New chart</p>
                <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Add a visualization to your dashboard</p>
              </div>
              <button onClick={handleAddChart} className="btn-action">
                + New Chart
              </button>
            </GlassCard>
          </div>
        )}
      </section>
    </div>
  );
}
