import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

async function createTestChart() {
  const res = await request(app)
    .post("/api/charts")
    .send({ title: "Test Chart", type: "line" });
  return res.body.chart;
}

test("PUT /api/charts/:id rejects invalid type with 400", async () => {
  const chart = await createTestChart();
  const res = await request(app)
    .put(`/api/charts/${chart.id}`)
    .send({ title: "Updated", type: "xss_attempt" })
    .expect(400);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /type must be one of/);
  await request(app).delete(`/api/charts/${chart.id}`);
});

test("PUT /api/charts/:id accepts valid type", async () => {
  const chart = await createTestChart();
  const res = await request(app)
    .put(`/api/charts/${chart.id}`)
    .send({ title: "Updated", type: "bar" })
    .expect(200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.chart.type, "bar");
  await request(app).delete(`/api/charts/${chart.id}`);
});

test("PUT /api/charts/:id with no type field does not reject", async () => {
  const chart = await createTestChart();
  const res = await request(app)
    .put(`/api/charts/${chart.id}`)
    .send({ title: "Title Only" })
    .expect(200);
  assert.equal(res.body.success, true);
  await request(app).delete(`/api/charts/${chart.id}`);
});
