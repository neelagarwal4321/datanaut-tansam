import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

async function createChart() {
  const res = await request(app)
    .post("/api/charts")
    .send({ title: "PATCH Test", type: "line" });
  return res.body.chart;
}

test("PATCH /api/charts/:id updates only supplied fields", async () => {
  const chart = await createChart();

  const res = await request(app)
    .patch(`/api/charts/${chart.id}`)
    .send({ title: "Patched Title" })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.chart.title, "Patched Title");
  assert.equal(res.body.chart.type, "line", "type must be preserved when not in patch");

  await request(app).delete(`/api/charts/${chart.id}`);
});

test("PATCH /api/charts/:id rejects invalid type", async () => {
  const chart = await createChart();

  const res = await request(app)
    .patch(`/api/charts/${chart.id}`)
    .send({ type: "not_a_real_chart_type" })
    .expect(400);

  assert.equal(res.body.success, false);
  assert.match(res.body.error, /type must be one of/);

  await request(app).delete(`/api/charts/${chart.id}`);
});

test("PATCH /api/charts/:id returns 404 for unknown id", async () => {
  const res = await request(app)
    .patch("/api/charts/chart_nonexistent_xyz")
    .send({ title: "X" })
    .expect(404);
  assert.equal(res.body.success, false);
});

test("PATCH /api/charts/:id preserves createdAt", async () => {
  const chart = await createChart();
  const originalCreatedAt = chart.createdAt;

  const res = await request(app)
    .patch(`/api/charts/${chart.id}`)
    .send({ title: "No createdAt change", createdAt: "1970-01-01T00:00:00.000Z" })
    .expect(200);

  assert.equal(res.body.chart.createdAt, originalCreatedAt, "createdAt must be immutable");

  await request(app).delete(`/api/charts/${chart.id}`);
});
