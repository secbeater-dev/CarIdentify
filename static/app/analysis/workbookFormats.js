const GPS_RECORD_HEADERS = ["定位時間", "定位位置", "地標名稱", "經度", "緯度"];
const GPS_RECORD_HEADER_SCAN_LIMIT = 20;
const PLATE_IMAGE_RECORD_HEADERS = ["順序", "牌照號碼", "牌照圖檔", "日期時間", "行經道路位置", "座標"];
const PLATE_IMAGE_RECORD_HEADER_SCAN_LIMIT = 20;
const PLATE_TEXT_RECORD_HEADERS = ["順序", "牌照號碼", "日期時間", "行經道路位置", "座標"];
const PLATE_TEXT_RECORD_HEADER_SCAN_LIMIT = 20;
const PLATE_IMAGE_MAX_COUNT = 5000;
const PLATE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PLATE_IMAGE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const OOXML_RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

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

function findPlateImageHeaderRow(matrix) {
  const limit = Math.min(matrix.length, PLATE_IMAGE_RECORD_HEADER_SCAN_LIMIT);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = Array.isArray(matrix[rowIndex])
      ? matrix[rowIndex].map(textValue)
      : [];
    if (PLATE_IMAGE_RECORD_HEADERS.every((header) => headers.includes(header))) {
      return rowIndex;
    }
  }
  return -1;
}

export function parsePlateImageRecordMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return null;
  }

  const headerRowIndex = findPlateImageHeaderRow(matrix);
  if (headerRowIndex < 0) {
    return null;
  }

  const headers = matrix[headerRowIndex].map(textValue);
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const getCell = (row, header) => row?.[columnIndex.get(header)] ?? "";
  const rows = [];
  const rowIndexes = [];

  matrix.slice(headerRowIndex + 1).forEach((row, offset) => {
    const hasRecord = ["順序", "牌照號碼", "日期時間", "行經道路位置", "座標"]
      .some((header) => textValue(getCell(row, header)) !== "");
    if (!hasRecord) return;

    rows.push({
      順序: getCell(row, "順序"),
      牌照號碼: getCell(row, "牌照號碼"),
      牌照圖檔: getCell(row, "牌照圖檔"),
      日期時間: getCell(row, "日期時間"),
      行經道路位置: getCell(row, "行經道路位置"),
      座標: getCell(row, "座標")
    });
    rowIndexes.push(headerRowIndex + 1 + offset);
  });

  return { rows, rowIndexes };
}

function findPlateTextHeaderRow(matrix) {
  const limit = Math.min(matrix.length, PLATE_TEXT_RECORD_HEADER_SCAN_LIMIT);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = Array.isArray(matrix[rowIndex])
      ? matrix[rowIndex].map(textValue)
      : [];
    if (
      !headers.includes("牌照圖檔")
      && PLATE_TEXT_RECORD_HEADERS.every((header) => headers.includes(header))
    ) {
      return rowIndex;
    }
  }
  return -1;
}

export function parsePlateTextRecordMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return null;
  }

  const headerRowIndex = findPlateTextHeaderRow(matrix);
  if (headerRowIndex < 0) {
    return null;
  }

  const headers = matrix[headerRowIndex].map(textValue);
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const getCell = (row, header) => row?.[columnIndex.get(header)] ?? "";

  return matrix
    .slice(headerRowIndex + 1)
    .filter((row) => PLATE_TEXT_RECORD_HEADERS.some(
      (header) => textValue(getCell(row, header)) !== ""
    ))
    .map((row) => ({
      順序: getCell(row, "順序"),
      牌照號碼: getCell(row, "牌照號碼"),
      日期時間: getCell(row, "日期時間"),
      行經道路位置: getCell(row, "行經道路位置"),
      座標: getCell(row, "座標")
    }));
}

function normalizePackagePath(value) {
  const segments = String(value ?? "").replaceAll("\\", "/").split("/");
  const output = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join("/");
}

function resolvePackageTarget(sourcePart, target) {
  const rawTarget = String(target ?? "").trim();
  if (!rawTarget) throw new Error("Missing package relationship target.");
  if (rawTarget.startsWith("/")) {
    return normalizePackagePath(rawTarget);
  }
  const sourceSegments = normalizePackagePath(sourcePart).split("/");
  sourceSegments.pop();
  return normalizePackagePath([...sourceSegments, rawTarget].join("/"));
}

function getRelationshipsPartPath(sourcePart) {
  const segments = normalizePackagePath(sourcePart).split("/");
  const fileName = segments.pop();
  return [...segments, "_rels", `${fileName}.rels`].join("/");
}

function getXmlElements(documentNode, localName) {
  return Array.from(documentNode.getElementsByTagNameNS("*", localName));
}

function getRelationshipAttribute(node, localName) {
  return node.getAttributeNS(OOXML_RELATIONSHIP_NS, localName)
    || Array.from(node.attributes || []).find((attribute) => attribute.localName === localName)?.value
    || "";
}

function parseXmlPart(files, partPath) {
  const bytes = files[normalizePackagePath(partPath)];
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("Missing package XML part.");
  }
  const xml = new TextDecoder("utf-8").decode(bytes);
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  if (getXmlElements(documentNode, "parsererror").length > 0) {
    throw new Error("Invalid package XML.");
  }
  return documentNode;
}

function parseRelationships(files, sourcePart) {
  const relationships = new Map();
  const documentNode = parseXmlPart(files, getRelationshipsPartPath(sourcePart));
  for (const relationship of getXmlElements(documentNode, "Relationship")) {
    const id = relationship.getAttribute("Id") || "";
    const target = relationship.getAttribute("Target") || "";
    if (!id || !target) continue;
    relationships.set(id, {
      target,
      external: String(relationship.getAttribute("TargetMode") || "").toLowerCase() === "external"
    });
  }
  return relationships;
}

function getRelatedPart(relationships, sourcePart, relationshipId) {
  const relationship = relationships.get(relationshipId);
  if (!relationship || relationship.external) {
    throw new Error("Invalid package relationship.");
  }
  return resolvePackageTarget(sourcePart, relationship.target);
}

function getChildNumber(node, localName) {
  const child = getXmlElements(node, localName)[0];
  const value = Number.parseInt(child?.textContent ?? "", 10);
  return Number.isInteger(value) ? value : -1;
}

function detectImageMime(bytes) {
  if (!(bytes instanceof Uint8Array)) return "";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

export async function extractPlateImageRecordImages(arrayBuffer, sheetName, rowIndexes) {
  const createdUrls = [];
  try {
    if (
      typeof fflate === "undefined"
      || typeof DOMParser === "undefined"
      || typeof URL === "undefined"
      || typeof URL.createObjectURL !== "function"
      || !(arrayBuffer instanceof ArrayBuffer)
    ) {
      throw new Error("Required workbook image parser is unavailable.");
    }

    const requestedRows = new Set(
      (Array.isArray(rowIndexes) ? rowIndexes : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
    );
    if (requestedRows.size > PLATE_IMAGE_MAX_COUNT) {
      throw new Error("Workbook image count exceeds the limit.");
    }

    const unzipped = fflate.unzipSync(new Uint8Array(arrayBuffer));
    const files = Object.fromEntries(
      Object.entries(unzipped).map(([name, bytes]) => [normalizePackagePath(name), bytes])
    );
    const workbookPart = "xl/workbook.xml";
    const workbookDocument = parseXmlPart(files, workbookPart);
    const workbookRelationships = parseRelationships(files, workbookPart);
    const sheet = getXmlElements(workbookDocument, "sheet")
      .find((node) => String(node.getAttribute("name") || "") === String(sheetName || ""));
    if (!sheet) {
      throw new Error("Worksheet relationship is unavailable.");
    }

    const sheetRelationshipId = getRelationshipAttribute(sheet, "id");
    const sheetPart = getRelatedPart(workbookRelationships, workbookPart, sheetRelationshipId);
    const sheetDocument = parseXmlPart(files, sheetPart);
    const drawingNodes = getXmlElements(sheetDocument, "drawing");
    if (drawingNodes.length === 0 || requestedRows.size === 0) {
      return new Map();
    }

    const sheetRelationships = parseRelationships(files, sheetPart);
    const imageRecords = [];
    for (const drawingNode of drawingNodes) {
      const drawingRelationshipId = getRelationshipAttribute(drawingNode, "id");
      const drawingPart = getRelatedPart(sheetRelationships, sheetPart, drawingRelationshipId);
      const drawingDocument = parseXmlPart(files, drawingPart);
      const drawingRelationships = parseRelationships(files, drawingPart);
      const anchors = [
        ...getXmlElements(drawingDocument, "oneCellAnchor"),
        ...getXmlElements(drawingDocument, "twoCellAnchor")
      ];

      for (const anchor of anchors) {
        const from = getXmlElements(anchor, "from")[0];
        const rowIndex = from ? getChildNumber(from, "row") : -1;
        if (!requestedRows.has(rowIndex)) continue;

        const blip = getXmlElements(anchor, "blip")[0];
        if (!blip) continue;
        const imageRelationshipId = getRelationshipAttribute(blip, "embed");
        const imagePart = getRelatedPart(drawingRelationships, drawingPart, imageRelationshipId);
        const bytes = files[imagePart];
        if (!(bytes instanceof Uint8Array)) {
          throw new Error("Workbook image data is unavailable.");
        }
        imageRecords.push({ rowIndex, imagePart, bytes });
      }
    }

    if (imageRecords.length > PLATE_IMAGE_MAX_COUNT) {
      throw new Error("Workbook image count exceeds the limit.");
    }

    const uniqueImages = new Map();
    let totalBytes = 0;
    for (const record of imageRecords) {
      if (uniqueImages.has(record.imagePart)) continue;
      if (record.bytes.byteLength > PLATE_IMAGE_MAX_BYTES) {
        throw new Error("Workbook image exceeds the size limit.");
      }
      const mime = detectImageMime(record.bytes);
      if (!mime) {
        throw new Error("Workbook image type is unsupported.");
      }
      totalBytes += record.bytes.byteLength;
      if (totalBytes > PLATE_IMAGE_MAX_TOTAL_BYTES) {
        throw new Error("Workbook images exceed the total size limit.");
      }
      uniqueImages.set(record.imagePart, { bytes: record.bytes, mime });
    }

    const urlByImagePart = new Map();
    for (const [imagePart, image] of uniqueImages.entries()) {
      const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mime }));
      createdUrls.push(url);
      urlByImagePart.set(imagePart, url);
    }

    const imageUrlByRow = new Map();
    for (const record of imageRecords) {
      if (!imageUrlByRow.has(record.rowIndex)) {
        imageUrlByRow.set(record.rowIndex, urlByImagePart.get(record.imagePart) || "");
      }
    }
    return imageUrlByRow;
  } catch (error) {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    }
    throw new Error("牌照圖片解析失敗。");
  }
}
