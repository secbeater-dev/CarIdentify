import assert from "node:assert/strict";

import {
  analyzeRecords,
  detectColumns,
  detectDatasetFormat,
  normalizeRows
} from "../static/app/analysis/core.js";

const combinedCoordinateRows = [
  {
    "編號": "1",
    "車號": "ABC-1234",
    "時間": "2026-01-01 08:00:00",
    "來源": "unit-a",
    "備註": "synthetic-a",
    "經緯度": "121.500000, 25.000000"
  },
  {
    "編號": "2",
    "車號": "ABC-1234",
    "時間": "2026-01-01 08:30:00",
    "來源": "unit-b",
    "備註": "synthetic-b",
    "經緯度": "25.001000 121.501000"
  },
  {
    "編號": "3",
    "車號": "ABC-1234",
    "時間": "2026-01-01 09:00:00",
    "來源": "unit-c",
    "備註": "synthetic-c",
    "經緯度": "(121.502000 / 25.002000)"
  }
];

assert.equal(detectDatasetFormat(combinedCoordinateRows), "combined_coordinate");

const columns = detectColumns(combinedCoordinateRows);
assert.equal(columns.plate, "車號");
assert.equal(columns.timestamp, "時間");
assert.equal(columns.coord, "經緯度");
assert.equal(columns.lon, undefined);
assert.equal(columns.lat, undefined);

const normalized = normalizeRows(combinedCoordinateRows);
assert.equal(normalized.length, 3);
assert.equal(normalized[0].lon, 121.5);
assert.equal(normalized[0].lat, 25);
assert.equal(normalized[1].lon, 121.501);
assert.equal(normalized[1].lat, 25.001);
assert.equal(normalized[2].lon, 121.502);
assert.equal(normalized[2].lat, 25.002);

const result = analyzeRecords(combinedCoordinateRows, { normalDrivingSpeedKmh: 40 });
assert.equal(result.summary.cleaning_skipped, false);
assert.equal(result.summary.raw_records, 3);
assert.equal(result.summary.clean_records, 3);
assert.equal(result.map.track.length, 3);
assert.ok(result.stays.length >= 1);

console.log("PASS core-unit-tests");
