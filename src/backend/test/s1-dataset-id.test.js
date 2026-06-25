import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

const INJECTION_IDS = [
  "x'; DROP TABLE datasets_metadata;--",
  "../../../etc/passwd",
  "ds_valid; DROP TABLE x",
  "ds_ok UNION SELECT 1",
];

const VALID_ID = "ds_nonexistent_abc123";

for (const badId of INJECTION_IDS) {
  test(`rejects injected dataset ID "${badId.slice(0, 30)}" with 400`, async () => {
    const res = await request(app)
      .get(`/api/datasets/${encodeURIComponent(badId)}/data`)
      .expect(400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /Invalid dataset ID/);
  });
}

test("valid-format ds_ ID passes validation (404, not 400)", async () => {
  const res = await request(app).get(`/api/datasets/${VALID_ID}/data`);
  assert.equal(res.body.success, false);
  assert.doesNotMatch(res.body.error ?? "", /Invalid dataset ID/);
  // 404 means it passed validation but dataset not found — correct
});

test("DELETE /api/datasets/:id rejects injected ID with 400", async () => {
  const res = await request(app)
    .delete("/api/datasets/x';DROP TABLE x;--")
    .expect(400);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /Invalid dataset ID/);
});
