import { test } from "node:test";
import assert from "node:assert/strict";
import { createSqlConnection, queryTablePaginated, closeConnection } from "../modules/sql.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../static_datasets.db");

test("C1: queryTablePaginated with no search returns all rows (baseline)", async () => {
  const conn = await createSqlConnection({ type: "sqlite", filename: DB_PATH });
  const result = await queryTablePaginated(conn, "datasets_metadata", { page: 1, limit: 100, search: "" });
  assert.ok(typeof result.totalRows === "number");
  assert.ok(Array.isArray(result.rows));
  await closeConnection(conn);
});

test("C1: queryTablePaginated search returns subset of rows", async () => {
  const conn = await createSqlConnection({ type: "sqlite", filename: DB_PATH });

  const all = await queryTablePaginated(conn, "datasets_metadata", { page: 1, limit: 100, search: "" });
  // Only run the search sub-test if there are rows to search
  if (all.totalRows > 0) {
    // Search for a substring that exists in the data (use part of row id format)
    const firstRow = all.rows[0];
    const firstVal = String(Object.values(firstRow).find(v => v != null) ?? "").slice(0, 4);

    if (firstVal.length > 0) {
      const filtered = await queryTablePaginated(conn, "datasets_metadata", { page: 1, limit: 100, search: firstVal });
      assert.ok(
        filtered.totalRows <= all.totalRows,
        `filtered (${filtered.totalRows}) must be <= total (${all.totalRows})`
      );
      // Every returned row must contain the search term in at least one column
      for (const row of filtered.rows) {
        const allValues = Object.values(row).map(v => String(v ?? "").toLowerCase());
        const anyMatch = allValues.some(v => v.includes(firstVal.toLowerCase()));
        assert.ok(anyMatch, `Row does not match "${firstVal}": ${JSON.stringify(row)}`);
      }
    }
  }

  await closeConnection(conn);
});

test("C1: search with no matching term returns 0 rows and totalRows 0", async () => {
  const conn = await createSqlConnection({ type: "sqlite", filename: DB_PATH });
  const result = await queryTablePaginated(conn, "datasets_metadata", {
    page: 1, limit: 50, search: "ZZZNOWAYTHISEXISTS_999xyz"
  });
  assert.equal(result.totalRows, 0);
  assert.equal(result.rows.length, 0);
  await closeConnection(conn);
});
