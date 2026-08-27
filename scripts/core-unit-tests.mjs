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
assert.equal(
  typeof workbookFormats.parsePlateImageRecordMatrix,
  "function",
  "Plate image record workbook adapter should be available"
);
assert.equal(
  typeof workbookFormats.parsePlateTextRecordMatrix,
  "function",
  "Plate text record workbook adapter should be available"
);
assert.equal(
  typeof workbookFormats.extractPlateImageRecordImages,
  "function",
  "Plate image record image extractor should be available"
);

const plateImageRecordMatrix = [
  ["合成牌照辨識報表"],
  [
    "順序",
    "牌照號碼",
    "牌照圖檔",
    "日期時間",
    "建置期別/埠",
    "行經道路位置",
    "分局",
    "派出所",
    "座標"
  ],
  ["7", "SYN-9001", "", "115/08/04 06:10:00", "ignored-a", "synthetic-road-a", "ignored-b", "ignored-c", "25.040000, 121.520000"],
  [],
  ["8", "SYN-9001", "", "115/08/04 06:40:00", "ignored-d", "synthetic-road-b", "ignored-e", "ignored-f", "(121.521000 / 25.041000)"]
];

const plateImageAdapted = workbookFormats.parsePlateImageRecordMatrix(plateImageRecordMatrix);
assert.deepEqual(plateImageAdapted.rowIndexes, [2, 4]);
assert.equal(plateImageAdapted.rows.length, 2);
assert.deepEqual(Object.keys(plateImageAdapted.rows[0]), [
  "順序",
  "牌照號碼",
  "牌照圖檔",
  "日期時間",
  "行經道路位置",
  "座標"
]);
assert.equal(plateImageAdapted.rows[0]["順序"], "7");
assert.equal(plateImageAdapted.rows[0]["行經道路位置"], "synthetic-road-a");
assert.equal("建置期別/埠" in plateImageAdapted.rows[0], false);
assert.equal("分局" in plateImageAdapted.rows[0], false);
assert.equal("派出所" in plateImageAdapted.rows[0], false);
assert.equal(
  workbookFormats.parsePlateImageRecordMatrix([["not", "a", "plate", "image", "record"]]),
  null
);

const beyondPlateImageHeaderScanLimit = Array.from({ length: 20 }, (_, index) => [index]);
beyondPlateImageHeaderScanLimit.push(
  ["順序", "牌照號碼", "牌照圖檔", "日期時間", "行經道路位置", "座標"],
  ["1", "SYN-9001", "", "115/08/04 06:10:00", "synthetic-road", "25.04, 121.52"]
);
assert.equal(
  workbookFormats.parsePlateImageRecordMatrix(beyondPlateImageHeaderScanLimit),
  null,
  "Plate image headers after the first 20 rows should not be adapted"
);

assert.equal(detectDatasetFormat(plateImageAdapted.rows), "plate_image_record");
const plateImageColumns = detectColumns(plateImageAdapted.rows);
assert.equal(plateImageColumns.id, "順序");
assert.equal(plateImageColumns.plate, "牌照號碼");
assert.equal(plateImageColumns.image, "牌照圖檔");
assert.equal(plateImageColumns.timestamp, "日期時間");
assert.equal(plateImageColumns.note, "行經道路位置");
assert.equal(plateImageColumns.coord, "座標");
assert.equal(plateImageColumns.source, undefined);

plateImageAdapted.rows[0]["牌照圖檔"] = "blob:synthetic-image-a";
plateImageAdapted.rows[1]["牌照圖檔"] = "blob:synthetic-image-b";
const plateImageNormalized = normalizeRows(plateImageAdapted.rows);
assert.equal(plateImageNormalized.length, 2);
assert.equal(plateImageNormalized[0].id, 7);
assert.equal(plateImageNormalized[0].plate_norm, "SYN9001");
assert.equal(plateImageNormalized[0].timestamp.getFullYear(), 2026);
assert.equal(plateImageNormalized[0].source, "未提供");
assert.equal(plateImageNormalized[0].note, "synthetic-road-a");
assert.equal(plateImageNormalized[0].lon, 121.52);
assert.equal(plateImageNormalized[0].lat, 25.04);
assert.equal(plateImageNormalized[0].image_url, "blob:synthetic-image-a");

const plateImageResult = analyzeRecords(plateImageAdapted.rows, { normalDrivingSpeedKmh: 40 });
assert.equal(plateImageResult.summary.cleaning_skipped, false);
assert.equal(plateImageResult.map.track.length, 2);
assert.equal(plateImageResult.map.track[0].image_url, "blob:synthetic-image-a");
assert.equal(plateImageResult.map.track[1].image_url, "blob:synthetic-image-b");
assert.equal(JSON.stringify(plateImageResult.exports).includes("blob:synthetic-image"), false);

const plateTextRecordMatrix = [
  ["合成牌照文字報表"],
  [],
  [
    "順序",
    "牌照號碼",
    "日期時間",
    "建置期別/埠",
    "行經道路位置",
    "分局",
    "派出所",
    "座標"
  ],
  ["11", "TXT-9001", "115/08/06 07:10:00", "ignored-a", "synthetic-road-a", "ignored-b", "ignored-c", "25.050000, 121.530000"],
  [],
  ["12", "TXT-9001", "115/08/06 07:40:00", "ignored-d", "synthetic-road-b", "ignored-e", "ignored-f", "(121.531000 / 25.051000)"]
];

const plateTextRows = workbookFormats.parsePlateTextRecordMatrix(plateTextRecordMatrix);
assert.equal(plateTextRows.length, 2);
assert.deepEqual(Object.keys(plateTextRows[0]), [
  "順序",
  "牌照號碼",
  "日期時間",
  "行經道路位置",
  "座標"
]);
assert.equal(plateTextRows[0]["順序"], "11");
assert.equal(plateTextRows[0]["行經道路位置"], "synthetic-road-a");
assert.equal("建置期別/埠" in plateTextRows[0], false);
assert.equal("分局" in plateTextRows[0], false);
assert.equal("派出所" in plateTextRows[0], false);
assert.equal("牌照圖檔" in plateTextRows[0], false);
assert.equal(
  workbookFormats.parsePlateTextRecordMatrix([["not", "a", "plate", "text", "record"]]),
  null
);
assert.equal(
  workbookFormats.parsePlateTextRecordMatrix(plateImageRecordMatrix),
  null,
  "Plate image workbooks should not be adapted as plate text records"
);

const beyondPlateTextHeaderScanLimit = Array.from({ length: 20 }, (_, index) => [index]);
beyondPlateTextHeaderScanLimit.push(
  ["順序", "牌照號碼", "日期時間", "行經道路位置", "座標"],
  ["1", "TXT-9001", "115/08/06 07:10:00", "synthetic-road", "25.05, 121.53"]
);
assert.equal(
  workbookFormats.parsePlateTextRecordMatrix(beyondPlateTextHeaderScanLimit),
  null,
  "Plate text headers after the first 20 rows should not be adapted"
);

assert.equal(detectDatasetFormat(plateTextRows), "plate_text_record");
const plateTextColumns = detectColumns(plateTextRows);
assert.equal(plateTextColumns.id, "順序");
assert.equal(plateTextColumns.plate, "牌照號碼");
assert.equal(plateTextColumns.image, undefined);
assert.equal(plateTextColumns.timestamp, "日期時間");
assert.equal(plateTextColumns.note, "行經道路位置");
assert.equal(plateTextColumns.coord, "座標");
assert.equal(plateTextColumns.source, undefined);

const plateTextNormalized = normalizeRows(plateTextRows);
assert.equal(plateTextNormalized.length, 2);
assert.equal(plateTextNormalized[0].id, 11);
assert.equal(plateTextNormalized[0].plate_norm, "TXT9001");
assert.equal(plateTextNormalized[0].timestamp.getFullYear(), 2026);
assert.equal(plateTextNormalized[0].source, "未提供");
assert.equal(plateTextNormalized[0].note, "synthetic-road-a");
assert.equal(plateTextNormalized[0].lon, 121.53);
assert.equal(plateTextNormalized[0].lat, 25.05);
assert.equal(Object.prototype.hasOwnProperty.call(plateTextNormalized[0], "image_url"), false);

const plateTextResult = analyzeRecords(plateTextRows, { normalDrivingSpeedKmh: 40 });
assert.equal(plateTextResult.summary.cleaning_skipped, false);
assert.equal(plateTextResult.map.track.length, 2);
assert.equal(
  plateTextResult.map.track.some((row) => Object.prototype.hasOwnProperty.call(row, "image_url")),
  false
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
    SheetNames: ["plate-text"],
    Sheets: {
      "plate-text": {
        name: "plate-text",
        matrix: plateTextRecordMatrix,
        rows: [{ legacy: "should-not-run" }]
      }
    }
  };
  sheetToJsonCalls = [];
  const parsedPlateTextWorkbook = await parseWorkbookArrayBuffer(new ArrayBuffer(0));
  assert.deepEqual(parsedPlateTextWorkbook, plateTextRows);
  assert.deepEqual(sheetToJsonCalls, [{ sheet: "plate-text", matrix: true }]);

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

const anonymousCoordinateRowsA = [
  {
    "編號": "1",
    "時間": "115/08/12 08:00:00",
    "來源": "anonymous-unit-a",
    "備註": "synthetic-anonymous-a",
    "經緯度": "25.040000, 121.520000"
  },
  {
    "編號": "2",
    "時間": "115/08/12 08:30:00",
    "來源": "anonymous-unit-b",
    "備註": "synthetic-anonymous-b",
    "經緯度": "25.041000 121.521000"
  }
];
const anonymousCoordinateRowsB = [
  {
    "編號": "1",
    "時間": "115/08/12 09:00:00",
    "來源": "anonymous-unit-c",
    "備註": "synthetic-anonymous-c",
    "經緯度": "(121.522000 / 25.042000)"
  },
  {
    "編號": "2",
    "時間": "115/08/12 09:30:00",
    "來源": "anonymous-unit-d",
    "備註": "synthetic-anonymous-d",
    "經緯度": "121.523000,25.043000"
  }
];

assert.equal(detectDatasetFormat(anonymousCoordinateRowsA), "anonymous_coordinate_record");
const anonymousNormalized = normalizeRows(anonymousCoordinateRowsA);
assert.equal(anonymousNormalized.length, 2);
assert.equal(anonymousNormalized[0].plate, "未提供");
assert.equal(anonymousNormalized[0].plate_norm, "未提供");
assert.equal(anonymousNormalized[0].timestamp.getFullYear(), 2026);
assert.equal(anonymousNormalized[0].lon, 121.52);
assert.equal(anonymousNormalized[0].lat, 25.04);
assert.equal(Object.hasOwn(anonymousNormalized[0], "image_url"), false);

const anonymousSingleResult = analyzeRecords(anonymousCoordinateRowsA, { normalDrivingSpeedKmh: 40 });
assert.equal(anonymousSingleResult.summary.cleaning_skipped, false);
assert.equal(anonymousSingleResult.summary.raw_records, anonymousCoordinateRowsA.length);
assert.equal(anonymousSingleResult.map.track.length, anonymousCoordinateRowsA.length);

const anonymousMergedRows = [...anonymousCoordinateRowsA, ...anonymousCoordinateRowsB];
const anonymousMergedResult = analyzeRecords(anonymousMergedRows, { normalDrivingSpeedKmh: 40 });
assert.equal(anonymousMergedResult.summary.raw_records, anonymousMergedRows.length);
assert.equal(anonymousMergedResult.summary.clean_records, anonymousMergedRows.length);
assert.equal(anonymousMergedResult.map.track.length, anonymousMergedRows.length);
assert.equal(anonymousMergedResult.summary.plate_display, "未提供");

const genericRowsWithoutPlate = [
  {
    "時間戳": "2026-08-12 08:00:00",
    "經度": "121.52",
    "緯度": "25.04"
  }
];
assert.equal(detectDatasetFormat(genericRowsWithoutPlate), "generic");
assert.throws(() => normalizeRows(genericRowsWithoutPlate), /缺少必要欄位/);

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

const skipCsvResult = analyzeRecords(irentRows, { normalDrivingSpeedKmh: 40, skipCsvExports: true });
assert.equal(skipCsvResult.exports.stay_csv, "");
assert.equal(skipCsvResult.exports.hotspot_csv, "");
assert.equal(skipCsvResult.exports.validation_csv, "");

console.log("PASS core-unit-tests");
