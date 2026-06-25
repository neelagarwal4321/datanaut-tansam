import connectionManager from '../connectionManager.js';

export async function updateHandler(req, res) {
  try {
    // Extract api_key (also support key or device_id)
    const api_key = req.query.api_key || 
                    (req.body ? req.body.api_key : undefined) || 
                    req.query.key || 
                    (req.body ? req.body.key : undefined) || 
                    req.query.device_id || 
                    (req.body ? req.body.device_id : undefined);
                    
    if (!api_key) {
      console.warn("⚠️ Received /update request but no api_key or device_id was provided.");
      return res.send("0"); // ThingSpeak returns 0 on failure
    }

    // Find a matching HTTP connection in ConnectionManager
    const connections = connectionManager.listConnections().filter(
      (conn) => conn.type === "http"
    );
    
    // Match by ID, apiKey config, or deviceId config
    const conn = connections.find(
      (c) =>
        c.id === api_key ||
        (c.config && c.config.apiKey === api_key) ||
        (c.config && c.config.deviceId === api_key) ||
        (c.config && c.config.name === api_key)
    );

    if (!conn) {
      console.warn(`⚠️ Received update request but no matching HTTP connection found for key/id: ${api_key}`);
      return res.send("0");
    }

    // Extract fields (field1 to field8) and status from request
    const fields = {};
    let hasData = false;

    // Check query params and request body for field1...field8
    for (let i = 1; i <= 8; i++) {
      const fieldKey = `field${i}`;
      const val = req.query[fieldKey] !== undefined ? req.query[fieldKey] : (req.body ? req.body[fieldKey] : undefined);
      if (val !== undefined && val !== null) {
        const num = Number(val);
        fields[fieldKey] = isNaN(num) ? val : num;
        hasData = true;
      }
    }

    // Also support custom parameter updates (like temperature, humidity) if sent as JSON
    const customParams = ['temperature', 'humidity', 'vibration', 'pressure', 'value'];
    customParams.forEach(param => {
      const val = req.query[param] !== undefined ? req.query[param] : (req.body ? req.body[param] : undefined);
      if (val !== undefined && val !== null) {
        const num = Number(val);
        fields[param] = isNaN(num) ? val : num;
        hasData = true;
      }
    });

    const statusVal = req.query.status || (req.body ? req.body.status : undefined);
    if (statusVal !== undefined && statusVal !== null) {
      fields.status = statusVal;
      hasData = true;
    }

    if (!hasData) {
      console.warn(`⚠️ Received push update for connection ${conn.id} but no data fields or status were found.`);
      return res.send("0");
    }

    // Initialize dataCache if needed
    const cacheKey = conn.config?.endpoint || "/update";
    if (!conn.dataCache) conn.dataCache = {};
    if (!conn.dataCache[cacheKey]) conn.dataCache[cacheKey] = [];

    // Create the flat data row
    const flatRow = {
      timestamp: new Date().toISOString(),
      endpoint: cacheKey,
      deviceId: conn.config?.deviceId || conn.id,
      apiKey: api_key,
      ...fields
    };

    // Push to cache
    conn.dataCache[cacheKey].push(flatRow);

    // Limit cache entries to avoid memory leak
    const EDA_LIMIT = 10000;
    if (conn.dataCache[cacheKey].length > EDA_LIMIT) {
      conn.dataCache[cacheKey] = conn.dataCache[cacheKey].slice(-EDA_LIMIT);
    }

    // Increment connection update count
    conn.count = (conn.count || 0) + 1;

    // Broadcast update to all WebSocket clients
    connectionManager.broadcastUpdate(conn.id, cacheKey, flatRow);

    console.log(`✅ Received local ThingSpeak Push for connection ${conn.id}:`, JSON.stringify(fields));

    // Return the total entry count in the feed (standard ThingSpeak response format)
    return res.send(String(conn.dataCache[cacheKey].length));
  } catch (err) {
    console.error("❌ Error in updateHandler:", err.message);
    return res.send("0");
  }
}
