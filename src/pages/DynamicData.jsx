import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../providers/StoreContext.jsx";
import { BACKEND_URL as BACKEND } from "../config.js";

// --- Shared Item Selector Component ---
function ItemSelector({ selectedId, label, noun, fetchUrl, saveUrl, onSaved, initialSelectedItems = [] }) {
  const [availableItems, setAvailableItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (initialSelectedItems) {
      setSelectedItems(initialSelectedItems);
    }
  }, [initialSelectedItems]);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage("");
    setErrorMsg("");
    try {
      const res = await fetch(`${BACKEND}${fetchUrl}`);
      const data = await res.json();
      if (data.success) {
        const items = data.tables || data.collections || [];
        setAvailableItems(items);
      } else {
        setErrorMsg(data.error || `Unable to fetch ${noun}s`);
      }
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [fetchUrl, noun]);

  useEffect(() => {
    if (selectedId) fetchItems();
  }, [selectedId, fetchItems]);

  const toggleItemSelection = (item) => {
    setSelectedItems((prev) =>
      prev.includes(item)
        ? prev.filter((i) => i !== item)
        : [...prev, item]
    );
  };

  const saveSelectedItems = async () => {
    if (selectedItems.length === 0) {
      setStatusMessage(`Please select at least one ${noun}`);
      return;
    }
    setIsLoading(true);
    setStatusMessage("");
    setErrorMsg("");
    try {
      const bodyPayload = noun === "table" ? { tables: selectedItems } : { collections: selectedItems };
      const res = await fetch(`${BACKEND}${saveUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage(`✅ Selected ${noun}s updated successfully!`);
        if (onSaved) onSaved();
      } else {
        setErrorMsg(`❌ Failed to update selected ${noun}s: ` + data.error);
      }
    } catch (error) {
      setErrorMsg(`❌ Error saving selected ${noun}s: ` + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 mb-3">
      <h4 className="font-semibold text-slate-800 dark:text-slate-100">{label}</h4>
      {statusMessage && (
        <div className="p-2.5 text-xs text-green-700 bg-green-50 rounded-lg dark:bg-green-950/30 dark:text-green-300">
          {statusMessage}
        </div>
      )}
      {errorMsg && (
        <div className="p-2.5 text-xs text-red-700 bg-red-50 rounded-lg dark:bg-red-950/30 dark:text-red-300">
          {errorMsg}
        </div>
      )}
      {isLoading ? (
        <div className="py-3 text-center text-sm text-slate-500">Loading {noun}s...</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 p-2 border border-slate-200 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-800/50 max-h-36 overflow-y-auto">
            {availableItems.length > 0 ? (
              availableItems.map((item) => (
                <label
                  key={item}
                  className={`flex items-center px-3 py-2 rounded-lg border cursor-pointer bg-white dark:bg-slate-700
                    transition ${selectedItems.includes(item) ? "bg-blue-50 border-blue-300" : "border-slate-200"}`}>
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(item)}
                    onChange={() => toggleItemSelection(item)}
                    className="mr-2 accent-blue-500"
                  />
                  {item}
                </label>
              ))
            ) : (
              <div className="w-full text-center text-slate-400">No {noun}s available</div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveSelectedItems}
              disabled={isLoading || selectedItems.length === 0}
              className={`rounded-xl px-4 py-2 text-sm font-medium bg-blue-500 text-white shadow hover:bg-blue-600 transition ${selectedItems.length === 0 ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              {isLoading ? "Saving..." : `Save Selected ${noun === "table" ? "Tables" : "Collections"}`}
            </button>
            <button
              onClick={fetchItems}
              disabled={isLoading}
              className="rounded-xl px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 shadow hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              Refresh {noun === "table" ? "Tables" : "Collections"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SqlTableSelector({ selectedId, onTablesSelected, initialSelectedItems }) {
  return (
    <ItemSelector
      selectedId={selectedId}
      label="Select Tables to Display"
      noun="table"
      fetchUrl={`/api/sql/tables/${selectedId}`}
      saveUrl={`/api/sql/select-tables/${selectedId}`}
      onSaved={onTablesSelected}
      initialSelectedItems={initialSelectedItems}
    />
  );
}

function NoSqlCollectionSelector({ selectedId, onCollectionsSelected, initialSelectedItems }) {
  return (
    <ItemSelector
      selectedId={selectedId}
      label="Select Collections to Display"
      noun="collection"
      fetchUrl={`/api/nosql/collections/${selectedId}`}
      saveUrl={`/api/nosql/select-collections/${selectedId}`}
      onSaved={onCollectionsSelected}
      initialSelectedItems={initialSelectedItems}
    />
  );
}

// --- Main Dashboard Split Layout ---
export default function DynamicData() {
  const { saveDataset, generateId } = useStore();
  const [connections, setConnections] = useState([]);
  const [formType, setFormType] = useState("sql");
  const [form, setForm] = useState({ name: "", config: {} });
  const [fileConnFile, setFileConnFile] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [cached, setCached] = useState([]);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawJson, setRawJson] = useState(null);
  const [connToRemove, setConnToRemove] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const wsRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  const wsStoppedRef = useRef(false);
  const lastUpdateRef = useRef(Date.now());
  const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname}:8085`;

  const saveTableData = (tableData, format = "json") => {
    setStatusMessage("");
    try {
      let blob, filename;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const tableName = tableData.table || "table";

      if (format === "csv") {
        if (!Array.isArray(tableData.rows) || tableData.rows.length === 0) {
          setStatusMessage("❌ No data to save");
          return;
        }
        const headers = Object.keys(tableData.rows[0]);
        const csvRows = [
          headers.join(","),
          ...tableData.rows.map((row) =>
            headers
              .map((header) => {
                const value = row[header];
                if (value === null || value === undefined) return "";
                const stringValue = String(value).replace(/"/g, '""');
                return `"${stringValue}"`;
              })
              .join(",")
          ),
        ];
        const csvContent = csvRows.join("\n");
        blob = new Blob([csvContent], { type: "text/csv" });
        filename = `${tableName}-${ts}.csv`;
      } else {
        blob = new Blob([JSON.stringify(tableData, null, 2)], { type: "application/json" });
        filename = `${tableName}-${ts}.json`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setStatusMessage(`❌ Failed to save table data: ${e.message}`);
    }
  };

  const downloadSelectedTablesList = async () => {
    setStatusMessage("");
    try {
      if (!selectedId) {
        setStatusMessage("❌ No connection selected");
        return;
      }
      const selectedConn = connections.find((c) => c.id === selectedId);
      const isSqlSubtype =
        selectedConn && ["mysql", "sqlite", "postgres", "postgresql", "mariadb"].includes((selectedConn.type || "").toLowerCase());
      const isSqlSelected = !!(selectedConn && (selectedConn.type === "sql" || selectedConn.dbType || isSqlSubtype));

      if (!isSqlSelected) {
        setStatusMessage("❌ Selected tables can only be saved for SQL connections");
        return;
      }

      let selectedTables =
        Array.isArray(selectedConn?.selectedTables) && selectedConn.selectedTables.length > 0
          ? selectedConn.selectedTables
          : null;

      if (!selectedTables && cached.length > 0) {
        selectedTables = cached.map((t) => t.table);
      }

      if (!selectedTables || selectedTables.length === 0) {
        const res = await fetch(`${BACKEND}/api/sql/tables/${selectedId}`);
        const data = await res.json();
        if (!data.success) {
          setStatusMessage("❌ Failed to fetch tables: " + (data.error || "Unknown error"));
          return;
        }
        selectedTables = data.tables || [];
      }

      const tablesData = {
        connectionId: selectedId,
        connectionName: selectedConn.config?.name || selectedId,
        tables: selectedTables,
        savedAt: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(tablesData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `selected-tables-${selectedId}-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setStatusMessage(`❌ Failed to save selected tables: ${e.message}`);
    }
  };

  async function fetchConnections() {
    try {
      const res = await fetch(`${BACKEND}/api/connections`);
      const j = await res.json();
      if (j.success) setConnections(j.connections);
    } catch (e) {
      console.error("❌ fetchConnections:", e);
    }
  }

  // Clean, well-scoped fetchDataFor
  const fetchDataFor = async (id, manual = false) => {
    if (!id) return;
    console.log(`🔄 Fetching data for connection: ${id}`);
    try {
      const res = await fetch(`${BACKEND}/api/data/${id}`);
      const j = await res.json();
      console.log(`📥 Data fetch response for ${id}:`, j);

      const selectedConn = connections.find((c) => c.id === id);
      const isSerial = selectedConn && selectedConn.type === "serial";

      if (!j || !j.success) {
        console.warn(`⚠️ No data or invalid response for ${id}:`, j);
        if (manual) {
          setStatusMessage(`❌ No data available for this connection. ${j?.error ? `Error: ${j.error}` : "Make sure the connection is active and data is being received."}`);
        }
        return;
      }

      // Allow a single table object as response too
      const payload = Array.isArray(j.data) ? j.data : (j.data && typeof j.data === "object" ? [j.data] : null);
      if (!payload) {
        console.warn("Expected data to be array or object with table/rows, got:", j.data);
        if (manual) setStatusMessage("❌ Invalid data format received from server.");
        return;
      }

      // If serial connection, normalize structure
      if (isSerial) {
        if (payload.length === 0) {
          setCached([]);
          lastUpdateRef.current = Date.now();
          return;
        }
        const potential = payload[0];
        // If wrapped in table object already, move to generic flow below
        if (!potential || (typeof potential === "object" && potential.rows)) {
          // fall through
        } else {
          const potentialRows = payload[0];
          if (Array.isArray(potentialRows) || (typeof potentialRows === "object" && !Array.isArray(potentialRows))) {
            let serialRows = Array.isArray(potentialRows) ? potentialRows : payload;
            const tail = serialRows.slice(-50);
            const fieldSet = new Set();
            tail.forEach((row) => Object.keys(row || {}).forEach((k) => fieldSet.add(k)));
            const headers = Array.from(fieldSet);
            const types = headers.map((h) => {
              const v = tail.find((r) => r && r[h] !== undefined && r[h] !== null)?.[h];
              if (typeof v === "number") return "number";
              if (typeof v === "boolean") return "boolean";
              return "string";
            });
            const normalizedRows = tail.map((row) => {
              const normalized = {};
              headers.forEach((h, idx) => {
                const val = row ? row[h] : undefined;
                if (val === undefined || val === null) {
                  normalized[h] = types[idx] === "number" ? 0 : types[idx] === "boolean" ? false : "";
                } else {
                  normalized[h] = val;
                }
              });
              return normalized;
            });
            const serialTable = { table: "serial_data", headers, types, rows: normalizedRows };
            setCached([serialTable]);
            lastUpdateRef.current = Date.now();
            return;
          }
        }
      }

      // Non-serial flow: expecting tables
      console.log(`✅ Received ${payload.length} tables with data`);
      payload.forEach((table, idx) => {
        console.log(`  Table ${idx}: "${table.table || table.topic || table.endpoint || "data"}" with ${Array.isArray(table.rows) ? (table.rows?.length || 0) : 0} rows`);
      });

      // Helpers
      const parseMaybeJson = (value) => {
        if (typeof value === "string") {
          try { return JSON.parse(value); } catch { return value; }
        }
        return value;
      };
      const flattenWrapperIfAny = (obj) => {
        if (!obj || typeof obj !== "object") return obj;
        // If the object has a single key that itself is an array of rows
        const keys = Object.keys(obj);
        if (keys.length === 1 && Array.isArray(obj[keys[0]])) {
          return obj[keys[0]];
        }
        return obj;
      };

      // Normalize tables to ensure rows are array of objects and headers present
      const normalizeTable = (t) => {
        if (!t) return null;
        const name = t.table || t.topic || t.endpoint || "data";
        let headers = Array.isArray(t.headers) ? t.headers.slice() : undefined;
        let rowsRaw = t.rows ?? t.data ?? [];

        // If rows were delivered as a JSON string, parse
        rowsRaw = parseMaybeJson(rowsRaw);

        // If array of JSON strings, parse each
        if (Array.isArray(rowsRaw) && typeof rowsRaw[0] === "string") {
          rowsRaw = rowsRaw.map((s) => parseMaybeJson(s));
        }

        // Flatten wrapped objects like { "Serial Data": [ ... ] }
        if (!Array.isArray(rowsRaw)) {
          rowsRaw = flattenWrapperIfAny(rowsRaw);
        }

        let rows = Array.isArray(rowsRaw) ? rowsRaw : [];

        // If rows are array-of-arrays and headers provided, map to objects
        if (rows.length > 0 && Array.isArray(rows[0])) {
          if (!headers || headers.length === 0) {
            headers = rows[0].map((_, idx) => `col${idx + 1}`);
          }
          rows = rows.map((arr) => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = arr[i]; });
            return obj;
          });
        }

        // If rows are array of objects but no headers, derive from union of keys
        if ((!headers || headers.length === 0) && rows.length > 0 && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
          const keySet = new Set();
          rows.forEach((r) => Object.keys(r || {}).forEach((k) => keySet.add(k)));
          headers = Array.from(keySet);
        }

        return { table: name, headers, rows };
      };

      const normalized = payload.map(normalizeTable).filter(Boolean);

      setCached(normalized);
      lastUpdateRef.current = Date.now();
    } catch (e) {
      console.error("❌ fetchDataFor error:", e);
      if (manual) {
        setStatusMessage(`❌ Failed to fetch data: ${e.message}`);
      }
    }
  };

  // Polling / initial fetch when selectedId changes (all types)
  useEffect(() => {
    if (!selectedId) return;

    const interval = setInterval(() => {
      fetchDataFor(selectedId);
    }, 5000);
    // initial fetch
    fetchDataFor(selectedId);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // WebSocket for realtime updates & connections list refresh with auto-reconnect
  useEffect(() => {
    fetchConnections();

    const connect = () => {
      if (wsStoppedRef.current) return;
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      } catch (e) { /* ignore */ }
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        // clear any pending reconnect
        if (wsReconnectTimerRef.current) {
          clearTimeout(wsReconnectTimerRef.current);
          wsReconnectTimerRef.current = null;
        }
        console.log("🟢 WebSocket connected to backend");
      };
      const scheduleReconnect = () => {
        if (wsStoppedRef.current) return;
        if (wsReconnectTimerRef.current) return;
        wsReconnectTimerRef.current = setTimeout(() => {
          wsReconnectTimerRef.current = null;
          connect();
        }, 2000);
      };
      ws.onclose = () => {
        console.log("🔴 WebSocket disconnected");
        scheduleReconnect();
      };
      ws.onerror = () => {
        console.error("⚠️ WebSocket error");
        scheduleReconnect();
      };
      ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        // console.log("📥 WebSocket message received:", msg);

        if (msg.type === "update") {
          lastUpdateRef.current = Date.now();
          // update connection counts
          setConnections((prev) =>
            prev.map((c) => (c.id === msg.id ? { ...c, count: (c.count || 0) + (msg.rows?.length || 1) } : c))
          );

          // If update relates to currently selected connection, update cached data for serial/topic updates
          if (msg.id === selectedId) {
            if (msg.topic === "serial_data" || msg.table === "serial_data") {
              // update or create serial_data table in cached
              setCached((prevCached) => {
                const existing = prevCached.find((t) => t.table === "serial_data");
                if (!existing) {
                  const newRow = Array.isArray(msg.rows) && msg.rows.length > 0 ? msg.rows[0] : msg.row || {};
                  const headers = Object.keys(newRow || {});
                  const types = headers.map((h) => {
                    const v = newRow[h];
                    if (typeof v === "number") return "number";
                    if (typeof v === "boolean") return "boolean";
                    return "string";
                  });
                  const newTable = {
                    table: "serial_data",
                    headers,
                    types,
                    rows: Array.isArray(msg.rows) ? msg.rows.slice(0, 100) : [newRow],
                  };
                  return [...prevCached, newTable];
                } else {
                  const newRows = Array.isArray(msg.rows) ? msg.rows : [msg.row || {}];
                  // Recompute union headers and keep tail 50
                  const combined = [ ...(existing.rows || []), ...newRows ];
                  const tail = combined.slice(-50);
                  const fieldSet = new Set();
                  tail.forEach((row) => Object.keys(row || {}).forEach((k) => fieldSet.add(k)));
                  const headers = Array.from(fieldSet);
                  const types = headers.map((h) => {
                    const v = tail.find((r) => r && r[h] !== undefined && r[h] !== null)?.[h];
                    if (typeof v === "number") return "number";
                    if (typeof v === "boolean") return "boolean";
                    return "string";
                  });
                  const normalizedRows = tail.map((row) => {
                    const normalized = {};
                    headers.forEach((h, idx) => {
                      const val = row ? row[h] : undefined;
                      if (val === undefined || val === null) {
                        normalized[h] = types[idx] === "number" ? 0 : types[idx] === "boolean" ? false : "";
                      } else {
                        normalized[h] = val;
                      }
                    });
                    return normalized;
                  });
                  const updated = {
                    ...existing,
                    headers,
                    types,
                    rows: normalizedRows,
                  };
                  return prevCached.map((t) => (t.table === "serial_data" ? updated : t));
                }
              });
            } else {
              // for non-serial table updates, you may want to refresh server data
              // quick approach: fetch current data for selectedId
              fetchDataFor(selectedId);
            }
          }
        } else if (msg.type === "removed") {
          fetchConnections();
          if (msg.id === selectedId) {
            setSelectedId(null);
            setCached([]);
          }
        }
      } catch (e) {
        console.error("❌ WS parse error:", e);
      }
      };
    };
    wsStoppedRef.current = false;
    connect();

    // Also refresh connections periodically to keep counts/names in sync
    const connInterval = setInterval(fetchConnections, 40000);

    return () => {
      clearInterval(connInterval);
      wsStoppedRef.current = true;
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
      try { wsRef.current && wsRef.current.close(); } catch (e) { /* ignore */ }
    };
    // Re-run WebSocket listeners only when selected connection changes to avoid reconnection loops
  }, [selectedId]);

  const handleAdd = async () => {
    setStatusMessage("");
    if (!form.name.trim()) {
      setStatusMessage("❌ Please provide a connection name");
      return;
    }

    if (formType === "mqtt") {
      let brokerUrl = (form.config.brokerUrl || "").trim();
      if (brokerUrl && !brokerUrl.match(/^(mqtt|ws|wss|tcp):\/\//)) {
        brokerUrl = "mqtt://" + brokerUrl.replace(/^\/\//, "");
      }
      if (!brokerUrl || brokerUrl === "mqtt://") {
        brokerUrl = "mqtt://localhost:1883";
      }
      if (brokerUrl && brokerUrl.startsWith("mqtt://")) {
        const urlMatch = brokerUrl.match(/^mqtt:\/\/([^\/:]+)(?::(\d+))?(?:\/.*)?$/);
        if (urlMatch) {
          const host = urlMatch[1];
          const port = urlMatch[2];
          if (!port) {
            brokerUrl = `mqtt://${host}:1883`;
          }
        }
      }
      form.config.brokerUrl = brokerUrl;
      if (!form.config.topic) {
        setStatusMessage("❌ Please specify an MQTT topic to subscribe to");
        return;
      }
    }

    if (formType === "nosql") {
      if (!form.config.uri) {
        setStatusMessage("❌ Please specify the MongoDB Connection URI");
        return;
      }
      if (!form.config.dbType) {
        form.config.dbType = "mongodb";
      }
    }

    if (formType === "sql" && !form.config.type) {
      form.config.type = "mysql";
    }

    // Coerce port to number for SQL connections
    const configToSend = { ...form.config, name: form.name };
    if (formType === "sql" && configToSend.port) {
      configToSend.port = Number(configToSend.port) || undefined;
    }

    if (formType === "http") {
      if (!configToSend.mode) {
        configToSend.mode = "pull";
      }
      if (configToSend.mode === "push") {
        configToSend.apiKey = configToSend.deviceId;
      }
    }

    if (formType === "file") {
      if (!fileConnFile) { setStatusMessage("❌ Please select a CSV or JSON file"); return; }
      try {
        const fd = new FormData();
        fd.append("file", fileConnFile);
        fd.append("name", form.name.trim());
        const res = await fetch(`${BACKEND}/api/connections/file`, { method: "POST", body: fd });
        const j = await res.json();
        if (j.success) {
          setStatusMessage(`✅ File connection added: ${j.id} — ${j.rowCount} rows`);
          setFileConnFile(null);
          const r2 = await fetch(`${BACKEND}/api/connections`);
          const d2 = await r2.json();
          if (d2.success) setConnections(d2.connections);
        } else { setStatusMessage(`❌ ${j.error}`); }
      } catch (err) { setStatusMessage(`❌ ${err.message}`); }
      return;
    }

    const payload = { type: formType, config: configToSend };
    try {
      const res = await fetch(`${BACKEND}/api/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (j.success) {
        setStatusMessage(`✅ Connection added: ${j.id}`);
        setForm({ name: "", config: {} });
        fetchConnections();
      } else {
        setStatusMessage(`❌ Add failed: ${j.error || "Unknown error"}`);
      }
    } catch (e) {
      setStatusMessage(`❌ Add error: ${e.message}`);
    }
  };

  const handleRemove = async (id) => {
    setStatusMessage("");
    try {
      const res = await fetch(`${BACKEND}/api/connections/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchConnections();
        if (selectedId === id) {
          setSelectedId(null);
          setCached([]);
        }
        setConnToRemove(null); // Close modal
      } else {
        setStatusMessage(`❌ Failed to remove connection: ${data.error || "Unknown error"}`);
      }
    } catch (e) {
      console.error("❌ Remove error:", e);
      setStatusMessage(`❌ Error removing connection: ${e.message}`);
    }
  };

  const inputStyle =
    "rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 w-full";

  const renderConfigInputs = () => {
    const setConfigField = (k, v) => setForm((s) => ({ ...s, config: { ...s.config, [k]: v } }));

    switch (formType) {
      case "sql": {
        const sqlType = (form.config.type || "mysql").toLowerCase();
        const isSqlite = sqlType === "sqlite";
        return (
          <>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">SQL Type</label>
              <select value={form.config.type || "mysql"} onChange={(e) => setConfigField("type", e.target.value)} className={inputStyle}>
                <option value="mysql">MySQL</option>
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
                <option value="mariadb">MariaDB</option>
              </select>
            </div>
            {isSqlite ? (
              <div className="mb-3">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">File Path</label>
                <input placeholder="Path to .db file (e.g. C:/data/mydb.sqlite)" value={form.config.filename || ""} onChange={(e) => setConfigField("filename", e.target.value)} className={inputStyle} />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Absolute path to the SQLite database file on the server machine.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Host</label>
                  <input placeholder="Host" value={form.config.host || ""} onChange={(e) => setConfigField("host", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Port</label>
                  <input placeholder={sqlType === "postgres" ? "Port (default 5432)" : "Port (default 3306)"} type="number" value={form.config.port || ""} onChange={(e) => setConfigField("port", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">User</label>
                  <input placeholder="User" value={form.config.user || ""} onChange={(e) => setConfigField("user", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Password</label>
                  <input placeholder="Password" type="password" value={form.config.password || ""} onChange={(e) => setConfigField("password", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Database</label>
                  <input placeholder="Database" value={form.config.database || ""} onChange={(e) => setConfigField("database", e.target.value)} className={inputStyle} />
                </div>
              </>
            )}
          </>
        );
      }
      case "mqtt":
        return (
          <>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Broker URL</label>
              <input placeholder="mqtt://test.mosquitto.org:1883" value={form.config.brokerUrl || ""} onChange={(e) => setConfigField("brokerUrl", e.target.value)} className={inputStyle} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Format: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">mqtt://broker-host:port</code>
                <br />
                Example: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">mqtt://test.mosquitto.org:1883</code>
              </p>
            </div>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Topic</label>
              <input placeholder="" value={form.config.topic || ""} onChange={(e) => setConfigField("topic", e.target.value)} className={inputStyle} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                The MQTT topic to subscribe to (must match exactly, case-sensitive)
                <br />
                Example: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">Name/machine/sensors</code>
              </p>
            </div>
          </>
        );
      case "http": {
        const httpMode = form.config.mode || "pull";
        const localIp = window.location.hostname;
        const apiKey = form.config.deviceId || "";
        return (
          <>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Connection Mode</label>
              <select value={httpMode} onChange={(e) => setConfigField("mode", e.target.value)} className={inputStyle}>
                <option value="pull">Pull (Server Polls Device)</option>
                <option value="push">Push (Device Pushes to Server / ThingSpeak)</option>
              </select>
            </div>
            {httpMode === "push" ? (
              <>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">API Key / Device ID</label>
                  <input placeholder="Enter API Key (e.g., my-esp-sensor)" value={form.config.deviceId || ""} onChange={(e) => setConfigField("deviceId", e.target.value)} className={inputStyle} />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    This key identifies your sensor. Program your ESP sensor to request this key.
                  </p>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-slate-800/50 border border-blue-200 dark:border-blue-700/40 rounded-xl text-xs text-slate-700 dark:text-slate-300 mb-2">
                  <p className="font-semibold text-blue-800 dark:text-blue-400 mb-2">🔗 Local Webhook Endpoint:</p>
                  <p className="mb-1"><strong>GET Request (ThingSpeak Format):</strong></p>
                  <code className="block p-2 bg-slate-100 dark:bg-slate-900 rounded select-all break-all mb-2 font-mono">
                    {`http://${localIp}:8085/update?api_key=${apiKey || "API_KEY"}&field1=23.5`}
                  </code>
                  <p className="mb-1"><strong>POST Request (JSON Format):</strong></p>
                  <p className="mb-1">URL: <code className="bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded select-all font-mono">{`http://${localIp}:8085/update`}</code></p>
                  <p className="mb-1">Body:</p>
                  <pre className="p-2 bg-slate-100 dark:bg-slate-900 rounded text-left overflow-x-auto font-mono text-[10px]">
{`{
  "api_key": "${apiKey || "API_KEY"}",
  "field1": 23.5,
  "field2": 62.3
}`}
                  </pre>
                </div>
              </>
            ) : (
              <>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Base URL</label>
                  <input placeholder="Base URL (e.g., http://127.0.0.1:8080)" value={form.config.url || ""} onChange={(e) => setConfigField("url", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Endpoint</label>
                  <input placeholder="Endpoint (e.g., /api/iot or api/iot)" value={form.config.endpoint || ""} onChange={(e) => setConfigField("endpoint", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Device ID (Optional)</label>
                  <input placeholder="Device ID (optional, e.g., sensor-001)" value={form.config.deviceId || ""} onChange={(e) => setConfigField("deviceId", e.target.value)} className={inputStyle} />
                </div>
                <div className="mb-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Poll Interval (ms)</label>
                  <input placeholder="Poll Interval (ms, e.g., 2000)" type="number" value={form.config.pollIntervalMs || ""} onChange={(e) => setConfigField("pollIntervalMs", e.target.value)} className={inputStyle} />
                </div>
              </>
            )}
          </>
        );
      }
      case "serial":
        return (
          <>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Port Number</label>
              <input placeholder="COM3 or /dev/ttyUSB0" value={form.config.port || ""} onChange={(e) => setConfigField("port", e.target.value)} className={inputStyle} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                For Windows: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">COM3</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">COM4</code>. For Linux/Mac: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">/dev/ttyUSB0</code>.
              </p>
            </div>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Baud Rate</label>
              <input placeholder="9600" type="number" value={form.config.baudRate || ""} onChange={(e) => setConfigField("baudRate", e.target.value)} className={inputStyle} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Common values: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">9600</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">115200</code>. Matches speed set in Arduino code.
              </p>
            </div>
          </>
        );
      case "nosql":
        return (
          <>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">NoSQL Type</label>
              <select value={form.config.dbType || "mongodb"} onChange={(e) => setConfigField("dbType", e.target.value)} className={inputStyle}>
                <option value="mongodb">MongoDB</option>
              </select>
            </div>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Connection URI</label>
              <input placeholder="mongodb://localhost:27017" value={form.config.uri || ""} onChange={(e) => setConfigField("uri", e.target.value)} className={inputStyle} />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Example: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">mongodb://localhost:27017</code>
              </p>
            </div>
            <div className="mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Database Name</label>
              <input placeholder="Database Name" value={form.config.database || ""} onChange={(e) => setConfigField("database", e.target.value)} className={inputStyle} />
            </div>
          </>
        );
      case "file":
        return (
          <div className="mb-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Upload CSV or JSON file</label>
            <input
              type="file"
              accept=".csv,.json"
              onChange={(e) => setFileConnFile(e.target.files?.[0] || null)}
              className={inputStyle}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Up to 50,000 rows. Stored as a connection in the dynamic dashboard.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col w-full min-h-screen bg-slate-100 dark:bg-slate-900 px-2 py-2">
      <div className="max-w-screen-2xl mx-auto flex flex-row w-full gap-6">
        {/* Left */}
        <div className="flex-1 flex flex-col gap-6 w-1/2 min-w-[360px]">
          <section className="rounded-2xl bg-white dark:bg-slate-800/80 p-6 shadow-sm w-full">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">🌐 Add/Edit Connection</h2>
            {statusMessage && (
              <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm ${statusMessage.startsWith("✅") ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300 border border-green-200 dark:border-green-800/30" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 border border-red-200 dark:border-red-800/30"}`}>
                {statusMessage}
              </div>
            )}
            <input placeholder="Connection Name" className={inputStyle + " mb-4"} value={form.name || ""} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            <div className="mb-4">
              <label className="block mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Connection Type</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} className={inputStyle}>
                <option value="mqtt">MQTT</option>
                <option value="sql">SQL</option>
                <option value="nosql">NoSQL</option>
                <option value="http">HTTP API</option>
                <option value="serial">Serial</option>
                <option value="file">File (CSV / JSON)</option>
              </select>
            </div>
            <div className="mb-5 flex flex-col gap-3">{renderConfigInputs()}</div>
            <div className="flex gap-4 mt-2">
              <button onClick={handleAdd} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-600 transition">
                Add Connection
              </button>
              <button onClick={fetchConnections} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 transition">
                Refresh List
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white dark:bg-slate-800/80 p-6 shadow-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Active Connections</h3>
            {connections.length === 0 ? (
              <div className="p-6 text-center text-slate-500 bg-slate-50 dark:bg-slate-800/50 dark:text-slate-400 rounded-xl border border-dashed border-slate-200 dark:border-slate-600">No connections yet. Add a connection above to get started.</div>
            ) : (
              <div className="grid gap-4 grid-cols-1">
                {connections.map((c) => (
                  <div key={c.id} className={`border rounded-xl p-5 shadow-sm transition mb-2 ${selectedId === c.id ? "bg-blue-50 border-blue-200 dark:bg-slate-800 dark:border-blue-400/40" : "bg-white border-slate-200 dark:bg-slate-700 dark:border-slate-600"}`}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <strong className="font-semibold text-slate-900 dark:text-slate-100 block mb-1">{c.config?.name || c.id}</strong>
                        <span className="text-xs text-slate-500 dark:text-slate-300 block">
                          Type:{" "}
                          <em>
                            {(() => {
                              const isSqlSubtype = ["mysql", "sqlite", "postgres", "postgresql", "mariadb"].includes((c.type || "").toLowerCase());
                              if (c.type === "sql" || c.dbType || isSqlSubtype) {
                                const subtype = (c.dbType || (isSqlSubtype ? c.type : "")).toString();
                                return `sql${subtype ? ` (${subtype})` : ""}`;
                              }
                              if (c.type === "nosql" || (c.type && c.type.toLowerCase() === "nosql")) {
                                return `NoSQL (${c.dbType || "MongoDB"})`;
                              }
                              return c.type;
                            })()}
                          </em>
                        </span>
                      </div>
                      {c.count && (
                        <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full text-slate-600 dark:text-slate-300">
                          {c.count} updates
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedId(c.id);
                          fetchDataFor(c.id);
                          const isSqlSubtype = ["mysql", "sqlite", "postgres", "postgresql", "mariadb"].includes((c.type || "").toLowerCase());
                          setFormType((c.type === "sql" || c.dbType || isSqlSubtype) ? "sql" : c.type);
                        }}
                        className="flex-1 rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600"
                      >
                        View Data
                      </button>
                      <button onClick={() => setConnToRemove(c.id)} className="rounded-xl bg-red-100 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-200">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: Data Display */}
        <div className="flex-1 w-1/2 min-w-[400px] flex flex-col gap-6">
          <section className="rounded-2xl bg-white dark:bg-slate-800/80 p-6 shadow-sm h-fit mb-6 sticky top-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">📊 Data {selectedId ? `for ${selectedId}` : ""}</h3>
              {selectedId && (
                <div className="flex gap-2">
                  <button onClick={() => fetchDataFor(selectedId, true)} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300">
                    Refresh Data
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        setRawLoading(true);
                        setRawJson(null);
                        const res = await fetch(`${BACKEND}/api/data/${selectedId}`);
                        const j = await res.json();
                        setRawJson(j);
                        setRawOpen(true);
                      } catch (e) {
                        alert(`Failed to fetch raw data: ${e.message}`);
                      } finally {
                        setRawLoading(false);
                      }
                    }}
                    className="rounded-xl bg-slate-800 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-900"
                  >
                    {rawLoading ? "Loading..." : "View Raw Data"}
                  </button>
                </div>
              )}
            </div>

            {(() => {
              const selectedConn = connections.find((c) => c.id === selectedId);
              const isSqlSubtype = selectedConn ? ["mysql", "sqlite", "postgres", "postgresql", "mariadb"].includes((selectedConn.type || "").toLowerCase()) : false;
              const isSqlSelected = !!(selectedConn && (selectedConn.type === "sql" || selectedConn.dbType || isSqlSubtype || formType === "sql"));
              return isSqlSelected && selectedId;
            })() && (
              <div>
                <SqlTableSelector
                  selectedId={selectedId}
                  onTablesSelected={() => fetchDataFor(selectedId, true)}
                  initialSelectedItems={connections.find((c) => c.id === selectedId)?.selectedTables || []}
                />
                <button onClick={downloadSelectedTablesList} className="rounded-xl bg-purple-500 text-white px-4 py-2 text-sm font-semibold hover:bg-purple-600 transition mb-3" title="Export selected tables list">
                  ⬇ Export Table Selection
                </button>
              </div>
            )}

            {(() => {
              const selectedConn = connections.find((c) => c.id === selectedId);
              const isNoSqlSelected = !!(selectedConn && selectedConn.type === "nosql");
              return isNoSqlSelected && selectedId;
            })() && (
              <div>
                <NoSqlCollectionSelector
                  selectedId={selectedId}
                  onCollectionsSelected={() => fetchDataFor(selectedId, true)}
                  initialSelectedItems={connections.find((c) => c.id === selectedId)?.selectedTables || []}
                />
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto max-h-[500px]">
              {cached.length > 0 ? (
                cached.map((tableData, i) => (
                  <div key={i} className="mb-5 bg-slate-100 dark:bg-slate-800/70 rounded-xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-700">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 flex justify-between items-center">
                      <h5 className="m-0 text-base font-semibold text-slate-900 dark:text-slate-100">
                        <span className="mr-2">📊</span>
                        {tableData.table}
                      </h5>
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full text-slate-600 dark:text-slate-300">{tableData.rows?.length ?? 0} rows</span>
                        <div className="flex gap-1">
                          <button onClick={() => saveTableData(tableData, "json")} className="rounded-lg bg-green-500 text-white px-2 py-1 text-xs font-medium hover:bg-green-600 transition" title="Save as JSON">
                            💾 JSON
                          </button>
                          <button onClick={() => saveTableData(tableData, "csv")} className="rounded-lg bg-blue-500 text-white px-2 py-1 text-xs font-medium hover:bg-blue-600 transition" title="Save as CSV">
                            📄 CSV
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      {tableData.rows && tableData.rows.length > 0 ? (
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                              {(tableData.headers && tableData.headers.length > 0
                                ? tableData.headers
                                : Object.keys(tableData.rows[0])
                              ).map((key) => (
                                <th key={key} className="p-3 text-left font-semibold text-slate-800 dark:text-slate-100">
                                  {key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.rows.map((row, j) => {
                              const headers = (tableData.headers && tableData.headers.length > 0)
                                ? tableData.headers
                                : Object.keys(row);
                              return (
                                <tr key={j} className={`border-b border-slate-200 dark:border-slate-700 ${j % 2 === 0 ? "bg-slate-100 dark:bg-slate-800/60" : "bg-slate-50 dark:bg-slate-800/40"}`}>
                                  {headers.map((key) => (
                                    <td key={key} className="p-3 text-slate-700 dark:text-slate-300 max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                                      {row[key] !== null && row[key] !== undefined ? (typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key])) : <span className="text-slate-400 dark:text-slate-500 italic">null</span>}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <div className="p-5 text-center text-slate-500 dark:text-slate-400 italic">No rows available in this table</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
                  <svg className="h-8 w-8 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    {selectedId
                      ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
                    }
                  </svg>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {selectedId ? "No data available yet." : "Select a connection to view data."}
                  </p>
                  {selectedId && (
                    <button
                      onClick={() => fetchDataFor(selectedId, true)}
                      className="btn-action mt-1"
                    >
                      Refresh
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Raw Data Modal */}
      {rawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 w-[90vw] max-w-4xl max-h-[80vh] rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Raw Data Preview</h4>
              <button onClick={() => setRawOpen(false)} className="rounded-lg bg-slate-200 dark:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600">
                Close
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[70vh] text-xs">
              <pre className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">{JSON.stringify(rawJson, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {connToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden transform scale-in duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 text-red-600 mb-4">
                <span className="text-3xl">⚠️</span>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Delete Connection</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
                Are you sure you want to remove the connection <strong className="font-semibold text-slate-800 dark:text-slate-200">{connToRemove}</strong>? This will close all active streams/ports and discard cached data.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConnToRemove(null)}
                  className="rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                >
                  Cancel
                </button>
                <button
                  id="confirm-remove-btn"
                  onClick={() => handleRemove(connToRemove)}
                  className="rounded-xl bg-red-500 hover:bg-red-600 text-white px-4 py-2 text-sm font-semibold transition"
                >
                  Yes, Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
