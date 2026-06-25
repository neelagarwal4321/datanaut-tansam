import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

// New routes must exist (non-404)
test("POST /api/connections exists (replaces /api/add-connection)", async () => {
  const res = await request(app)
    .post("/api/connections")
    .send({ type: "sql", config: { type: "sqlite", filename: "/nonexistent/path.db" } });
  assert.notEqual(res.status, 404, "POST /api/connections must not 404");
  assert.equal(typeof res.body.success, "boolean");
});

test("DELETE /api/connections/:id exists (replaces /api/remove-connection/:id)", async () => {
  const res = await request(app).delete("/api/connections/nonexistent-id");
  assert.notEqual(res.status, 404, "DELETE /api/connections/:id must not 404");
  assert.equal(typeof res.body.success, "boolean");
});

test("POST /api/presentations/launch exists (replaces /api/launch-presentations)", async () => {
  const res = await request(app)
    .post("/api/presentations/launch")
    .send({ presentations: [] });
  assert.notEqual(res.status, 404, "POST /api/presentations/launch must not 404");
});

// Old routes must NOT exist (404)
test("POST /api/add-connection is gone (404)", async () => {
  const res = await request(app).post("/api/add-connection").send({});
  assert.equal(res.status, 404);
});

test("DELETE /api/remove-connection/:id is gone (404)", async () => {
  const res = await request(app).delete("/api/remove-connection/any");
  assert.equal(res.status, 404);
});

test("POST /api/launch-presentations is gone (404)", async () => {
  const res = await request(app).post("/api/launch-presentations").send({});
  assert.equal(res.status, 404);
});
