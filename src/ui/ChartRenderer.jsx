import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { useTheme } from "../providers/ThemeContext.jsx";
import { defaultPalette } from "../utils/colors.js";
import Dynamic3DCharts from "./Dynamic3DCharts.jsx";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const exportNodeToPng = async (node, filename = "chart.png") => {
  if (!node) return;
  const backgroundColor =
    typeof window !== "undefined" ? window.getComputedStyle(document.body).backgroundColor : "#ffffff";
  const canvas = await html2canvas(node, { backgroundColor, scale: 2 });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
};

const makeDomId = (chartId) => {
  if (chartId) {
    return `chart-${String(chartId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  }
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `chart-${crypto.randomUUID()}`;
  }
  return `chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const CustomTooltip = ({ active, payload, label, isDark, palette, chartType, mappings }) => {
  if (!active || !payload || !payload.length) return null;

  if (chartType === "scatter") {
    const item = payload[0];
    const dataRow = item.payload;
    const xName = mappings?.xField || "X";
    const yName = mappings?.yField || "Y";
    const xVal = dataRow?.[xName];
    const yVal = dataRow?.[yName];
    const formattedX = typeof xVal === "number" ? xVal.toLocaleString() : xVal;
    const formattedY = typeof yVal === "number" ? yVal.toLocaleString() : yVal;

    return (
      <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-xl backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90 transition-all text-[10px] select-none min-w-[120px]">
        <div className="mb-1.5 font-bold text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-850 pb-0.5 uppercase tracking-wider text-[8px]">
          Data Point Coordinates
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold text-slate-500 dark:text-slate-400">{xName}:</span>
            <span className="font-bold text-slate-900 dark:text-white">{formattedX}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold text-slate-500 dark:text-slate-400">{yName}:</span>
            <span className="font-bold text-slate-900 dark:text-white">{formattedY}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-xl backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90 transition-all text-[10px] select-none">
      <div className="mb-1 font-bold text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-850 pb-0.5">
        {label}
      </div>
      <div className="flex flex-col gap-1 min-w-[110px]">
        {payload.map((item, idx) => {
          let badgeColor = item.color || item.fill;
          if (badgeColor && badgeColor.startsWith("url")) {
            badgeColor = item.stroke || palette?.[idx % palette.length] || "#6366f1";
          }
          return (
            <div key={idx} className="flex items-center justify-between gap-5">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: badgeColor }} />
                <span className="font-semibold text-slate-600 dark:text-slate-300">{item.name}</span>
              </div>
              <span className="font-bold text-slate-900 dark:text-white">
                {typeof item.value === 'number' 
                  ? item.value.toLocaleString(undefined, { maximumFractionDigits: 3 }) 
                  : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function ChartRenderer({ chart, data = [], compact = false, skipValidation = false, serverComputed = null }) {
  const containerRef = useRef(null);
  const chartDomIdRef = useRef(makeDomId(chart?.id));
  const [exporting, setExporting] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const mappedData = Array.isArray(data) ? data : [];
  const chartType = chart?.chartType || "bar";
  const mappings = chart?.mappings || {};
  const title = chart?.title || "Chart";
  const options = chart?.options || {};
  const seriesColors = options.seriesColors || {};
  const palette = options.palette && options.palette.length > 0 ? options.palette : defaultPalette;
  const wrapperClasses = compact
    ? "flex flex-col gap-3 transition-colors"
    : "flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 transition-colors dark:bg-slate-800/80 dark:ring-slate-700";
  const axisColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "#33415555" : "#e2e8f088";

  const yFields = useMemo(() => {
    if (mappings.yFields) return mappings.yFields;
    if (mappings.yField) return [mappings.yField];
    if (mappings.valueField) return [mappings.valueField];
    if (mappings.radiusField) return [mappings.radiusField];
    return [];
  }, [mappings]);

  const leftMargin = useMemo(() => {
    if (!mappedData.length || !yFields.length) return -10;
    let maxVal = 0;
    mappedData.forEach((row) => {
      yFields.forEach((field) => {
        const val = Math.abs(Number(row[field]) || 0);
        if (val > maxVal) maxVal = val;
      });
    });
    const strLen = Math.round(maxVal).toLocaleString().length;
    return Math.max(-10, (strLen - 3) * 6 - 15);
  }, [mappedData, yFields]);

  const handleLegendClick = (payload) => {
    if (!payload || !payload.dataKey) return;
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(payload.dataKey)) {
        next.delete(payload.dataKey);
      } else {
        next.add(payload.dataKey);
      }
      return next;
    });
  };

  const legendFormatter = (value, entry) => {
    const isHidden = hiddenSeries.has(entry.dataKey);
    return (
      <span className="cursor-pointer select-none transition-opacity duration-200" style={{ opacity: isHidden ? 0.35 : 1, textDecoration: isHidden ? "line-through" : "none" }}>
        {value}
      </span>
    );
  };
  
  const legendProps = useMemo(
    () => ({
      iconType: "circle",
      iconSize: 6,
      onClick: handleLegendClick,
      formatter: legendFormatter,
      wrapperStyle: {
        color: axisColor,
        paddingTop: 8,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase"
      }
    }),
    [axisColor, hiddenSeries]
  );

  const coerceNumeric = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const handleExport = async () => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      await exportNodeToPng(containerRef.current, `${title.replace(/\s+/g, "_").toLowerCase()}.png`);
    } catch (error) {
      console.error("Export failed", error);
      window.alert("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const renderPlaceholder = (message) => (
    <div className="flex h-52 items-center justify-center px-4 text-center text-xs text-slate-400 dark:text-slate-500">
      {message}
    </div>
  );

  const ensureFieldsPresent = (requiredFields) => requiredFields.every((field) => field && typeof field === "string");

  const safeData = useMemo(() => {
    if (!mappedData.length) return [];

    if (["line", "bar", "area"].includes(chartType)) {
      const xField = mappings.xField;
      const yFields = mappings.yFields || [];
      if (!ensureFieldsPresent([xField]) || yFields.length === 0) return [];
      return mappedData
        .map((row) => {
          if (row == null || typeof row !== "object") return null;
          const entry = { [xField]: row[xField] };
          let hasValue = false;
          yFields.forEach((field) => {
            const coerced = coerceNumeric(row[field]);
            if (coerced !== null) hasValue = true;
            entry[field] = coerced;
          });
          return hasValue ? entry : null;
        })
        .filter(Boolean);
    }

    if (chartType === "scatter") {
      const xField = mappings.xField;
      const yField = mappings.yField;
      if (!ensureFieldsPresent([xField, yField])) return [];
      return mappedData
        .map((row) => {
          if (row == null || typeof row !== "object") return null;
          const x = coerceNumeric(row[xField]);
          const y = coerceNumeric(row[yField]);
          if (x === null || y === null) return null;
          return { [xField]: x, [yField]: y };
        })
        .filter(Boolean);
    }

    if (["pie", "donut"].includes(chartType)) {
      const categoryField = mappings.categoryField;
      const valueField = mappings.valueField;
      if (!ensureFieldsPresent([categoryField, valueField])) return [];
      return mappedData
        .map((row) => {
          if (row == null || typeof row !== "object") return null;
          const category = row[categoryField];
          const value = coerceNumeric(row[valueField]);
          if (category === undefined || category === null || value === null) return null;
          return { [categoryField]: category, [valueField]: value };
        })
        .filter(Boolean);
    }

    if (chartType === "radar") {
      const angleField = mappings.angleField;
      const radiusField = mappings.radiusField;
      if (!ensureFieldsPresent([angleField, radiusField])) return [];
      return mappedData
        .map((row) => {
          if (row == null || typeof row !== "object") return null;
          const angle = row[angleField];
          const radius = coerceNumeric(row[radiusField]);
          if (angle === undefined || angle === null || radius === null) return null;
          return { [angleField]: angle, [radiusField]: radius };
        })
        .filter(Boolean);
    }

    if (["histogram", "box", "gauge"].includes(chartType)) {
      const yField = mappings.yField || (mappings.yFields && mappings.yFields[0]) || mappings.valueField;
      if (!ensureFieldsPresent([yField])) return [];
      return mappedData
        .map((row) => {
          if (row == null || typeof row !== "object") return null;
          const value = coerceNumeric(row[yField]);
          if (value === null) return null;
          return { [yField]: value };
        })
        .filter(Boolean);
    }

    if (["scatter3d", "surface3d", "line3d"].includes(chartType)) {
      const { xField, yField, zField } = mappings;
      if (!ensureFieldsPresent([xField, yField, zField])) return [];
      return mappedData
        .map((row) => {
          if (row == null || typeof row !== "object") return null;
          const x = coerceNumeric(row[xField]);
          const y = coerceNumeric(row[yField]);
          const z = coerceNumeric(row[zField]);
          if (x === null || y === null || z === null) return null;
          return { [xField]: x, [yField]: y, [zField]: z };
        })
        .filter(Boolean);
    }

    return mappedData;
  }, [chartType, mappedData, mappings]);

  const renderChart = () => {
    if (["line", "bar", "area"].includes(chartType)) {
      const xField = mappings.xField;
      const yFields = mappings.yFields || [];
      if (!skipValidation && (!ensureFieldsPresent([xField]) || yFields.length === 0)) {
        return renderPlaceholder("Select X and at least one Y field to preview.");
      }
      if (!safeData.length) {
        return renderPlaceholder("No numeric values available for the selected mappings.");
      }

      const ChartComponent = chartType === "bar" ? BarChart : AreaChart;

      return (
        <ResponsiveContainer width="100%" height={compact ? 280 : 340}>
          <ChartComponent data={safeData} margin={{ top: 10, right: 10, left: leftMargin, bottom: 0 }}>
            <defs>
              <filter id={`lineGlow-${chartDomIdRef.current}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.15" />
              </filter>
              {yFields.map((field, index) => {
                const color = seriesColors[field] || palette[index % palette.length];
                return (
                  <g key={`grad-defs-${field}`}>
                    <linearGradient id={`areaGrad-${field}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={chartType === "line" ? 0.08 : 0.4} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id={`barGrad-${field}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={1.0} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.65} />
                    </linearGradient>
                  </g>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey={xField} stroke="transparent" tick={{ fill: axisColor, fontSize: 9, fontWeight: 500 }} tickLine={false} />
            <YAxis stroke="transparent" tick={{ fill: axisColor, fontSize: 9, fontWeight: 500 }} tickLine={false} />
            <Tooltip cursor={{ stroke: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)", strokeWidth: 1.5, strokeDasharray: "3 3" }} content={<CustomTooltip isDark={isDark} palette={palette} chartType={chartType} mappings={mappings} />} />
            <Legend {...legendProps} />
            {yFields.map((field, index) => {
              if (hiddenSeries.has(field)) return null;
              const color = seriesColors[field] || palette[index % palette.length];
              if (chartType === "bar") {
                return (
                  <Bar 
                    key={field} 
                    dataKey={field} 
                    stackId={mappings.stacked ? "stack" : undefined} 
                    fill={`url(#barGrad-${field})`} 
                    stroke={color}
                    strokeWidth={1}
                    radius={mappings.stacked ? [0, 0, 0, 0] : [4, 4, 0, 0]} 
                  />
                );
              }
              return (
                <Area 
                  key={field} 
                  type="monotone" 
                  dataKey={field} 
                  stroke={color} 
                  fill={`url(#areaGrad-${field})`} 
                  strokeWidth={chartType === "line" ? 2.5 : 2} 
                  stackId={mappings.stacked && chartType === "area" ? "stack" : undefined}
                  filter={chartType === "line" ? `url(#lineGlow-${chartDomIdRef.current})` : undefined}
                  dot={false}
                  activeDot={{ r: 5, stroke: isDark ? "#0f172a" : "#ffffff", strokeWidth: 1.5 }}
                />
              );
            })}
          </ChartComponent>
        </ResponsiveContainer>
      );
    }

    if (chartType === "scatter") {
      const xField = mappings.xField;
      const yField = mappings.yField;
      if (!skipValidation && !ensureFieldsPresent([xField, yField])) {
        return renderPlaceholder("Select X and Y fields to preview.");
      }
      if (!safeData.length) {
        return renderPlaceholder("Unable to plot scatter data. Check that chosen fields are numeric.");
      }
      const defaultScatterColor = seriesColors[yField] || palette[0];
      return (
        <ResponsiveContainer width="100%" height={compact ? 280 : 340}>
          <ScatterChart margin={{ top: 10, right: 10, left: leftMargin, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis type="number" dataKey={xField} stroke="transparent" tick={{ fill: axisColor, fontSize: 9 }} tickLine={false} />
            <YAxis type="number" dataKey={yField} stroke="transparent" tick={{ fill: axisColor, fontSize: 9 }} tickLine={false} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)", strokeWidth: 1.5 }} content={<CustomTooltip isDark={isDark} palette={palette} chartType={chartType} mappings={mappings} />} />
            <Scatter data={safeData} fill={defaultScatterColor} fillOpacity={0.7} stroke={defaultScatterColor} strokeWidth={1} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    if (["pie", "donut"].includes(chartType)) {
      const categoryField = mappings.categoryField;
      const valueField = mappings.valueField;
      if (!skipValidation && !ensureFieldsPresent([categoryField, valueField])) {
        return renderPlaceholder("Select category and value fields to preview.");
      }
      if (!safeData.length) {
        return renderPlaceholder("No values available for the selected fields.");
      }
      const isDonut = chartType === "donut" && mappings.donut !== false;
      const innerRadius = isDonut ? 75 : 0;
      const outerRadius = 110;
      
      const total = safeData.reduce((acc, row) => acc + (Number(row[valueField]) || 0), 0);

      return (
        <div className="relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height={compact ? 280 : 320}>
            <PieChart>
              <Tooltip content={<CustomTooltip isDark={isDark} palette={palette} chartType={chartType} mappings={mappings} />} />
              <Legend {...legendProps} />
              <Pie
                dataKey={valueField}
                nameKey={categoryField}
                data={safeData}
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                paddingAngle={isDonut ? 2 : 0}
                stroke={isDark ? "#0f172a" : "#ffffff"}
                strokeWidth={2}
                cornerRadius={isDonut ? 3 : 0}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {safeData.map((entry, index) => (
                  <Cell key={`slice-${index}`} fill={palette[index % palette.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {isDonut && (
            <div className="absolute flex flex-col items-center justify-center pointer-events-none select-none">
              <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500">Total</span>
              <span className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
            </div>
          )}
        </div>
      );
    }

    if (chartType === "radar") {
      const angleField = mappings.angleField;
      const radiusField = mappings.radiusField;
      if (!skipValidation && !ensureFieldsPresent([angleField, radiusField])) {
        return renderPlaceholder("Select a category for the angle and numeric field for the radius.");
      }
      if (!safeData.length) {
        return renderPlaceholder("Radar preview needs numeric radius values for the chosen field.");
      }
      const radarColor = seriesColors[radiusField] || palette[0];
      return (
        <ResponsiveContainer width="100%" height={compact ? 280 : 320}>
          <RadarChart data={safeData}>
            <PolarGrid stroke={gridColor} gridType="circle" />
            <PolarAngleAxis dataKey={angleField} stroke={axisColor} tick={{ fill: axisColor, fontSize: 9 }} />
            <PolarRadiusAxis stroke={axisColor} tick={{ fill: axisColor, fontSize: 9 }} />
            <Tooltip content={<CustomTooltip isDark={isDark} palette={palette} chartType={chartType} mappings={mappings} />} />
            <Radar dataKey={radiusField} stroke={radarColor} fill={radarColor} fillOpacity={0.15} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === "histogram") {
      const yField = mappings.yField || mappings.valueField || (mappings.yFields && mappings.yFields[0]);
      if (!skipValidation && !ensureFieldsPresent([yField])) {
        return renderPlaceholder("Select a numeric field for histogram.");
      }

      let histogramData;
      if (serverComputed?.histogram) {
        histogramData = serverComputed.histogram;
        if (!histogramData.length) return renderPlaceholder("No numeric values available.");
      } else {
        if (!mappedData.length) return renderPlaceholder("No data available.");
        const values = mappedData.map(row => coerceNumeric(row[yField])).filter(v => v !== null);
        if (values.length === 0) return renderPlaceholder("No numeric values available.");

        const bins = 10;
        let min = Math.min(...values);
        let max = Math.max(...values);
        if (max === min) {
          min = min - 0.5;
          max = max + 0.5;
        }
        const binWidth = (max - min) / bins;
        histogramData = Array.from({ length: bins }, (_, i) => {
          const binStart = min + i * binWidth;
          const binEnd = binStart + binWidth;
          const count = values.filter(v => v >= binStart && (i === bins - 1 ? v <= binEnd : v < binEnd)).length;
          return { bin: `${binStart.toFixed(1)}-${binEnd.toFixed(1)}`, count };
        });
      }

      const color = seriesColors[yField] || palette[0];
      return (
        <ResponsiveContainer width="100%" height={compact ? 280 : 340}>
          <BarChart data={histogramData} margin={{ top: 10, right: 10, left: leftMargin, bottom: 0 }}>
            <defs>
              <linearGradient id={`histoGrad-${yField}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={1.0} />
                <stop offset="100%" stopColor={color} stopOpacity={0.65} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="bin" stroke="transparent" tick={{ fill: axisColor, fontSize: 8 }} angle={-45} textAnchor="end" height={80} tickLine={false} />
            <YAxis stroke="transparent" tick={{ fill: axisColor, fontSize: 9 }} tickLine={false} />
            <Tooltip cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.02)" }} content={<CustomTooltip isDark={isDark} palette={palette} chartType={chartType} mappings={mappings} />} />
            <Bar dataKey="count" fill={`url(#histoGrad-${yField})`} stroke={color} strokeWidth={1} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === "box") {
      const yField = mappings.yField || mappings.valueField || (mappings.yFields && mappings.yFields[0]);
      if (!skipValidation && !ensureFieldsPresent([yField])) {
        return renderPlaceholder("Select a numeric field for box plot.");
      }

      let absoluteMin, absoluteMax, q1, median, q3, whiskerMin, whiskerMax;
      let outliers = [];
      let outlierCount = 0;

      if (serverComputed?.stats && serverComputed.stats.count) {
        const s = serverComputed.stats;
        absoluteMin = s.min; absoluteMax = s.max;
        q1 = s.q1; median = s.median; q3 = s.q3;
        whiskerMin = s.whiskerMin; whiskerMax = s.whiskerMax;
        outlierCount = s.outlierCount || 0;
      } else {
        if (!mappedData.length) return renderPlaceholder("No data available.");
        const values = mappedData.map(row => coerceNumeric(row[yField])).filter(v => v !== null).sort((a, b) => a - b);
        if (values.length === 0) return renderPlaceholder("No numeric values available.");

        absoluteMin = values[0];
        absoluteMax = values[values.length - 1];
        q1 = values[Math.floor(values.length * 0.25)];
        median = values[Math.floor(values.length * 0.5)];
        q3 = values[Math.floor(values.length * 0.75)];

        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        outliers = values.filter(v => v < lowerBound || v > upperBound);
        outlierCount = outliers.length;
        const nonOutliers = values.filter(v => v >= lowerBound && v <= upperBound);
        whiskerMin = nonOutliers.length > 0 ? nonOutliers[0] : absoluteMin;
        whiskerMax = nonOutliers.length > 0 ? nonOutliers[nonOutliers.length - 1] : absoluteMax;
      }

      const range = absoluteMax - absoluteMin;
      const getX = (val) => {
        if (range === 0) return 200;
        return 40 + ((val - absoluteMin) / range) * 320;
      };
      
      const color = seriesColors[yField] || palette[0];
      
      return (
        <div style={{ width: "100%", height: compact ? 280 : 340 }} className="flex flex-col items-center justify-center p-4">
          <div className="text-xs font-semibold mb-2 text-slate-500 dark:text-slate-400 uppercase tracking-wide">{yField}</div>
          <div className="w-full max-w-lg h-48 flex items-center justify-center">
            <svg className="w-full h-full" viewBox="0 0 400 120" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id={`boxGrad-${chartDomIdRef.current}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <line x1="40" y1="60" x2="360" y2="60" stroke={gridColor} strokeWidth="1" strokeDasharray="4 4" />
              <line x1={getX(whiskerMin)} y1="60" x2={getX(whiskerMax)} y2="60" stroke={color} strokeWidth="1.5" />
              <line x1={getX(whiskerMin)} y1="48" x2={getX(whiskerMin)} y2="72" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
              <line x1={getX(whiskerMax)} y1="48" x2={getX(whiskerMax)} y2="72" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
              <rect 
                x={getX(q1)} 
                y="40" 
                width={Math.max(2, getX(q3) - getX(q1))} 
                height="40" 
                fill={`url(#boxGrad-${chartDomIdRef.current})`} 
                stroke={color} 
                strokeWidth="1.5" 
                rx="3" 
              />
              <line x1={getX(median)} y1="40" x2={getX(median)} y2="80" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
              {outliers.slice(0, 30).map((val, idx) => (
                <circle 
                  key={`outlier-${idx}`} 
                  cx={getX(val)} 
                  cy="60" 
                  r="3.5" 
                  fill="#ef444433" 
                  stroke="#ef4444" 
                  strokeWidth="1.2" 
                />
              ))}
              <text x={getX(whiskerMin)} y="33" textAnchor="middle" fill={axisColor} fontSize="8" fontWeight="500">{whiskerMin.toFixed(1)}</text>
              <text x={getX(q1)} y="95" textAnchor="middle" fill={axisColor} fontSize="8" fontWeight="500">{q1.toFixed(1)}</text>
              <text x={getX(median)} y="33" textAnchor="middle" fill={isDark ? "#f8fafc" : "#0f172a"} fontSize="9" fontWeight="bold">{median.toFixed(1)}</text>
              <text x={getX(q3)} y="95" textAnchor="middle" fill={axisColor} fontSize="8" fontWeight="500">{q3.toFixed(1)}</text>
              <text x={getX(whiskerMax)} y="33" textAnchor="middle" fill={axisColor} fontSize="8" fontWeight="500">{whiskerMax.toFixed(1)}</text>
              {outlierCount > 0 && (
                <text x="200" y="115" textAnchor="middle" fill="#ef4444" fontSize="9" fontWeight="600">
                  Outliers: {outlierCount} point(s)
                </text>
              )}
            </svg>
          </div>
        </div>
      );
    }

    if (chartType === "gauge") {
      const valueField = mappings.yField || mappings.valueField || (mappings.yFields && mappings.yFields[0]);
      if (!skipValidation && !ensureFieldsPresent([valueField])) {
        return renderPlaceholder("Select a value field for gauge.");
      }

      let value, max;
      if (serverComputed?.gauge && serverComputed.gauge.count) {
        value = serverComputed.gauge.value;
        max = serverComputed.gauge.max || 1;
      } else {
        if (!mappedData.length) return renderPlaceholder("No data available.");
        const values = mappedData.map(row => coerceNumeric(row[valueField])).filter(v => v !== null);
        if (values.length === 0) return renderPlaceholder("No numeric values available.");
        value = values.reduce((sum, v) => sum + v, 0) / values.length;
        const rawMax = Math.max(...values);
        max = rawMax === 0 ? 1 : rawMax * 1.1;
      }
      const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
      
      const color = seriesColors[valueField] || palette[0];
      const gaugeColor = percentage > 80 ? "#ef4444" : percentage > 50 ? "#eab308" : "#10b981";
      
      return (
        <div style={{ width: "100%", height: compact ? 280 : 340 }} className="flex flex-col items-center justify-center p-6">
          <div className="text-xs font-semibold mb-1 text-slate-500 dark:text-slate-400 uppercase tracking-wider">{valueField}</div>
          <div className="relative w-48 h-24">
            <svg className="w-full h-full" viewBox="0 0 200 100" style={{ overflow: "visible" }}>
              <defs>
                <filter id={`gaugeShadow-${chartDomIdRef.current}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={gaugeColor} floodOpacity="0.35" />
                </filter>
              </defs>
              <path
                d="M 25 85 A 75 75 0 0 1 175 85"
                fill="none"
                stroke={gridColor}
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                d="M 25 85 A 75 75 0 0 1 175 85"
                fill="none"
                stroke={gaugeColor}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={`${(percentage / 100) * 235.619} 235.619`}
                filter={`url(#gaugeShadow-${chartDomIdRef.current})`}
                className="transition-all duration-500 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 select-none">
              <span className="text-2xl font-extrabold text-slate-800 dark:text-white leading-none">
                {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                Target: {max.toFixed(0)}
              </span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-2 font-semibold">
            Status: <span style={{ color: gaugeColor }} className="font-bold">{percentage.toFixed(0)}% Capacity</span>
          </div>
        </div>
      );
    }

    if (["scatter3d", "surface3d", "line3d"].includes(chartType)) {
      const { xField, yField, zField } = mappings;
      if (!skipValidation && !ensureFieldsPresent([xField, yField, zField])) {
        return renderPlaceholder("Select X, Y, and Z fields for 3D visualization.");
      }
      if (!safeData.length) return renderPlaceholder("No numeric values available.");
      
      return (
        <div style={{ height: compact ? 280 : 340, width: "100%" }}>
          <Dynamic3DCharts
            chartType={chartType}
            data={safeData}
            mappings={mappings}
            seriesColors={seriesColors}
            palette={palette}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className={wrapperClasses}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold tracking-wide text-slate-800 dark:text-slate-200 uppercase">{title}</h4>
          {chart?.description ? <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{chart.description}</p> : null}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:bg-slate-700/60"
        >
          {exporting ? "Exporting..." : "Export PNG"}
        </button>
      </div>
      <div 
        ref={containerRef} 
        id={chartDomIdRef.current} 
        className={`w-full overflow-hidden rounded-xl bg-white transition-colors dark:bg-slate-900/40 ${compact ? "h-[280px]" : "h-[340px]"}`}
      >
        {renderChart()}
      </div>
    </div>
  );
}
