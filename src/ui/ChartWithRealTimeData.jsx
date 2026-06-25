import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import DynamicChart2D from "./DynamicChart2D.jsx";
import DynamicChart3D from "./DynamicChart3D.jsx";
import ChartRenderer from "./ChartRenderer.jsx";
import { toRendererConfig } from "../utils/dynamicChartUtils.js";
import { buildChartData } from "../utils/chartData.js";
import { BACKEND_URL } from "../config.js";
import { useWsSubscribe } from "../providers/WebSocketContext.jsx";

export default function ChartWithRealTimeData({ chart, onEdit, onDuplicate, onDelete, className, wrapInCard = false, showActions = false }) {
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const abortControllerRef = useRef(null);
  
  const dataSource = chart?.dataSource;
  const dimension = chart?.dimension || chart?.options?.dimension || "2d";
  const aggregation = chart?.options?.aggregation || chart?.aggregation || "none";
  const topN = chart?.options?.topN || chart?.topN || 0;
  
  useEffect(() => {
    if (!dataSource) {
      // No data source, chart will use chart.data if available
      setIsLoading(false);
      return;
    }
    
    const fetchData = async () => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        const dbTable = chart?.table || chart?.options?.table;
        const sourceType = chart?.sourceType;
        // Use sourceType when available; fall back to table presence for legacy charts
        const isDb = sourceType ? ["sql", "nosql"].includes(sourceType) : !!dbTable;
        
        let url;
        if (isDb) {
          const xField = chart.xField || chart.mappings?.xField || "";
          const yField = chart.yField || (chart.mappings?.yFields || []).join(",") || chart.mappings?.yField || "";
          const zField = chart.zField || chart.mappings?.zField || "";
          let yParam = yField;
          const chartType = chart.type || chart.chartType || "line";
          if (["scatter3d", "surface3d", "line3d"].includes(chartType) && zField) {
            yParam = `${yField},${zField}`;
          }
          url = `${BACKEND_URL}/api/data/${dataSource}/aggregate?table=${encodeURIComponent(dbTable)}&xField=${encodeURIComponent(xField)}&yField=${encodeURIComponent(yParam)}&aggregation=${aggregation}`;
        } else {
          url = `${BACKEND_URL}/api/data/${dataSource}`;
        }

        const response = await fetch(url, { signal });
        const data = await response.json();
        
        if (data.success) {
          if (isDb) {
            let rows = data.data || [];
            if (topN > 0) {
              rows = rows.slice(0, topN);
            }
            setChartData(rows);
          } else {
            // Flatten the data if it's nested in tables
            let flatData = data.data || [];
            if (flatData.length > 0 && flatData[0].rows) {
              flatData = flatData.flatMap(table => table.rows);
            }
            // Keep only the last 50 entries from the tail
            setChartData(flatData.slice(-50));
          }
        }
        setIsLoading(false);
      } catch (err) {
        // Don't set error if request was aborted
        if (err.name === 'AbortError') {
          return;
        }
        console.error("Error fetching chart data:", err);
        setIsLoading(false);
      }
    };
    
    // Fetch immediately and then poll periodically as a safety net
    fetchData();
    const interval = setInterval(fetchData, 5000); // 5s safety poll while WS provides realtime
    
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [dataSource, chart?.table, chart?.options?.table, chart?.xField, chart?.yField, chart?.yFields, chart?.zField, chart?.type, chart?.chartType, aggregation, topN]);

  // Real-time updates via the shared app-level WebSocket (WebSocketContext).
  // A single WS connection serves all chart instances; this component just subscribes.
  const wsHandler = useCallback((msg) => {
    const incoming = Array.isArray(msg.rows) ? msg.rows : (msg.row ? [msg.row] : []);
    if (incoming.length === 0) return;
    setChartData((prev) => {
      const next = [...prev, ...incoming];
      const maxPoints = (chart?.table || chart?.options?.table) ? 1000 : 50;
      return next.slice(-maxPoints);
    });
  }, [chart?.table, chart?.options?.table]);

  useWsSubscribe(dataSource, wsHandler);

  // Process chart data with aggregation
  const processedChartData = useMemo(() => {
    if (!chartData.length) {
      return chartData;
    }
    
    // Get chart configuration
    const rendererConfig = toRendererConfig(chart);
    if (!rendererConfig) {
      return chartData;
    }
    
    const mappings = rendererConfig.mappings || {};
    const chartType = rendererConfig.chartType || chart?.type || chart?.chartType || "bar";
    
    // Only apply aggregation if mappings are defined
    if (!mappings.xField || (!mappings.yFields?.length && !mappings.yField)) {
      return chartData;
    }
    
    // Ensure yFields is set
    if (!mappings.yFields || mappings.yFields.length === 0) {
      if (mappings.yField) {
        mappings.yFields = [mappings.yField];
      } else {
        return chartData;
      }
    }
    
    const options = {
      aggregation: aggregation,
      topN: topN
    };
    
    return buildChartData(chartData, chartType, mappings, options);
  }, [chartData, chart, aggregation, topN]);
  
  const sourceType = chart?.sourceType;
  const isDbChart = sourceType ? ["sql", "nosql"].includes(sourceType) : !!(chart?.table || chart?.options?.table);

  if (isLoading && dataSource) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-500 mx-auto"></div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Loading data...</p>
        </div>
      </div>
    );
  }

  if (!isLoading && chartData.length === 0 && dataSource && !isDbChart) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        <div className="text-center">
          <div className="mb-1 text-lg">⏳</div>
          <p>Waiting for live data…</p>
          <p className="text-xs mt-1 text-slate-300 dark:text-slate-600">Data appears when your source sends messages.</p>
        </div>
      </div>
    );
  }

  // Pass the fetched data to the appropriate chart component
  if (dimension === "3d") {
    return (
      <DynamicChart3D
        chart={chart}
        data={processedChartData.length > 0 ? processedChartData : undefined}
        onEdit={showActions ? onEdit : undefined}
        onDuplicate={showActions ? onDuplicate : undefined}
        onDelete={showActions ? onDelete : undefined}
        className={className}
        wrapInCard={wrapInCard}
        showActions={showActions}
        showHeader={false}
        showMeta={false}
      />
    );
  } else {
    // For 2D charts in dashboard, render just the chart without card wrapper
    const rendererChart = toRendererConfig(chart);
    const dataset = processedChartData.length > 0 ? processedChartData : [];
    let inferredDataset;

    // Infer missing mappings for pie/donut from data sample
    if (rendererChart && ["pie", "donut"].includes(rendererChart.chartType)) {
      const mappings = rendererChart.mappings || {};
      const hasCategory = !!mappings.categoryField;
      const hasValue = !!mappings.valueField;
      const sampleRows = dataset.length > 0 ? dataset : (chartData.length > 0 ? chartData : []);
      if ((!hasCategory || !hasValue) && sampleRows.length > 0) {
        const sample = sampleRows[0];
        const keys = Object.keys(sample);
        const isNumeric = (v) => {
          if (typeof v === 'number') return Number.isFinite(v);
          if (typeof v === 'string') return Number.isFinite(Number(v.trim()));
          return false;
        };
        const numericKey = keys.find(k => isNumeric(sample[k]));
        const categoryKey = keys.find(k => k !== numericKey);
        if (!mappings.valueField && numericKey) mappings.valueField = numericKey;
        if (!mappings.categoryField && categoryKey) mappings.categoryField = categoryKey;
        rendererChart.mappings = mappings;
        if (dataset.length === 0) {
          const opts = rendererChart.options || { aggregation, topN };
          const rebuilt = buildChartData(sampleRows, rendererChart.chartType, mappings, {
            aggregation: opts.aggregation ?? aggregation,
            topN: opts.topN ?? topN
          });
          if (Array.isArray(rebuilt)) inferredDataset = rebuilt;
        }
      }
    }

    if (!rendererChart) {
      return (
        <div className="w-full h-56 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
          Invalid chart configuration. Please edit the chart to set fields.
        </div>
      );
    }

    // Ensure options include aggregation and topN
    if (rendererChart.options) {
      rendererChart.options.aggregation = aggregation;
      rendererChart.options.topN = topN;
    } else {
      rendererChart.options = {
        aggregation: aggregation,
        topN: topN,
        dimension: dimension
      };
    }

    if (wrapInCard) {
      return (
        <DynamicChart2D
          chart={chart}
          data={dataset}
          onEdit={showActions ? onEdit : undefined}
          onDuplicate={showActions ? onDuplicate : undefined}
          onDelete={showActions ? onDelete : undefined}
          className={className}
        />
      );
    } else {
      return (
        <div className="w-full h-full">
          <ChartRenderer chart={rendererChart} data={inferredDataset ?? dataset} compact />
        </div>
      );
    }
  }
}
