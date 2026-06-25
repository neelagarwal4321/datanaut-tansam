import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../providers/StoreContext.jsx";
import GlassCard from "../ui/GlassCard.jsx";
import SavedStaticChart from "../ui/SavedStaticChart.jsx";

const formatNumber = (value) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toString();
};

export default function DashboardPage() {
  const { charts, datasets, deleteChart, duplicateChart } = useStore();
  const navigate = useNavigate();

  const chartList = useMemo(
    () =>
      Object.values(charts)
        .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()),
    [charts]
  );

  const metrics = useMemo(() => {
    const datasetCount = Object.keys(datasets).length;
    const chartCount = chartList.length;
    const lastUpdated = chartList[0]?.updatedAt ? new Date(chartList[0].updatedAt).toLocaleString() : "N/A";
    return [
      {
        label: "Datasets",
        value: datasetCount,
        trend: "+1 new",
        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
      },
      {
        label: "Charts",
        value: chartCount,
        trend: "Ready to share",
        color: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
      },
      {
        label: "Last update",
        value: lastUpdated,
        trend: "Auto-saved",
        color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
      }
    ];
  }, [chartList, datasets]);

  const handleEdit = (chartId) => {
    navigate(`/visualize?chartId=${chartId}`);
  };

  const handleDelete = (chart) => {
    if (window.confirm(`Delete chart "${chart.title}"?`)) {
      deleteChart(chart.id);
    }
  };

  const handleDuplicate = (chartId) => {
    duplicateChart(chartId);
  };

  return (
    <div className="flex w-full flex-col gap-6 px-4 pb-10 pt-2 md:px-6 lg:px-8">
      <section>
        <GlassCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Dashboard Overview</h1>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Your saved insights update live with every dataset change.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                Live
              </span>
              <button className="btn-action">Refresh</button>
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
            {chartList.length} charts
          </div>
        </header>
        {chartList.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <svg className="h-8 w-8 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No charts yet.</p>
            <button
              onClick={() => navigate("/visualize")}
              className="btn-action"
            >
              + New Chart
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            {chartList.map((chart) => {
              const dataset = datasets[chart.datasetId];
              return (
                <GlassCard key={chart.id} className="flex flex-col gap-0">
                  {/* Card header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{chart.title}</h3>
                      <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {dataset?.name || "Dataset missing"} · {chart.updatedAt ? new Date(chart.updatedAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button onClick={() => handleEdit(chart.id)} className="btn-action">Edit</button>
                      <button onClick={() => handleDuplicate(chart.id)} className="btn-action">Duplicate</button>
                      <button onClick={() => handleDelete(chart)} className="btn-action-danger">Delete</button>
                    </div>
                  </div>
                  {/* Chart area */}
                  <div className="rounded-md bg-zinc-50 dark:bg-zinc-900/60 p-3 border border-zinc-100 dark:border-zinc-800">
                    <SavedStaticChart chart={chart} />
                  </div>
                  {/* Meta strip */}
                  <div className="mt-3 flex gap-5 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-xs">
                    <div>
                      <span className="block text-[10px] font-medium uppercase tracking-widest text-zinc-400">Type</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300 uppercase">{chart.chartType}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-medium uppercase tracking-widest text-zinc-400">Aggregation</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">{chart.options?.aggregation || "none"}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-medium uppercase tracking-widest text-zinc-400">Limit</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">{chart.options?.topN || "default"}</span>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
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
              <button onClick={() => navigate("/visualize")} className="btn-action">
                + New Chart
              </button>
            </GlassCard>
          </div>
        )}
      </section>
    </div>
  );
}
