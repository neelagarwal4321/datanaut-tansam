import { test } from "node:test";
import assert from "node:assert/strict";
import { getDatasets, registerDataset, deleteDataset, updateDatasetMetadata } from "../modules/staticDb.js";

test("C2: getDatasets() does not return rowsPreview field", async () => {
  const datasets = await getDatasets();
  for (const ds of datasets) {
    assert.equal(ds.rowsPreview, undefined, `dataset ${ds.id} should not have rowsPreview`);
  }
});

test("updateDatasetMetadata: updates name and returns metadata", async () => {
  const id = `ds_test_${Date.now()}`;
  await registerDataset({
    id, name: "Original", sourceType: "csv",
    headers: ["a"], types: ["string"], rowCount: 0
  });

  const updated = await updateDatasetMetadata(id, { name: "Renamed" });
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.id, id);

  await deleteDataset(id);
});

test("updateDatasetMetadata: throws Dataset not found for unknown ID", async () => {
  await assert.rejects(
    () => updateDatasetMetadata("ds_does_not_exist_xyz", { name: "X" }),
    { message: "Dataset not found" }
  );
});
