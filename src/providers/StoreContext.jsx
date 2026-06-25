import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { parseCSVText, parseJSONText } from "../utils/parseData.js";
import { BACKEND_URL } from "../config.js";

const StoreContext = createContext(null);

const DATASETS_KEY = "datasets";
const CHARTS_KEY = "charts";
const SEED_FLAG_KEY = "seeded";


const nowIso = () => new Date().toISOString();

const generateId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
};

const safeParse = (value) => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Failed to parse localStorage value", error);
    return {};
  }
};

export function StoreProvider({ children }) {
  const [datasets, setDatasets] = useState({});
  const [charts, setCharts] = useState({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    const fetchDatasetsAndCharts = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/datasets`);
        const j = await res.json();
        if (j.success) {
          const datasetsObj = {};
          j.datasets.forEach((d) => {
            datasetsObj[d.id] = {
              ...d,
              schema: d.schema ?? { headers: d.headers ?? [], types: d.types ?? [] }
            };
          });
          setDatasets(datasetsObj);
        }
      } catch (err) {
        console.error("Failed to load datasets from backend:", err);
      }
      
      let storedCharts = safeParse(localStorage.getItem(CHARTS_KEY));
      const seedFlag = localStorage.getItem("seeded_default_charts");
      if (!seedFlag) {
        const defaultCharts = {
          "chart_default_sales": {
            id: "chart_default_sales",
            title: "Revenue by Month",
            datasetId: "ds_sample_sales",
            chartType: "bar",
            mappings: {
              xField: "Month",
              yField: "Revenue",
              yFields: ["Revenue"]
            },
            options: {
              aggregation: "none",
              topN: 0,
              bins: 10,
              seriesColors: {},
              palette: [],
              filters: []
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          "chart_default_scatter": {
            id: "chart_default_scatter",
            title: "Units vs Revenue",
            datasetId: "ds_sample_scatter",
            chartType: "scatter",
            mappings: {
              xField: "Units",
              yField: "Revenue",
              yFields: ["Revenue"]
            },
            options: {
              aggregation: "none",
              topN: 0,
              bins: 10,
              seriesColors: {},
              palette: [],
              filters: []
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          "chart_default_pie": {
            id: "chart_default_pie",
            title: "Share by Category",
            datasetId: "ds_sample_pie",
            chartType: "pie",
            mappings: {
              xField: "category",
              yField: "value",
              yFields: ["value"],
              angleField: "value",
              categoryField: "category"
            },
            options: {
              aggregation: "none",
              topN: 0,
              bins: 10,
              seriesColors: {},
              palette: [],
              filters: []
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        };

        storedCharts = { ...defaultCharts, ...storedCharts };
        localStorage.setItem(CHARTS_KEY, JSON.stringify(storedCharts));
        localStorage.setItem("seeded_default_charts", "true");
      }
      setCharts(storedCharts);
      setLoading(false);
    };

    fetchDatasetsAndCharts();
  }, []);

  useEffect(() => {
    if (!loading) {
      localStorage.setItem(CHARTS_KEY, JSON.stringify(charts));
    }
  }, [charts, loading]);

  const saveDataset = useCallback((dataset) => {
    setDatasets((prev) => ({
      ...prev,
      [dataset.id]: dataset
    }));
  }, []);

  const deleteDataset = useCallback(async (datasetId) => {
    try {
      await fetch(`${BACKEND_URL}/api/datasets/${datasetId}`, { method: "DELETE" });
      setDatasets((prev) => {
        const next = { ...prev };
        delete next[datasetId];
        return next;
      });
      setCharts((prev) => {
        const next = { ...prev };
        Object.values(prev).forEach((chart) => {
          if (chart.datasetId === datasetId) {
            delete next[chart.id];
          }
        });
        return next;
      });
    } catch (err) {
      console.error("Failed to delete dataset:", err);
    }
  }, []);


  const saveChart = useCallback((chart) => {
    setCharts((prev) => {
      const next = { ...prev, [chart.id]: chart };
      return next;
    });
  }, []);

  const duplicateChart = useCallback(
    (chartId) => {
      const original = charts[chartId];
      if (!original) return;
      const clonedId = generateId();
      const clone = {
        ...original,
        id: clonedId,
        title: `${original.title} (Copy)`,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      saveChart(clone);
    },
    [charts, saveChart]
  );

  const deleteChart = useCallback((chartId) => {
    setCharts((prev) => {
      const next = { ...prev };
      delete next[chartId];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      datasets,
      charts,
      loading,
      saveDataset,
      deleteDataset,
      saveChart,
      deleteChart,
      duplicateChart,
      generateId
    }),
    [charts, datasets, deleteChart, deleteDataset, duplicateChart, loading, saveChart, saveDataset]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return context;
}
