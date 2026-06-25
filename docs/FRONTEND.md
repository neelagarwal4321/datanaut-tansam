# Frontend Architecture — TANSAM4.0 (DATANAUT)

## Stack

| Package | Version | Role |
|---------|---------|------|
| React | 18.2.0 | UI framework |
| Vite | 7.x | Build / dev server |
| Tailwind CSS | 3.4.1 | Styling |
| Recharts | 2.10.3 | 2D chart rendering |
| html2canvas | 1.4.1 | PNG chart export |
| Firebase | 12.4.0 | Auth + Firestore |
| react-hook-form | 7.50.0 | Form state |
| react-router-dom | 6.22.3 | Routing |
| PapaParse | 5.5.3 | CSV parsing (client-side) |
| xlsx | 0.18.5 | Excel parsing |
| lucide-react | 0.548.0 | Icons |
| mqtt | 5.14.1 | MQTT client (browser) |

---

## Routes (`src/App.jsx`)

| Path | Component | Requires Auth |
|------|-----------|:---:|
| `/` | Redirects to `/dashboard` | yes |
| `/login` | Login | no |
| `/home` | Home (landing) | yes |
| `/data` | Data | yes |
| `/visualize` | Visualize | yes |
| `/dashboard` | Dashboard | yes |
| `/dynamic-data` | DynamicData | yes |
| `/dynamic-dashboard` | DynamicDashboard | yes |
| `/dynamic-visualize/:id?` | DynamicVisualize | yes |
| `/presentation` | PresentationMode | yes |
| `/presentation-window` | PresentationWindow | no layout |
| `*` | NotFound | — |

Protected routes are wrapped in `<PrivateRoute>` which checks `useAuth().user`.

---

## Pages (`src/pages/`)

### `Data.jsx` — Static Dataset Manager
**Purpose:** Upload, preview, search, paginate and delete datasets.

**State:**
```js
activePreview      // current page's rows from /api/datasets/:id/data
expandedId         // which dataset panel is open
firstRowHeader     // boolean toggle for CSV upload
previewPage / previewLimit (50) / previewSearch
```

**API calls:**
- `POST /api/datasets/upload` — multipart (file or googleUrl)
- `GET /api/datasets/:id/data?page&limit&search`
- `DELETE /api/datasets/:id`
- `GET /api/datasets` — via StoreContext on mount

**Key functions:**
- `parseFile(file)` — detects CSV/XLSX/JSON, POSTs FormData
- `onFetchGoogle(url)` — transforms share URL → export CSV URL, POSTs googleUrl
- `toggleDatasetPreview(id)` — expand/collapse with pagination
- `onDeleteDataset(id)` — calls StoreContext.deleteDataset, removes linked charts

---

### `Visualize.jsx` — Static Chart Builder (882 lines)
**Purpose:** Build, preview, and save static charts against uploaded datasets.

**State:**
- `react-hook-form` managing: `title`, `datasetId`, `chartType`, `mappings`, `options`
- `chartData` — rows from `/api/datasets/:id/aggregate`
- `chartLoading`, `statusMessage`

**Chart types (13):** `line`, `bar`, `area`, `scatter`, `pie`, `donut`, `radar`, `histogram`, `box`, `gauge`, `scatter3d`, `surface3d`, `line3d`

**Key functions:**
- `getDatasetMeta(dataset)` — resolves headers/types from both `dataset.schema.headers` (upload shape) and `dataset.headers` (backend load shape)
- `suggestMappings(chartType, meta, current)` — auto-fills field pickers on chart type change
- `getYFieldParam / getXFieldParam` — build query params for the aggregate endpoint
- `onSubmit(values)` — saves chart to StoreContext (localStorage)

**Data flow:**
```
Select dataset → useEffect fetches /api/datasets/:id/aggregate
→ setChartData(rows)  → ChartRenderer previews
→ onSubmit → saveChart(chart) → localStorage
```

**Scale note:** Aggregate endpoint downsamples to ≤1000 display points for datasets > 1000 rows (step sampling).

---

### `Dashboard.jsx` — Static Dashboard
**Purpose:** Grid display of all saved static charts with edit/duplicate/delete.

**Data source:** `charts` + `datasets` from StoreContext (localStorage + backend).

**Renders:** `ChartRenderer` for each chart using `buildChartData(rows, chartType, mappings, options)` over the dataset's `rowsPreview` (first 50 rows from backend).

---

### `DynamicData.jsx` — Live Connection Manager (1167 lines)
**Purpose:** Add/remove/view real-time data connections (SQL, NoSQL, MQTT, HTTP, Serial).

**Connection types + required config fields:**

| Type | Required fields |
|------|----------------|
| SQL (mysql/postgres/sqlite/mariadb) | type, host, port, user, password, database (or filename for sqlite) |
| NoSQL (mongodb) | uri, database |
| MQTT | brokerUrl, topic |
| HTTP pull | url, pollIntervalMs |
| HTTP push | mode="push", apiKey or deviceId |
| Serial | port (e.g. COM3), baudRate |

**WebSocket events consumed:**
- `{ type: "update", id, topic, rows }` — update table data + connection count
- `{ type: "removed", id }` — refresh connection list

**Key API calls:**
- `POST /api/add-connection`
- `DELETE /api/remove-connection/:id`
- `GET /api/connections`
- `GET /api/data/:id?table&page&limit&search`
- `GET /api/sql/tables/:id` + `POST /api/sql/select-tables/:id`
- `GET /api/nosql/collections/:id` + `POST /api/nosql/select-collections/:id`

---

### `DynamicVisualize.jsx` — Live Chart Builder (845 lines)
**Purpose:** Build charts on top of live data connections.

**State:** `chartTitle`, `chartType`, `chartDimension`, `dataSource` (connection ID), `selectedTable`, `selectedFields { xField, yField, zField }`, `aggregation`, `topN`, `previewData`

**Save payload (POST/PUT `/api/charts`):**
```json
{
  "title": "string",
  "type": "line",
  "dataSource": "conn_xxx",
  "dimension": "2d",
  "xField": "timestamp",
  "yField": "temperature",
  "zField": "",
  "table": "sensor_readings",
  "options": { "aggregation": "none", "topN": 0, "dimension": "2d", "table": "sensor_readings" }
}
```

**Data flow:**
- DB connections: poll `/api/data/:id/aggregate` every 5s
- Stream connections (MQTT/HTTP/Serial): WebSocket `update` events → last 50 rows

---

### `DynamicDashboard.jsx` — Live Dashboard (395 lines)
**Purpose:** Grid of real-time charts, 30s auto-refresh metadata.

**Data source:** `GET /api/connections` + `GET /api/charts` → renders `ChartWithRealTimeData` per chart.

**Cache:** localStorage key `datanaut_dynamic_dashboard_cache` — used as fallback when backend offline.

---

### `Login.jsx` — Authentication (210 lines)
**Modes:** Email+password, Google OAuth, Demo mode (no Firebase required).

---

## UI Components (`src/ui/`)

### `ChartRenderer.jsx` — Universal Chart Renderer

**Props:**
```ts
chart: {
  chartType: string,    // "line" | "bar" | ... | "scatter3d"
  title: string,
  mappings: {
    xField?: string,
    yFields?: string[],   // multi-series
    yField?: string,
    categoryField?: string,
    valueField?: string,
    angleField?: string,
    radiusField?: string,
    zField?: string
  },
  options: {
    aggregation?: string,
    topN?: number,
    seriesColors?: { [field]: hex },
    palette?: string[]
  }
}
data: object[]    // rows with original field names as keys
compact?: boolean // omit card wrapper
```

**Library:** Recharts for all 2D types. `Dynamic3DCharts` for scatter3d/surface3d/line3d.

**safeData processing:** Validates and coerces each row per chart type. Returns `[]` if required fields are absent → renders placeholder.

**PNG export:** `html2canvas` on the chart container node.

---

### `ChartWithRealTimeData.jsx` — Real-time Chart Wrapper

Connects a saved dynamic chart to live data and renders via `ChartRenderer` or `DynamicChart3D`.

**Props:** `chart` (from `/api/charts`), `onEdit`, `onDuplicate`, `onDelete`, `wrapInCard`, `showActions`

**Data sources (auto-detected):**
1. DB connections → `GET /api/data/:id` then poll every 5s
2. Stream connections (MQTT/HTTP/Serial) → WebSocket

**Pie/donut fallback:** If `mappings.categoryField`/`valueField` are missing, infers them from first data row's keys.

**Max buffer:** 1000 rows for DB connections, 50 rows for stream connections.

---

### `GlassCard.jsx`
```jsx
<div className="m3-card rounded-2xl p-4 md:p-6 hover:shadow-md {className}">{children}</div>
```

---

### `DataPreviewTable.jsx`
Sticky-header table with type badges, null display, alternating rows, compact mode.

---

## Providers (`src/providers/`)

### `AuthContext.jsx`
```ts
{
  user: { uid, email } | null,
  signup(email, password): Promise,
  login(email, password): Promise,
  loginWithGoogle(): Promise,
  logout(): Promise,
  loading: boolean
}
```
Falls back to demo mode if Firebase unavailable. Demo user: `{ uid: "demo-user", email: "demo@example.com" }`.

---

### `StoreContext.jsx`
```ts
{
  datasets: { [id]: { id, name, sourceType, rowCount, headers, types, schema, rowsPreview } },
  charts: { [id]: { id, title, datasetId, chartType, mappings, options, createdAt, updatedAt } },
  loading: boolean,
  saveDataset(dataset): void,
  deleteDataset(id): Promise,
  saveChart(chart): void,
  deleteChart(id): void,
  duplicateChart(id): void,
  generateId(): string
}
```

- **Datasets** — fetched from `GET /api/datasets` on mount, normalised to include `schema: { headers, types }`.
- **Charts** — persisted to `localStorage` key `charts`.

---

### `ThemeContext.jsx`
```ts
{ theme: "light"|"dark", toggleTheme(): void, setTheme(t): void }
```
Persists to `localStorage` key `tansam-theme`. Respects `prefers-color-scheme` on first visit.

---

## Utilities (`src/utils/`)

### `chartData.js` — `buildChartData(rows, chartType, mappings, options)`
Client-side aggregation for stream data (MQTT/Serial/HTTP). Returns chart-ready array.

Supported aggregations: `none`, `sum`, `avg`, `min`, `max`.
TopN: slices to first N after sort.

### `colors.js` — `defaultPalette`
9-colour array: `["#1da0ff", "#6366f1", "#0ea5e9", "#f97316", "#22c55e", "#a855f7", "#ef4444", "#14b8a6", "#eab308"]`

### `parseData.js`
- `normalizeRows(file)` — CSV/JSON → `{ headers, rows }`
- `inferTypes(headers, rows)` — detects `"number"`, `"date"`, `"string"` per column
- `transformGoogleSheetsUrl(url)` — converts share link to CSV export URL

### `dynamicChartUtils.js`
- `toRendererConfig(chart)` — maps dynamic chart object to ChartRenderer-compatible `{ chartType, title, mappings, options }`
- `normalizeDynamicCharts(charts)` — normalises `dimension` field
- `saveDynamicDashboardCache / loadDynamicDashboardCache` — localStorage helpers

---

## Backend URL

All frontend files resolve the backend URL with:
```js
const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname}:8085`
  : 'http://127.0.0.1:8085';
```

Override by setting `VITE_BACKEND_PORT` env var (future improvement).

---

## Scale notes

- Static datasets: Aggregate endpoint downsamples to 1000 points for display. Table preview paginates at 50 rows. SQLite handles up to 100M rows.
- Dynamic data (stream): Buffer capped at 50 rows for charts (last N). DB connections use server-side aggregation.
- Dynamic data (DB): Pagination + server-side aggregate — external DB handles query load (1B+ rows).
