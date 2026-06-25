import { createSqlConnection, getTables, previewTable, testConnection, closeConnection } from "./modules/sql.js";
import { createMqttConnection } from "./modules/mqtt.js";
import { createSerialConnection } from "./modules/serial.js";
import { createHttpConnection } from "./modules/http.js";
import { createNoSqlConnection, getCollections as getNoSqlCollectionsRaw, previewCollection as previewNoSqlCollectionRaw, testConnection as testNoSqlConnection, closeConnection as closeNoSqlConnection } from "./modules/nosql.js";
import { readFile, writeFile } from "fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONNECTIONS_FILE = path.join(__dirname, "connections.json");

// Max messages retained per MQTT topic in memory for real-time EDA
const MQTT_CACHE_LIMIT = 10_000;

// AES-256-GCM encryption for credentials at rest.
// Set ENCRYPTION_KEY env var to a 64-char hex string (32 bytes).
// If unset, configs are stored in plaintext (acceptable for dev; warn in prod).
const _ENC_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, "hex")
  : null;

if (!_ENC_KEY) {
  console.warn(
    "⚠️  ENCRYPTION_KEY not set — connection credentials stored in plaintext.\n" +
    "   Set ENCRYPTION_KEY to a 64-char hex string in src/backend/.env for production use."
  );
}

function encryptConfig(config) {
  if (!_ENC_KEY) return { _plain: true, config };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", _ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return {
    _enc: true,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: enc.toString("hex"),
  };
}

function decryptConfig(stored) {
  if (!stored || stored._plain) return stored?.config ?? stored;
  if (!stored._enc) return stored; // legacy plaintext (no wrapper)
  if (!_ENC_KEY) {
    console.error("⚠️  Cannot decrypt connection config: ENCRYPTION_KEY not set.");
    return {};
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    _ENC_KEY,
    Buffer.from(stored.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(stored.tag, "hex"));
  const plain =
    decipher.update(Buffer.from(stored.data, "hex")).toString("utf8") +
    decipher.final("utf8");
  return JSON.parse(plain);
}

class ConnectionManager {
  constructor() {
    this.connections = {};
    this.wss = null;
    // Expose promise so server.js can await full connection restoration before listening.
    this._ready = this.loadConnections();
  }

  saveConnections() {
    const list = Object.values(this.connections).map(c => ({
      id: c.id,
      type: c.type,
      config: encryptConfig(c.config),
      selectedTables: c.selectedTables,
    }));
    writeFile(CONNECTIONS_FILE, JSON.stringify(list, null, 2), "utf8").catch(err =>
      console.error(`⚠️ Failed to save connections: ${err.message}`)
    );
  }

  async loadConnections() {
    try {
      const data = await readFile(CONNECTIONS_FILE, "utf8");
      const list = JSON.parse(data);
      if (Array.isArray(list)) {
        console.log(`🔄 Re-initializing ${list.length} connections from persistent storage...`);
        for (const conn of list) {
          try {
            const entry = await this.addConnection(conn.type, decryptConfig(conn.config), conn.id, true);
            if (conn.selectedTables) entry.selectedTables = conn.selectedTables;
            console.log(`✅ Restored connection: ${conn.id}`);
          } catch (err) {
            console.error(`❌ Failed to restore connection ${conn.id}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`⚠️ Failed to load connections: ${err.message}`);
      }
    }
  }
  
  // Attempt to coerce non-JSON serial lines into a flat object for charts
  parseNonJsonSerialLine(line) {
    const text = (typeof line === 'string' ? line : String(line)).trim();
    if (text.length === 0) return { raw: '' };
    
    // Single numeric value -> { value: number }
    if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
      const num = Number(text);
      return Number.isNaN(num) ? { raw: text } : { value: num };
    }
    
    // Key=value or key:value pairs (separated by comma/semicolon/space)
    if (/[=:]/.test(text)) {
      // First, see if it is a single key-value pair like "Distance: 12.34 cm" or "temp: 22.5"
      const sepCount = (text.match(/[=:]/g) || []).length;
      if (sepCount === 1) {
        const sepIndex = text.indexOf(':') !== -1 ? text.indexOf(':') : text.indexOf('=');
        const key = text.slice(0, sepIndex).trim().replace(/[^A-Za-z0-9_]/g, '_') || 'value';
        const valRaw = text.slice(sepIndex + 1).trim();
        const parsedFloat = parseFloat(valRaw);
        if (!isNaN(parsedFloat)) {
          return { [key]: parsedFloat, raw: text };
        } else {
          return { [key]: valRaw, raw: text };
        }
      }

      // If multiple or single parsing failed, tokenize
      let normalizedText = text.replace(/\s*([=:])\s*/g, '$1');
      const result = {};
      const tokens = normalizedText.split(/[;,\s]+/).filter(Boolean);
      for (const token of tokens) {
        const sepIndexEq = token.indexOf('=');
        const sepIndexCol = token.indexOf(':');
        let sepIndex = -1;
        if (sepIndexEq !== -1 && (sepIndexCol === -1 || sepIndexEq < sepIndexCol)) {
          sepIndex = sepIndexEq;
        } else if (sepIndexCol !== -1) {
          sepIndex = sepIndexCol;
        }
        if (sepIndex > 0) {
          const key = token.slice(0, sepIndex).trim().replace(/[^A-Za-z0-9_]/g, '_') || 'field';
          const valRaw = token.slice(sepIndex + 1).trim();
          const parsedFloat = parseFloat(valRaw);
          result[key] = !isNaN(parsedFloat) ? parsedFloat : valRaw;
        }
      }
      if (Object.keys(result).length > 0) {
        result.raw = text;
        return result;
      }
    }
    
    // CSV-like values or whitespace-separated numeric series -> { value1, value2, ... }
    if (text.includes(',') || /\s+/.test(text)) {
      const rawParts = text.includes(',') ? text.split(',') : text.split(/\s+/);
      const parts = rawParts.map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        const obj = {};
        let hasNumber = false;
        parts.forEach((p, idx) => {
          const numVal = parseFloat(p);
          if (!isNaN(numVal)) {
            obj[`value${idx + 1}`] = numVal;
            hasNumber = true;
          } else {
            obj[`value${idx + 1}`] = p;
          }
        });
        if (hasNumber) {
          obj.raw = text;
          return obj;
        }
      }
    }
    
    return { raw: text };
  }

  // Try to repair common malformed JSON fragments into valid JSON strings
  tryRepairJsonString(line) {
    let text = (typeof line === 'string' ? line : String(line)).trim();
    if (!text) return null;
    
    // If it looks like key":value} without opening brace or opening quote
    if (!text.startsWith('{')) {
      // Quote unquoted keys: batt:81 -> "batt":81
      text = text.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '"$1":');
      // If it now starts with a quoted key, prepend '{'
      if (/^"[^"]+"\s*:/.test(text)) {
        text = `{${text}`;
      }
    }
    // Ensure closing brace
    if (!text.endsWith('}')) {
      text = `${text}}`;
    }
    // Remove trailing commas before closing brace: {"a":1,} -> {"a":1}
    text = text.replace(/,\s*}/g, '}');
    
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  
  // Normalize parsed serial payload to a readable, chart-friendly shape
  toReadableSerialRow(parsed) {
    // Handle null, undefined, or non-object inputs
    if (!parsed || typeof parsed !== 'object') {
      parsed = { raw: String(parsed) };
    }
    
    const base = { ...parsed };
    
    // Ensure all values are properly typed for visualization
    Object.keys(base).forEach(key => {
      const val = base[key];
      if (val === 'true' || val === 'false') {
        base[key] = val === 'true';
      } else if (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== '') {
        base[key] = Number(val);
      }
    });

    // If we have positional values (value1..value6), map common sensor fields
    const positionalKeys = Object.keys(base).filter(k => /^value\d+$/.test(k)).sort((a, b) => Number(a.replace('value', '')) - Number(b.replace('value', '')));
    if (positionalKeys.length >= 2) {
      const sensorOrder = ['temp', 'humid', 'press', 'co2', 'lux', 'batt'];
      sensorOrder.forEach((name, idx) => {
        const key = positionalKeys[idx];
        if (key && base[key] !== undefined && base[name] === undefined) {
          base[name] = base[key];
        }
      });
    }

    // Check if we already have successfully parsed fields besides 'raw'
    const hasKeysOtherThanRaw = Object.keys(base).filter(k => k !== 'raw' && k !== 'timestamp' && k !== 'ts' && k !== 'source' && k !== 'status').length > 0;

    // If we only got a raw CSV string under 'raw', attempt to parse it into common fields
    if (!hasKeysOtherThanRaw && typeof base.raw === 'string' && (base.raw.includes(',') || /\s+/.test(base.raw))) {
      const tokens = (base.raw.includes(',') ? base.raw.split(',') : base.raw.split(/\s+/)).map(s => s.trim()).filter(Boolean);
      if (tokens.length >= 2) {
        const nums = tokens.map(t => {
          const n = Number(t);
          return Number.isFinite(n) ? n : t;
        });
        const sensorOrder = ['temp', 'humid', 'press', 'co2', 'lux', 'batt'];
        sensorOrder.forEach((name, idx) => {
          if (nums[idx] !== undefined && base[name] === undefined) {
            base[name] = nums[idx];
          }
        });
      }
    }
    
    // Prefer provided timestamps if present (ts, time, timestamp)
    const candidateTs = base.timestamp || base.ts || base.time;
    if (candidateTs !== undefined && candidateTs !== null) {
      let tsIso;
      if (typeof candidateTs === 'number') {
        const ms = candidateTs > 1e12 ? candidateTs : candidateTs > 1e9 ? candidateTs * 1000 : candidateTs;
        tsIso = new Date(ms).toISOString();
        // Also ensure numeric 'ts' field in milliseconds
        if (!base.ts) base.ts = ms;
      } else if (typeof candidateTs === 'string') {
        const n = Number(candidateTs.trim());
        if (Number.isFinite(n)) {
          const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : n;
          tsIso = new Date(ms).toISOString();
          if (!base.ts) base.ts = ms;
        } else {
          const d = new Date(candidateTs);
          tsIso = isNaN(d.getTime()) ? undefined : d.toISOString();
          if (!base.ts) base.ts = d.getTime();
        }
      }
      if (tsIso) {
        base.timestamp = tsIso;
      }
    }
    
    // Always ensure timestamp exists
    if (!base.timestamp) {
      const now = new Date();
      base.timestamp = now.toISOString();
      if (!base.ts) base.ts = now.getTime();
    }
    
    // Add metadata fields if not present
    if (!Object.prototype.hasOwnProperty.call(base, 'source')) {
      base.source = 'serial';
    }
    if (!Object.prototype.hasOwnProperty.call(base, 'status')) {
      base.status = 'ok';
    }
    
    // Ensure a 'value' field exists for charts that need a primary value
    const numericKeys = Object.keys(base).filter((k) => typeof base[k] === 'number');
    const preferred = ['value', 'val', 'reading', 'batt', 'battery', 'temp', 'temperature', 'hum', 'humid', 'humidity', 'press', 'pressure', 'co2', 'lux'];
    const preferredKey = preferred.find((k) => Object.prototype.hasOwnProperty.call(base, k) && typeof base[k] === 'number');
    // Exclude both 'timestamp' and 'ts' from firstNumericKey selection
    const firstNumericKey = preferredKey || numericKeys.find((k) => k !== 'timestamp' && k !== 'ts');
    if (firstNumericKey && !Object.prototype.hasOwnProperty.call(base, 'value')) {
      base.value = base[firstNumericKey];
    }
    
    // If no numeric values found, add a default value field
    if (numericKeys.filter(k => k !== 'ts').length === 0 && !base.value) {
      base.value = 0;
    }
    
    return base;
  }
  
  setWebSocketServer(wss) {
    this.wss = wss;
  }
  
  // Ensure serial listener is attached for a given connection
  ensureSerialListener(connectionId, softLimit = 1000) {
    const c = this.connections[connectionId];
    if (!c || c.type !== "serial") return;
    if (!c.dataCache) c.dataCache = [];
    if (c.dataListenerSet) return;
    if (!c.parser) {
      console.error(`❌ No parser available for serial connection ${connectionId}`);
      return;
    }
    c.parser.on('data', (line) => {
      try {
        if (!line || (typeof line === 'string' && line.trim() === '')) {
          return;
        }

        console.log(`🔌 Serial line (${connectionId}):`, typeof line === 'string' ? line : JSON.stringify(line));
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          const repaired = this.tryRepairJsonString(line);
          parsed = repaired || this.parseNonJsonSerialLine(line);
        }
        const flatRow = this.toReadableSerialRow(parsed);
        c.dataCache.push(flatRow);
        if (c.dataCache.length > softLimit) {
          c.dataCache = c.dataCache.slice(-softLimit);
        }
        if (this.wss) {
          this.broadcastUpdate(connectionId, "serial_data", flatRow);
        }
      } catch (err) {
        console.error(`Error processing serial data: ${err.message}`);
      }
    });
    c.dataListenerSet = true;
    console.log(`✅ Serial data listener set up for connection ${connectionId}`);
  }
  
  broadcastUpdate(connectionId, topic, newData) {
    if (!this.wss) return;
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify({
          type: "update",
          id: connectionId,
          topic: topic,
          rows: [newData]
        }));
      }
    });
  }

  broadcastRemoval(connectionId) {
    if (!this.wss) return;
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify({
          type: "removed",
          id: connectionId
        }));
      }
    });
  }


  async addConnection(type, config, id = "conn_" + Date.now(), isStartup = false) {
    let entry;
    try {
      if (type === "sql") {
        entry = await createSqlConnection(config);
        // Immediately test the connection to validate credentials
        // Build a temporary conn-like object for testConnection
        const tempConn = { type: "sql", dbType: entry.type, pool: entry.pool, db: entry.db };
        await testConnection(tempConn);
        console.log(`✅ SQL connection test passed for ${id}`);
      }
      else if (type === "mqtt") {
        entry = { client: createMqttConnection(config) };
        // Initialize MQTT-specific properties
        entry.dataCache = {};
        entry.subscribedTopics = new Set();
        
        // Store connection FIRST before setting up handlers to avoid race conditions
        this.connections[id] = { id, type, dbType: undefined, config, ...entry };
        const conn = this.connections[id];
        
        // Set up global message handler for this MQTT connection
        conn.client.on('connect', () => {
          console.log(`✅ MQTT connected: ${id} to broker ${config.brokerUrl}`);
          if (config.topic) {
            conn.client.subscribe(config.topic, { qos: 0 }, (err) => {
              if (err) {
                console.error(`❌ MQTT subscription error for topic ${config.topic}:`, err);
              } else {
                conn.subscribedTopics.add(config.topic);
                if (!conn.dataCache[config.topic]) conn.dataCache[config.topic] = [];
              }
            });
          }
        });

        // Subscribe immediately if the client is already connected (e.g. re-used broker session)
        if (conn.client && conn.client.connected && config.topic && !conn.subscribedTopics.has(config.topic)) {
          conn.client.subscribe(config.topic, { qos: 0 }, (err) => {
            if (err) {
              console.error(`❌ Immediate subscription error:`, err);
            } else {
              conn.subscribedTopics.add(config.topic);
              if (!conn.dataCache[config.topic]) conn.dataCache[config.topic] = [];
            }
          });
        }

        const connectionId = id;
        conn.client.on('message', (receivedTopic, message) => {
          try {
            const connection = this.connections[connectionId];
            if (!connection || !connection.dataCache) return;

            const messageStr = message.toString();
            console.log(`📨 MQTT raw message [${receivedTopic}]: ${messageStr.slice(0, 200)}`);
            // Derive a meaningful field name from the last topic segment (e.g. "factory/sensor/distance" → "distance")
            const topicField = receivedTopic.split("/").filter(Boolean).pop() || "value";
            let parsedData;
            try {
              const parsed = JSON.parse(messageStr);
              if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                parsedData = parsed;
              } else if (Array.isArray(parsed)) {
                parsedData = { [topicField]: parsed, raw: messageStr };
              } else {
                // plain number / string / boolean — use topic-derived field name
                parsedData = { [topicField]: parsed };
              }
            } catch {
              // non-JSON: try plain number, else raw string
              const asNum = Number(messageStr.trim());
              parsedData = isNaN(asNum)
                ? { [topicField]: messageStr }
                : { [topicField]: asNum };
            }

            if (!connection.dataCache[receivedTopic]) {
              connection.dataCache[receivedTopic] = [];
            }

            const flatData = { timestamp: new Date().toISOString(), topic: receivedTopic, ...parsedData };
            connection.dataCache[receivedTopic].push(flatData);
            if (connection.dataCache[receivedTopic].length > MQTT_CACHE_LIMIT) {
              connection.dataCache[receivedTopic] = connection.dataCache[receivedTopic].slice(-MQTT_CACHE_LIMIT);
            }

            if (this.wss) this.broadcastUpdate(connectionId, receivedTopic, flatData);
          } catch (err) {
            console.error(`❌ MQTT message error on ${receivedTopic}:`, err.message);
          }
        });
        
        conn.client.on('error', (err) => {
          console.error(`❌ MQTT error for ${id}:`, err);
        });
        
        this.saveConnections();
        return conn;
      }
      else if (type === "static") {
        // Static/snapshot connection - stores data directly
        entry = {
          dataCache: {},
          snapshotData: config.snapshotData || []
        };
        
        // Convert snapshot data to dataCache format for compatibility
        if (Array.isArray(entry.snapshotData)) {
          entry.snapshotData.forEach((tableData, idx) => {
            const tableName = tableData.table || `table_${idx}`;
            entry.dataCache[tableName] = tableData.rows || [];
          });
        }
      }
      else if (type === "serial") {
        entry = createSerialConnection(config);
        // Initialize serial-specific properties
        entry.dataCache = [];
        entry.dataListenerSet = false;
        // Store connection before setting listener
        this.connections[id] = { id, type, dbType: undefined, config, ...entry };
        // Immediately ensure listener is attached
        this.ensureSerialListener(id, 1000);
        this.saveConnections();
        return this.connections[id];
      }
      else if (type === "http") {
        entry = { client: createHttpConnection(config) };
        // Initialize HTTP-specific properties
        entry.dataCache = {};
        entry.pollInterval = null;
        
        // Store connection FIRST before setting up polling
        this.connections[id] = { id, type, dbType: undefined, config, ...entry };
        const conn = this.connections[id];
        
        // Set up automatic polling if endpoint and poll interval are configured (and mode is not push)
        if (config.mode !== "push" && config.endpoint && config.pollIntervalMs) {
          const pollIntervalMs = Number(config.pollIntervalMs) || 5000; // Default 5 seconds
          const endpoint = config.endpoint;
          
          // Initial fetch
          this.pollHttpEndpoint(id, endpoint);
          
          // Set up interval for continuous polling
          conn.pollInterval = setInterval(() => {
            this.pollHttpEndpoint(id, endpoint);
          }, pollIntervalMs);
          
          console.log(`🔄 HTTP polling started for ${id} at endpoint ${endpoint}, interval: ${pollIntervalMs}ms`);
        } else if (config.mode !== "push" && config.endpoint) {
          // If endpoint is provided but no interval, do initial fetch
          this.pollHttpEndpoint(id, config.endpoint);
        }
        
        this.saveConnections();
        return conn;
      }
      else if (type === "nosql") {
        entry = await createNoSqlConnection(config);
        // Immediately test the connection to validate credentials
        const tempConn = { type: "nosql", dbType: entry.type, connection: entry.connection };
        await testNoSqlConnection(tempConn);
        console.log(`✅ NoSQL connection test passed for ${id}`);
      }
      else if (type === "file") {
        // config: { name: string, rows: object[], headers: string[] }
        // Data is stored directly in dataCache — no external connection needed
        const tableName = config.name || "data";
        entry = {
          dataCache: { [tableName]: config.rows || [] },
          selectedTables: [tableName]
        };
        console.log(`✅ File connection created: ${id} — ${(config.rows || []).length} rows`);
      }
      else throw new Error("Unsupported type");
    } catch (err) {
      if (isStartup) {
        console.warn(`⚠️ Failed to restore connection ${id} (${type}) on startup: ${err.message}`);
        entry = {
          pool: null,
          db: null,
          connection: null,
          error: err.message,
          dbType: type === "nosql" ? "mongodb" : (config?.type || undefined)
        };
      } else {
        throw err;
      }
    }

    // Preserve protocol type (e.g., 'sql', 'nosql') and store DB subtype separately to avoid UI confusion
    let dbType;
    if (type === "sql" || type === "nosql") {
      dbType = entry && entry.type ? entry.type : undefined;
      if (!dbType && config && config.type) {
        dbType = config.type;
      }
      if (entry && Object.prototype.hasOwnProperty.call(entry, "type")) {
        delete entry.type; // prevent overwriting protocol type
      }
    }
    this.connections[id] = { id, type, dbType, config, ...entry };
    this.saveConnections();
    return this.connections[id];
  }

  async removeConnection(id) {
    const conn = this.connections[id];
    if (!conn) {
      delete this.connections[id];
      return;
    }
    // Clean up HTTP polling
    if (conn.pollInterval) {
      clearInterval(conn.pollInterval);
      console.log(`🛑 Stopped HTTP polling for ${id}`);
    }
    // Clean up SQL connection pools
    if (conn.type === "sql") {
      try {
        await closeConnection(conn);
        console.log(`🛑 SQL pool closed for ${id}`);
      } catch (err) {
        console.error(`⚠️ Error closing SQL pool for ${id}:`, err.message);
      }
    }
    // Clean up NoSQL connections
    if (conn.type === "nosql") {
      try {
        await closeNoSqlConnection(conn);
        console.log(`🛑 NoSQL connection closed for ${id}`);
      } catch (err) {
        console.error(`⚠️ Error closing NoSQL connection for ${id}:`, err.message);
      }
    }
    // Clean up MQTT client
    if (conn.type === "mqtt" && conn.client) {
      try {
        conn.client.end(true);
        console.log(`🛑 MQTT client disconnected for ${id}`);
      } catch (err) {
        console.error(`⚠️ Error closing MQTT client for ${id}:`, err.message);
      }
    }
    // Clean up Serial port
    if (conn.type === "serial") {
      try {
        if (conn.parser) conn.parser.removeAllListeners();
        if (conn.port) {
          conn.port.removeAllListeners();
          if (conn.port.isOpen) {
            await new Promise((resolve) => conn.port.close((err) => {
              if (err) console.error(`⚠️ Error closing serial port for ${id}:`, err.message);
              resolve();
            }));
          }
        }
      } catch (err) {
        console.error(`⚠️ Exception during serial port cleanup for ${id}:`, err.message);
      }
    }
    // Broadcast removal event to all WS clients
    this.broadcastRemoval(id);
    delete this.connections[id];
    this.saveConnections();
  }

  listConnections() {
    return Object.values(this.connections);
  }

  getConnection(id) {
    return this.connections[id];
  }

  async getSqlTables(id) {
    const c = this.connections[id];
    if (!c || !c.type) throw new Error("Invalid connection or missing type");
    if (c.type !== "sql") throw new Error("Not SQL");
    return getTables(c);
  }

  async previewSqlTable(id, table, limit) {
    const c = this.connections[id];
    if (!c || !c.type) throw new Error("Invalid connection or missing type");
    if (c.type !== "sql") throw new Error("Not SQL");
    return previewTable(c, table, limit);
  }

  async getNoSqlCollections(id) {
    const c = this.connections[id];
    if (!c || !c.type) throw new Error("Invalid connection or missing type");
    if (c.type !== "nosql") throw new Error("Not NoSQL");
    return getNoSqlCollectionsRaw(c);
  }

  async previewNoSqlCollection(id, collection, limit) {
    const c = this.connections[id];
    if (!c || !c.type) throw new Error("Invalid connection or missing type");
    if (c.type !== "nosql") throw new Error("Not NoSQL");
    return previewNoSqlCollectionRaw(c, collection, limit);
  }

  // MQTT, HTTP, Serial data preview methods
  async previewMqttData(id, topic, limit = 1000) {
    const c = this.connections[id];
    if (!c || c.type !== "mqtt") throw new Error("Not MQTT");
    
    // If there's no data cache yet, create one
    if (!c.dataCache) c.dataCache = {};
    if (!c.dataCache[topic]) c.dataCache[topic] = [];
    
    // Subscribe to the topic if not already subscribed
    if (!c.subscribedTopics) c.subscribedTopics = new Set();
    if (!c.subscribedTopics.has(topic)) {
      c.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`❌ MQTT subscription error for topic ${topic}:`, err);
        } else {
          console.log(`📡 Subscribed to MQTT topic: ${topic}`);
          c.subscribedTopics.add(topic);
        }
      });
    }
    
    // Return cached data (message handler already set up in addConnection)
    return c.dataCache[topic] || [];
  }
  
  async pollHttpEndpoint(id, endpoint) {
    const c = this.connections[id];
    if (!c || c.type !== "http") {
      console.error(`❌ HTTP connection ${id} not found or not HTTP type`);
      return;
    }
    
    try {
      // Build endpoint URL with device ID support
      let endpointPath = endpoint || c.config?.endpoint || '';
      
      // If device ID is provided, append as query parameter or include in path
      if (c.config?.deviceId) {
        const deviceId = c.config.deviceId;
        // Check if endpoint already has query params
        if (endpointPath.includes('?')) {
          endpointPath += `&device_id=${encodeURIComponent(deviceId)}`;
        } else {
          endpointPath += `?device_id=${encodeURIComponent(deviceId)}`;
        }
      }
      
      console.log(`📡 HTTP polling: ${id} -> ${endpointPath}`);
      const response = await c.client.get(endpointPath);
      const responseData = response.data;
      
      // Use base endpoint (without query params) as cache key
      const cacheKey = endpoint || c.config?.endpoint || endpointPath.split('?')[0];
      
      // Initialize cache if needed
      if (!c.dataCache) c.dataCache = {};
      if (!c.dataCache[cacheKey]) c.dataCache[cacheKey] = [];
      
      // Flatten data and collect all new rows for broadcast
      const now = new Date().toISOString();
      const deviceId = c.config?.deviceId || null;
      const newRows = [];

      if (Array.isArray(responseData)) {
        responseData.forEach(item => {
          const row = {
            timestamp: now,
            endpoint: cacheKey,
            deviceId,
            ...(typeof item === 'object' && item !== null ? item : { value: item })
          };
          c.dataCache[cacheKey].push(row);
          newRows.push(row);
        });
      } else if (typeof responseData === 'object' && responseData !== null) {
        const row = { timestamp: now, endpoint: cacheKey, deviceId, ...responseData };
        c.dataCache[cacheKey].push(row);
        newRows.push(row);
      } else {
        const row = { timestamp: now, endpoint: cacheKey, deviceId, value: responseData };
        c.dataCache[cacheKey].push(row);
        newRows.push(row);
      }

      // Keep last 10,000 entries per endpoint
      const EDA_LIMIT = 10000;
      if (c.dataCache[cacheKey].length > EDA_LIMIT) {
        c.dataCache[cacheKey] = c.dataCache[cacheKey].slice(-EDA_LIMIT);
      }

      // Broadcast all new rows to connected WebSocket clients
      if (this.wss && newRows.length > 0) {
        this.wss.clients.forEach((client) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: "update", id, topic: cacheKey, rows: newRows }));
          }
        });
      }
      
      console.log(`✅ HTTP data cached for ${cacheKey}, cache size: ${c.dataCache[cacheKey].length}`);
    } catch (err) {
      console.error(`❌ HTTP polling error for ${id} (${endpoint}):`, err.message);
      // Don't throw, just log - polling should continue even if one request fails
    }
  }
  
  async previewHttpData(id, endpoint, limit = 5) {
    const c = this.connections[id];
    if (!c || c.type !== "http") throw new Error("Not HTTP");
    
    // If endpoint is provided, fetch it now (this also initializes polling if configured)
    if (endpoint) {
      await this.pollHttpEndpoint(id, endpoint);
    }
    
    // Return cached data
    if (!c.dataCache) c.dataCache = {};
    if (endpoint && c.dataCache[endpoint]) {
      // Return the requested endpoint's data
      const data = c.dataCache[endpoint];
      // If limit is specified, return only the latest entries
      return limit ? data.slice(-limit) : data;
    }
    
    // If no specific endpoint requested, return all cached endpoints' data
    return Object.values(c.dataCache).flat().slice(-limit);
  }
  
  async previewSerialData(id, limit = 20) {
    const c = this.connections[id];
    if (!c || c.type !== "serial") throw new Error("Not Serial");
    if (!c.dataCache) c.dataCache = [];
    return c.dataCache.slice(-limit);
  }
}

export default new ConnectionManager();
