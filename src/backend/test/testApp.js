import express from "express";
import bodyParser from "body-parser";
import routes from "../routes.js";

// Stripped-down app for supertest — no rate limiting, no listener.
// API_SECRET is unset in test env so requireApiKey middleware passes through.
const app = express();
app.use(bodyParser.json());
app.use("/api", routes);

export default app;
