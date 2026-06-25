import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import http, { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import routes from "./routes.js";
import connectionManager from "./connectionManager.js";
import chartsStorage from "./chartsStorage.js";
import { updateHandler } from "./modules/thingSpeak.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8085;

// CORS — restrict to known origin in production; allow all in dev
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin ? corsOrigin.split(",").map(s => s.trim()) : true,
  credentials: true,
}));

app.use(bodyParser.json({ limit: "2mb" }));

// General rate limit — 200 requests / minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests — slow down." },
});

// Strict rate limit for mutating endpoints (upload, add-connection)
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Rate limit exceeded for write operations." },
});

app.use("/api", generalLimiter);
app.use("/api/datasets/upload", strictLimiter);
app.post("/api/connections", strictLimiter);

app.use("/api", routes);
app.use("/update", updateHandler);
app.get("/status", (_req, res) =>
  res.json({ server: "Unified Multi-Protocol Server", status: "running" }));

// Proxy to Vite Dev Server (port 5173) when running in dev mode
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/status") || req.path.startsWith("/update")) {
    return next();
  }

  const proxyReq = http.request(
    { hostname: "localhost", port: 5173, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );
  proxyReq.on("error", () => next());
  req.pipe(proxyReq, { end: true });
});

// Production: serve built frontend from dist/
app.use(express.static(path.join(__dirname, "../../dist")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/status")) return next();
  res.sendFile(path.join(__dirname, "../../dist/index.html"));
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

connectionManager.setWebSocketServer(wss);

wss.on("connection", (ws, req) => {
  // Require API key on WS upgrade when API_SECRET is configured.
  const API_SECRET = process.env.API_SECRET;
  if (API_SECRET) {
    const params = new URL(req.url, `http://localhost`).searchParams;
    const key = req.headers["x-api-key"] ?? params.get("api_key");
    if (!key || key !== API_SECRET) {
      ws.close(1008, "Unauthorized");
      return;
    }
  }
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("close", () => {});
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(heartbeatInterval));

// Await persistent state restoration before accepting traffic.
await Promise.all([connectionManager._ready, chartsStorage._ready]);

httpServer.listen(PORT, () => {
  console.log(`🚀 Unified Multi-Protocol Server running on port ${PORT}`);
});
