# Backend Architecture — TANSAM4.0

## Overview

Express 4 server (`src/backend/server.js`) on port `8085` (or `process.env.PORT`).

- Serves REST API under `/api/*`
- Serves WebSocket on the same HTTP server (via `ws` library)
- In dev mode: proxies `/*` to Vite dev server on port 5173
- In prod mode: serves `dist/` static files

---

## File Structure

```
src/backend/
├── server.js               Express + WS setup, port binding, proxy
├── routes.js               All REST routes
├── connectionManager.js    Connection lifecycle, data cache, WS broadcast
├── chartsStorage.js        Dynamic chart CRUD, JSON persistence
├── connections.json        Saved connections (auto-created)
├── dynamic_charts.json     Saved dynamic charts (auto-created)
├── static_datasets.db      SQLite for uploaded datasets (auto-created)
├── package.json
└── modules/
    ├── serial.js           SerialPort driver wrapper
    ├── sql.js              MySQL / PostgreSQL / SQLite / MariaDB
    ├── nosql.js            MongoDB via Mongoose
    ├── mqtt.js             MQTT client (mqtt library)
    ├── http.js             HTTP client (axios)
    ├── staticDb.js         SQLite dataset storage (100M row support)
    └── thingSpeak.js       ThingSpeak-compat webhook handler
```

---

## `server.js`

```js
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
connectionManager.setWebSocketServer(wss);
app.use('/api', routes);
// Proxy or static file serve
server.listen(PORT);
```

**Middleware:** CORS (all origins), JSON body-parser, URL-encoded body-parser.

**WebSocket heartbeat:** ping/pong every 30s to detect dead connections.

---

## `connectionManager.js` — Connection Lifecycle

### Connection object shape (in-memory)

```ts
{
  id: string,                // e.g. "conn_1234567890"
  type: "sql"|"nosql"|"mqtt"|"http"|"serial"|"static",
  dbType?: string,           // "postgres" | "mysql" | "sqlite" | "mariadb" | "mongodb"
  config: object,            // original user config (sanitised before sending to client)
  
  // SQL:
  pool?: mysql2.Pool | pg.Pool,
  db?: sqlite instance,

  // NoSQL:
  connection?: mongoose.Connection,

  // MQTT:
  client?: mqtt.MqttClient,
  dataCache?: { [topic]: Row[] },      // max 10,000 rows per topic
  subscribedTopics?: Set<string>,

  // HTTP:
  client?: axios.AxiosInstance,
  dataCache?: { [endpoint]: Row[] },   // max 10,000 rows per endpoint
  pollInterval?: NodeJS.Timeout,

  // Serial:
  port?: SerialPort,
  parser?: ReadlineParser,
  dataCache?: Row[],                    // max 1,000 rows total
  dataListenerSet?: boolean,

  // Static:
  dataCache?: { [tableName]: Row[] },
  snapshotData?: Row[],

  selectedTables?: string[],
  count?: number              // incremented on each WebSocket update
}
```

### Key methods

| Method | Description |
|--------|-------------|
| `addConnection(type, config, id?)` | Create + initialise connection, save to file, return object |
| `removeConnection(id)` | Close pool/client/port, clear intervals, broadcast removal, delete |
| `listConnections()` | Array of all connections |
| `getConnection(id)` | Single connection by ID |
| `setWebSocketServer(wss)` | Register WS server for broadcasting |
| `broadcastUpdate(id, topic, rows)` | Send `{ type:"update", id, topic, rows }` to all WS clients |
| `broadcastRemoval(id)` | Send `{ type:"removed", id }` to all WS clients |

### Persistence
Connections saved to `connections.json` on every add/remove. Loaded on startup and re-initialised.

---

## `chartsStorage.js` — Dynamic Chart CRUD

Singleton class, persists to `dynamic_charts.json`.

### Chart schema (stored + returned)

```ts
{
  id: string,              // "chart_<timestamp>_<counter>"
  title: string,
  type: string,            // chart type, e.g. "line"
  chartType: string,       // duplicate of type (compatibility)
  dataSource: string,      // connection ID
  dimension: "2d"|"3d",
  xField: string,
  yField: string,
  zField?: string,
  table: string,           // table/collection/topic name
  createdAt: ISO string,
  updatedAt: ISO string,
  options: {
    table: string,
    aggregation?: string,
    topN?: number,
    dimension?: string
  }
}
```

### Methods
- `create(chartData)` → chart
- `get(id)` → chart | undefined
- `getAll()` → chart[]
- `update(id, chartData)` → chart (merges with existing)
- `delete(id)` → boolean

---

## Modules

### `modules/sql.js`

```ts
createSqlConnection({ type, host, port, user, password, database, filename, ssl? })
  → { type, pool | db }

testConnection(conn)         → void (throws on failure)
closeConnection(conn)        → void
getTables(conn)              → string[]
previewTable(conn, table, limit) → Row[]
queryTablePaginated(conn, table, { page, limit, search })
  → { rows: Row[], totalRows: number }
queryTableAggregate(conn, table, { xField, yField, aggregation })
  → Row[]   // { [xField]: x, [yField]: y }
```

**Supported types:** `mysql`, `mariadb` (both use mysql2), `postgres`/`postgresql` (pg), `sqlite` (better-sqlite3 via `sqlite` wrapper).

---

### `modules/nosql.js`

```ts
createNoSqlConnection({ uri, database })
  → { type: "nosql", dbType: "mongodb", connection: mongoose.Connection }

testConnection(conn)
getCollections(conn)         → string[]
previewCollection(conn, collectionName, limit) → Row[]  // _id as string, nested → JSON string
queryCollectionPaginated(conn, collectionName, { page, limit, search })
  → { rows: Row[], totalRows: number }
queryCollectionAggregate(conn, collectionName, { xField, yField, aggregation })
  → Row[]   // MongoDB aggregation pipeline
closeConnection(conn)
```

---

### `modules/mqtt.js`

```ts
createMqttConnection({ brokerUrl, topic, options? })
  → mqtt.MqttClient
```

Auto-fixes broker URL: adds `mqtt://` prefix if no protocol. WebSocket URLs converted to proper MQTT WS options. Unique `clientId` generated if absent.

Message handling is done in `connectionManager.js` via the global `client.on('message')` handler.

---

### `modules/http.js`

```ts
createHttpConnection({ url })
  → axios.AxiosInstance  // baseURL = url, timeout = 30000ms
```

Polling and push handling done in `connectionManager.js`.

---

### `modules/serial.js`

```ts
createSerialConnection({ port, baudRate })
  → { port: SerialPort, parser: ReadlineParser }  // delimiter: '\n'
```

---

### `modules/staticDb.js` — SQLite Static Dataset Storage

**DB file:** `src/backend/static_datasets.db`

**Schema:**
```sql
-- Metadata table
CREATE TABLE datasets_metadata (
  id TEXT PRIMARY KEY,
  name TEXT,
  sourceType TEXT,    -- "csv" | "json" | "xlsx" | "google" | "sample_csv" | "sample_json"
  headers TEXT,       -- JSON array of column names
  types TEXT,         -- JSON array of "number"|"string"|"boolean"|"date"
  rowCount INTEGER,
  createdAt TEXT
);

-- One table per dataset (columns named c0, c1, c2...)
CREATE TABLE dataset_rows_{id} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  c0 TEXT, c1 TEXT, ...
);
```

**Key functions:**

| Function | Description |
|----------|-------------|
| `getDb()` | Lazy singleton, creates tables + seeds samples on first run |
| `registerDataset({ id, name, sourceType, headers, types, rowCount })` | Create metadata + row table |
| `insertRowsBatch(id, rows, columnsCount)` | Batch insert in transaction |
| `getDatasets()` | All datasets with first 50 rows preview |
| `getDatasetData(id, { page, limit, search })` | Paginated + full-text search |
| `getDatasetAggregate(id, { xField, yField, aggregation })` | Returns rows with original field names |
| `deleteDataset(id)` | Delete metadata + drop row table |

**Scale:** Handles up to 100M rows. Aggregate query downsamples to ≤1000 display points using `WHERE id % step = 0`. Index created on xField column for aggregation queries.

**Auto-seeded sample datasets:**
- `ds_sample_sales` — CSV (Product, Quantity, Revenue, Category)
- `ds_sample_scatter` — CSV (x, y, group)
- `ds_sample_pie` — JSON (category, value)

---

### `modules/thingSpeak.js`

Express middleware for `/update` endpoint. Accepts ThingSpeak-compatible GET/POST with `api_key`/`device_id` + `field1`–`field8`. Stores to matching HTTP connection's `dataCache`. Returns count string (ThingSpeak format).

---

## Serial Data Parsing Pipeline

Every line received from a serial port goes through `connectionManager.js`:

```
Raw line (string/Buffer)
  → Try JSON.parse()
  → On fail: attempt JSON repair (add braces, quote keys, remove trailing commas)
  → On fail: parseNonJsonSerialLine()
      - Single number "25.5"     → { value: 25.5 }
      - Key=value "temp:25"      → { temp: 25 }
      - CSV-like "25,60"         → { value1: 25, value2: 60 }
      - Other text               → { raw: "text" }
  → toReadableSerialRow()
      - Normalise numeric strings
      - Map positional values to sensor names (temp, humid, press, co2, lux, batt)
      - Ensure `value` field exists
      - Add timestamp (ISO), ts (ms), source: "serial", status: "ok"
  → Push to dataCache[] (cap 1000 rows)
  → broadcastUpdate(id, "serial_data", newRow)
```

---

## WebSocket Protocol

**URL:** `ws://host:8085`

**Server → Client messages:**

```jsonc
// New data arrived for a connection
{ "type": "update", "id": "conn_xxx", "topic": "temperature", "rows": [ { ... } ] }

// Connection was deleted
{ "type": "removed", "id": "conn_xxx" }
```

No client → server messages (one-way push only).

---

## Scale Notes

| Source | In-memory cap | Persistent storage |
|--------|-------------|-------------------|
| Static datasets | 50 rows preview | SQLite (100M rows) |
| SQL/NoSQL dynamic | None (query on demand) | External DB (1B+ rows) |
| MQTT | 10,000 rows/topic | None |
| HTTP | 10,000 rows/endpoint | None |
| Serial | 1,000 rows total | None |

For large-scale dynamic DB sources, all heavy lifting is delegated to the external database engine via `queryTablePaginated` / `queryCollectionPaginated`.
