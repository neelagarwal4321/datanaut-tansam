import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "./testApp.js";

test("GET /api/nosql/preview/:id without collection returns 400 not 500", async () => {
  const res = await request(app)
    .get("/api/nosql/preview/any-connection-id")
    .expect(400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, "collection is required");
});

test("GET /api/nosql/preview/:id with collection param proceeds past param validation", async () => {
  const res = await request(app)
    .get("/api/nosql/preview/nonexistent?collection=users");
  assert.equal(res.body.success, false);
  assert.notEqual(res.body.error, "collection is required");
});
