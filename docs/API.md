# API Reference — TANSAM4.0

Base URL: `http://localhost:8085`

All JSON responses include `{ success: boolean, error?: string }`.

---

## Static Datasets

### Upload Dataset
```
POST /api/datasets/upload
Content-Type: multipart/form-data
```

**Form fields:**

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `file` | File | either/or | CSV, XLSX, or JSON file |
| `googleUrl` | string | either/or | Public Google Sheets share URL |
| `datasetName` | string | no | Defaults to filename |
| `firstRowHeader` | "true"/"false" | no | Default: "true" |
| `sourceType` | "csv"\|"json"\|"xlsx" | no | Auto-detected from extension |

**Response:**
```json
{
  "success": true,
  "dataset": {
    "id": "ds_1234567890_abcd",
    "name": "My Dataset",
    "sourceType": "csv",
    "schema": { "headers": ["date", "sales"], "types": ["string", "number"] },
    "rowCount": 5000,
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

---

### List All Datasets
```
GET /api/datasets
```

**Response:**
```json
{
  "success": true,
  "datasets": [
    {
      "id": "ds_xxx",
      "name": "Sample Sales",
      "sourceType": "csv",
      "rowCount": 120,
      "headers": ["product", "quantity", "revenue"],
      "types": ["string", "number", "number"],
      "rowsPreview": [ { "product": "A", "quantity": 10, "revenue": 500 }, ... ]
    }
  ]
}
```

---

### Get Dataset Rows (Paginated)
```
GET /api/datasets/:id/data?page=1&limit=50&search=
```

| Param | Default | Notes |
|-------|---------|-------|
| `page` | 1 | 1-indexed |
| `limit` | 50 | Rows per page |
| `search` | "" | Full-text search across all columns |

**Response:**
```json
{
  "success": true,
  "rows": [ { "product": "A", "quantity": 10 } ],
  "totalRows": 5000,
  "page": 1,
  "limit": 50,
  "headers": ["product", "quantity"],
  "types": ["string", "number"]
}
```

---

### Get Aggregated Data (for Charts)
```
GET /api/datasets/:id/aggregate?xField=date&yField=sales,revenue&aggregation=sum
```

| Param | Required | Values |
|-------|:--------:|--------|
| `xField` | yes | Column name for X axis |
| `yField` | yes | Comma-separated column names for Y axis |
| `aggregation` | no | `none` (default), `sum`, `avg`, `min`, `max`, `count` |

**Response:**
```json
{
  "success": true,
  "data": [
    { "date": "Jan", "sales": 1200, "revenue": 8500 },
    { "date": "Feb", "sales": 1500, "revenue": 9200 }
  ]
}
```

- Returns ≤1000 points (downsampled for large datasets)
- Field names in response match the original column names (not generic aliases)

---

### Delete Dataset
```
DELETE /api/datasets/:id
```

**Response:** `{ "success": true }`

---

## Dynamic Connections

### Add Connection
```
POST /api/add-connection
Content-Type: application/json
```

**Body by type:**

**SQL — MySQL / MariaDB**
```json
{
  "type": "sql",
  "config": {
    "type": "mysql",
    "name": "My MySQL",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "secret",
    "database": "mydb"
  }
}
```

**SQL — PostgreSQL**
```json
{
  "type": "sql",
  "config": {
    "type": "postgres",
    "name": "My Postgres",
    "host": "127.0.0.1",
    "port": 5432,
    "user": "postgres",
    "password": "secret",
    "database": "mydb"
  }
}
```

**SQL — SQLite**
```json
{
  "type": "sql",
  "config": {
    "type": "sqlite",
    "name": "Local SQLite",
    "filename": "/absolute/path/to/file.db"
  }
}
```

**NoSQL — MongoDB**
```json
{
  "type": "nosql",
  "config": {
    "name": "My Mongo",
    "uri": "mongodb://localhost:27017",
    "database": "iotdata"
  }
}
```

**MQTT**
```json
{
  "type": "mqtt",
  "config": {
    "name": "HiveMQ",
    "brokerUrl": "mqtt://broker.hivemq.com",
    "topic": "sensors/#"
  }
}
```

**HTTP Pull**
```json
{
  "type": "http",
  "config": {
    "name": "Sensor API",
    "url": "https://api.example.com/readings",
    "mode": "pull",
    "pollIntervalMs": 5000
  }
}
```

**HTTP Push (ThingSpeak-compat)**
```json
{
  "type": "http",
  "config": {
    "name": "IoT Device",
    "mode": "push",
    "apiKey": "DEVICE_API_KEY"
  }
}
```

**Serial**
```json
{
  "type": "serial",
  "config": {
    "name": "Arduino",
    "port": "COM3",
    "baudRate": 9600
  }
}
```

**Response:**
```json
{
  "success": true,
  "connection": {
    "id": "conn_1234567890",
    "type": "sql",
    "config": { "name": "My MySQL", "host": "127.0.0.1", ... }
  }
}
```

---

### List Connections
```
GET /api/connections
```

Returns safe-serialised connection list (passwords omitted).

---

### Remove Connection
```
DELETE /api/remove-connection/:id
```

**Response:** `{ "success": true }`

---

### Get Connection Data (Paginated)
```
GET /api/data/:id?table=sensor_readings&page=1&limit=50&search=
```

| Param | Notes |
|-------|-------|
| `table` | Table (SQL), collection (NoSQL), topic (MQTT), endpoint (HTTP) |
| `page` | 1-indexed |
| `limit` | Rows per page (default 50) |
| `search` | Filter text (SQL/NoSQL only) |

**Response:**
```json
{
  "success": true,
  "rows": [ { "timestamp": "...", "temperature": 23.5 } ],
  "totalRows": 1500,
  "headers": ["timestamp", "temperature"],
  "types": ["string", "number"]
}
```

For MQTT/HTTP/Serial, returns in-memory cache (paginated). `totalRows` = cache length.

---

### Get Aggregated Connection Data (for Charts)
```
GET /api/data/:id/aggregate?table=readings&xField=timestamp&yField=temperature&aggregation=avg
```

Same params as dataset aggregate. Returns `{ success, data: [...] }`.

---

## SQL Endpoints

### List Tables
```
GET /api/sql/tables/:id
```
**Response:** `{ "success": true, "tables": ["users", "readings", "logs"] }`

---

### Save Selected Tables
```
POST /api/sql/select-tables/:id
Content-Type: application/json
Body: { "tables": ["readings", "events"] }
```

---

### Preview Table
```
GET /api/sql/preview/:id?table=readings&limit=20
```

---

## NoSQL Endpoints

### List Collections
```
GET /api/nosql/collections/:id
```
**Response:** `{ "success": true, "collections": ["sensors", "alerts"] }`

---

### Save Selected Collections
```
POST /api/nosql/select-collections/:id
Body: { "collections": ["sensors"] }
```

---

### Preview Collection
```
GET /api/nosql/preview/:id?collection=sensors&limit=20
```

---

## MQTT Endpoints

### Preview Topic Cache
```
GET /api/mqtt/preview/:id?topic=sensors/temp&limit=100
```

Auto-subscribes to topic if not already subscribed.

---

## HTTP Endpoints

### Preview Endpoint Cache
```
GET /api/http/preview/:id?endpoint=/api/readings&limit=50
```

---

### ThingSpeak Push
```
POST /update
  or
GET /update?api_key=DEVICE_KEY&field1=25.5&field2=65
```

**Body / Query params:**

| Param | Notes |
|-------|-------|
| `api_key` or `key` or `device_id` | Matches against HTTP connection config |
| `field1`–`field8` | Numeric sensor values |
| `temperature`, `humidity`, `vibration`, `pressure`, `value` | Named sensor fields |
| `status` | Optional status string |

**Response:** Count of entries in cache (ThingSpeak format, e.g. `"42"`)

---

## Serial Endpoints

### Preview Serial Cache
```
GET /api/serial/preview/:id?limit=50
```

---

## Dynamic Charts

### List Charts
```
GET /api/charts
```
**Response:** `{ "success": true, "charts": [ { ...chart } ] }`

---

### Get Chart
```
GET /api/charts/:id
```
**Response:** `{ "success": true, "chart": { ...chart } }`

---

### Create Chart
```
POST /api/charts
Content-Type: application/json
```

**Body:**
```json
{
  "title": "Temperature Over Time",
  "type": "line",
  "dataSource": "conn_1234567890",
  "dimension": "2d",
  "xField": "timestamp",
  "yField": "temperature",
  "zField": "",
  "table": "sensor_readings",
  "options": {
    "aggregation": "none",
    "topN": 0,
    "dimension": "2d",
    "table": "sensor_readings"
  }
}
```

**Response:** `{ "success": true, "chart": { "id": "chart_xxx", ...full chart } }`

---

### Update Chart
```
PUT /api/charts/:id
Content-Type: application/json
Body: (same as create, partial fields accepted)
```

---

### Delete Chart
```
DELETE /api/charts/:id
```
**Response:** `{ "success": true }`

---

## WebSocket

**URL:** `ws://localhost:8085`

**Protocol:** Plain JSON messages, server → client only.

### Message: Data Update
```json
{
  "type": "update",
  "id": "conn_1234567890",
  "topic": "sensors/temperature",
  "rows": [
    {
      "timestamp": "2024-01-15T10:00:00.000Z",
      "ts": 1705312800000,
      "temperature": 23.5,
      "humidity": 65,
      "value": 23.5,
      "source": "serial",
      "status": "ok"
    }
  ]
}
```

`topic` is:
- MQTT: the MQTT topic string
- HTTP: the API endpoint path
- Serial: `"serial_data"`
- SQL/NoSQL: the table/collection name

### Message: Connection Removed
```json
{
  "type": "removed",
  "id": "conn_1234567890"
}
```

---

## System Endpoints

### Health Check
```
GET /status
```
**Response:** `{ "status": "ok", "connections": 3, "charts": 7 }`

---

## Error Responses

All errors return HTTP 4xx/5xx with:
```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

Common errors:
- `400` — Missing required field, invalid file type, unsupported SQL type
- `404` — Dataset/chart/connection not found
- `500` — Database error, connection failure, parse error
