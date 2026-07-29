const GPS_RECORD_HEADERS = ["定位時間", "定位位置", "地標名稱", "經度", "緯度"];
const GPS_RECORD_HEADER_SCAN_LIMIT = 20;

function textValue(value) {
  return String(value ?? "").trim();
}

function canonicalizeGpsHeader(value) {
  const text = textValue(value);
  if (/^定位時間\s*[\(（]\s*\d+\s*筆\s*[\)）]$/.test(text)) {
    return "定位時間";
  }
  return text;
}

function findGpsHeaderRow(matrix) {
  const limit = Math.min(matrix.length, GPS_RECORD_HEADER_SCAN_LIMIT);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = Array.isArray(matrix[rowIndex])
      ? matrix[rowIndex].map(canonicalizeGpsHeader)
      : [];
    if (GPS_RECORD_HEADERS.every((header) => headers.includes(header))) {
      return rowIndex;
    }
  }
  return -1;
}

function extractGpsPlate(metadataRows) {
  for (const row of metadataRows) {
    for (const value of Array.isArray(row) ? row : []) {
      const match = textValue(value).match(/車牌(?:號碼)?\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{3,})/i);
      if (match) {
        return match[1].toUpperCase();
      }
    }
  }
  return "";
}

export function parseGpsRecordListMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return null;
  }

  const headerRowIndex = findGpsHeaderRow(matrix);
  if (headerRowIndex < 0) {
    return null;
  }

  const plate = extractGpsPlate(matrix.slice(0, headerRowIndex));
  if (!plate) {
    throw new Error("GPS 記錄表缺少可辨識的車牌資訊。");
  }

  const headers = matrix[headerRowIndex].map(canonicalizeGpsHeader);
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const getCell = (row, header) => row?.[columnIndex.get(header)] ?? "";

  return matrix
    .slice(headerRowIndex + 1)
    .filter((row) => {
      const timestamp = textValue(getCell(row, "定位時間"));
      const lon = textValue(getCell(row, "經度"));
      const lat = textValue(getCell(row, "緯度"));
      return Boolean(timestamp || lon || lat);
    })
    .map((row) => ({
      車號: plate,
      定位時間: getCell(row, "定位時間"),
      定位位置: getCell(row, "定位位置"),
      地標名稱: getCell(row, "地標名稱"),
      經度: getCell(row, "經度"),
      緯度: getCell(row, "緯度")
    }));
}
