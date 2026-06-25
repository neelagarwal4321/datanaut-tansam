import mysql from "mysql2/promise";
import sqlite3 from "sqlite3";
import { open as sqliteOpen } from "sqlite";
import { Pool as PgPool } from "pg";

/**
 * Guard against SQL injection via identifier names (table, column).
 * Only allows alphanumerics, underscores, and dollar signs — the safe
 * subset that covers 99.9% of real schema names without enabling injection.
 */
function validateIdentifier(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_$]+$/.test(name)) {
    throw new Error(
      `Invalid SQL identifier "${name}". Only letters, digits, underscores, and $ are allowed.`
    );
  }
  return name;
}

async function getPrimaryKey(conn, type, table) {
  try {
    if (type === "mysql") {
      const dbResult = await conn.pool.query("SELECT DATABASE() as db");
      const currentDb = dbResult[0]?.[0]?.db;
      if (currentDb) {
        const result = await conn.pool.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' LIMIT 1`,
          [currentDb, table]
        );
        return result[0]?.[0]?.COLUMN_NAME || null;
      }
    } else if (type === "postgres") {
      const result = await conn.pool.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary LIMIT 1`,
        [table]
      );
      return result.rows[0]?.attname || null;
    }
  } catch (e) {
    // Fail silently and return null to fallback to original sorting
  }
  return null;
}

async function getTableColumns(conn, type, table) {
  try {
    if (type === "mysql") {
      const result = await conn.pool.query(`SHOW COLUMNS FROM \`${table}\``);
      return result[0].map((r) => r.Field);
    }
    if (type === "sqlite") {
      const cols = await conn.db.all(`PRAGMA table_info("${table}")`);
      return cols.map((c) => c.name);
    }
    if (type === "postgres") {
      const result = await conn.pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
        [table]
      );
      return result.rows.map((r) => r.column_name);
    }
  } catch (_) {}
  return [];
}

export async function createSqlConnection({ type, ...config }) {
  // Check if type is defined
  if (!type) {
    throw new Error("SQL type is required. Supported types are: mysql, sqlite, postgres/postgresql, and mariadb.");
  }
  
  // Convert type to lowercase for case-insensitive comparison
  const sqlType = type.toLowerCase();
  
  // Coerce port to a number (frontend sends strings from input fields)
  if (config.port !== undefined && config.port !== null && config.port !== "") {
    config.port = Number(config.port);
    if (isNaN(config.port)) {
      throw new Error(`Invalid port value: "${config.port}". Port must be a number.`);
    }
  } else {
    delete config.port; // let the driver use its default
  }
  
  // Filter driver-specific configuration to avoid passing unsupported keys (e.g., name)
  if (sqlType === "mysql" || sqlType === "mariadb") {
    const { host, port, user, password, database, ssl } = config;
    const pool = await mysql.createPool({ host, port, user, password, database, ssl });
    return { type: sqlType === "mariadb" ? "mysql" : sqlType, pool };
  }
  if (sqlType === "sqlite") {
    const { filename } = config;
    if (!filename) {
      throw new Error("SQLite requires a 'filename' (file path to the .db file).");
    }
    const db = await sqliteOpen({ filename, driver: sqlite3.Database });
    return { type: sqlType, db };
  }
  if (sqlType === "postgres" || sqlType === "postgresql") {
    const { host, port, user, password, database, ssl, connectionString } = config;
    const pgConfig = connectionString ? { connectionString, ssl } : { host, port, user, password, database, ssl };
    const pool = new PgPool(pgConfig);
    return { type: "postgres", pool };
  }
  
  // Provide more detailed error message
  throw new Error(`Unsupported SQL type: ${type}. Supported types are: mysql, sqlite, postgres/postgresql, and mariadb.`);
}

/**
 * Validate the connection immediately by running a trivial query.
 * Throws with a clear message if credentials or host are wrong.
 */
export async function testConnection(conn) {
  if (!conn || !conn.type) {
    throw new Error("Invalid SQL connection object");
  }
  
  const type = ((conn.type === "sql" && conn.dbType) ? conn.dbType : conn.type).toLowerCase();
  
  try {
    if (type === "mysql") {
      await conn.pool.query("SELECT 1");
    } else if (type === "sqlite") {
      await conn.db.get("SELECT 1");
    } else if (type === "postgres") {
      await conn.pool.query("SELECT 1");
    } else {
      throw new Error(`Cannot test connection for SQL type '${type}'.`);
    }
  } catch (err) {
    // Re-throw with a friendlier message that includes the original error
    const detail = err.message || String(err);
    throw new Error(`SQL connection test failed: ${detail}`);
  }
}

/**
 * Properly close/terminate the connection pool or database handle.
 */
export async function closeConnection(conn) {
  if (!conn || !conn.type) return;
  
  const type = ((conn.type === "sql" && conn.dbType) ? conn.dbType : conn.type).toLowerCase();
  
  try {
    if (type === "mysql" && conn.pool) {
      await conn.pool.end();
      console.log(`✅ MySQL pool closed`);
    } else if (type === "sqlite" && conn.db) {
      await conn.db.close();
      console.log(`✅ SQLite database closed`);
    } else if (type === "postgres" && conn.pool) {
      await conn.pool.end();
      console.log(`✅ PostgreSQL pool closed`);
    }
  } catch (err) {
    console.error(`⚠️ Error closing SQL connection: ${err.message}`);
  }
}

export async function getTables(conn) {
  // Check if connection and type are defined
  if (!conn || !conn.type) {
    throw new Error("Invalid SQL connection object");
  }
  
  const type = ((conn.type === "sql" && conn.dbType) ? conn.dbType : conn.type).toLowerCase();
  
  if (type === "mysql")
    return (await conn.pool.query("SHOW TABLES"))[0].map(row => Object.values(row)[0]);
  if (type === "sqlite")
    return (await conn.db.all("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
  if (type === "postgres") {
    const result = await conn.pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    return result.rows.map(r => r.tablename);
  }
  
  throw new Error(`Getting tables for SQL type '${type}' is not implemented.`);
}

export async function previewTable(conn, table, limit = 20) {
  if (!conn || !conn.type) throw new Error("Invalid SQL connection object");
  validateIdentifier(table);
  const type = ((conn.type === "sql" && conn.dbType) ? conn.dbType : conn.type).toLowerCase();
  
  if (type === "mysql")
    return (await conn.pool.query(`SELECT * FROM \`${table}\` LIMIT ?`, [limit]))[0];
  if (type === "sqlite")
    return await conn.db.all(`SELECT * FROM "${table}" LIMIT ?`, limit);
  if (type === "postgres") {
    const result = await conn.pool.query(`SELECT * FROM "${table}" LIMIT $1`, [limit]);
    return result.rows;
  }
  
  throw new Error(`Previewing tables for SQL type '${type}' is not implemented.`);
}

export async function queryTablePaginated(conn, table, { page = 1, limit = 50, search = "" }) {
  validateIdentifier(table);
  const type = ((conn.type === "sql" && conn.dbType) ? conn.dbType : conn.type).toLowerCase();
  const offset = (page - 1) * limit;

  // Build search WHERE clause by introspecting column names from the DB schema.
  // Column names come from trusted system tables so quoting is used, not validateIdentifier.
  let whereSQL = "";
  let searchBindings = [];

  if (search) {
    const columns = await getTableColumns(conn, type, table);
    if (columns.length > 0) {
      const searchVal = `%${search}%`;
      if (type === "mysql") {
        whereSQL = `WHERE ${columns.map((c) => `CAST(\`${c}\` AS CHAR) LIKE ?`).join(" OR ")}`;
        searchBindings = columns.map(() => searchVal);
      } else if (type === "sqlite") {
        whereSQL = `WHERE ${columns.map((c) => `CAST("${c}" AS TEXT) LIKE ?`).join(" OR ")}`;
        searchBindings = columns.map(() => searchVal);
      } else if (type === "postgres") {
        whereSQL = `WHERE ${columns.map((c, i) => `CAST("${c}" AS TEXT) LIKE $${i + 1}`).join(" OR ")}`;
        searchBindings = columns.map(() => searchVal);
      }
    }
  }

  let totalRows = 0;
  let rows = [];

  if (type === "mysql") {
    const tableExpr = `\`${table}\``;
    if (!search) {
      try {
        const dbResult = await conn.pool.query("SELECT DATABASE() as db");
        const currentDb = dbResult[0]?.[0]?.db;
        if (currentDb) {
          const estResult = await conn.pool.query(
            `SELECT TABLE_ROWS as count, TABLE_TYPE as ttype FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [currentDb, table]
          );
          const row = estResult[0]?.[0];
          const isView = row?.ttype === "VIEW";
          const estCount = row?.count != null ? parseInt(row.count, 10) : -1;
          if (isView || estCount === -1) {
            // VIEWs have NULL TABLE_ROWS — skip COUNT(*) to avoid full-scan timeout
            totalRows = -1;
          } else if (estCount > 100000) {
            totalRows = estCount;
          } else {
            totalRows = (await conn.pool.query(`SELECT COUNT(*) as count FROM ${tableExpr}`))[0][0].count;
          }
        } else {
          totalRows = (await conn.pool.query(`SELECT COUNT(*) as count FROM ${tableExpr}`))[0][0].count;
        }
      } catch (_) {
        totalRows = (await conn.pool.query(`SELECT COUNT(*) as count FROM ${tableExpr}`))[0][0].count;
      }
    } else {
      const countResult = await conn.pool.query(
        `SELECT COUNT(*) as count FROM ${tableExpr} ${whereSQL}`,
        searchBindings
      );
      totalRows = countResult[0][0].count;
    }
    const rowsResult = await conn.pool.query(
      `SELECT * FROM ${tableExpr} ${whereSQL} LIMIT ? OFFSET ?`,
      [...searchBindings, limit, offset]
    );
    rows = rowsResult[0];

  } else if (type === "sqlite") {
    const tableExpr = `"${table}"`;
    const countResult = await conn.db.get(
      `SELECT COUNT(*) as count FROM ${tableExpr} ${whereSQL}`,
      searchBindings
    );
    totalRows = countResult ? countResult.count : 0;
    rows = await conn.db.all(
      `SELECT * FROM ${tableExpr} ${whereSQL} LIMIT ? OFFSET ?`,
      [...searchBindings, limit, offset]
    );

  } else if (type === "postgres") {
    const tableExpr = `"${table}"`;
    const pgLimitIdx = searchBindings.length + 1;
    const pgOffsetIdx = searchBindings.length + 2;

    if (!search) {
      try {
        const estResult = await conn.pool.query(
          `SELECT reltuples::bigint AS count FROM pg_class WHERE oid = $1::regclass`,
          [table]
        );
        const estCount = estResult.rows[0] ? parseInt(estResult.rows[0].count, 10) : -1;
        if (estCount > 100000) {
          totalRows = estCount;
        } else {
          const countResult = await conn.pool.query(`SELECT COUNT(*) as count FROM ${tableExpr}`);
          totalRows = parseInt(countResult.rows[0].count, 10);
        }
      } catch (_) {
        const countResult = await conn.pool.query(`SELECT COUNT(*) as count FROM ${tableExpr}`);
        totalRows = parseInt(countResult.rows[0].count, 10);
      }
    } else {
      const countResult = await conn.pool.query(
        `SELECT COUNT(*) as count FROM ${tableExpr} ${whereSQL}`,
        searchBindings
      );
      totalRows = parseInt(countResult.rows[0].count, 10);
    }

    const rowsResult = await conn.pool.query(
      `SELECT * FROM ${tableExpr} ${whereSQL} LIMIT $${pgLimitIdx} OFFSET $${pgOffsetIdx}`,
      [...searchBindings, limit, offset]
    );
    rows = rowsResult.rows;
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, totalRows, headers };
}

export async function queryTableAggregate(conn, table, { xField, yField, aggregation = "none" }) {
  validateIdentifier(table);
  validateIdentifier(xField);
  yField.split(",").forEach(validateIdentifier);
  const type = ((conn.type === "sql" && conn.dbType) ? conn.dbType : conn.type).toLowerCase();
  const cleanAgg = aggregation.toLowerCase();
  const yFields = yField.split(",");

  let selectX = type === "mysql" ? `\`${xField}\`` : `"${xField}"`;
  const selectCols = [`${selectX} as xField`];

  yFields.forEach((yf, i) => {
    let selectY = type === "mysql" ? `\`${yf}\`` : `"${yf}"`;
    if (cleanAgg === "none") {
      selectCols.push(`${selectY} as yField_${i}`);
    } else {
      let aggSql = `CAST(${selectY} AS REAL)`;
      if (type === "mysql" || type === "postgres") {
        aggSql = `CAST(${selectY} AS DOUBLE PRECISION)`;
      }
      if (cleanAgg === "sum") {
        aggSql = `SUM(${aggSql})`;
      } else if (cleanAgg === "avg" || cleanAgg === "average") {
        aggSql = `AVG(${aggSql})`;
      } else if (cleanAgg === "min") {
        aggSql = `MIN(${aggSql})`;
      } else if (cleanAgg === "max") {
        aggSql = `MAX(${aggSql})`;
      } else if (cleanAgg === "count") {
        aggSql = `COUNT(*)`;
      }
      selectCols.push(`${aggSql} as yField_${i}`);
    }
  });

  const selectStr = selectCols.join(", ");
  const tableExpr = type === "mysql" ? `\`${table}\`` : `"${table}"`;

  let query = "";
  let needsReversing = false;
  if (cleanAgg === "none") {
    if (type === "sqlite") {
      const countRes = await conn.db.get(`SELECT COUNT(*) as count FROM "${table}"`);
      const total = countRes ? countRes.count : 0;
      if (total > 1000) {
        const step = Math.floor(total / 1000);
        query = `SELECT ${selectStr} FROM "${table}" WHERE rowid % ${step} = 0 LIMIT 1000`;
      } else {
        query = `SELECT ${selectStr} FROM "${table}" LIMIT 1000`;
      }
    } else {
      // Postgres and MySQL: use PK index if available to avoid filesort
      const pk = await getPrimaryKey(conn, type, table);
      if (pk) {
        const orderCol = type === "mysql" ? `\`${pk}\`` : `"${pk}"`;
        query = `SELECT ${selectStr} FROM ${tableExpr} ORDER BY ${orderCol} DESC LIMIT 1000`;
        needsReversing = true;
      } else {
        // No PK (e.g. a VIEW) — skip ORDER BY to avoid full-table scan/sort
        query = `SELECT ${selectStr} FROM ${tableExpr} LIMIT 1000`;
        needsReversing = false;
      }
    }
  } else {
    query = `SELECT ${selectStr} FROM ${tableExpr} GROUP BY ${selectX} ORDER BY ${selectX} DESC LIMIT 1000`;
    needsReversing = true;
  }

  let dbRows = [];
  if (type === "mysql") {
    const result = await conn.pool.query(query);
    dbRows = result[0];
  } else if (type === "sqlite") {
    dbRows = await conn.db.all(query);
  } else if (type === "postgres") {
    const result = await conn.pool.query(query);
    dbRows = result.rows;
  }

  if (needsReversing && dbRows && dbRows.length > 0) {
    dbRows.reverse();
  }

  return dbRows.map(r => {
    const xVal = r.xField !== undefined ? r.xField : r.xfield;
    const rowObj = {
      [xField]: xVal
    };
    yFields.forEach((yf, i) => {
      const val = r[`yField_${i}`] !== undefined ? r[`yField_${i}`] : r[`yfield_${i}`];
      rowObj[yf] = val !== null && val !== undefined ? Number(val) : null;
    });
    return rowObj;
  });
}

