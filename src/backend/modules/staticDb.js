import sqlite3 from "sqlite3";
import { open as sqliteOpen } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "../static_datasets.db");

// Named limits — single source of truth for backend aggregate caps (L6)
const CATEGORY_DEFAULT_LIMIT = 30;
const SERIES_DEFAULT_LIMIT = 500;
const SCATTER_DEFAULT_LIMIT = 2_000;

let dbInstance = null;
let readDbInstance = null; // H1: dedicated read-only connection for aggregate queries

async function seedDefaultDatasets(db) {
  try {
    const publicSamplesDir = path.join(__dirname, "../../../public/samples");
    if (!fs.existsSync(publicSamplesDir)) return;

    const salesPath = path.join(publicSamplesDir, "sample_sales.csv");
    if (fs.existsSync(salesPath)) {
      const salesCsv = fs.readFileSync(salesPath, "utf-8");
      const lines = salesCsv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(",");
      const types = ["string", "number", "number", "string"];
      const rows = lines.slice(1).map(l => l.split(","));
      const id = "ds_sample_sales";
      await registerDataset({ id, name: "Sample Sales", sourceType: "sample_csv", headers, types, rowCount: rows.length });
      await insertRowsBatch(id, rows, headers.length);
      console.log("✅ Seeded dataset: ds_sample_sales");
    }

    const scatterPath = path.join(publicSamplesDir, "sample_scatter.csv");
    if (fs.existsSync(scatterPath)) {
      const scatterCsv = fs.readFileSync(scatterPath, "utf-8");
      const lines = scatterCsv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(",");
      const types = ["number", "number", "string"];
      const rows = lines.slice(1).map(l => l.split(","));
      const id = "ds_sample_scatter";
      await registerDataset({ id, name: "Sample Scatter", sourceType: "sample_csv", headers, types, rowCount: rows.length });
      await insertRowsBatch(id, rows, headers.length);
      console.log("✅ Seeded dataset: ds_sample_scatter");
    }

    const piePath = path.join(publicSamplesDir, "sample_pie.json");
    if (fs.existsSync(piePath)) {
      const pieJson = JSON.parse(fs.readFileSync(piePath, "utf-8"));
      const headers = ["category", "value"];
      const types = ["string", "number"];
      const rows = pieJson.map(item => [item.category, item.value]);
      const id = "ds_sample_pie";
      await registerDataset({ id, name: "Sample Categories", sourceType: "sample_json", headers, types, rowCount: rows.length });
      await insertRowsBatch(id, rows, headers.length);
      console.log("✅ Seeded dataset: ds_sample_pie");
    }
  } catch (err) {
    console.error("⚠️ Error seeding default datasets:", err);
  }
}

export async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await sqliteOpen({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // WAL mode — dramatically faster for bulk inserts
  await dbInstance.exec(`PRAGMA journal_mode=WAL`);
  await dbInstance.exec(`PRAGMA synchronous=NORMAL`);
  await dbInstance.exec(`PRAGMA cache_size=-65536`); // 64 MB page cache

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS datasets_metadata (
      id TEXT PRIMARY KEY,
      name TEXT,
      sourceType TEXT,
      headers TEXT,
      types TEXT,
      rowCount INTEGER,
      status TEXT DEFAULT 'ready',
      createdAt TEXT
    )
  `);

  // Migrate existing databases that don't have the status column
  try {
    await dbInstance.exec(`ALTER TABLE datasets_metadata ADD COLUMN status TEXT DEFAULT 'ready'`);
  } catch (_) {}

  const count = await dbInstance.get("SELECT COUNT(*) as count FROM datasets_metadata");
  if (count && count.count === 0) {
    console.log("🌱 Database empty — seeding samples...");
    await seedDefaultDatasets(dbInstance);
  }

  return dbInstance;
}

/**
 * H1: Read-only connection for aggregate queries.
 * SQLite WAL mode allows concurrent readers alongside the single writer,
 * so heavy aggregate scans no longer block ingest transactions.
 */
export async function getReadDb() {
  if (readDbInstance) return readDbInstance;
  await getDb(); // ensure WAL mode is active and schema exists first
  readDbInstance = await sqliteOpen({
    filename: DB_PATH,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });
  await readDbInstance.exec(`PRAGMA cache_size=-32768`); // 32 MB page cache for reads
  return readDbInstance;
}

export async function registerDataset({ id, name, sourceType, headers, types, rowCount, status = "ready" }) {
  const db = await getDb();

  const columnsDef = headers.map((_, idx) => `c${idx} TEXT`).join(", ");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_rows_${id} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${columnsDef}
    )
  `);

  await db.run(
    `INSERT INTO datasets_metadata (id, name, sourceType, headers, types, rowCount, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, sourceType, JSON.stringify(headers), JSON.stringify(types), rowCount, status, new Date().toISOString()]
  );
}

export async function updateDatasetStatus(id, status, rowCount = null) {
  const db = await getDb();
  if (rowCount !== null) {
    await db.run(
      "UPDATE datasets_metadata SET status = ?, rowCount = ? WHERE id = ?",
      [status, rowCount, id]
    );
  } else {
    await db.run("UPDATE datasets_metadata SET status = ? WHERE id = ?", [status, id]);
  }
}

/**
 * Multi-row VALUES INSERT — ~500x faster than per-row await stmt.run().
 * Chunks rowsBatch into groups that stay under SQLite's 32766 param limit.
 * Uses SAVEPOINT instead of BEGIN/COMMIT — safe to call inside or outside
 * any existing transaction (avoids "cannot start transaction within transaction").
 */
export async function insertRowsBatch(id, rowsBatch, columnsCount) {
  const db = await getDb();
  if (rowsBatch.length === 0) return;

  const colNames = Array.from({ length: columnsCount }, (_, i) => `c${i}`).join(", ");
  const singlePlaceholder = `(${Array(columnsCount).fill("?").join(", ")})`;

  // Stay safely under SQLite's 32766 variable limit
  const rowsPerStmt = Math.max(1, Math.floor(32766 / columnsCount));
  const chunkSize = Math.min(rowsPerStmt, 500);

  const sp = `sp_batch_${Date.now()}`;
  await db.run(`SAVEPOINT ${sp}`);
  try {
    for (let start = 0; start < rowsBatch.length; start += chunkSize) {
      const chunk = rowsBatch.slice(start, start + chunkSize);
      const placeholders = chunk.map(() => singlePlaceholder).join(", ");
      const sql = `INSERT INTO dataset_rows_${id} (${colNames}) VALUES ${placeholders}`;
      const values = [];
      for (const row of chunk) {
        for (let i = 0; i < columnsCount; i++) {
          values.push(row[i] != null ? String(row[i]) : null);
        }
      }
      await db.run(sql, values);
    }
    await db.run(`RELEASE ${sp}`);
  } catch (err) {
    await db.run(`ROLLBACK TO ${sp}`);
    await db.run(`RELEASE ${sp}`);
    throw err;
  }
}

export async function getDatasets() {
  const db = await getDb();
  const list = await db.all("SELECT * FROM datasets_metadata ORDER BY createdAt DESC");

  return list.map((item) => {
    let headers, types;
    try { headers = JSON.parse(item.headers); } catch (_) { headers = []; }
    try { types = JSON.parse(item.types); } catch (_) { types = []; }
    return { ...item, headers, types };
  });
}

export async function getDatasetMetadata(id) {
  const db = await getDb();
  const meta = await db.get("SELECT * FROM datasets_metadata WHERE id = ?", [id]);
  if (!meta) return null;
  return {
    ...meta,
    headers: JSON.parse(meta.headers),
    types: JSON.parse(meta.types)
  };
}

export async function deleteDataset(id) {
  const db = await getDb();
  const result = await db.run("DELETE FROM datasets_metadata WHERE id = ?", [id]);
  if (result.changes === 0) throw new Error("Dataset not found");
  await db.exec(`DROP TABLE IF EXISTS dataset_rows_${id}`);
}

export async function updateDatasetMetadata(id, { name }) {
  const db = await getDb();
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("name is required");
  const result = await db.run(
    "UPDATE datasets_metadata SET name = ? WHERE id = ?",
    [trimmed, id]
  );
  if (result.changes === 0) throw new Error("Dataset not found");
  return getDatasetMetadata(id);
}

export async function getDatasetData(id, { page = 1, limit = 50, search = "" }) {
  const db = await getDb();
  const readDb = await getReadDb();
  const meta = await getDatasetMetadata(id);
  if (!meta) throw new Error("Dataset not found");

  const offset = (page - 1) * limit;
  const headers = meta.headers;

  let query = `SELECT * FROM dataset_rows_${id}`;
  const params = [];

  if (search) {
    const likeClauses = headers.map((_, idx) => `c${idx} LIKE ?`).join(" OR ");
    query += ` WHERE ${likeClauses}`;
    const searchVal = `%${search}%`;
    headers.forEach(() => params.push(searchVal));
  }

  // M1: skip full COUNT(*) scan when not searching — rowCount from metadata is exact.
  let totalRows;
  if (search) {
    const countQuery = `SELECT COUNT(*) as count FROM dataset_rows_${id} WHERE ${
      headers.map((_, idx) => `c${idx} LIKE ?`).join(" OR ")}`;
    const countResult = await readDb.get(countQuery, params);
    totalRows = countResult ? countResult.count : 0;
  } else {
    totalRows = meta.rowCount ?? 0;
  }

  query += ` LIMIT ? OFFSET ?`;
  const runParams = [...params, limit, offset];
  const dbRows = await readDb.all(query, runParams);

  const rows = dbRows.map(dbRow => {
    const mapped = {};
    headers.forEach((header, idx) => {
      const dbVal = dbRow[`c${idx}`];
      const type = meta.types[idx];
      if (dbVal === null || dbVal === undefined) {
        mapped[header] = null;
      } else if (type === "number") {
        mapped[header] = Number(dbVal);
      } else if (type === "boolean") {
        mapped[header] = dbVal === "true";
      } else {
        mapped[header] = dbVal;
      }
    });
    return mapped;
  });

  return { rows, totalRows, page, limit, headers, types: meta.types };
}

// Map an aggregation keyword to a SQL expression over a column.
function aggExpr(agg, col) {
  switch (agg) {
    case "sum": return `SUM(CAST(${col} AS REAL))`;
    case "avg":
    case "average": return `AVG(CAST(${col} AS REAL))`;
    case "min": return `MIN(CAST(${col} AS REAL))`;
    case "max": return `MAX(CAST(${col} AS REAL))`;
    case "count": return `COUNT(*)`;
    default: return `CAST(${col} AS REAL)`;
  }
}

/**
 * Build a parameterized WHERE clause from a filter spec.
 * Each filter: { field, op, value, value2 }. Unknown fields are skipped.
 * Column names are synthetic (c{idx}) so there is no identifier injection risk;
 * all user values are bound as parameters.
 */
function buildWhereClause(meta, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return { clause: "", params: [] };
  const frags = [];
  const params = [];

  for (const f of filters) {
    if (!f || !f.field) continue;
    const idx = meta.headers.indexOf(f.field);
    if (idx === -1) continue;
    const col = `c${idx}`;
    const num = `CAST(${col} AS REAL)`;
    const op = String(f.op || "=").toLowerCase();
    const v = f.value;

    switch (op) {
      case "=":
      case "eq":
        frags.push(`${col} = ?`); params.push(String(v ?? "")); break;
      case "!=":
      case "neq":
        frags.push(`${col} != ?`); params.push(String(v ?? "")); break;
      case ">":
      case "gt":
        frags.push(`${num} > ?`); params.push(Number(v)); break;
      case ">=":
      case "gte":
        frags.push(`${num} >= ?`); params.push(Number(v)); break;
      case "<":
      case "lt":
        frags.push(`${num} < ?`); params.push(Number(v)); break;
      case "<=":
      case "lte":
        frags.push(`${num} <= ?`); params.push(Number(v)); break;
      case "contains":
        frags.push(`${col} LIKE ?`); params.push(`%${v ?? ""}%`); break;
      case "between": {
        frags.push(`${num} BETWEEN ? AND ?`);
        params.push(Number(v), Number(f.value2));
        break;
      }
      case "in": {
        const list = String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length === 0) break;
        frags.push(`${col} IN (${list.map(() => "?").join(", ")})`);
        list.forEach((item) => params.push(item));
        break;
      }
      default:
        break;
    }
  }

  return { clause: frags.length ? `WHERE ${frags.join(" AND ")}` : "", params };
}

async function ensureIndex(db, id, col) {
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_${id}_${col} ON dataset_rows_${id} (${col})`);
}

// Merge a WHERE clause from buildWhereClause with extra raw conditions.
function combineWhere(baseClause, extraConds = []) {
  const parts = [];
  if (baseClause) parts.push(baseClause.replace(/^WHERE\s+/i, ""));
  for (const c of extraConds) if (c) parts.push(c);
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

/**
 * Mode-aware aggregate. Returns { data, sampled } where sampled=true means
 * the result was computed over a spread sample (live preview only).
 * Modes:
 *  - series    (line/area): grouped-by-x or evenly downsampled raw points
 *  - category  (bar/pie/donut/radar): GROUP BY x, ranked, top-N
 *  - scatter:  raw x/y pairs downsampled
 *  - histogram: SQL bin counts over full dataset
 *  - stats     (box): quartiles/whiskers/outliers over full dataset
 *  - gauge:    single aggregate value over full dataset
 */
export async function getDatasetAggregate(id, opts) {
  const {
    xField,
    yField,
    aggregation = "none",
    mode = "series",
    filters = [],
    limit,
    bins = 10
  } = opts || {};

  const db = await getDb();         // write connection — ensureIndex only
  const readDb = await getReadDb(); // read connection — all queries (H1)
  const meta = await getDatasetMetadata(id);
  if (!meta) throw new Error("Dataset not found");

  const table = `dataset_rows_${id}`;
  const cleanAgg = String(aggregation).toLowerCase();
  const where = buildWhereClause(meta, filters);

  const yFields = String(yField || "").split(",").filter(Boolean);
  const yIndices = yFields.map((yf) => meta.headers.indexOf(yf));
  if (yFields.length === 0 || yIndices.includes(-1)) {
    throw new Error(`One or more fields in ${yField} do not exist in dataset.`);
  }

  const isNumericCol = (idx) => meta.types[idx] === "number";
  const numGuard = (col, idx) => (isNumericCol(idx) ? null : `${col} GLOB '*[0-9]*'`);

  // H2: spread sampling — pick every Nth row for an unbiased preview across
  // the full table instead of a head-biased LIMIT scan.
  const sample = Number(opts.sample) || 0;
  const bigSample = sample > 0 && meta.rowCount > sample;
  let srcExpr = table;
  let sampleScale = 1;
  if (bigSample) {
    if (meta.rowCount > 50000) {
      srcExpr = `(SELECT * FROM (SELECT * FROM ${table} ORDER BY id DESC LIMIT ${sample}) ORDER BY id ASC)`;
    } else {
      const step = Math.max(1, Math.floor(meta.rowCount / sample));
      srcExpr = `(SELECT * FROM ${table} WHERE id % ${step} = 0 LIMIT ${sample})`;
      sampleScale = meta.rowCount / sample;
    }
  }

  // ---- histogram ----
  if (mode === "histogram") {
    const colY = `c${yIndices[0]}`;
    const num = `CAST(${colY} AS REAL)`;
    const numWhere = combineWhere(where.clause, [numGuard(colY, yIndices[0])]);
    const range = await readDb.get(
      `SELECT MIN(${num}) lo, MAX(${num}) hi FROM ${srcExpr} ${numWhere}`,
      where.params
    );
    if (!range || range.lo === null) return { data: [], sampled: bigSample };
    let { lo, hi } = range;
    const nBins = Math.max(1, Math.min(Number(bins) || 10, 100));
    if (hi === lo) { hi = lo + 0.5; lo = lo - 0.5; }
    const binWidth = (hi - lo) / nBins;
    const rows = await readDb.all(
      `SELECT MIN(${nBins - 1}, CAST((${num} - ?) / ? AS INT)) b, COUNT(*) c
       FROM ${srcExpr} ${numWhere} GROUP BY b`,
      [lo, binWidth, ...where.params]
    );
    const counts = new Array(nBins).fill(0);
    for (const r of rows) {
      const b = Math.max(0, Math.min(nBins - 1, r.b));
      counts[b] += r.c;
    }
    return {
      data: counts.map((count, i) => {
        const start = lo + i * binWidth;
        const end = start + binWidth;
        return { bin: `${start.toFixed(1)}-${end.toFixed(1)}`, count: Math.round(count * sampleScale) };
      }),
      sampled: bigSample
    };
  }

  // ---- stats (box plot) ----
  if (mode === "stats") {
    const colY = `c${yIndices[0]}`;
    const num = `CAST(${colY} AS REAL)`;
    if (!bigSample) await ensureIndex(db, id, colY);
    const numWhere = combineWhere(where.clause, [numGuard(colY, yIndices[0])]);
    const agg = await readDb.get(
      `SELECT COUNT(*) n, MIN(${num}) mn, MAX(${num}) mx FROM ${srcExpr} ${numWhere}`,
      where.params
    );
    const n = agg?.n || 0;
    if (n === 0) return { data: { count: 0, field: yFields[0] }, sampled: bigSample };

    const valueAtOffset = async (offset) => {
      const r = await readDb.get(
        `SELECT ${num} v FROM ${srcExpr} ${numWhere} ORDER BY ${num} LIMIT 1 OFFSET ?`,
        [...where.params, Math.max(0, Math.min(n - 1, offset))]
      );
      return r ? r.v : null;
    };
    const q1 = await valueAtOffset(Math.floor(0.25 * (n - 1)));
    const median = await valueAtOffset(Math.floor(0.5 * (n - 1)));
    const q3 = await valueAtOffset(Math.floor(0.75 * (n - 1)));
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const guard = numGuard(colY, yIndices[0]);
    const whiskWhere = combineWhere(where.clause, [guard, `${num} BETWEEN ? AND ?`]);
    const whisk = await readDb.get(
      `SELECT MIN(${num}) wmin, MAX(${num}) wmax FROM ${srcExpr} ${whiskWhere}`,
      [...where.params, lowerBound, upperBound]
    );
    const outWhere = combineWhere(where.clause, [guard, `(${num} < ? OR ${num} > ?)`]);
    const outliers = await readDb.get(
      `SELECT COUNT(*) c FROM ${srcExpr} ${outWhere}`,
      [...where.params, lowerBound, upperBound]
    );

    return {
      data: {
        min: agg.mn,
        max: agg.mx,
        q1, median, q3,
        whiskerMin: whisk?.wmin ?? agg.mn,
        whiskerMax: whisk?.wmax ?? agg.mx,
        outlierCount: Math.round((outliers?.c ?? 0) * sampleScale),
        count: Math.round(n * sampleScale),
        field: yFields[0]
      },
      sampled: bigSample
    };
  }

  // ---- gauge ----
  if (mode === "gauge") {
    const colY = `c${yIndices[0]}`;
    const num = `CAST(${colY} AS REAL)`;
    const agg = cleanAgg === "none" ? "avg" : cleanAgg;
    const additive = agg === "sum" || agg === "count";
    const numWhere = combineWhere(where.clause, [numGuard(colY, yIndices[0])]);
    const r = await readDb.get(
      `SELECT ${aggExpr(agg, colY)} v, MAX(${num}) mx, COUNT(*) c FROM ${srcExpr} ${numWhere}`,
      where.params
    );
    let value = r?.v ?? 0;
    const mx = r?.mx ?? 0;
    if (additive && sampleScale > 1) value *= sampleScale;
    return {
      data: { value, max: mx > 0 ? mx * 1.1 : 1, count: Math.round((r?.c ?? 0) * sampleScale), field: yFields[0] },
      sampled: bigSample
    };
  }

  // ---- modes that require xField ----
  const xIdx = meta.headers.indexOf(xField);
  if (xIdx === -1) throw new Error(`Field ${xField} does not exist in dataset.`);
  const colX = `c${xIdx}`;
  const xType = meta.types[xIdx];

  const remap = (dbRows) =>
    dbRows.map((r) => {
      let xVal = r.xField;
      if (xVal !== null && xVal !== undefined && xType === "number") xVal = Number(xVal);
      const rowObj = { [xField]: xVal };
      yFields.forEach((yf, i) => {
        let yVal = r[`yField_${i}`];
        if (yVal !== null && yVal !== undefined) yVal = Number(yVal);
        rowObj[yf] = yVal;
      });
      return rowObj;
    });

  // ---- scatter ----
  if (mode === "scatter") {
    const cap = Number(limit) || SCATTER_DEFAULT_LIMIT;
    const colY = `c${yIndices[0]}`;
    const base = combineWhere(where.clause, [numGuard(colX, xIdx), numGuard(colY, yIndices[0])]);
    let total;
    if (!where.clause && isNumericCol(xIdx) && isNumericCol(yIndices[0])) {
      total = bigSample ? sample : meta.rowCount;
    } else {
      const cnt = await readDb.get(`SELECT COUNT(*) n FROM ${srcExpr} ${base}`, where.params);
      total = cnt?.n || 0;
    }
    const select = `SELECT ${colX} as xField, ${colY} as yField_0 FROM ${srcExpr}`;
    let query, params;
    if (total <= cap) {
      query = `${select} ${base}`;
      if (!bigSample) query += ` ORDER BY id`;
      params = where.params;
    } else {
      const step = Math.max(1, Math.floor(total / cap));
      const sampleWhere = combineWhere(where.clause, [numGuard(colX, xIdx), numGuard(colY, yIndices[0]), "id % ? = 0"]);
      query = `${select} ${sampleWhere} LIMIT ?`;
      params = [...where.params, step, cap];
    }
    return { data: remap(await readDb.all(query, params)), sampled: bigSample };
  }

  // ---- category (bar/pie/donut/radar) ----
  if (mode === "category") {
    const cap = Number(limit) || CATEGORY_DEFAULT_LIMIT;
    const agg = cleanAgg === "none" ? "sum" : cleanAgg;
    const additive = agg === "sum" || agg === "count";

    const selectCols = [`${colX} as xField`];
    yFields.forEach((yf, i) => {
      selectCols.push(`${aggExpr(agg, `c${meta.headers.indexOf(yf)}`)} as yField_${i}`);
    });

    if (!bigSample) await ensureIndex(db, id, colX);
    const query = `SELECT ${selectCols.join(", ")} FROM ${srcExpr} ${where.clause}
      GROUP BY ${colX} ORDER BY yField_0 DESC LIMIT ?`;
    let rows = await readDb.all(query, [...where.params, cap]);

    if (bigSample && additive && sampleScale > 1) {
      rows = rows.map((r) => {
        const o = { ...r };
        yFields.forEach((_, i) => {
          if (o[`yField_${i}`] != null) o[`yField_${i}`] *= sampleScale;
        });
        return o;
      });
    }
    return { data: remap(rows), sampled: bigSample };
  }

  // ---- series (line/area) ----
  const cap = Number(limit) || SERIES_DEFAULT_LIMIT;
  if (cleanAgg === "none") {
    const selectCols = [`${colX} as xField`];
    yFields.forEach((yf, i) => {
      selectCols.push(`c${meta.headers.indexOf(yf)} as yField_${i}`);
    });
    const select = `SELECT ${selectCols.join(", ")} FROM ${srcExpr}`;
    let total;
    if (!where.clause) {
      total = bigSample ? sample : meta.rowCount;
    } else {
      const cnt = await readDb.get(`SELECT COUNT(*) n FROM ${srcExpr} ${where.clause}`, where.params);
      total = cnt?.n || 0;
    }
    let query, params;
    if (total <= cap) {
      query = `${select} ${where.clause}`;
      if (!bigSample) query += ` ORDER BY id`;
      params = where.params;
    } else {
      const step = Math.max(1, Math.floor(total / cap));
      const idClause = where.clause ? `${where.clause} AND id % ? = 0` : `WHERE id % ? = 0`;
      query = `${select} ${idClause} LIMIT ?`;
      params = [...where.params, step, cap];
    }
    return { data: remap(await readDb.all(query, params)), sampled: bigSample };
  }

  if (!bigSample) await ensureIndex(db, id, colX);
  const selectCols = [`${colX} as xField`];
  yFields.forEach((yf, i) => {
    selectCols.push(`${aggExpr(cleanAgg, `c${meta.headers.indexOf(yf)}`)} as yField_${i}`);
  });
  const query = `SELECT ${selectCols.join(", ")} FROM ${srcExpr} ${where.clause}
    GROUP BY ${colX} ORDER BY ${colX} LIMIT ?`;
  let rows = await readDb.all(query, [...where.params, cap]);
  if (bigSample && (cleanAgg === "sum" || cleanAgg === "count") && sampleScale > 1) {
    rows = rows.map((r) => {
      const o = { ...r };
      yFields.forEach((_, i) => { if (o[`yField_${i}`] != null) o[`yField_${i}`] *= sampleScale; });
      return o;
    });
  }
  return { data: remap(rows), sampled: bigSample };
}
