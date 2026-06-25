import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_PATH = path.join(__dirname, "dynamic_charts.json");

class ChartsStorage {
  constructor() {
    this.charts = new Map();
    this.idCounter = 1;
    this._writeQueue = Promise.resolve();
    this._ready = this._loadFromFile();
  }

  generateId() {
    return `chart_${Date.now()}_${this.idCounter++}`;
  }

  async _loadFromFile() {
    try {
      const data = await readFile(FILE_PATH, "utf8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const chart of parsed) {
          this.charts.set(chart.id, chart);
          const match = chart.id.match(/_(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num >= this.idCounter) this.idCounter = num + 1;
          }
        }
        console.log(`✅ Loaded ${this.charts.size} dynamic charts from persistent file`);
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`⚠️ Failed to load dynamic charts from file: ${err.message}`);
      }
    }
  }

  // C3: serialize all disk writes — no concurrent file writes can interleave
  _enqueueWrite() {
    this._writeQueue = this._writeQueue
      .then(() => this._persistToFile())
      .catch((err) => console.error(`⚠️ Failed to persist charts: ${err.message}`));
  }

  async _persistToFile() {
    const arr = Array.from(this.charts.values());
    await writeFile(FILE_PATH, JSON.stringify(arr, null, 2), "utf8");
  }

  async create(chartData) {
    await this._ready;
    const id = chartData.id || this.generateId();
    const chartType = chartData.type || chartData.chartType || "line";
    const chart = {
      id,
      title: chartData.title || "Untitled Chart",
      type: chartType,
      chartType,
      dataSource: chartData.dataSource,
      sourceType: chartData.sourceType,
      dimension: chartData.dimension || "2d",
      xField: chartData.xField,
      yField: chartData.yField,
      zField: chartData.zField,
      table: chartData.table || chartData.options?.table,
      createdAt: chartData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      options: {
        ...(chartData.options || {}),
        table: chartData.table || chartData.options?.table
      }
    };
    this.charts.set(id, chart);
    this._enqueueWrite();
    return chart;
  }

  async get(id) {
    await this._ready;
    return this.charts.get(id);
  }

  async getAll() {
    await this._ready;
    return Array.from(this.charts.values());
  }

  async update(id, chartData) {
    await this._ready;
    const existing = this.charts.get(id);
    if (!existing) throw new Error("Chart not found");
    const chartType = chartData.type || chartData.chartType || existing.type;
    const updated = {
      ...existing,
      ...chartData,
      id,
      type: chartType,
      chartType,
      createdAt: existing.createdAt,      // C4: immutable — never overwrite with payload
      updatedAt: new Date().toISOString(),
      options: {
        ...(existing.options || {}),
        ...(chartData.options || {}),
        table: chartData.table || chartData.options?.table || existing.table
      }
    };
    this.charts.set(id, updated);
    this._enqueueWrite();
    return updated;
  }

  async delete(id) {
    await this._ready;
    const deleted = this.charts.delete(id);
    if (deleted) this._enqueueWrite();
    return deleted;
  }
}

export default new ChartsStorage();
