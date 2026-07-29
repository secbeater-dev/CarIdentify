import assert from "node:assert/strict";

import {
  analyzeRecords,
  detectColumns,
  detectDatasetFormat,
  normalizeRows,
  parseWorkbookArrayBuffer
} from "../static/app/analysis/core.js";

let workbookFormats = {};
try {
  workbookFormats = await import("../static/app/analysis/workbookFormats.js");
} catch (error) {
  workbookFormats = {};
}

assert.equal(
  typeof workbookFormats.parseGpsRecordListMatrix,
  "function",
  "GPS record list workbook adapter should be available"
);

const gpsRecordMatrix = [
  ["記錄列表"],
  [],
  ["車牌：GPS-TEST-001 日期：2026/01/01"],
  [
    "定位時間 (3筆)",
    "定位位置",
    "地標名稱",
    "狀態",
    "時速(km/h)",
    "公里數",
    "方向",
    "經度",
    "緯度"
  ],
  ["2026/01/01 08:00:00", "synthetic-source-a", "synthetic-note-a", "正常", "0", "1", "北", "121.500000", "25.000000"],
  ["2026/01/01 08:30:00", "synthetic-source-b", "synthetic-note-b", "正常", "0", "2", "北", "121.501000", "25.001000"],
  ["2026/01/01 09:00:00", "synthetic-source-c", "synthetic-note-c", "正常", "0", "3", "北", "121.502000", "25.002000"]
];

const gpsRows = workbookFormats.parseGpsRecordListMatrix(gpsRecordMatrix);
assert.equal(gpsRows.length, 3);
assert.deepEqual(Object.keys(gpsRows[0]), ["車號", "定位時間", "定位位置", "地標名稱", "經度", "緯度"]);
assert.equal(gpsRows[0]["車號"], "GPS-TEST-001");
assert.equal(gpsRows[0]["定位時間"], "2026/01/01 08:00:00");
assert.equal(gpsRows[0]["定位位置"], "synthetic-source-a");
assert.equal(gpsRows[0]["地標名稱"], "synthetic-note-a");
assert.equal(gpsRows[0]["經度"], "121.500000");
assert.equal(gpsRows[0]["緯度"], "25.000000");
assert.equal("狀態" in gpsRows[0], false);
assert.equal("時速(km/h)" in gpsRows[0], false);
assert.equal("公里數" in gpsRows[0], false);
assert.equal("方向" in gpsRows[0], false);

assert.equal(detectDatasetFormat(gpsRows), "gps_record_list");
const gpsNormalized = normalizeRows(gpsRows);
assert.equal(gpsNormalized.length, 3);
assert.equal(gpsNormalized[0].plate_norm, "GPSTEST001");
assert.equal(gpsNormalized[0].source, "synthetic-source-a");
assert.equal(gpsNormalized[0].note, "synthetic-note-a");
assert.equal(gpsNormalized[0].lon, 121.5);
assert.equal(gpsNormalized[0].lat, 25);
const gpsResult = analyzeRecords(gpsRows, { normalDrivingSpeedKmh: 40 });
assert.equal(gpsResult.summary.cleaning_skipped, false);
assert.equal(gpsResult.map.track.length, 3);

assert.equal(
  workbookFormats.parseGpsRecordListMatrix([["not", "a", "supported", "header"]]),
  null
);
assert.throws(
  () => workbookFormats.parseGpsRecordListMatrix([
    ["記錄列表"],
    [],
    ["日期：2026/01/01"],
    ["定位時間（1筆）", "定位位置", "地標名稱", "經度", "緯度"],
    ["2026/01/01 08:00:00", "synthetic-source", "synthetic-note", "121.5", "25"]
  ]),
  /GPS 記錄表缺少可辨識的車牌資訊/
);

const beyondGpsHeaderScanLimit = Array.from(
  { length: 20 },
  (_, index) => index === 0 ? ["車牌：GPS-LIMIT-001"] : []
);
beyondGpsHeaderScanLimit.push(
  ["定位時間（1筆）", "定位位置", "地標名稱", "經度", "緯度"],
  ["2026/01/01 08:00:00", "synthetic-source", "synthetic-note", "121.5", "25"]
);
assert.equal(
  workbookFormats.parseGpsRecordListMatrix(beyondGpsHeaderScanLimit),
  null,
  "GPS header rows after the first 20 rows should not be adapted"
);

const originalXlsx = globalThis.XLSX;
let syntheticWorkbook = null;
let sheetToJsonCalls = [];
globalThis.XLSX = {
  read() {
    return syntheticWorkbook;
  },
  utils: {
    sheet_to_json(sheet, options = {}) {
      sheetToJsonCalls.push({ sheet: sheet.name, matrix: options.header === 1 });
      return options.header === 1 ? sheet.matrix : sheet.rows;
    },
    decode_cell() {
      throw new Error("Synthetic worksheets should not need range recovery.");
    },
    decode_range() {
      throw new Error("Synthetic worksheets should not need range recovery.");
    },
    encode_range() {
      throw new Error("Synthetic worksheets should not need range recovery.");
    }
  }
};

try {
  syntheticWorkbook = {
    SheetNames: ["gps"],
    Sheets: {
      gps: {
        name: "gps",
        matrix: gpsRecordMatrix,
        rows: [{ legacy: "should-not-run" }]
      }
    }
  };
  sheetToJsonCalls = [];
  const parsedGpsWorkbook = await parseWorkbookArrayBuffer(new ArrayBuffer(0));
  assert.deepEqual(parsedGpsWorkbook, gpsRows);
  assert.deepEqual(sheetToJsonCalls, [{ sheet: "gps", matrix: true }]);

  const scanLimitFallbackRows = [{ legacy: "scan-limit-fallback" }];
  syntheticWorkbook = {
    SheetNames: ["beyond-limit"],
    Sheets: {
      "beyond-limit": {
        name: "beyond-limit",
        matrix: beyondGpsHeaderScanLimit,
        rows: scanLimitFallbackRows
      }
    }
  };
  sheetToJsonCalls = [];
  const parsedScanLimitWorkbook = await parseWorkbookArrayBuffer(new ArrayBuffer(0));
  assert.deepEqual(parsedScanLimitWorkbook, scanLimitFallbackRows);
  assert.deepEqual(sheetToJsonCalls, [
    { sheet: "beyond-limit", matrix: true },
    { sheet: "beyond-limit", matrix: false }
  ]);

  const fallbackRows = [
    {
      車號: "FALLBACK-001",
      時間: "2026/01/01 10:00:00",
      經度: "121.6",
      緯度: "25.1"
    }
  ];
  syntheticWorkbook = {
    SheetNames: ["empty", "legacy"],
    Sheets: {
      empty: {
        name: "empty",
        matrix: [["not", "gps"]],
        rows: []
      },
      legacy: {
        name: "legacy",
        matrix: [["車號", "時間", "經度", "緯度"]],
        rows: fallbackRows
      }
    }
  };
  sheetToJsonCalls = [];
  const parsedFallbackWorkbook = await parseWorkbookArrayBuffer(new ArrayBuffer(0));
  assert.deepEqual(parsedFallbackWorkbook, fallbackRows);
  assert.deepEqual(sheetToJsonCalls, [
    { sheet: "empty", matrix: true },
    { sheet: "empty", matrix: false },
    { sheet: "legacy", matrix: true },
    { sheet: "legacy", matrix: false }
  ]);
} finally {
  if (originalXlsx === undefined) {
    delete globalThis.XLSX;
  } else {
    globalThis.XLSX = originalXlsx;
  }
}

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

const splitCoordinateRows = [
  {
    "編號": "1",
    "車號": "BTQ-1234",
    "時間": "2026-01-01 08:00:00",
    "經度": "25.080329",
    "緯度": "121.698062",
    "來源": "unit-a",
    "備註": "split-a"
  },
  {
    "編號": "2",
    "車號": "BTQ-1234",
    "時間": "2026-01-01 08:30:00",
    "經度": "25.081",
    "緯度": "121.699",
    "來源": "unit-b",
    "備註": "split-b"
  }
];

const splitColumns = detectColumns(splitCoordinateRows);
assert.equal(splitColumns.coord, undefined);
assert.equal(splitColumns.lon, "經度");
assert.equal(splitColumns.lat, "緯度");
const splitResult = analyzeRecords(splitCoordinateRows, { normalDrivingSpeedKmh: 40 });
assert.equal(splitResult.summary.raw_records, 2);
assert.equal(splitResult.map.track[0].lon, 121.698062);
assert.equal(splitResult.map.track[0].lat, 25.080329);

const freewayRows = [
  {
    "車牌號碼": "BQM-1362",
    "eTag序號": "etag-a",
    "偵測日期": "2026-01-01 08:00:00",
    "門架名稱": "gate-a",
    "緯度": "25.080329",
    "經度": "121.698062",
    "公里數": "1",
    "行進方向": "N",
    "國道系統": "國1"
  },
  {
    "車牌號碼": "BQM-1362",
    "eTag序號": "etag-a",
    "偵測日期": "2026-01-01 08:30:00",
    "門架名稱": "gate-b",
    "緯度": "25.081",
    "經度": "121.699",
    "公里數": "2",
    "行進方向": "N",
    "國道系統": "國1"
  }
];

assert.equal(detectDatasetFormat(freewayRows), "vehicle_recognition");
const freewayColumns = detectColumns(freewayRows);
assert.equal(freewayColumns.coord, undefined);
assert.equal(freewayColumns.lon, "經度");
assert.equal(freewayColumns.lat, "緯度");
const freewayResult = analyzeRecords(freewayRows, { skipCleaning: true, normalDrivingSpeedKmh: 40 });
assert.equal(freewayResult.summary.cleaning_skipped, true);
assert.equal(freewayResult.map.track.length, 2);

const irentRows = [
  {
    "車號": "SYN-0001",
    "GPS時間": "1/1/2026 1:00:00 PM",
    "經度": "25.1000000",
    "緯度": "121.5000000"
  },
  {
    "車號": "SYN-0001",
    "GPS時間": "1/1/2026 1:00:30 PM",
    "經度": "25.1000000",
    "緯度": "121.5000000"
  },
  {
    "車號": "SYN-0001",
    "GPS時間": "1/1/2026 1:02:00 PM",
    "經度": "25.1001000",
    "緯度": "121.5001000"
  }
];

assert.equal(detectDatasetFormat(irentRows), "irent");
const irentColumns = detectColumns(irentRows);
assert.equal(irentColumns.timestamp, "GPS時間");
assert.equal(irentColumns.coord, undefined);
assert.equal(irentColumns.lon, "經度");
assert.equal(irentColumns.lat, "緯度");
const irentNormalized = normalizeRows(irentRows);
assert.equal(irentNormalized[0].lon, 25.1);
assert.equal(irentNormalized[0].lat, 121.5);
const irentResult = analyzeRecords(irentRows, { normalDrivingSpeedKmh: 40 });
assert.equal(irentResult.summary.coordinate_swapped_fixed, true);
assert.equal(irentResult.map.track[0].lon, 121.5);
assert.equal(irentResult.map.track[0].lat, 25.1);

console.log("PASS core-unit-tests");
