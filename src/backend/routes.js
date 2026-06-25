import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import connectionManager from "./connectionManager.js";
import chartsStorage from "./chartsStorage.js";
import multer from "multer";
import fs from "fs";
import { unlink as fsUnlink } from "fs/promises";
import readline from "readline";
import axios from "axios";
import * as staticDb from "./modules/staticDb.js";
import { updateDatasetStatus } from "./modules/staticDb.js";
import * as XLSX from "xlsx";
import { queryTablePaginated, queryTableAggregate } from "./modules/sql.js";
import { queryCollectionPaginated, queryCollectionAggregate } from "./modules/nosql.js";
import { requireApiKey } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const SENSOR_CACHE_LIMIT = 10_000;

// ---- Google Sheets helpers ----

/**
 * Normalize any Google Sheets URL to a direct CSV export endpoint.
 * Handles: /edit, /pub, /view, bare /spreadsheets/d/<id>, and already-transformed URLs.
 */
/**
 * Build the correct Google Sheets export URL for the requested format.
 * format: "csv" | "xlsx" | "json"
 * JSON uses the gviz/tq endpoint which returns a structured table object.
 */
function normalizeGoogleSheetsUrl(url, format = "csv") {
  if (!url) throw new Error("No Google Sheets URL provided.");
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    // Already a direct export URL — pass through if format matches
    if (/\/export\?/.test(url) || /\/gviz\/tq/.test(url)) return url;
    throw new Error("Could not extract spreadsheet ID from URL. Make sure you paste the full Google Sheets link.");
  }
  const docId = match[1];
  const gid = url.match(/[#&?]gid=([0-9]+)/)?.[1] ?? "0";
  if (format === "json") {
    return `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:json&gid=${gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/${docId}/export?format=${format}&gid=${gid}`;
}

/**
 * Download a Google Sheet CSV to disk with retry + timeout.
 * Strips UTF-8 BOM if present. Throws a human-readable error on failure.
 */
async function downloadGoogleSheet(url, destPath, { retries = 3, timeoutMs = 30_000 } = {}) {
  console.log(`📡 downloadGoogleSheet URL: ${url}`);
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
        timeout: timeoutMs,
        maxRedirects: 5,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TANSAM/4.0; +https://tansam.app)",
          "Accept": "text/csv,text/plain,*/*"
        },
        validateStatus: (status) => status < 400
      });

      const writer = fs.createWriteStream(destPath);
      let firstChunk = true;
      let firstBytes = null;
      await new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          if (firstChunk) {
            firstChunk = false;
            // Capture first bytes before any stripping
            firstBytes = chunk.slice(0, 15).toString("utf8");
            // Strip UTF-8 BOM
            if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
              chunk = chunk.slice(3);
            }
          }
          writer.write(chunk);
        });
        response.data.on("end", () => writer.end());
        response.data.on("error", reject);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // Detect HTML error responses — only check for text-based formats (XLSX is binary and starts with PK)
      const isXlsx = destPath.endsWith(".xlsx") || destPath.endsWith(".xls");
      if (!isXlsx && firstBytes && (firstBytes.trimStart().startsWith("<!") || firstBytes.trimStart().startsWith("<html"))) {
        await fsUnlink(destPath).catch(() => {});
        throw new Error("Google Sheets returned an HTML page instead of data. Make sure the sheet is shared as 'Anyone with the link can view'.");
      }
      return; // success
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        // Exponential backoff: 500ms, 1s, 2s
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  // Surface meaningful error
  const msg = lastErr?.message || "Unknown error";
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
    throw new Error("Could not reach Google Sheets. Check your network connection.");
  }
  if (lastErr?.response?.status === 400) {
    throw new Error("Google Sheets rejected the request (400). Verify the spreadsheet is shared as 'Anyone with the link can view' and the URL is correct.");
  }
  if (lastErr?.response?.status === 403) {
    throw new Error("Access denied (403). Make sure the Google Sheet is shared as 'Anyone with the link can view'.");
  }
  if (lastErr?.response?.status === 404) {
    throw new Error("Google Sheet not found (404). The sheet may have been deleted or the URL is incorrect.");
  }
  throw new Error(`Failed to download Google Sheet after ${retries} attempts: ${msg}`);
}

// Authenticate every API route
router.use(requireApiKey);

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 10 GB cap for very large CSV datasets
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseJsonStream(stream, onRow) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let braceCount = 0;
    let inString = false;
    let isEscaped = false;
    let startIndex = -1;
    let destroyed = false;

    stream.on("data", (chunk) => {
      if (destroyed) return;
      const str = chunk.toString();
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        buffer += char;
        
        if (char === '"' && !isEscaped) {
          inString = !inString;
        }
        
        if (inString) {
          isEscaped = (char === '\\' && !isEscaped);
          continue;
        }
        
        if (char === '{') {
          if (braceCount === 0) {
            startIndex = buffer.length - 1;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0 && startIndex !== -1) {
            const objStr = buffer.slice(startIndex);
            try {
              const obj = JSON.parse(objStr);
              onRow(obj);
            } catch (e) {
              // Ignore malformed fragments
            }
            // Reset buffer memory
            buffer = buffer.slice(startIndex + objStr.length);
            startIndex = -1;
          }
        }
      }
    });

    stream.on("end", () => {
      if (!destroyed) resolve();
    });
    
    stream.on("error", (err) => {
      if (!destroyed) reject(err);
    });

    const originalDestroy = stream.destroy;
    stream.destroy = function(...args) {
      destroyed = true;
      originalDestroy.apply(this, args);
      resolve();
    };
  });
}

async function inferCSVTypes(filePath, firstRowHeader, headerRow = 1) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const hdrIdx = Math.max(0, (headerRow || 1) - 1); // 0-based index of the header line
  let lineIndex = 0;
  let headers = [];
  const sampleRows = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = splitCsvLine(line);
    if (lineIndex < hdrIdx) {
      // rows above the header row — skip
    } else if (lineIndex === hdrIdx) {
      if (firstRowHeader) {
        headers = parts.map((h, idx) => h.trim() || `Field ${idx + 1}`);
      } else {
        headers = parts.map((_, idx) => `Field ${idx + 1}`);
        sampleRows.push(parts);
      }
    } else {
      sampleRows.push(parts);
    }
    lineIndex++;
    if (lineIndex > hdrIdx + 1000) break;
  }
  rl.close();
  fileStream.destroy();

  const types = headers.map((_, colIdx) => {
    let numberCount = 0;
    let dateCount = 0;
    let booleanCount = 0;
    let stringCount = 0;

    for (const row of sampleRows) {
      const val = row[colIdx];
      if (val === undefined || val === null || val.trim() === "") continue;
      const normalized = val.toLowerCase().trim();
      if (normalized === "true" || normalized === "false") {
        booleanCount++;
      } else if (!isNaN(Number(val))) {
        numberCount++;
      } else if (!isNaN(Date.parse(val))) {
        dateCount++;
      } else {
        stringCount++;
      }
    }

    if (booleanCount > 0 && stringCount === 0 && numberCount === 0 && dateCount === 0) return "boolean";
    if (numberCount > 0 && stringCount === 0) return "number";
    if (dateCount > 0 && stringCount === 0) return "date";
    return "string";
  });

  return { headers, types };
}

async function ingestCSVRows(filePath, datasetId, headersCount, firstRowHeader, headerRow = 1) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const hdrIdx = Math.max(0, (headerRow || 1) - 1); // 0-based index of the header line
  let lineIndex = 0;
  let rowCount = 0;
  let batch = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    // skip everything up to and including the header row
    if (lineIndex <= hdrIdx && firstRowHeader) {
      lineIndex++;
      continue;
    }
    if (lineIndex < hdrIdx && !firstRowHeader) {
      lineIndex++;
      continue;
    }
    const parts = splitCsvLine(line);
    batch.push(parts);

    if (batch.length >= 5000) {
      await staticDb.insertRowsBatch(datasetId, batch, headersCount);
      rowCount += batch.length;
      batch = [];
    }
    lineIndex++;
  }
  if (batch.length > 0) {
    await staticDb.insertRowsBatch(datasetId, batch, headersCount);
    rowCount += batch.length;
  }

  rl.close();
  fileStream.destroy();
  return rowCount;
}

async function inferJSONTypes(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const headersSet = new Set();
  const sampleRows = [];
  let objectCount = 0;

  await parseJsonStream(fileStream, (obj) => {
    Object.keys(obj).forEach(k => headersSet.add(k));
    sampleRows.push(obj);
    objectCount++;
    if (objectCount >= 1000) {
      fileStream.destroy();
    }
  });

  const headers = Array.from(headersSet);
  const types = headers.map((header) => {
    let numberCount = 0;
    let dateCount = 0;
    let booleanCount = 0;
    let stringCount = 0;

    for (const row of sampleRows) {
      const val = row[header];
      if (val === undefined || val === null) continue;
      if (typeof val === "boolean") {
        booleanCount++;
      } else if (typeof val === "number") {
        numberCount++;
      } else if (!isNaN(Date.parse(val)) && typeof val === "string") {
        dateCount++;
      } else if (typeof val === "string" && val.trim() !== "") {
        stringCount++;
      }
    }

    if (booleanCount > 0 && stringCount === 0 && numberCount === 0 && dateCount === 0) return "boolean";
    if (numberCount > 0 && stringCount === 0) return "number";
    if (dateCount > 0 && stringCount === 0) return "date";
    return "string";
  });

  return { headers, types };
}

async function ingestJSONRows(filePath, datasetId, headers) {
  const fileStream = fs.createReadStream(filePath);
  let rowCount = 0;
  let batch = [];
  // Chain inserts as a serial Promise so batches never overlap.
  // parseJsonStream calls onRow synchronously; an async callback would not be awaited.
  let insertChain = Promise.resolve();

  await parseJsonStream(fileStream, (obj) => {
    batch.push(headers.map(h => obj[h]));
    if (batch.length >= 5000) {
      const toInsert = batch;
      batch = [];
      insertChain = insertChain.then(async () => {
        await staticDb.insertRowsBatch(datasetId, toInsert, headers.length);
        rowCount += toInsert.length;
      });
    }
  });

  await insertChain; // drain any in-flight batch

  if (batch.length > 0) {
    await staticDb.insertRowsBatch(datasetId, batch, headers.length);
    rowCount += batch.length;
  }

  return rowCount;
}

/**
 * Parse the Google Sheets gviz/tq JSON response.
 * The response is JSONP-wrapped: `google.visualization.Query.setResponse({...});`
 * Returns { headers, types, rows } where rows are plain objects keyed by header.
 */
function parseGvizJson(text) {
  // Strip the JSONP wrapper
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("Invalid Google Sheets JSON response.");
  const obj = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const table = obj.table;
  if (!table || !Array.isArray(table.cols)) throw new Error("Unexpected Google Sheets JSON structure.");

  const headers = table.cols.map((c, idx) => (c.label || c.id || `Field ${idx + 1}`).trim() || `Field ${idx + 1}`);
  const gvizTypes = table.cols.map(c => c.type); // "string" | "number" | "boolean" | "date" | "datetime" | "timeofday"

  const types = gvizTypes.map(t => {
    if (t === "number") return "number";
    if (t === "boolean") return "boolean";
    if (t === "date" || t === "datetime") return "date";
    return "string";
  });

  const rows = (table.rows || []).map(r =>
    headers.reduce((obj, h, i) => {
      const cell = r.c ? r.c[i] : null;
      obj[h] = cell ? (cell.v ?? null) : null;
      return obj;
    }, {})
  );

  return { headers, types, rows };
}

function inferXLSXTypes(sheetData, firstRowHeader, headerRow = 1) {
  if (sheetData.length === 0) return { headers: [], types: [] };
  const hdrIdx = Math.max(0, (headerRow || 1) - 1); // 0-based
  const headerRowData = sheetData[hdrIdx] || sheetData[0];
  let headers = [];
  const sampleRows = [];
  if (firstRowHeader) {
    headers = headerRowData.map((h, idx) => String(h || "").trim() || `Field ${idx + 1}`);
    for (let i = hdrIdx + 1; i < Math.min(sheetData.length, hdrIdx + 1001); i++) {
      sampleRows.push(sheetData[i]);
    }
  } else {
    headers = headerRowData.map((_, idx) => `Field ${idx + 1}`);
    for (let i = hdrIdx; i < Math.min(sheetData.length, hdrIdx + 1000); i++) {
      sampleRows.push(sheetData[i]);
    }
  }

  const types = headers.map((_, colIdx) => {
    let numberCount = 0;
    let dateCount = 0;
    let booleanCount = 0;
    let stringCount = 0;

    for (const row of sampleRows) 
    {
      const val = row[colIdx];
      if (val === undefined || val === null || String(val).trim() === "") continue;
      if (typeof val === "number") {
        numberCount++;
      } 
      else if (typeof val === "boolean") {
        booleanCount++;
      } 
      else if (!isNaN(Date.parse(val)) && typeof val === "string") {
        dateCount++;
      } else {
        stringCount++;
      }
    }

    if (booleanCount > 0 && stringCount === 0 && numberCount === 0 && dateCount === 0) return "boolean";
    if (numberCount > 0 && stringCount === 0) return "number";
    if (dateCount > 0 && stringCount === 0) return "date";
    return "string";
  });

  return { headers, types };
}

async function ingestXLSXRows(sheetData, datasetId, headersCount, firstRowHeader, headerRow = 1) {
  let batch = [];
  let rowCount = 0;
  const hdrIdx = Math.max(0, (headerRow || 1) - 1);
  const startIndex = firstRowHeader ? hdrIdx + 1 : hdrIdx;

  for (let i = startIndex; i < sheetData.length; i++) {
    batch.push(sheetData[i]);
    if (batch.length >= 5000) {
      await staticDb.insertRowsBatch(datasetId, batch, headersCount);
      rowCount += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await staticDb.insertRowsBatch(datasetId, batch, headersCount);
    rowCount += batch.length;
  }
  return rowCount;
}

router.post("/connections", async (req, res) => {
  try {
    const { type, config } = req.body || {};
    if (!type) return res.status(400).json({ success: false, error: "type is required" });
    if (!config || typeof config !== "object") return res.status(400).json({ success: false, error: "config object is required" });
    const conn = await connectionManager.addConnection(type, config);
    res.json({ success: true, id: conn.id, type: conn.type });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
// File upload as a dynamic connection (CSV or JSON, up to 50k rows)
router.post("/connections/file", upload.single("file"), async (req, res) => {
  let tempFilePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded." });
    tempFilePath = req.file.path;
    const connName = (req.body.name || req.file.originalname?.replace(/\.[^/.]+$/, "") || "Uploaded File").trim();
    const firstRowHeader = req.body.firstRowHeader !== "false";
    const ext = (req.file.originalname?.split(".").pop() || "csv").toLowerCase();
    const MAX_ROWS = 50_000;

    let headers = [];
    let rows = [];

    if (ext === "csv") {
      const inferred = await inferCSVTypes(tempFilePath, firstRowHeader);
      headers = inferred.headers;
      // Re-read to get actual row objects
      const stream = fs.createReadStream(tempFilePath);
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let li = 0;
      for await (const line of rl) {
        if (!line.trim()) continue;
        if (li === 0 && firstRowHeader) { li++; continue; }
        const parts = splitCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = parts[i] != null ? parts[i] : null; });
        rows.push(obj);
        li++;
        if (rows.length >= MAX_ROWS) break;
      }
      rl.close(); stream.destroy();
    } else if (ext === "json") {
      const inferred = await inferJSONTypes(tempFilePath);
      headers = inferred.headers;
      const stream2 = fs.createReadStream(tempFilePath);
      await parseJsonStream(stream2, (obj) => {
        if (rows.length < MAX_ROWS) rows.push(obj);
      });
    } else {
      return res.status(400).json({ success: false, error: "Only CSV and JSON files are supported for file connections." });
    }

    const conn = await connectionManager.addConnection("file", { name: connName, rows, headers });
    res.json({ success: true, id: conn.id, type: conn.type, rowCount: rows.length, headers });
  } catch (err) {
    console.error("❌ file connection upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tempFilePath) fsUnlink(tempFilePath).catch(() => {});
  }
});

router.delete("/connections/:id", async (req, res) => {
  const { id } = req.params;
  console.log(`🗑️ DELETE request received for connection: ${id}`);
  try {
    await connectionManager.removeConnection(id);
    console.log(`✅ Connection ${id} successfully removed`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Error removing connection ${id}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get("/connections", (req, res) => {
  try {
    const safeConnections = connectionManager.listConnections().map((c) => ({
      id: c.id,
      type: c.type,
      dbType: c.dbType,
      config: { name: c.config?.name },
      count: c.count || 0,
      selectedTables: c.selectedTables || [],
    }));
    res.json({ success: true, connections: safeConnections });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/connections/:id", (req, res) => {
  try {
    const conn = connectionManager.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: "Connection not found" });
    res.json({
      success: true,
      connection: {
        id: conn.id,
        type: conn.type,
        dbType: conn.dbType,
        config: { name: conn.config?.name },
        count: conn.count || 0,
        selectedTables: conn.selectedTables || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/connections/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, config } = req.body || {};
    if (!type) return res.status(400).json({ success: false, error: "type is required" });
    if (!config || typeof config !== "object") {
      return res.status(400).json({ success: false, error: "config object is required" });
    }
    const existing = connectionManager.getConnection(id);
    if (!existing) return res.status(404).json({ success: false, error: "Connection not found" });
    await connectionManager.removeConnection(id);
    const conn = await connectionManager.addConnection(type, config, id);
    res.json({ success: true, id: conn.id, type: conn.type });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SQL endpoints
router.get("/sql/tables/:id", async (req, res) => {
  try { res.json({ success: true, tables: await connectionManager.getSqlTables(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.post("/sql/select-tables/:id", async (req, res) => {
  try {
    const { tables } = req.body || {};
    const conn = connectionManager.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: "Connection not found" });
    if (conn.type !== "sql") return res.status(400).json({ success: false, error: "Not SQL" });
    if (!Array.isArray(tables)) return res.status(400).json({ success: false, error: "'tables' must be an array" });
    conn.selectedTables = tables;
    connectionManager.saveConnections();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get("/sql/preview/:id", async (req, res) => {
  try {
    const { table, limit } = req.query;
    if (!table) return res.status(400).json({ success: false, error: "table is required" });
    res.json({ success: true, rows: await connectionManager.previewSqlTable(req.params.id, table, Number(limit || 5)) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// NoSQL endpoints
router.get("/nosql/collections/:id", async (req, res) => {
  try { res.json({ success: true, collections: await connectionManager.getNoSqlCollections(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.post("/nosql/select-collections/:id", async (req, res) => {
  try {
    const { collections } = req.body || {};
    const conn = connectionManager.getConnection(req.params.id);
    if (!conn) return res.status(404).json({ success: false, error: "Connection not found" });
    if (conn.type !== "nosql") return res.status(400).json({ success: false, error: "Not NoSQL" });
    if (!Array.isArray(collections)) return res.status(400).json({ success: false, error: "'collections' must be an array" });
    conn.selectedTables = collections;
    connectionManager.saveConnections();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get("/nosql/preview/:id", async (req, res) => {
  try {
    const { collection, limit } = req.query;
    if (!collection) return res.status(400).json({ success: false, error: "collection is required" });
    res.json({ success: true, rows: await connectionManager.previewNoSqlCollection(req.params.id, collection, Number(limit || 5)) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// MQTT endpoints
router.get("/mqtt/preview/:id", async (req, res) => {
  try {
    const { topic, limit } = req.query;
    if (!topic) return res.status(400).json({ success: false, error: "Topic is required" });
    const data = await connectionManager.previewMqttData(req.params.id, topic, Number(limit || 10));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// HTTP endpoints
router.get("/http/preview/:id", async (req, res) => {
  try {
    const { endpoint, limit } = req.query;
    if (!endpoint) return res.status(400).json({ success: false, error: "Endpoint is required" });
    const data = await connectionManager.previewHttpData(req.params.id, endpoint, Number(limit || 5));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// HTTP POST endpoint to receive sensor data (alternative: /api/sensor-data or /api/data)
router.post("/sensor-data", async (req, res) => {
  try {
    const sensorData = req.body;
    const { device_id } = sensorData;
    
    if (!device_id) {
      return res.status(400).json({ success: false, error: "device_id is required" });
    }
    
    console.info(`📡 Received sensor data from device: ${device_id}`);
    
    // Find push-mode HTTP connections; fall back to all HTTP connections
    let connections = connectionManager.listConnections().filter(
      conn => conn.type === "http" && conn.config?.mode === "push"
    );
    if (connections.length === 0) {
      connections = connectionManager.listConnections().filter(conn => conn.type === "http");
    }

    if (connections.length === 0) {
      return res.status(200).json({ success: true, message: "Data received but no HTTP connections configured" });
    }

    // Always use device_id as the cache key so data from the same device lands
    // in the same bucket regardless of which connection handles it.
    const cacheKey = device_id;
    const flatData = {
      timestamp: sensorData.timestamp || new Date().toISOString(),
      device_id,
      ...sensorData
    };

    for (const conn of connections) {
      if (!conn.dataCache) conn.dataCache = {};
      if (!conn.dataCache[cacheKey]) conn.dataCache[cacheKey] = [];
      conn.dataCache[cacheKey].push(flatData);
      if (conn.dataCache[cacheKey].length > SENSOR_CACHE_LIMIT) {
        conn.dataCache[cacheKey] = conn.dataCache[cacheKey].slice(-SENSOR_CACHE_LIMIT);
      }
      connectionManager.broadcastUpdate(conn.id, cacheKey, flatData);
    }

    res.status(200).json({ success: true, message: `Data received from ${device_id}`, stored: true });
  } catch (err) {
    console.error(`❌ Error receiving sensor data:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serial endpoints
router.get("/serial/preview/:id", async (req, res) => {
  try {
    const { limit } = req.query;
    const data = await connectionManager.previewSerialData(req.params.id, Number(limit || 20));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Generic data endpoint for DynamicData page
router.get("/data/:id", async (req, res) => {
  try {
    const conn = connectionManager.getConnection(req.params.id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "Connection not found" });
    }
    
    const { table, page, limit, search } = req.query;
    
    // If a specific table/collection is requested with pagination:
    if (table) {
      const pageNum = Number(page || 1);
      const limitNum = Number(limit || 50);
      const searchStr = search || "";
      
      if (conn.type === "sql") {
        const result = await queryTablePaginated(conn, table, { page: pageNum, limit: limitNum, search: searchStr });
        return res.json({ success: true, table, ...result });
      } else if (conn.type === "nosql") {
        const result = await queryCollectionPaginated(conn, table, { page: pageNum, limit: limitNum, search: searchStr });
        return res.json({ success: true, table, ...result });
      }
    }

    // Default backwards compatibility behavior (preview all tables/collections)
    let data = [];
    if (conn.type === "sql") {
      // For SQL, get selected tables if set, otherwise all tables
      let tables = Array.isArray(conn.selectedTables) && conn.selectedTables.length > 0
        ? conn.selectedTables
        : await connectionManager.getSqlTables(req.params.id);
      if (tables && tables.length > 0) {
        const limitVal = Number(req.query.limit || 100);
        for (const t of tables) {
          const rows = await connectionManager.previewSqlTable(req.params.id, t, limitVal);
          data.push({ table: t, rows });
        }
      }
    } else if (conn.type === "nosql") {
      let collections = Array.isArray(conn.selectedTables) && conn.selectedTables.length > 0
        ? conn.selectedTables
        : await connectionManager.getNoSqlCollections(req.params.id);
      if (collections && collections.length > 0) {
        const limitVal = Number(req.query.limit || 100);
        for (const col of collections) {
          const rows = await connectionManager.previewNoSqlCollection(req.params.id, col, limitVal);
          data.push({ table: col, rows });
        }
      }
    } else if (conn.type === "mqtt") {
      if (conn.dataCache) {
        const topics = Object.keys(conn.dataCache);
        if (topics.length > 0) {
          data = topics.map(topic => ({ table: topic, rows: conn.dataCache[topic] || [] }));
        } else if (conn.config?.topic) {
          // Triggers subscription; WebSocket delivers rows as messages arrive
          await connectionManager.previewMqttData(req.params.id, conn.config.topic, 1000);
          const freshConn = connectionManager.getConnection(req.params.id);
          const cached = freshConn?.dataCache?.[conn.config.topic];
          if (cached?.length > 0) data = [{ table: conn.config.topic, rows: cached }];
        }
      } else if (conn.config?.topic) {
        await connectionManager.previewMqttData(req.params.id, conn.config.topic, 1000);
        const freshConn = connectionManager.getConnection(req.params.id);
        const cached = freshConn?.dataCache?.[conn.config.topic];
        if (cached?.length > 0) data = [{ table: conn.config.topic, rows: cached }];
      }
    } else if (conn.type === "http") {
      
      // For HTTP, get data from all endpoints in cache
      if (conn.dataCache) {
        const endpoints = Object.keys(conn.dataCache);
        if (endpoints.length > 0) {
          data = endpoints.map(endpoint => ({ table: endpoint, rows: conn.dataCache[endpoint] || [] }));
        } else if (conn.config?.endpoint) {
          // pollHttpEndpoint is awaited — data lands in conn.dataCache before this line returns
          await connectionManager.pollHttpEndpoint(req.params.id, conn.config.endpoint);
          const rows = conn.dataCache?.[conn.config.endpoint];
          if (rows?.length > 0) data = [{ table: conn.config.endpoint, rows }];
        }
      } else if (conn.config?.endpoint) {
        await connectionManager.pollHttpEndpoint(req.params.id, conn.config.endpoint);
        const rows = conn.dataCache?.[conn.config.endpoint];
        if (rows?.length > 0) data = [{ table: conn.config.endpoint, rows }];
      }
    } else if (conn.type === "serial") {
      // For Serial, get the latest data
      const serialData = await connectionManager.previewSerialData(req.params.id, 20);
      data = [{ table: "serial_data", rows: serialData }];
    } else if (conn.type === "static") {
      // For Static/Snapshot connections, return the stored snapshot data
      if (conn.dataCache) {
        const tables = Object.keys(conn.dataCache);
        if (tables.length > 0) {
          data = tables.map(topic => ({
            table: topic,
            rows: conn.dataCache[topic] || []
          }));
        }
      } else if (conn.snapshotData && Array.isArray(conn.snapshotData)) {
        // Fallback to snapshotData if dataCache not initialized
        data = conn.snapshotData;
      }
    } else if (conn.type === "file") {
      if (conn.dataCache) {
        const tables = Object.keys(conn.dataCache);
        data = tables.map(t => ({ table: t, rows: conn.dataCache[t] || [], headers: Object.keys((conn.dataCache[t] || [])[0] || {}) }));
      }
    }
    
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/data/:id/aggregate", async (req, res) => {
  try {
    const conn = connectionManager.getConnection(req.params.id);
    if (!conn) {
      return res.status(404).json({ success: false, error: "Connection not found" });
    }
    
    const { table, xField, yField, aggregation } = req.query;
    if (!table || !xField || !yField) {
      return res.status(400).json({ success: false, error: "table, xField, and yField are required query params." });
    }
    
    let result = [];
    if (conn.type === "sql") {
      result = await queryTableAggregate(conn, table, { xField, yField, aggregation: aggregation || "none" });
    } else if (conn.type === "nosql") {
      result = await queryCollectionAggregate(conn, table, { xField, yField, aggregation: aggregation || "none" });
    } else {
      return res.status(400).json({ success: false, error: "Aggregation is only supported for SQL and NoSQL connections." });
    }
    
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Chart endpoints for Dynamic Dashboard
router.get("/charts", async (req, res) => {
  try {
    const charts = await chartsStorage.getAll();
    res.json({ success: true, charts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/charts/:id", async (req, res) => {
  try {
    const chart = await chartsStorage.get(req.params.id);
    if (!chart) {
      return res.status(404).json({ success: false, error: `Chart with ID "${req.params.id}" not found` });
    }
    res.json({ success: true, chart });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const VALID_CHART_TYPES = new Set([
  "line","bar","area","scatter","pie","donut","radar",
  "histogram","box","gauge","scatter3d","surface3d","line3d"
]);

function validateDatasetId(id) {
  if (typeof id !== "string" || !/^ds_[a-zA-Z0-9_]+$/.test(id)) {
    const err = new Error("Invalid dataset ID");
    err.status = 400;
    throw err;
  }
}

router.post("/charts", async (req, res) => {
  try {
    const { title, type } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, error: "title is required" });
    }
    if (!type || !VALID_CHART_TYPES.has(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${[...VALID_CHART_TYPES].join(", ")}` });
    }
    const chart = await chartsStorage.create({ ...req.body, title: title.trim() });
    res.status(201).json({ success: true, chart, id: chart.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/charts/:id", async (req, res) => {
  try {
    if (req.body.type && !VALID_CHART_TYPES.has(req.body.type)) {
      return res.status(400).json({
        success: false,
        error: `type must be one of: ${[...VALID_CHART_TYPES].join(", ")}`
      });
    }
    const chart = await chartsStorage.update(req.params.id, req.body);
    res.json({ success: true, chart });
  } catch (err) {
    if (err.message === "Chart not found") {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/charts/:id", async (req, res) => {
  try {
    if (req.body.type && !VALID_CHART_TYPES.has(req.body.type)) {
      return res.status(400).json({
        success: false,
        error: `type must be one of: ${[...VALID_CHART_TYPES].join(", ")}`
      });
    }
    const chart = await chartsStorage.update(req.params.id, req.body);
    res.json({ success: true, chart });
  } catch (err) {
    if (err.message === "Chart not found") {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/charts/:id", async (req, res) => {
  try {
    const deleted = await chartsStorage.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Chart not found" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Presentation endpoints
router.post("/presentations/launch", (req, res) => {
  try {
    const { presentations } = req.body;
    if (!presentations || !Array.isArray(presentations)) {
      return res.status(400).json({ success: false, error: "presentations array is required" });
    }

    const config = {
      presentations: presentations.map(p => ({
        url: p.url,
        screen_id: p.screen_id || 0,
        browser: p.browser || 'chrome'
      }))
    };

    const pythonScript = path.join(__dirname, 'presentation_manager.py');
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const python = spawn(pythonCmd, [pythonScript, JSON.stringify(config)]);

    let output = '';
    let error = '';
    python.stdout.on('data', (data) => { output += data.toString(); });
    python.stderr.on('data', (data) => { error += data.toString(); });

    python.on('error', (err) => {
      console.error("Failed to start python presentation manager process:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: `Failed to execute python presentation manager: ${err.message}. Please verify Python is installed.` });
      }
    });

    python.on('close', (code) => {
      try {
        if (code !== 0) {
          if (!res.headersSent) {
            return res.status(500).json({ success: false, error: `Python script failed: ${error}` });
          }
          return;
        }
        if (!res.headersSent) {
          res.json(JSON.parse(output));
        }
      } catch (parseError) {
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'Failed to parse presentation manager response', output });
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get available screens
router.get("/screens", (req, res) => {
  try {
    const pythonScript = path.join(__dirname, 'presentation_manager.py');
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const python = spawn(pythonCmd, [pythonScript]);
    
    let output = '';
    let error = '';
    
    python.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      error += data.toString();
    });

    python.on('error', (err) => {
      console.error("Failed to start python screen detector process:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: `Failed to execute python screen detector: ${err.message}. Please verify Python is installed.` });
      }
    });
    
    python.on('close', (code) => {
      try {
        if (code !== 0) {
          console.error('Python script error:', error);
          return res.status(500).json({ 
            success: false, 
            error: `Failed to detect screens: ${error}` 
          });
        }
        
        const result = JSON.parse(output);
        res.json({ 
          success: true, 
          screens: result.screens,
          system: result.system
        });
      } catch (parseError) {
        console.error('Failed to parse screen detection output:', output, parseError);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to detect screens' 
        });
      }
    });
    
  } catch (err) {
    console.error('Error detecting screens:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Static Datasets Scalability Endpoints
router.post("/datasets/upload", upload.single("file"), async (req, res) => {
  let tempFilePath = null;
  let fromGoogle = false;
  try {
    let name = req.body.datasetName || "Unnamed Dataset";
    let firstRowHeader = req.body.firstRowHeader === "true" || req.body.firstRowHeader === true;
    const headerRow = Math.max(1, parseInt(req.body.headerRow, 10) || 1);
    let sourceType = req.body.sourceType || "csv";

    if (req.body.googleUrl) {
      const rawUrl = req.body.googleUrl.trim();
      // XLSX export from Google Sheets requires authentication — only CSV and JSON work for public sheets
      const googleFormat = ["csv", "json"].includes(req.body.googleFormat) ? req.body.googleFormat : "csv";
      fromGoogle = true;

      if (googleFormat === "json") {
        // gviz/tq JSON — fetch text in-memory, parse immediately (no temp file needed)
        const downloadUrl = normalizeGoogleSheetsUrl(rawUrl, "json");
        const response = await axios({ url: downloadUrl, method: "GET", responseType: "text",
          timeout: 30_000, maxRedirects: 5,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; TANSAM/4.0)", "Accept": "text/plain,*/*" },
          validateStatus: s => s < 400
        });
        const gvizText = response.data;
        if (typeof gvizText !== "string" || gvizText.trimStart().startsWith("<!")) {
          throw new Error("Google Sheets returned HTML instead of JSON. Ensure the sheet is shared as 'Anyone with the link'.");
        }
        const parsed = parseGvizJson(gvizText);
        // Write rows as JSON array to a temp file so ingestJSONRows can consume it
        const tempJson = path.join(uploadDir, `google_${Date.now()}.json`);
        tempFilePath = tempJson;
        fs.writeFileSync(tempJson, JSON.stringify(parsed.rows));
        sourceType = "json";
        // Override headers/types from gviz — they come pre-typed, skip inference step
        const id = `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const finalSourceType = "google";
        await staticDb.registerDataset({ id, name, sourceType: finalSourceType, headers: parsed.headers, types: parsed.types, rowCount: 0, status: "processing" });
        res.status(202).json({ success: true, processing: true, dataset: { id, name, sourceType: finalSourceType, schema: { headers: parsed.headers, types: parsed.types }, headers: parsed.headers, types: parsed.types, rowCount: 0, status: "processing", createdAt: new Date().toISOString() } });
        ;(async () => {
          try {
            const rowCount = await ingestJSONRows(tempJson, id, parsed.headers);
            await updateDatasetStatus(id, "ready", rowCount);
            console.log(`✅ Ingest complete (google/json): ${id} — ${rowCount.toLocaleString()} rows`);
          } catch (err) {
            console.error("❌ background ingest error:", err);
            await updateDatasetStatus(id, "error").catch(() => {});
          } finally {
            fsUnlink(tempJson).catch(() => {});
          }
        })();
        return; // response already sent
      }

      const ext = googleFormat; // "csv" or "xlsx"
      const downloadUrl = normalizeGoogleSheetsUrl(rawUrl, ext);
      const downloadPath = path.join(uploadDir, `google_${Date.now()}.${ext}`);
      tempFilePath = downloadPath;
      await downloadGoogleSheet(downloadUrl, downloadPath);
      sourceType = ext;
    } else {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded." });
      }
      tempFilePath = req.file.path;
      if (!req.body.datasetName && req.file.originalname) {
        name = req.file.originalname.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ");
      }
    }

    const id = `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let headers = [];
    let types = [];
    let xlsxSheetData = null; // held in closure for background ingest

    const ext = sourceType.toLowerCase();

    // Type inference only — fast, reads at most 1000 lines
    if (ext === "csv") {
      const inferred = await inferCSVTypes(tempFilePath, firstRowHeader, headerRow);
      headers = inferred.headers;
      types = inferred.types;
    } else if (ext === "json") {
      const inferred = await inferJSONTypes(tempFilePath);
      headers = inferred.headers;
      types = inferred.types;
    } else if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX.readFile(tempFilePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Guard OOM: check row count via sheet range before loading all rows
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      const sheetRowCount = range ? range.e.r - range.s.r : 0;
      if (sheetRowCount > 500000) {
        if (tempFilePath) fsUnlink(tempFilePath).catch(() => {});
        return res.status(413).json({
          success: false,
          error: `XLSX file has ~${sheetRowCount.toLocaleString()} rows. XLSX cannot be streamed — convert to CSV for files over 500,000 rows.`
        });
      }

      xlsxSheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
      const inferred = inferXLSXTypes(xlsxSheetData, firstRowHeader, headerRow);
      headers = inferred.headers;
      types = inferred.types;
    } else {
      throw new Error(`Unsupported sourceType: ${sourceType}`);
    }

    const finalSourceType = fromGoogle ? "google" : sourceType;
    await staticDb.registerDataset({ id, name, sourceType: finalSourceType, headers, types, rowCount: 0, status: "processing" });

    // Respond 202 immediately — client polls /api/datasets/:id/status for completion
    res.status(202).json({
      success: true,
      processing: true,
      dataset: {
        id,
        name,
        sourceType: finalSourceType,
        schema: { headers, types },
        headers,
        types,
        rowCount: 0,
        status: "processing",
        createdAt: new Date().toISOString()
      }
    });

    // Background ingest — runs after response is sent
    ;(async () => {
      try {
        let rowCount = 0;
        if (ext === "csv") {
          rowCount = await ingestCSVRows(tempFilePath, id, headers.length, firstRowHeader, headerRow);
        } else if (ext === "json") {
          rowCount = await ingestJSONRows(tempFilePath, id, headers);
        } else if (ext === "xlsx" || ext === "xls") {
          rowCount = await ingestXLSXRows(xlsxSheetData, id, headers.length, firstRowHeader, headerRow);
          xlsxSheetData = null;
        }
        await updateDatasetStatus(id, "ready", rowCount);
        console.log(`✅ Ingest complete: ${id} — ${rowCount.toLocaleString()} rows`);
      } catch (err) {
        console.error("❌ background ingest error:", err);
        await updateDatasetStatus(id, "error").catch(() => {});
      } finally {
        if (tempFilePath) fsUnlink(tempFilePath).catch(() => {});
      }
    })();

  } catch (err) {
    console.error("❌ upload error:", err);
    if (tempFilePath) fsUnlink(tempFilePath).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Poll ingestion status for large uploads
router.get("/datasets/:id/status", async (req, res) => {
  try {
    validateDatasetId(req.params.id);
    const meta = await staticDb.getDatasetMetadata(req.params.id);
    if (!meta) return res.status(404).json({ success: false, error: "Dataset not found" });
    res.json({ success: true, id: meta.id, status: meta.status || "ready", rowCount: meta.rowCount });
  } catch (err) {
    const status = err.status || (err.message === "Dataset not found" ? 404 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

router.get("/datasets", async (req, res) => {
  try {
    const list = await staticDb.getDatasets();
    res.json({ success: true, datasets: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/datasets/:id/data", async (req, res) => {
  try {
    validateDatasetId(req.params.id);
    const { page, limit, search } = req.query;
    const result = await staticDb.getDatasetData(req.params.id, {
      page: Number(page || 1),
      limit: Number(limit || 50),
      search: search || ""
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || (err.message === "Dataset not found" ? 404 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

const X_REQUIRED_MODES = new Set(["series", "category", "scatter"]);

router.get("/datasets/:id/aggregate", async (req, res) => {
  try {
    validateDatasetId(req.params.id);
    const { xField, yField, aggregation, mode, filters, limit, bins, sample } = req.query;
    const resolvedMode = mode || "series";

    if (!yField) {
      return res.status(400).json({ success: false, error: "yField is required query param." });
    }
    if (X_REQUIRED_MODES.has(resolvedMode) && !xField) {
      return res.status(400).json({ success: false, error: "xField is required for this chart type." });
    }

    let parsedFilters = [];
    if (filters) {
      try {
        parsedFilters = JSON.parse(filters);
      } catch (_) {
        return res.status(400).json({ success: false, error: "filters must be valid JSON." });
      }
      if (!Array.isArray(parsedFilters)) {
        return res.status(400).json({ success: false, error: "filters must be a JSON array." });
      }
    }

    const result = await staticDb.getDatasetAggregate(req.params.id, {
      xField,
      yField,
      aggregation: aggregation || "none",
      mode: resolvedMode,
      filters: parsedFilters,
      limit: Number(limit) || undefined,
      bins: Number(bins) || 10,
      sample: Number(sample) || 0
    });
    // result = { data, sampled } — sampled=true means preview used a spread sample
    res.json({ success: true, data: result.data, sampled: result.sampled });
  } catch (err) {
    const status = err.status || (err.message === "Dataset not found" ? 404 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

router.delete("/datasets/:id", async (req, res) => {
  try {
    validateDatasetId(req.params.id);
    await staticDb.deleteDataset(req.params.id);
    res.json({ success: true });
  } catch (err) {
    const status = err.status || (err.message === "Dataset not found" ? 404 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

router.put("/datasets/:id", async (req, res) => {
  try {
    validateDatasetId(req.params.id);
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: "name is required" });
    }
    const dataset = await staticDb.updateDatasetMetadata(req.params.id, { name });
    res.json({ success: true, dataset });
  } catch (err) {
    const status = err.status || (err.message === "Dataset not found" ? 404 : 500);
    res.status(status).json({ success: false, error: err.message });
  }
});

// Handle multer-specific errors (e.g. file too large) before Express default handler
router.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: "File too large. Maximum upload size is 200 MB." });
  }
  next(err);
});

export default router;

