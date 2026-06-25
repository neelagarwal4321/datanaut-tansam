import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

test("GET /api/connections returns success shape", async () => {
  const res = await request(app).get("/api/connections").expect(200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.connections));
});

test("GET /api/charts returns success shape", async () => {
  const res = await request(app).get("/api/charts").expect(200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.charts));
});
