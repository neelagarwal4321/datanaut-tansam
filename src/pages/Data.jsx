import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useStore } from "../providers/StoreContext.jsx";
import { transformGoogleSheetsUrl } from "../utils/parseData.js";
import DataPreviewTable from "../ui/DataPreviewTable.jsx";

const BACKEND = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname}:8085`
  : "http://127.0.0.1:8085";

export default function DataPage() {
  const { datasets, saveDataset, deleteDataset } = useStore();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    resetField,
    formState: { errors }
  } = useForm({
    defaultValues: {
      datasetName: "",
      googleUrl: ""
    }
  });

  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [headerRow, setHeaderRow] = useState(1);
  const [googleFormat, setGoogleFormat] = useState("csv");
  const [activePreview, setActivePreview] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const [previewPage, setPreviewPage] = useState(1);
  const [previewLimit] = useState(50);
  const [previewSearch, setPreviewSearch] = useState("");
  const pollRef = useRef(null); // active upload poll
  const recoveryRef = useRef(null); // recovery poll for processing datasets after page refresh

  // Clear polls on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (recoveryRef.current) clearInterval(recoveryRef.current);
  }, []);

  const savedDatasets = useMemo(
    () => Object.values(datasets).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [datasets]
  );

  // Recovery: if any dataset is still "processing" (e.g. after page refresh while ingesting),
  // poll until it resolves — the upload poll dies on unmount so this catches the gap.
  useEffect(() => {
    const processing = savedDatasets.filter(d => d.status === "processing");
    if (processing.length === 0) {
      if (recoveryRef.current) { clearInterval(recoveryRef.current); recoveryRef.current = null; }
      return;
    }
    if (recoveryRef.current) return; // already polling

    const remaining = new Set(processing.map(d => d.id));
    recoveryRef.current = setInterval(async () => {
      for (const id of [...remaining]) {
        try {
          const r = await fetch(`${BACKEND}/api/datasets/${id}/status`);
          const d = await r.json();
          if (d.status === "ready" || d.status === "error") {
            const ds = processing.find(p => p.id === id);
            if (ds) saveDataset({ ...ds, rowCount: d.rowCount ?? ds.rowCount, status: d.status });
            remaining.delete(id);
          }
        } catch (_) {}
      }
      if (remaining.size === 0) {
        clearInterval(recoveryRef.current);
        recoveryRef.current = null;
      }
    }, 3000);
  }, [savedDatasets.filter(d => d.status === "processing").map(d => d.id).join(",")]);

  const resetPreview = () => {
    setActivePreview(null);
    setStatusMessage("");
  };

  const handleDatasetClick = async (datasetId, page = 1, search = "") => {
    setExpandedId(datasetId);
    setLoading(true);
    setStatusMessage("Loading dataset preview...");
    try {
      const res = await fetch(`${BACKEND}/api/datasets/${datasetId}/data?page=${page}&limit=${previewLimit}&search=${encodeURIComponent(search)}`);
      const data = await res.json();
      if (data.success) {
        setActivePreview({
          id: datasetId,
          headers: data.headers,
          types: data.types,
          rows: data.rows,
          totalRows: data.totalRows,
          page: data.page
        });
        setPreviewPage(page);
        setPreviewSearch(search);
        setStatusMessage("");
      } else {
        throw new Error(data.error || "Failed to fetch preview.");
      }
    } catch (err) {
      console.error(err);
      setStatusMessage(err.message || "Failed to load preview.");
    } finally {
      setLoading(false);
    }
  };

  const toggleDatasetPreview = (datasetId) => {
    if (expandedId === datasetId) {
      setExpandedId(null);
    } else {
      handleDatasetClick(datasetId, 1, "");
    }
  };

  const startIngestPoll = useCallback((dataset) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND}/api/datasets/${dataset.id}/status`);
        const d = await res.json();
        if (d.status === "ready") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          const ready = { ...dataset, rowCount: d.rowCount, status: "ready", schema: { ...dataset.schema } };
          saveDataset(ready);
          setStatusMessage(`Imported "${dataset.name}" — ${(d.rowCount || 0).toLocaleString()} rows ready.`);
          setLoading(false);
          handleDatasetClick(dataset.id, 1, "");
        } else if (d.status === "error") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setStatusMessage(`Import failed for "${dataset.name}". Check server logs.`);
          setLoading(false);
        }
        // else still processing — keep polling
      } catch (_) { /* network hiccup — keep polling */ }
    }, 2000);
  }, [BACKEND, saveDataset, handleDatasetClick]);

  const parseFile = async (file) => {
    if (!file) return;
    setLoading(true);
    setStatusMessage("Uploading file…");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("firstRowHeader", firstRowHeader);
      formData.append("headerRow", headerRow);
      formData.append("datasetName", watch("datasetName") || "");
      formData.append("sourceType", file.name?.split(".").pop()?.toLowerCase() || "csv");

      const response = await fetch(`${BACKEND}/api/datasets/upload`, {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Failed to upload file.");

      resetField("datasetName");
      saveDataset(data.dataset);

      if (data.processing) {
        setStatusMessage(`"${data.dataset.name}" uploaded — ingesting rows in background…`);
        startIngestPoll(data.dataset);
      } else {
        setStatusMessage(`Imported "${data.dataset.name}" — ${(data.dataset.rowCount || 0).toLocaleString()} rows.`);
        handleDatasetClick(data.dataset.id, 1, "");
      }
    } catch (error) {
      console.error(error);
      setStatusMessage(error.message || "Failed to parse file.");
      resetPreview();
    } finally {
      setLoading(false);
    }
  };

  const handleFileInput = (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // reset so same file can be re-selected
    parseFile(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    parseFile(file);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const onFetchGoogle = async (event) => {
    event.preventDefault();
    const url = watch("googleUrl");
    if (!url) return;
    setLoading(true);
    setStatusMessage("Server downloading Google Sheet…");
    try {
      const response = await fetch(`${BACKEND}/api/datasets/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleUrl: url,
          firstRowHeader,
          headerRow,
          googleFormat,
          datasetName: watch("datasetName") || "Google Sheet Dataset",
          sourceType: "csv"
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Failed to import Google Sheet.");

      resetField("datasetName");
      resetField("googleUrl");
      saveDataset(data.dataset);

      if (data.processing) {
        setStatusMessage(`"${data.dataset.name}" downloaded — ingesting rows in background…`);
        startIngestPoll(data.dataset);
      } else {
        setStatusMessage(`Imported "${data.dataset.name}" — ${(data.dataset.rowCount || 0).toLocaleString()} rows.`);
        handleDatasetClick(data.dataset.id, 1, "");
      }
    } catch (error) {
      console.error(error);
      setStatusMessage(error.message || "Failed to fetch Google Sheets data.");
      resetPreview();
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (!activePreview?.id) return;
    handleDatasetClick(activePreview.id, newPage, previewSearch);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!activePreview?.id) return;
    handleDatasetClick(activePreview.id, 1, previewSearch);
  };

  const onDeleteDataset = (id, name) => {
    if (window.confirm(`Delete dataset "${name}"? This also removes linked charts.`)) {
      deleteDataset(id);
      if (activePreview?.id === id) {
        resetPreview();
      }
      setExpandedId(null);
    }
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6 sm:gap-8 lg:grid lg:grid-cols-[2fr,1fr] min-h-0">
      <section className="flex flex-col gap-6 min-h-0 lg:overflow-y-auto">
        <div className="rounded-2xl bg-white dark:bg-slate-800/80 p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import Data</h2>
            <p className="text-sm text-slate-500 dark:text-slate-300">
              Drag & drop or browse for CSV, XLSX, or JSON files. You can also paste public Google Sheets links.
            </p>
          </div>
          <div
            data-dropzone
            className="mt-4 flex h-40 flex-col items-center justify-center rounded-md border-2 border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 text-center transition hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/20 dark:hover:border-brand-500/60"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">Drop your file here or</p>
            <label className="mt-3 inline-flex cursor-pointer items-center rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
              Browse files
              <input type="file" accept=".csv,.xlsx,.xls,.json" className="hidden" onChange={handleFileInput} />
            </label>
          </div>
          <form className="mt-6 flex flex-col gap-3" onSubmit={onFetchGoogle}>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Google Sheets public link</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                {...register("googleUrl", {
                  pattern: {
                    value: /^https?:\/\/.+/,
                    message: "Enter a valid URL"
                  }
                })}
              />
              <select
                value={googleFormat}
                onChange={(e) => setGoogleFormat(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 shadow-sm focus:border-brand-400 focus:outline-none"
                title="Export format (XLSX requires sign-in and is not supported for public sheets)"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {loading ? "Loading..." : "Fetch"}
              </button>
            </div>
            {errors.googleUrl ? <span className="text-xs text-red-500">{errors.googleUrl.message}</span> : null}
          </form>
          <div className="mt-6 flex flex-col gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Dataset name (optional)</label>
            <input
              type="text"
              placeholder="Quarterly performance"
              className="rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
              {...register("datasetName")}
            />
          </div>
          <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                checked={firstRowHeader}
                onChange={(e) => setFirstRowHeader(e.target.checked)}
              />
              First row contains headers
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 sm:ml-auto">
              Header row
              <input
                type="number"
                min={1}
                max={50}
                value={headerRow}
                onChange={(e) => setHeaderRow(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1 text-center text-sm dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:border-brand-400"
                title="Row number that contains column headers (use 2+ if your sheet has title rows above the headers)"
              />
            </label>
          </div>
          {statusMessage ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-300">{statusMessage}</p> : null}
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-800/80 p-6 shadow-sm flex flex-col min-h-0">
          <div className="flex flex-col gap-2 mb-4 flex-shrink-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Dataset Preview</h3>
            <p className="text-sm text-slate-500 dark:text-slate-300">Browse rows and inspect your dataset schema below.</p>
          </div>
          {activePreview && (
            <form onSubmit={handleSearchSubmit} className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Search rows..."
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-slate-100"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-900 dark:bg-slate-100 dark:text-slate-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Search
              </button>
            </form>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activePreview ? (
              <div className="h-full flex flex-col gap-4">
                <div className="flex-1 overflow-auto">
                  <DataPreviewTable
                    headers={activePreview.headers}
                    types={activePreview.types}
                    rows={activePreview.rows}
                    compact
                    maxHeight={360}
                    totalRows={activePreview.totalRows}
                  />
                </div>
                {(() => {
                  const totalPages = Math.ceil(activePreview.totalRows / previewLimit);
                  return (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-2 text-sm text-slate-600 dark:text-slate-300">
                      <span>
                        Showing page <strong>{previewPage}</strong> of <strong>{totalPages || 1}</strong> ({activePreview.totalRows.toLocaleString()} total rows)
                      </span>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs">Go to:</span>
                          <input
                            type="number"
                            min={1}
                            max={totalPages}
                            value={previewPage}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (val >= 1 && val <= totalPages) {
                                handlePageChange(val);
                              }
                            }}
                            className="w-16 rounded border border-slate-200 dark:border-slate-600 px-2 py-1 text-center text-xs dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:border-brand-400"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handlePageChange(previewPage - 1)}
                            disabled={previewPage <= 1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 disabled:opacity-50 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            Previous
                          </button>
                          <button
                            onClick={() => handlePageChange(previewPage + 1)}
                            disabled={previewPage >= totalPages}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 disabled:opacity-50 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-500 dark:text-slate-300">
                <p>No data loaded yet. Import a file or fetch a Google Sheet to see the preview.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="flex flex-col gap-6 min-h-0 lg:overflow-y-auto">
        <div className="rounded-2xl bg-white dark:bg-slate-800/80 p-6 shadow-sm flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Saved datasets</h2>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800/60 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              {savedDatasets.length}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {savedDatasets.length === 0 ? (
              <p className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-slate-500 dark:text-slate-300">No datasets saved yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {savedDatasets.map((dataset) => {
                  const isExpanded = expandedId === dataset.id;
                  const totalRows = dataset.rowCount ?? 0;
                  const headerCount = dataset.schema?.headers?.length ?? 0;
                  const isProcessing = dataset.status === "processing";
                  return (
                    <div key={dataset.id} className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{dataset.name || "Untitled dataset"}</p>
                            {isProcessing && (
                              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Ingesting…
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-300">
                            {isProcessing ? "Processing — rows will update when complete" : `${totalRows.toLocaleString()} rows × ${headerCount.toLocaleString()} columns`}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <button
                            onClick={() => !isProcessing && toggleDatasetPreview(dataset.id)}
                            disabled={isProcessing}
                            className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-200 hover:bg-white/70 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isExpanded ? "Hide preview" : "Show preview"}
                          </button>
                          <button
                            onClick={() => navigate(`/visualize?datasetId=${dataset.id}`)}
                            disabled={isProcessing}
                            className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-brand-600 transition hover:border-brand-100 hover:bg-brand-50 dark:text-brand-400 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Visualize
                          </button>
                          <button
                            onClick={() => onDeleteDataset(dataset.id, dataset.name)}
                            className="rounded-full border border-transparent px-3 py-1 text-xs font-semibold text-red-500 transition hover:border-red-100 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {isExpanded ? (
                        activePreview && activePreview.id === dataset.id ? (
                          <div className="mt-3 space-y-2">
                            <DataPreviewTable
                              headers={activePreview.headers}
                              types={activePreview.types}
                              rows={activePreview.rows.slice(0, 20)}
                              compact
                              maxHeight={240}
                              totalRows={activePreview.totalRows}
                            />
                            {activePreview.totalRows > 20 ? (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Showing first 20 rows. View full preview, pagination, and search in the main panel.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-300">
                            Loading preview...
                          </p>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-brand-50 p-5 text-sm text-brand-900 ring-1 ring-inset ring-brand-100">
          <h3 className="text-base font-semibold text-brand-900">Need tips?</h3>
          <p className="mt-2">
            Ensure Google Sheets are shared as &ldquo;Anyone with the link&rdquo; and use the fetch button. Parsed datasets persist in
            sqlite database on the server automatically.
          </p>
        </div>
      </aside>
    </div>
  );
}


