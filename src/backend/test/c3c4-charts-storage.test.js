import { test } from "node:test";
import assert from "node:assert/strict";
import chartsStorage from "../chartsStorage.js";

test("C4: update() preserves original createdAt regardless of payload", async () => {
  const created = await chartsStorage.create({ title: "C4 Test", type: "bar" });
  const originalCreatedAt = created.createdAt;

  const updated = await chartsStorage.update(created.id, {
    title: "Updated",
    type: "line",
    createdAt: "1970-01-01T00:00:00.000Z"
  });

  assert.equal(updated.createdAt, originalCreatedAt, "createdAt must not change");
  assert.notEqual(updated.updatedAt, originalCreatedAt, "updatedAt must change");

  await chartsStorage.delete(created.id);
});

test("C3: concurrent writes serialize without corruption", async () => {
  const created = await chartsStorage.create({ title: "C3 Test", type: "bar" });

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      chartsStorage.update(created.id, { title: `Concurrent ${i}`, type: "bar" })
    )
  );

  const final = await chartsStorage.get(created.id);
  assert.ok(final, "chart must still exist after concurrent writes");
  assert.ok(final.title.startsWith("Concurrent"), "title should be one of the concurrent updates");

  await chartsStorage.delete(created.id);
});
