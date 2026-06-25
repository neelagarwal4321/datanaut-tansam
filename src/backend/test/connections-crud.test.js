import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

async function createTestConn() {
  const res = await request(app)
    .post("/api/connections")
    .send({ type: "sql", config: { type: "sqlite", filename: ":memory:", name: "Test DB" } });
  return res.body.id;
}

// Task 8: GET /connections/:id
test("GET /api/connections/:id returns single connection", async () => {
  const id = await createTestConn();
  assert.ok(id, "createTestConn must return an id");

  const res = await request(app).get(`/api/connections/${id}`).expect(200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.connection.id, id);
  assert.equal(res.body.connection.type, "sql");
  assert.equal(res.body.connection.config?.name, "Test DB");
  assert.equal(res.body.connection.config?.password, undefined, "must not expose credentials");

  await request(app).delete(`/api/connections/${id}`);
});

test("GET /api/connections/:id returns 404 for unknown id", async () => {
  const res = await request(app).get("/api/connections/nonexistent-id-xyz").expect(404);
  assert.equal(res.body.success, false);
});

// Task 9: PUT /connections/:id
test("PUT /api/connections/:id replaces connection and preserves id", async () => {
  const id = await createTestConn();
  assert.ok(id);

  const res = await request(app)
    .put(`/api/connections/${id}`)
    .send({ type: "sql", config: { type: "sqlite", filename: ":memory:", name: "Replaced DB" } })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.id, id, "id must be preserved after replace");

  const getRes = await request(app).get(`/api/connections/${id}`).expect(200);
  assert.equal(getRes.body.connection.config.name, "Replaced DB");

  await request(app).delete(`/api/connections/${id}`);
});

test("PUT /api/connections/:id returns 400 when type missing", async () => {
  const id = await createTestConn();
  const res = await request(app)
    .put(`/api/connections/${id}`)
    .send({ config: { filename: ":memory:" } })
    .expect(400);
  assert.equal(res.body.success, false);
  await request(app).delete(`/api/connections/${id}`);
});

test("PUT /api/connections/:id returns 404 for unknown id", async () => {
  const res = await request(app)
    .put("/api/connections/does-not-exist-xyz")
    .send({ type: "sql", config: { type: "sqlite", filename: ":memory:" } })
    .expect(404);
  assert.equal(res.body.success, false);
});
