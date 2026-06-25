import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";
import { registerDataset, deleteDataset } from "../modules/staticDb.js";

async function createTestDataset() {
  const id = `ds_test_${Date.now()}`;
  await registerDataset({ id, name: "Original Name", sourceType: "csv", headers: ["x"], types: ["number"], rowCount: 0 });
  return id;
}

test("PUT /api/datasets/:id updates dataset name", async () => {
  const id = await createTestDataset();

  const res = await request(app)
    .put(`/api/datasets/${id}`)
    .send({ name: "Renamed Dataset" })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.dataset.name, "Renamed Dataset");
  assert.equal(res.body.dataset.id, id);

  await deleteDataset(id);
});

test("PUT /api/datasets/:id returns 400 when name missing", async () => {
  const id = await createTestDataset();

  const res = await request(app)
    .put(`/api/datasets/${id}`)
    .send({})
    .expect(400);

  assert.equal(res.body.success, false);
  await deleteDataset(id);
});

test("PUT /api/datasets/:id returns 404 for unknown id", async () => {
  const res = await request(app)
    .put("/api/datasets/ds_nonexistent_xyz")
    .send({ name: "X" })
    .expect(404);
  assert.equal(res.body.success, false);
});

test("PUT /api/datasets/:id rejects injected ID with 400", async () => {
  const res = await request(app)
    .put("/api/datasets/x';DROP TABLE x;--")
    .send({ name: "X" })
    .expect(400);
  assert.match(res.body.error, /Invalid dataset ID/);
});
