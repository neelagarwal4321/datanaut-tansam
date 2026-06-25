import mongoose from "mongoose";

function validateIdentifier(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_$]+$/.test(name)) {
    throw new Error(
      `Invalid identifier "${name}". Only letters, digits, underscores, and $ are allowed.`
    );
  }
  return name;
}

export async function createNoSqlConnection({ uri, database }) {
  if (!uri) {
    throw new Error("MongoDB connection URI is required.");
  }

  console.log(`Connecting to MongoDB at: ${uri}, DB: ${database || "default"}`);
  // Create connection instance without binding to global mongoose
  const conn = mongoose.createConnection(uri, {
    dbName: database || undefined,
    serverSelectionTimeoutMS: 5000 // fail fast if server offline
  });

  // Wait for open or timeout error
  await conn.asPromise();

  return {
    type: "nosql",
    dbType: "mongodb",
    connection: conn
  };
}

export async function testConnection(conn) {
  if (!conn || !conn.connection) {
    throw new Error("Invalid NoSQL connection object");
  }
  // Run admin ping command
  await conn.connection.db.admin().ping();
}

export async function closeConnection(conn) {
  if (conn && conn.connection) {
    await conn.connection.close();
    console.log(`✅ MongoDB connection closed`);
  }
}

export async function getCollections(conn) {
  if (!conn || !conn.connection) {
    throw new Error("Invalid NoSQL connection object");
  }
  const collections = await conn.connection.db.listCollections().toArray();
  return collections.map((c) => c.name);
}

export async function previewCollection(conn, collectionName, limit = 50) {
  if (!conn || !conn.connection) throw new Error("Invalid NoSQL connection object");
  validateIdentifier(collectionName);
  const collection = conn.connection.db.collection(collectionName);
  const docs = await collection.find({}).limit(limit).toArray();

  // Flatten nested objects and serialize ObjectId/Date fields for tabular display
  return docs.map((doc) => {
    const flat = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === "_id") {
        flat[k] = v.toString();
      } else if (v instanceof Date) {
        flat[k] = v.toISOString();
      } else if (typeof v === "object" && v !== null) {
        flat[k] = JSON.stringify(v);
      } else {
        flat[k] = v;
      }
    }
    return flat;
  });
}

export async function queryCollectionPaginated(conn, collectionName, { page = 1, limit = 50, search = "" }) {
  if (!conn || !conn.connection) throw new Error("Invalid NoSQL connection object");
  validateIdentifier(collectionName);
  const collection = conn.connection.db.collection(collectionName);
  const skip = (page - 1) * limit;

  // Build search filter: regex match on string-typed _id only.
  // For richer field-based search, add a $text index on the collection.
  const filter = search
    ? { _id: { $regex: search, $options: "i" } }
    : {};

  const totalRows = search
    ? await collection.countDocuments(filter)
    : await collection.estimatedDocumentCount();

  const docs = await collection.find(filter).skip(skip).limit(limit).toArray();

  const rows = docs.map((doc) => {
    const flat = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === "_id") {
        flat[k] = v.toString();
      } else if (v instanceof Date) {
        flat[k] = v.toISOString();
      } else if (typeof v === "object" && v !== null) {
        flat[k] = JSON.stringify(v);
      } else {
        flat[k] = v;
      }
    }
    return flat;
  });

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, totalRows, headers };
}

export async function queryCollectionAggregate(conn, collectionName, { xField, yField, aggregation = "none" }) {
  if (!conn || !conn.connection) throw new Error("Invalid NoSQL connection object");
  validateIdentifier(collectionName);
  validateIdentifier(xField);
  yField.split(",").forEach(validateIdentifier);
  const collection = conn.connection.db.collection(collectionName);
  const cleanAgg = aggregation.toLowerCase();
  const yFields = yField.split(",");

  if (cleanAgg === "none") {
    const projection = { [xField]: 1 };
    yFields.forEach(yf => { projection[yf] = 1; });
    const docs = await collection.find({}, { projection }).sort({ [xField]: -1 }).limit(1000).toArray();
    docs.reverse();
    return docs.map(d => {
      const rowObj = {
        [xField]: d[xField] !== undefined ? d[xField] : null
      };
      yFields.forEach(yf => {
        rowObj[yf] = d[yf] !== undefined && d[yf] !== null ? Number(d[yf]) : null;
      });
      return rowObj;
    });
  } else {
    const groupOp = {};
    yFields.forEach(yf => {
      if (cleanAgg === "sum") {
        groupOp[yf] = { $sum: `$${yf}` };
      } else if (cleanAgg === "avg" || cleanAgg === "average") {
        groupOp[yf] = { $avg: `$${yf}` };
      } else if (cleanAgg === "min") {
        groupOp[yf] = { $min: `$${yf}` };
      } else if (cleanAgg === "max") {
        groupOp[yf] = { $max: `$${yf}` };
      } else if (cleanAgg === "count") {
        groupOp[yf] = { $sum: 1 };
      }
    });

    // When xField === "_id", projecting { _id: 0, _id: "$_id" } is a key collision.
    // Use a different alias and remap after.
    const xAlias = xField === "_id" ? "__xField" : xField;
    const projectOp = { _id: 0, [xAlias]: "$_id" };
    yFields.forEach(yf => { projectOp[yf] = 1; });

    const pipeline = [
      { $group: { _id: `$${xField}`, ...groupOp } },
      { $project: projectOp },
      { $sort: { [xAlias]: -1 } },
      { $limit: 1000 }
    ];

    const result = await collection.aggregate(pipeline).toArray();
    result.reverse();
    return result.map(r => {
      const rowObj = { [xField]: r[xAlias] ?? r[xField] };
      yFields.forEach(yf => {
        rowObj[yf] = r[yf] !== undefined && r[yf] !== null ? Number(r[yf]) : null;
      });
      return rowObj;
    });
  }
}

