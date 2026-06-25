import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "../providers/StoreContext.jsx";
import ChartRenderer from "../ui/ChartRenderer.jsx";
import { defaultPalette } from "../utils/colors.js";
import { fetchStaticChartData, getXField, getYField, PREVIEW_SAMPLE_SIZE } from "../utils/staticChartApi.js";

// L2: ops are split by field type — numeric fields get range operators,
// text fields get string operators. Both share = / != / in.
const FILTER_OPS_NUMERIC = [
  { value: "=", label: "= equals" },
  { value: "!=", label: "≠ not equals" },
  { value: ">", label: "> greater than" },
  { value: ">=", label: "≥ at least" },
  { value: "<", label: "< less than" },
  { value: "<=", label: "≤ at most" },
  { value: "between", label: "between" },
  { value: "in", label: "in list" }
];
const FILTER_OPS_TEXT = [
  { value: "=", label: "= equals" },
  { value: "!=", label: "≠ not equals" },
  { value: "contains", label: "contains" },
  { value: "in", label: "in list" }
];
function filterOpsForField(field, typeMap) {
  return typeMap[field] === "number" ? FILTER_OPS_NUMERIC : FILTER_OPS_TEXT;
}

const chartDefinitions = [
  { value: "line", label: "Line", description: "Track trends across a dimension" },
  { value: "bar", label: "Bar Plot", description: "Compare values side-by-side" },
  { value: "area", label: "Area Plot", description: "Emphasize cumulative totals" },
  { value: "scatter", label: "Scatter Plot", description: "Visualize relationships between variables" },
  { value: "pie", label: "Pie", description: "Show proportional breakdown" },
  { value: "donut", label: "Donut", description: "Pie chart with an open center" },
  { value: "radar", label: "Radar", description: "Compare metrics across categories" },
  { value: "histogram", label: "Histogram", description: "Shows data distribution" },
  { value: "box", label: "Box Plot", description: "Identifies outliers and data spread" },
  { value: "gauge", label: "Gauge Chart", description: "Shows progress or KPI value" },
  { value: "scatter3d", label: "3D Scatter Plot", description: "Relationship among three variables" },
  { value: "surface3d", label: "3D Surface Plot", description: "Trend or pattern visualization in 3D" },
  { value: "line3d", label: "3D Line Plot", description: "Time or path-based 3D trend visualization" }
];

const createDefaultValues = () => ({
  title: "",
  datasetId: "",
  chartType: "bar",
  mappings: {
    xField: "",
    yFields: [],
    stacked: false,
    yField: "",
    zField: "",
    categoryField: "",
    valueField: "",
    donut: true,
    angleField: "",
    radiusField: ""
  },
  options: {
    aggregation: "none",
    topN: 0,
    bins: 10,
    seriesColors: {},
    palette: defaultPalette.slice()
  }
});

const getDatasetMeta = (dataset) => {
  if (!dataset) {
    return {
      headers: [],
      types: [],
      numericFields: [],
      stringFields: []
    };
  }
  const headers = dataset.schema?.headers ?? dataset.headers ?? [];
  const rawTypes = dataset.schema?.types ?? dataset.types ?? [];
  const types = headers.map((header, index) => rawTypes[index] || "string");
  const numericFields = headers.filter((_, index) => types[index] === "number");
  const stringFields = headers.filter((_, index) => types[index] !== "number");
  return { headers, types, numericFields, stringFields };
};

const suggestMappings = (chartType, meta, current) => {
  const { headers, numericFields, stringFields } = meta;
  const suggestions = {};

  const firstHeader = headers[0] ?? "";
  const firstNumeric = numericFields[0] ?? headers[1] ?? headers[0] ?? "";
  const secondNumeric = numericFields[1] ?? numericFields[0] ?? "";
  const firstString = stringFields[0] ?? headers[0] ?? "";

  const mapHasField = (field) => field && headers.includes(field);

  if (!headers.length) {
    return {
      xField: "",
      yFields: [],
      yField: "",
      zField: "",
      categoryField: "",
      valueField: "",
      angleField: "",
      radiusField: ""
    };
  }

  if (["line", "bar", "area"].includes(chartType)) {
    if (!mapHasField(current.xField)) {
      // Bar groups by x — prefer a categorical (text) field to avoid grouping
      // by a high-cardinality numeric id. Line/area plot x sequentially, so the
      // first column is fine there.
      suggestions.xField = chartType === "bar" ? (firstString || firstHeader) : firstHeader;
    }
    const validY = (current.yFields || []).filter(mapHasField);
    if (validY.length === 0) {
      if (numericFields.length > 0) {
        suggestions.yFields = numericFields.slice(0, Math.min(3, numericFields.length));
      } else if (headers.length > 1) {
        suggestions.yFields = [headers[1]];
      } else {
        suggestions.yFields = [headers[0]];
      }
    } else if (validY.length !== (current.yFields || []).length) {
      suggestions.yFields = validY;
    }
  } else if (chartType === "scatter") {
    if (!mapHasField(current.xField) || current.xField === current.yField) {
      suggestions.xField = secondNumeric || firstNumeric;
    }
    if (!mapHasField(current.yField)) {
      suggestions.yField = firstNumeric;
    }
  } else if (["pie", "donut"].includes(chartType)) {
    if (!mapHasField(current.categoryField)) {
      suggestions.categoryField = firstString;
    }
    if (!mapHasField(current.valueField)) {
      suggestions.valueField = firstNumeric;
    }
  } else if (chartType === "radar") {
    if (!mapHasField(current.angleField)) {
      suggestions.angleField = firstString;
    }
    if (!mapHasField(current.radiusField)) {
      suggestions.radiusField = firstNumeric;
    }
  } else if (["histogram", "box", "gauge"].includes(chartType)) {
    if (!mapHasField(current.yField)) {
      suggestions.yField = firstNumeric;
    }
  } else if (["scatter3d", "surface3d", "line3d"].includes(chartType)) {
    if (!mapHasField(current.xField)) {
      suggestions.xField = firstNumeric;
    }
    if (!mapHasField(current.yField)) {
      suggestions.yField = secondNumeric || firstNumeric;
    }
    if (!mapHasField(current.zField)) {
      suggestions.zField = numericFields[2] || secondNumeric || firstNumeric;
    }
  }

  return suggestions;
};

const fieldTypeLabel = (field, typeMap) => {
  if (!field) return "";
  const type = typeMap[field];
  if (!type) return "";
  if (type === "number") return "Numeric";
  if (type === "date") return "Date";
  return "Text";
};

export default function VisualizePage() {
  const { datasets, charts, saveChart, generateId } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [statusMessage, setStatusMessage] = useState("");
  const defaults = useMemo(() => createDefaultValues(), []);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    getValues,
    formState: { isDirty }
  } = useForm({ defaultValues: defaults });

  const datasetId = watch("datasetId");
  const chartType = watch("chartType");
  const mappings = watch("mappings");
  const options = watch("options");
  const title = watch("title");

  const datasetOptions = useMemo(
    () => Object.values(datasets).map((dataset) => ({ value: dataset.id, label: dataset.name || "Untitled dataset" })),
    [datasets]
  );

  const selectedDataset = datasetId ? datasets[datasetId] : null;
  const meta = useMemo(() => getDatasetMeta(selectedDataset), [selectedDataset]);
  const typeMap = useMemo(
    () => meta.headers.reduce((acc, header, index) => ({ ...acc, [header]: meta.types[index] }), {}),
    [meta.headers, meta.types]
  );

  const currentChartId = searchParams.get("chartId");
  const editingChart = currentChartId ? charts[currentChartId] : null;
  const preselectedDatasetId = searchParams.get("datasetId");

  useEffect(() => {
    if (editingChart) {
      reset({
        ...defaults,
        ...editingChart,
        options: {
          ...defaults.options,
          ...(editingChart.options || {}),
          seriesColors: { ...defaults.options.seriesColors, ...(editingChart.options?.seriesColors || {}) }
        }
      });
      setFilters(Array.isArray(editingChart.options?.filters) ? editingChart.options.filters : []);
      setStatusMessage(`Editing "${editingChart.title}"`);
    } else {
      reset(createDefaultValues());
      setFilters([]);
      setStatusMessage("");
    }
  }, [defaults, editingChart, reset]);

  // Pre-select dataset when navigating from the Data page with ?datasetId=
  useEffect(() => {
    if (!preselectedDatasetId || editingChart) return;
    if (datasets[preselectedDatasetId]) {
      setValue("datasetId", preselectedDatasetId, { shouldDirty: false });
      // Remove param from URL so it doesn't re-apply on future navigations
      const next = new URLSearchParams(searchParams);
      next.delete("datasetId");
      setSearchParams(next, { replace: true });
    }
  }, [preselectedDatasetId, datasets, editingChart, setValue, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedDataset) {
      setValue("mappings", createDefaultValues().mappings, { shouldDirty: false });
      return;
    }
    const current = getValues("mappings");
    const suggestions = suggestMappings(chartType, meta, current);
    Object.entries(suggestions).forEach(([key, value]) => {
      if (value === undefined) return;
      const path = `mappings.${key}`;
      const existing = current[key];
      const equalsArray =
        Array.isArray(existing) && Array.isArray(value) ? existing.join("|") === value.join("|") : existing === value;
      if (!equalsArray) {
        setValue(path, value, { shouldDirty: false });
      }
    });
    if (Array.isArray(current.yFields)) {
      const unique = current.yFields.filter((field, index, arr) => arr.indexOf(field) === index && meta.headers.includes(field));
      if (unique.length !== current.yFields.length) {
        setValue("mappings.yFields", unique, { shouldDirty: false });
      }
    }
  }, [chartType, getValues, meta, selectedDataset, setValue]);

  useEffect(() => {
    if (!selectedDataset && !editingChart) {
      setSearchParams({});
    }
  }, [editingChart, selectedDataset, setSearchParams]);

  const [chartData, setChartData] = useState([]);
  const [serverComputed, setServerComputed] = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [approximate, setApproximate] = useState(false); // M6: true when preview used spread sample
  const [filters, setFilters] = useState([]);

  const xFieldParam = getXField(chartType, mappings);
  const yFieldParam = getYField(chartType, mappings);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!datasetId || !yFieldParam) {
      setChartData([]);
      setServerComputed(null);
      setApproximate(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setChartLoading(true);
    const loadData = async () => {
      try {
        const result = await fetchStaticChartData({
          datasetId,
          chartType,
          mappings,
          options,
          filters,
          sample: PREVIEW_SAMPLE_SIZE, // fast spread-sampled preview; dashboard charts are exact
          signal: controller.signal
        });
        if (active) {
          setChartData(result.rows);
          setServerComputed(result.serverComputed);
          setApproximate(result.approximate);
        }
      } catch (err) {
        if (err.name !== "AbortError") console.error("Failed to load chart data:", err);
      } finally {
        if (active) setChartLoading(false);
      }
    };

    // Debounce so dragging Top N / typing filters doesn't fire heavy queries.
    const debounce = setTimeout(loadData, 350);
    return () => {
      active = false;
      clearTimeout(debounce);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, chartType, xFieldParam, yFieldParam, options.aggregation, options.topN, options.bins, filtersKey]);

  const previewData = chartData;

  const addFilter = () => {
    const firstField = meta.headers[0] || "";
    setFilters((prev) => [...prev, { field: firstField, op: "=", value: "", value2: "" }]);
  };
  const updateFilter = (index, patch) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const removeFilter = (index) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const datasetField = register("datasetId");
  const chartTypeField = register("chartType");

  const handleYFieldsChange = (event) => {
    const selectedValues = Array.from(event.target.selectedOptions).map((option) => option.value);
    setValue("mappings.yFields", selectedValues, { shouldDirty: true, shouldValidate: true });
    const colorMap = options.seriesColors || {};
    const nextColorMap = {};
    selectedValues.forEach((field, index) => {
      nextColorMap[field] = colorMap[field] || defaultPalette[index % defaultPalette.length];
    });
    setValue("options.seriesColors", nextColorMap, { shouldDirty: true });
  };

  const handleSeriesColorChange = (field, fallbackIndex, color) => {
    const next = {
      ...(options.seriesColors || {}),
      [field]: color || defaultPalette[fallbackIndex % defaultPalette.length]
    };
    setValue("options.seriesColors", next, { shouldDirty: true });
  };

  const removeChartFromUrl = () => {
    if (!searchParams.has("chartId")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("chartId");
    setSearchParams(next);
  };

  const onSubmit = (values) => {
    if (!values.datasetId) {
      setStatusMessage("Select a dataset to build a chart.");
      return;
    }
    const id = editingChart?.id || generateId();
    const payload = {
      id,
      title: values.title || chartDefinitions.find((c) => c.value === values.chartType)?.label || "Untitled chart",
      datasetId: values.datasetId,
      chartType: values.chartType,
      mappings: { ...values.mappings },
      options: {
        aggregation: values.options.aggregation,
        topN: Number(values.options.topN) || 0,
        bins: Number(values.options.bins) || 10,
        seriesColors: values.options.seriesColors || {},
        palette: values.options.palette?.length ? values.options.palette : defaultPalette.slice(),
        filters: filters.filter((f) => f && f.field && f.op)
      },
      createdAt: editingChart?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveChart(payload);
    setSearchParams({ chartId: id });
    setStatusMessage(`Saved chart "${payload.title}".`);
  };

  const resetForm = () => {
    if (editingChart) {
      reset({
        ...defaults,
        ...editingChart,
        options: {
          ...defaults.options,
          ...(editingChart.options || {}),
          seriesColors: { ...defaults.options.seriesColors, ...(editingChart.options?.seriesColors || {}) }
        }
      });
    } else {
      reset(createDefaultValues());
      removeChartFromUrl();
    }
    setStatusMessage("");
  };

  const mappingHint = (field, expectation) => {
    if (!field) return null;
    const type = typeMap[field];
    if (!type) return null;
    if (expectation === "number" && type !== "number") {
      return <p className="text-xs text-amber-600">Tip: choose a numeric field for best results.</p>;
    }
    if (expectation === "string" && type === "number") {
      return <p className="text-xs text-amber-600">Tip: a categorical/text field works best here.</p>;
    }
    return null;
  };

  const chartSummary = chartDefinitions.find((item) => item.value === chartType);

  return (
    <div className="flex w-full flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8 flex-1 min-h-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Visualize</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Configure a dataset, choose a chart type, and see changes reflected instantly in the preview.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          View dashboard
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 flex-1 min-h-0 lg:gap-8">
        <section className="space-y-6 min-h-0 overflow-y-auto">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
            <div className="m3-card p-5">
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Chart details</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Title
                  <input
                    type="text"
                    placeholder="Untitled chart"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                    {...register("title")}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Dataset
                  <select
                    {...datasetField}
                    value={datasetId}
                    onChange={(event) => {
                      datasetField.onChange(event);
                      setValue("datasetId", event.target.value, { shouldDirty: true });
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                  >
                    <option value="">Select dataset</option>
                    {datasetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!datasetId ? <span className="text-xs text-slate-400">Choose a dataset to unlock field mappings.</span> : null}
                </label>
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Chart type</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {chartDefinitions.map((chart) => (
                    <button
                      key={chart.value}
                      type="button"
                      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors ${
                        chartType === chart.value
                          ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/30"
                          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/40"
                      }`}
                      onClick={() => {
                        chartTypeField.onChange({ target: { value: chart.value } });
                        setValue("chartType", chart.value, { shouldDirty: true });
                      }}
                    >
                      <span
                        className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-sm ${
                          chartType === chart.value ? "bg-brand-500 dark:bg-brand-400" : "bg-zinc-300 dark:bg-zinc-600"
                        }`}
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className={`text-xs font-semibold ${chartType === chart.value ? "text-brand-700 dark:text-brand-300" : "text-zinc-700 dark:text-zinc-300"}`}>{chart.label}</span>
                        <span className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">{chart.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {chartSummary ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Hint: {chartSummary.description}.</p>
                ) : null}
              </div>
            </div>

            <div className="m3-card p-5">
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Field mappings</h2>
              {!datasetId ? (
                <div className="mt-4 flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-5 text-sm text-zinc-400 dark:text-zinc-500">
                  Choose a dataset to configure field mappings.
                </div>
              ) : (
                <div className="mt-4 space-y-6">
                  {["line", "bar", "area"].includes(chartType) ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        X axis field
                        <select
                          value={mappings.xField || ""}
                          onChange={(event) => setValue("mappings.xField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.xField, "string")}
                      </label>
                      <div className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <span>Y axis fields</span>
                        <div className="h-32 overflow-y-auto rounded-lg border border-slate-200 p-2 shadow-sm dark:border-slate-600 dark:bg-slate-900/40 flex flex-col gap-1">
                          {meta.headers.map((header) => {
                            const isSelected = (mappings.yFields || []).includes(header);
                            return (
                              <label
                                key={header}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300"
                                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    let nextYFields;
                                    if (isSelected) {
                                      nextYFields = (mappings.yFields || []).filter((f) => f !== header);
                                    } else {
                                      nextYFields = [...(mappings.yFields || []), header];
                                    }
                                    setValue("mappings.yFields", nextYFields, { shouldDirty: true, shouldValidate: true });
                                    const colorMap = options.seriesColors || {};
                                    const nextColorMap = {};
                                    nextYFields.forEach((field, index) => {
                                      nextColorMap[field] = colorMap[field] || defaultPalette[index % defaultPalette.length];
                                    });
                                    setValue("options.seriesColors", nextColorMap, { shouldDirty: true });
                                  }}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                                />
                                <span className="truncate flex-1">{header}</span>
                                <span className="text-[10px] opacity-70">({fieldTypeLabel(header, typeMap)})</span>
                              </label>
                            );
                          })}
                        </div>
                        {mappingHint((mappings.yFields || [])[0], "number")}
                        {mappings.yFields?.length ? (
                          <div className="flex flex-wrap gap-3 text-xs mt-2">
                            {mappings.yFields.map((field, index) => (
                              <label key={field} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 dark:border-slate-600">
                                <span className="font-medium text-slate-600 dark:text-slate-200">{field}</span>
                                <input
                                  type="color"
                                  value={(options.seriesColors || {})[field] || defaultPalette[index % defaultPalette.length]}
                                  onChange={(event) => handleSeriesColorChange(field, index, event.target.value)}
                                  className="h-6 w-6 cursor-pointer rounded-full border border-slate-200 bg-transparent p-0 dark:border-slate-600"
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-amber-600">Select at least one numeric field.</p>
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={mappings.stacked || false}
                          onChange={(event) => setValue("mappings.stacked", event.target.checked, { shouldDirty: true })}
                          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                        />
                        Stacked bars / areas
                      </label>
                    </div>
                  ) : null}

                  {chartType === "scatter" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        X (numeric)
                        <select
                          value={mappings.xField || ""}
                          onChange={(event) => setValue("mappings.xField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.xField, "number")}
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Y (numeric)
                        <select
                          value={mappings.yField || ""}
                          onChange={(event) => setValue("mappings.yField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.yField, "number")}
                      </label>
                    </div>
                  ) : null}

                  {["pie", "donut"].includes(chartType) ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Category field
                        <select
                          value={mappings.categoryField || ""}
                          onChange={(event) => setValue("mappings.categoryField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.categoryField, "string")}
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Value field
                        <select
                          value={mappings.valueField || ""}
                          onChange={(event) => setValue("mappings.valueField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.valueField, "number")}
                      </label>
                      {chartType === "donut" ? (
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={mappings.donut !== false}
                            onChange={(event) => setValue("mappings.donut", event.target.checked, { shouldDirty: true })}
                            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                          />
                          Show as donut
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  {chartType === "radar" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Angle (category)
                        <select
                          value={mappings.angleField || ""}
                          onChange={(event) => setValue("mappings.angleField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.angleField, "string")}
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Radius (numeric)
                        <select
                          value={mappings.radiusField || ""}
                          onChange={(event) => setValue("mappings.radiusField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.radiusField, "number")}
                      </label>
                    </div>
                  ) : null}

                  {["histogram", "box", "gauge"].includes(chartType) ? (
                    <div>
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Value field (numeric)
                        <select
                          value={mappings.yField || ""}
                          onChange={(event) => setValue("mappings.yField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.yField, "number")}
                      </label>
                    </div>
                  ) : null}

                  {["scatter3d", "surface3d", "line3d"].includes(chartType) ? (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        X field (numeric)
                        <select
                          value={mappings.xField || ""}
                          onChange={(event) => setValue("mappings.xField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.xField, "number")}
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Y field (numeric)
                        <select
                          value={mappings.yField || ""}
                          onChange={(event) => setValue("mappings.yField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.yField, "number")}
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Z field (numeric)
                        <select
                          value={mappings.zField || ""}
                          onChange={(event) => setValue("mappings.zField", event.target.value, { shouldDirty: true })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                        >
                          <option value="">Select column</option>
                          {meta.headers.map((header) => (
                            <option key={header} value={header}>
                              {header} ({fieldTypeLabel(header, typeMap)})
                            </option>
                          ))}
                        </select>
                        {mappingHint(mappings.zField, "number")}
                      </label>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="m3-card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Filters</h2>
                <button
                  type="button"
                  onClick={addFilter}
                  disabled={!datasetId}
                  className="btn-action disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + Add filter
                </button>
              </div>
              {!datasetId ? (
                <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">Choose a dataset to add filters.</p>
              ) : filters.length === 0 ? (
                <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">No filters. The chart uses the full dataset.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {filters.map((filter, index) => {
                    const availableOps = filterOpsForField(filter.field, typeMap);
                    // M3: warn when a numeric op receives a non-numeric value
                    const numericOps = new Set([">", ">=", "<", "<=", "between"]);
                    const needsNumber = numericOps.has(filter.op);
                    const valueInvalid = needsNumber && filter.value !== "" && isNaN(Number(filter.value));
                    const value2Invalid = filter.op === "between" && filter.value2 !== "" && isNaN(Number(filter.value2));
                    return (
                      <div key={index} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={filter.field}
                            onChange={(e) => {
                              const newField = e.target.value;
                              // reset op to safe default when switching field type
                              const newOps = filterOpsForField(newField, typeMap);
                              const opValid = newOps.some((o) => o.value === filter.op);
                              updateFilter(index, { field: newField, op: opValid ? filter.op : newOps[0].value });
                            }}
                            className="min-w-[8rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                          >
                            {meta.headers.map((header) => (
                              <option key={header} value={header}>
                                {header} ({fieldTypeLabel(header, typeMap)})
                              </option>
                            ))}
                          </select>
                          <select
                            value={filter.op}
                            onChange={(e) => updateFilter(index, { op: e.target.value })}
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                          >
                            {availableOps.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={filter.value}
                            onChange={(e) => updateFilter(index, { value: e.target.value })}
                            placeholder={filter.op === "in" ? "a, b, c" : needsNumber ? "number" : "value"}
                            className={`min-w-[6rem] flex-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 dark:bg-slate-900/40 dark:text-slate-100 ${valueInvalid ? "border-red-400 focus:border-red-400 focus:ring-red-200" : "border-slate-200 focus:border-brand-400 focus:ring-brand-200 dark:border-slate-600"}`}
                          />
                          {filter.op === "between" ? (
                            <input
                              type="text"
                              value={filter.value2 || ""}
                              onChange={(e) => updateFilter(index, { value2: e.target.value })}
                              placeholder="and"
                              className={`min-w-[5rem] flex-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 dark:bg-slate-900/40 dark:text-slate-100 ${value2Invalid ? "border-red-400 focus:border-red-400 focus:ring-red-200" : "border-slate-200 focus:border-brand-400 focus:ring-brand-200 dark:border-slate-600"}`}
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => removeFilter(index)}
                            className="btn-action-danger"
                            aria-label="Remove filter"
                          >
                            Remove
                          </button>
                        </div>
                        {/* M3: inline NaN validation message */}
                        {(valueInvalid || value2Invalid) && (
                          <p className="text-[11px] text-red-500 pl-1">
                            {valueInvalid ? "Value must be a number for this operator." : "Second value must be a number."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="m3-card p-5">
              <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Options</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Aggregation
                  <select
                    {...register("options.aggregation")}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                  >
                    <option value="none">None</option>
                    <option value="sum">Sum</option>
                    <option value="avg">Average</option>
                    <option value="min">Min</option>
                    <option value="max">Max</option>
                  </select>
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {["pie", "donut", "radar", "bar"].includes(chartType) ? "Max categories (0 = default)" : "Max points (0 = default)"}
                  <input
                    type="number"
                    min="0"
                    value={options.topN ?? 0}
                    onChange={(event) =>
                      setValue("options.topN", event.target.value === "" ? 0 : Number(event.target.value), { shouldDirty: true })
                    }
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                  />
                </label>
                {chartType === "histogram" ? (
                  <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    Histogram bins
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={options.bins ?? 10}
                      onChange={(event) =>
                        setValue("options.bins", event.target.value === "" ? 10 : Number(event.target.value), { shouldDirty: true })
                      }
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100"
                    />
                  </label>
                ) : null}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500 dark:text-slate-300">{statusMessage}</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
                  >
                    Save chart
                  </button>
                </div>
              </div>
            </div>
          </form>

          {selectedDataset ? (
            <div className="m3-card p-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Dataset context</h3>
              <div className="mt-4 grid gap-3 text-xs text-slate-500 dark:text-slate-300 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">{selectedDataset.name}</p>
                  <p>{selectedDataset.rowCount ?? 0} rows</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">Columns</p>
                  <p className="max-h-20 overflow-y-auto text-slate-500 dark:text-slate-300">
                    {meta.headers.join(", ") || "N/A"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">Updated</p>
                  <p>{new Date(selectedDataset.updatedAt || Date.now()).toLocaleString()}</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>
        <aside className="flex flex-col gap-6 min-h-0 max-h-[calc(100vh-200px)] overflow-y-auto lg:pl-6">
          <div className="m3-card p-5 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Live preview</h3>
                {/* M6: badge when values are estimates over a spread sample */}
                {approximate && !chartLoading && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Values are estimates over a 200k-row spread sample. Save chart for exact results.">
                    ~ approx
                  </span>
                )}
              </div>
              {isDirty ? <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Unsaved changes</span> : null}
            </div>
            <div className="flex-1 min-h-0 rounded-xl bg-slate-50 p-6 dark:bg-slate-900/40 h-full w-full relative">
              {chartLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm rounded-xl">
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 animate-pulse">Loading preview...</span>
                </div>
              )}
              {/* L4: empty result when all rows are excluded by active filters */}
              {!chartLoading && datasetId && yFieldParam && chartData.length === 0 && serverComputed === null && filters.length > 0 && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">No data matches the current filters.</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">Try removing or relaxing a filter.</span>
                </div>
              )}
              <ChartRenderer
                chart={{
                  id: currentChartId || "preview",
                  title: title || "Preview",
                  chartType,
                  mappings,
                  options
                }}
                data={previewData}
                serverComputed={serverComputed}
                compact
              />
            </div>
          </div>
          <div className="rounded-2xl bg-brand-50 p-5 text-sm text-brand-900 ring-1 ring-inset ring-brand-100">
            <h4 className="text-base font-semibold text-brand-900">Builder tips</h4>
            <ul className="mt-2 space-y-2 text-sm">
              <li>Use aggregation to summarize repeated categories before charting.</li>
              <li>Top N trims results to keep dashboards focused.</li>
              <li>Radar and Scatter charts work best with numeric measures.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
