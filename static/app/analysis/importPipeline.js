import {
  analyzeRecords,
  detectDatasetFormat,
  normalizeRows,
  parseWorkbookArrayBuffer
} from "./core.js?v=20260827b";
import { LARGE_IMPORT_FILE_BYTES } from "../shared/constants.js?v=20260827b";

function fileByteLength(file) {
  if (Number.isFinite(file?.size)) return Number(file.size);
  return Number(file?.buffer?.byteLength || 0);
}

export async function importWorkbooks(files, analysisOptions = {}, onProgress = () => {}) {
  const sourceFiles = Array.isArray(files) ? files : [];
  const fileCount = sourceFiles.length;
  if (!fileCount) {
    throw new Error("請先選擇至少 1 個檔案。");
  }

  const largeFile = sourceFiles.some((file) => fileByteLength(file) > LARGE_IMPORT_FILE_BYTES);
  const mergedNormalizedRows = [];
  const datasetFormats = [];
  const plateImageJobs = [];

  for (let index = 0; index < sourceFiles.length; index += 1) {
    const file = sourceFiles[index];
    const name = String(file?.name || `檔案 ${index + 1}`);
    onProgress({
      stage: "parse",
      fileIndex: index,
      fileCount,
      percent: Math.round((index / fileCount) * 55),
      message: `解析 Excel（${index + 1}/${fileCount}）：${name}`,
      largeFile
    });

    try {
      const meta = {};
      const rows = await parseWorkbookArrayBuffer(file.buffer, {
        attachPlateImages: false,
        meta
      });
      if (meta.plateImage) {
        plateImageJobs.push({
          buffer: file.buffer,
          name,
          sheetName: meta.plateImage.sheetName,
          rowIndexes: meta.plateImage.rowIndexes,
          orders: meta.plateImage.orders
        });
      }
      datasetFormats.push(detectDatasetFormat(rows));
      onProgress({
        stage: "normalize",
        fileIndex: index,
        fileCount,
        percent: Math.round(((index + 0.65) / fileCount) * 55),
        message: `正規化資料（${index + 1}/${fileCount}）`,
        largeFile
      });
      mergedNormalizedRows.push(...normalizeRows(rows));
    } catch (error) {
      throw new Error(`${name}：${error.message}`);
    }
  }

  if (mergedNormalizedRows.length < 2) {
    throw new Error("有效資料不足（至少需要 2 筆有效軌跡）。");
  }

  onProgress({
    stage: "analyze",
    fileIndex: fileCount,
    fileCount,
    percent: 72,
    message: "分析軌跡...",
    largeFile
  });

  const skipCleaning = datasetFormats.some((format) => format === "vehicle_recognition");
  const analysis = analyzeRecords(mergedNormalizedRows, {
    strictDistanceTeleport: Boolean(analysisOptions.strictDistanceTeleport),
    normalizedRows: mergedNormalizedRows,
    skipCleaning,
    skipCsvExports: true,
    normalDrivingSpeedKmh: analysisOptions.normalDrivingSpeedKmh
  });

  onProgress({
    stage: "render",
    fileIndex: fileCount,
    fileCount,
    percent: 88,
    message: "準備畫面...",
    largeFile
  });

  return {
    analysis,
    datasetFormats,
    plateImageJobs,
    skipCleaning
  };
}
