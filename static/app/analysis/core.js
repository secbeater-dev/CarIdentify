import {
  DEFAULT_NORMAL_DRIVING_SPEED_KMH,
  HOME
} from "../shared/constants.js?v=20260408e";
import {
  formatDateTime,
  formatDuration,
  haversineKm,
  normalizeNormalDrivingSpeed,
  normalizePlate,
  overlapDayHours,
  overlapNightHours,
  pad2,
  parseRocDateTime,
  rowsToCsv,
  toNumber
} from "../shared/utils.js?v=20260408e";

export function normalizeHeaderKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()/]/g, "");
}

export function columnAliases() {
  return {
    id: ["蝺刻?", "id", "serial", "摨?"],
    plate: ["頠?", "頠?", "plate", "頠??Ⅳ"],
    timestamp: ["??", "time", "timestamp", "?交???", "颲刻???", "?菜葫?交?"],
    lon: ["蝬漲", "longitude", "lon", "lng", "x"],
    lat: ["蝺臬漲", "latitude", "lat", "y"],
    source: ["靘?", "蝮??", "source", "city", "銵?", "??蝟餌絞", "銵脫??, "??嗅?蝔?],
    note: ["?酉", "?啣?", "頝臬", "location", "place", "??, "??嗅?蝔?, "??蝟餌絞", "銵脫??]
  };
}

export function detectDatasetFormat(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const keys = [];
  const seen = new Set();
  for (const row of sourceRows.slice(0, 30)) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(normalizeHeaderKey(key));
      }
    }
  }
  const has = (name) => keys.includes(normalizeHeaderKey(name));
  const isIdkcityCamera = [
    "頠楚蝺刻?",
    "?蔣璈?蝔?,
    "頠?",
    "?桐?",
    "?交?",
    "??",
    "?蔣璈?,
    "蝬漲",
    "蝺臬漲"
  ].every((name) => has(name));
  if (isIdkcityCamera) {
    return "idkcity_camera";
  }
  if (has("?菜葫?交?") && has("??嗅?蝔?) && (has("eTag摨?") || has("??蝟餌絞") || has("頠??Ⅳ"))) {
    return "vehicle_recognition";
  }
  return "generic";
}

function resolveNormalizedColumns(rows, requiredMap) {
  const sampleRows = Array.isArray(rows) ? rows.slice(0, 30) : [];
  const keys = [];
  const keySet = new Set();
  for (const row of sampleRows) {
    Object.keys(row || {}).forEach((key) => {
      if (!keySet.has(key)) {
        keySet.add(key);
        keys.push(key);
      }
    });
  }

  const normalizedMap = new Map();
  keys.forEach((key) => {
    normalizedMap.set(normalizeHeaderKey(key), key);
  });

  const resolved = {};
  for (const [logicalKey, displayName] of Object.entries(requiredMap)) {
    const actualKey = normalizedMap.get(normalizeHeaderKey(displayName));
    if (!actualKey) {
      throw new Error(`蝻箏?敹?甈?: ${displayName}`);
    }
    resolved[logicalKey] = actualKey;
  }
  return resolved;
}

function extractTimeParts(rawValue) {
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    return {
      hour: rawValue.getHours(),
      minute: rawValue.getMinutes(),
      second: rawValue.getSeconds()
    };
  }

  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue >= 0 && rawValue < 1) {
    const totalSeconds = Math.round(rawValue * 86400);
    return {
      hour: Math.floor(totalSeconds / 3600) % 24,
      minute: Math.floor(totalSeconds / 60) % 60,
      second: totalSeconds % 60
    };
  }

  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;

  const timeMatch = raw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (timeMatch) {
    return {
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
      second: Number(timeMatch[3] || 0)
    };
  }

  const parsed = parseRocDateTime(raw);
  if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
    return {
      hour: parsed.getHours(),
      minute: parsed.getMinutes(),
      second: parsed.getSeconds()
    };
  }
  return null;
}

function combineDateAndTime(dateRaw, timeRaw) {
  const datePart = parseRocDateTime(dateRaw);
  const timePart = extractTimeParts(timeRaw);
  if (datePart instanceof Date && !Number.isNaN(datePart.getTime()) && timePart) {
    return new Date(
      datePart.getFullYear(),
      datePart.getMonth(),
      datePart.getDate(),
      timePart.hour,
      timePart.minute,
      timePart.second
    );
  }

  const direct = parseRocDateTime(`${String(dateRaw ?? "").trim()} ${String(timeRaw ?? "").trim()}`.trim());
  if (direct instanceof Date && !Number.isNaN(direct.getTime())) {
    return direct;
  }
  return null;
}

function normalizeIdkcityRows(rawRows) {
  const columns = resolveNormalizedColumns(rawRows, {
    trackId: "頠楚蝺刻?",
    cameraName: "?蔣璈?蝔?,
    plate: "頠?",
    unit: "?桐?",
    date: "?交?",
    time: "??",
    cameraId: "?蔣璈?,
    lon: "蝬漲",
    lat: "蝺臬漲"
  });

  const output = rawRows.map((row, idx) => {
    const cameraIdRaw = row?.[columns.cameraId];
    const cameraIdNum = Number.parseInt(cameraIdRaw, 10);
    const lon = toNumber(row?.[columns.lon]);
    const lat = toNumber(row?.[columns.lat]);
    const dateRaw = row?.[columns.date];
    const timeRaw = row?.[columns.time];
    const timestamp = combineDateAndTime(dateRaw, timeRaw);
    const source = String(row?.[columns.unit] ?? "").trim() || "?芣?靘?;
    const note = String(row?.[columns.cameraName] ?? "").trim() || source;
    const timestampRaw = `${String(dateRaw ?? "").trim()} ${String(timeRaw ?? "").trim()}`.trim();

    return {
      id: Number.isFinite(cameraIdNum) ? cameraIdNum : idx + 1,
      plate: String(row?.[columns.plate] ?? "").trim(),
      plate_norm: normalizePlate(row?.[columns.plate]),
      timestamp_raw: timestampRaw,
      timestamp,
      lon,
      lat,
      source,
      note
    };
  });

  const parsed = output.filter((row) => row.timestamp instanceof Date && !Number.isNaN(row.timestamp.getTime()));
  if (!parsed.length) {
    throw new Error("IDKCity timestamp parsing failed.");
  }
  return parsed;
}

export function detectColumns(rows) {
  const sampleRows = rows.slice(0, 30);
  const keys = [];
  const keySet = new Set();
  for (const row of sampleRows) {
    Object.keys(row || {}).forEach((key) => {
      if (!keySet.has(key)) {
        keySet.add(key);
        keys.push(key);
      }
    });
  }

  const normalizedMap = new Map();
  keys.forEach((key) => {
    normalizedMap.set(normalizeHeaderKey(key), key);
  });

  const selected = {};
  const aliases = columnAliases();
  Object.entries(aliases).forEach(([std, aliasList]) => {
    const normalizedAliases = aliasList.map((item) => normalizeHeaderKey(item));
    let hit = null;

    for (const alias of normalizedAliases) {
      if (normalizedMap.has(alias)) {
        hit = normalizedMap.get(alias);
        break;
      }
    }
    if (!hit) {
      for (const key of keys) {
        const nk = normalizeHeaderKey(key);
        if (normalizedAliases.some((alias) => nk.includes(alias) || alias.includes(nk))) {
          hit = key;
          break;
        }
      }
    }
    if (hit) selected[std] = hit;
  });

  if (!selected.timestamp) {
    let bestKey = "";
    let bestScore = -1;
    for (const key of keys) {
      let parseOk = 0;
      let totalNonEmpty = 0;
      for (const row of sampleRows) {
        const raw = row?.[key];
        const text = String(raw ?? "").trim();
        if (!text) continue;
        totalNonEmpty += 1;
        const parsed = parseRocDateTime(text);
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          parseOk += 1;
        }
      }
      if (totalNonEmpty === 0) continue;
      const score = parseOk / totalNonEmpty;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (bestKey && bestScore >= 0.6) {
      selected.timestamp = bestKey;
    }
  }

  const required = ["plate", "timestamp", "lon", "lat"];
  const missing = required.filter((key) => !selected[key]);
  if (missing.length) {
    throw new Error(`蝻箏?敹?甈?: ${missing.join(", ")}`);
  }
  return selected;
}

function median(values) {
  if (!values.length) return NaN;
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2) return arr[mid];
  return (arr[mid - 1] + arr[mid]) / 2;
}

function smartSwapCoordinates(rows) {
  const valid = rows.filter((row) => row.lon > 0 && row.lat > 0);
  if (!valid.length) return { rows, swapped: false };

  const lonMed = median(valid.map((row) => row.lon));
  const latMed = median(valid.map((row) => row.lat));
  const looksSwapped = lonMed >= 20 && lonMed <= 30 && latMed >= 110 && latMed <= 130;
  if (!looksSwapped) return { rows, swapped: false };

  return {
    swapped: true,
    rows: rows.map((row) => ({
      ...row,
      lon: row.lat,
      lat: row.lon
    }))
  };
}

export function normalizeRows(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error("Input rows are empty.");
  }

  if (detectDatasetFormat(rawRows) === "idkcity_camera") {
    return normalizeIdkcityRows(rawRows);
  }

  const selected = detectColumns(rawRows);
  const output = rawRows.map((row, idx) => {
    const idRaw = selected.id ? row[selected.id] : idx + 1;
    const idNum = Number.parseInt(idRaw, 10);
    const lon = toNumber(row[selected.lon]);
    const lat = toNumber(row[selected.lat]);

    const sourceRaw = selected.source ? row[selected.source] : "";
    const noteRaw = selected.note ? row[selected.note] : "";
    const source = String(sourceRaw ?? "").trim() || "?芣?靘?;
    const note = String(noteRaw ?? "").trim();

    return {
      id: Number.isFinite(idNum) ? idNum : idx + 1,
      plate: String(row[selected.plate] ?? "").trim(),
      plate_norm: normalizePlate(row[selected.plate]),
      timestamp_raw: row[selected.timestamp],
      timestamp: parseRocDateTime(row[selected.timestamp]),
      lon,
      lat,
      source,
      note
    };
  });

  const parsed = output.filter((row) => row.timestamp instanceof Date && !Number.isNaN(row.timestamp.getTime()));
  if (!parsed.length) {
    throw new Error("Timestamp parsing failed.");
  }
  return parsed;
}

function clusterPoints(stays, radiusM = 300) {
  const clusters = [];

  for (const stay of stays) {
    let assigned = null;
    for (const cluster of clusters) {
      const distM = haversineKm(stay.lat, stay.lon, cluster.centerLat, cluster.centerLon) * 1000;
      if (distM <= radiusM) {
        assigned = cluster;
        break;
      }
    }

    if (!assigned) {
      assigned = {
        centerLat: stay.lat,
        centerLon: stay.lon,
        points: [],
        visits: 0,
        durationMin: 0,
        areaCounter: new Map(),
        addrCounter: new Map()
      };
      clusters.push(assigned);
    }

    assigned.points.push(stay);
    assigned.visits += 1;
    assigned.durationMin += stay.duration_min;
    assigned.areaCounter.set(stay.area, (assigned.areaCounter.get(stay.area) || 0) + 1);
    assigned.addrCounter.set(stay.closest_address, (assigned.addrCounter.get(stay.closest_address) || 0) + 1);

    const w = assigned.visits;
    assigned.centerLat = (assigned.centerLat * (w - 1) + stay.lat) / w;
    assigned.centerLon = (assigned.centerLon * (w - 1) + stay.lon) / w;
  }

  const topEntry = (counterMap) => {
    let bestKey = "?芣?靘?;
    let bestVal = -1;
    for (const [key, value] of counterMap.entries()) {
      if (value > bestVal) {
        bestVal = value;
        bestKey = key;
      }
    }
    return bestKey;
  };

  return clusters
    .sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return b.durationMin - a.durationMin;
    })
    .map((cluster, idx) => ({
      rank: idx + 1,
      cluster_id: idx + 1,
      visits: cluster.visits,
      total_duration_min: Number(cluster.durationMin.toFixed(2)),
      total_duration_hhmm: formatDuration(cluster.durationMin),
      center_lat: Number(cluster.centerLat.toFixed(6)),
      center_lon: Number(cluster.centerLon.toFixed(6)),
      area: topEntry(cluster.areaCounter),
      closest_address: topEntry(cluster.addrCounter)
    }));
}

export function analyzeRecords(rawRows, options = {}) {
  const strictDistanceTeleport = Boolean(options.strictDistanceTeleport);
  const hasNormalizedInput = Array.isArray(options.normalizedRows);
  const skipCleaning = Boolean(options.skipCleaning);
  const normalDrivingSpeedKmh = normalizeNormalDrivingSpeed(
    options.normalDrivingSpeedKmh ?? DEFAULT_NORMAL_DRIVING_SPEED_KMH
  );

  let normalized = hasNormalizedInput ? options.normalizedRows.slice() : normalizeRows(rawRows);
  normalized.sort((a, b) => {
    const t = a.timestamp.getTime() - b.timestamp.getTime();
    if (t !== 0) return t;
    return a.id - b.id;
  });

  const plateCount = new Map();
  for (const row of normalized) {
    plateCount.set(row.plate_norm, (plateCount.get(row.plate_norm) || 0) + 1);
  }

  let targetPlate = "";
  let targetCount = -1;
  for (const [plate, count] of plateCount.entries()) {
    if (count > targetCount) {
      targetCount = count;
      targetPlate = plate;
    }
  }

  normalized = normalized.filter((row) => row.plate_norm === targetPlate);
  if (normalized.length < 2) {
    throw new Error("Not enough records after plate filtering.");
  }

  const swappedInfo = smartSwapCoordinates(normalized);
  const base = swappedInfo.rows;
  const anomalies = [];

  const invalidCoordRows = base.filter(
    (row) => !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || row.lat <= 0 || row.lon <= 0
  );

  for (const row of invalidCoordRows) {
    anomalies.push({
      type: "invalid_coord",
      time: formatDateTime(row.timestamp),
      description: `ID ${row.id} invalid coord (${row.lat}, ${row.lon})`
    });
  }

  const work = base.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon) && row.lat > 0 && row.lon > 0);
  if (work.length < 2) {
    throw new Error("Not enough valid coordinates.");
  }

  const kept = [work[0]];
  const teleportations = [];
  let prev = work[0];

  for (let i = 1; i < work.length; i += 1) {
    const curr = work[i];
    const dtHour = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 3600000;
    if (skipCleaning) {
      kept.push(curr);
      prev = curr;
      continue;
    }
    if (dtHour <= 0) {
      anomalies.push({
        type: "time_reverse",
        time: formatDateTime(curr.timestamp),
        description: `ID ${curr.id} skipped due to non-increasing timestamp`
      });
      continue;
    }

    const distKm = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);
    const speed = distKm / dtHour;
    const strictDistanceHit = distKm > 10 && (strictDistanceTeleport || dtHour <= 1.0);
    const speedHit = speed > 150;

    if (strictDistanceHit || speedHit) {
      teleportations.push({
        type: "teleport",
        time: formatDateTime(curr.timestamp),
        description: `ID ${prev.id}->${curr.id}, dist ${distKm.toFixed(2)}km, speed ${speed.toFixed(1)}km/h`,
        distance_km: Number(distKm.toFixed(2)),
        speed_kmh: Number(speed.toFixed(1)),
        from: {
          id: prev.id,
          lat: prev.lat,
          lon: prev.lon,
          time: formatDateTime(prev.timestamp)
        },
        to: {
          id: curr.id,
          lat: curr.lat,
          lon: curr.lon,
          time: formatDateTime(curr.timestamp)
        }
      });
      continue;
    }

    kept.push(curr);
    prev = curr;
  }

  const clean = kept;
  if (clean.length < 2) {
    throw new Error("Not enough records after cleaning.");
  }

  const transitions = [];
  const stays = [];
  const overnight = [];
  let normalSpeedExcluded = 0;

  for (let i = 0; i < clean.length - 1; i += 1) {
    const a = clean[i];
    const b = clean[i + 1];
    const dtMin = (b.timestamp.getTime() - a.timestamp.getTime()) / 60000;
    if (dtMin <= 0) continue;

    const distM = haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;
    const speedKmh = (distM / 1000) / (dtMin / 60);
    transitions.push({
      from_id: a.id,
      to_id: b.id,
      start_time: formatDateTime(a.timestamp),
      end_time: formatDateTime(b.timestamp),
      duration_min: Number(dtMin.toFixed(2)),
      distance_m: Number(distM.toFixed(1)),
      speed_kmh: Number(speedKmh.toFixed(2))
    });

    if (dtMin <= 4) continue;
    if (distM < 5) continue;
    if (speedKmh >= normalDrivingSpeedKmh) {
      normalSpeedExcluded += 1;
      continue;
    }

    const nightHours = overlapNightHours(a.timestamp, b.timestamp);
    const dayHours = overlapDayHours(a.timestamp, b.timestamp);
    const stay = {
      start_id: a.id,
      next_id: b.id,
      arrive_time: formatDateTime(a.timestamp),
      leave_time: formatDateTime(b.timestamp),
      duration_min: Number(dtMin.toFixed(2)),
      duration_hhmm: formatDuration(dtMin),
      area: a.source || "?芣?靘?,
      lon: Number(a.lon.toFixed(6)),
      lat: Number(a.lat.toFixed(6)),
      closest_address: a.note || a.source || "?芣?靘?,
      distance_to_next_m: Number(distM.toFixed(1)),
      speed_kmh: Number(speedKmh.toFixed(2)),
      is_breakpoint_6h: dtMin >= 360,
      day_overlap_h: Number(dayHours.toFixed(2)),
      night_overlap_h: Number(nightHours.toFixed(2)),
      is_overnight: dtMin >= 360 && nightHours >= 1.0,
      is_daytime_long_stay: dtMin >= 360 && dayHours >= 1.0
    };

    if (dtMin >= 1440) {
      stay.stay_type = "?瑟??(>=24h)";
    } else if (dtMin >= 360) {
      stay.stay_type = "??暺?>=6h)";
    } else if (dtMin >= 60) {
      stay.stay_type = "??暺?1-6h)";
    } else {
      stay.stay_type = "??暺?>4m)";
    }

    stays.push(stay);
    if (stay.is_overnight) {
      overnight.push(stay);
    }
  }

  const hotspots = clusterPoints(stays, 300).slice(0, 50);
  const parking60 = stays.filter((item) => item.duration_min >= 60);

  const hourlyCounts = Array(24).fill(0);
  for (const row of clean) {
    hourlyCounts[row.timestamp.getHours()] += 1;
  }

  const summary = {
    raw_records: base.length,
    clean_records: clean.length,
    teleportation_removed: teleportations.length,
    invalid_coord_removed: invalidCoordRows.length,
    cleaning_skipped: skipCleaning,
    normal_speed_threshold_kmh: normalDrivingSpeedKmh,
    normal_speed_excluded: normalSpeedExcluded,
    stay_records: stays.length,
    parking_records: parking60.length,
    overnight_records: overnight.length,
    period_start: formatDateTime(clean[0].timestamp),
    period_end: formatDateTime(clean[clean.length - 1].timestamp),
    plate_display: targetPlate,
    coordinate_swapped_fixed: swappedInfo.swapped
  };

  const mapPayload = {
    home: {
      lat: HOME.lat,
      lon: HOME.lon,
      radius_m: HOME.radiusM,
      address: HOME.address
    },
    track: clean.map((row) => ({
      id: row.id,
      lat: row.lat,
      lon: row.lon,
      time: formatDateTime(row.timestamp),
      area: row.source || "?芣?靘?,
      address: row.note || row.source || "?芣?靘?,
      timestamp_ms: row.timestamp.getTime()
    })),
    stays: stays.map((item) => ({
      start_id: item.start_id,
      next_id: item.next_id,
      lat: item.lat,
      lon: item.lon,
      arrive_time: item.arrive_time,
      leave_time: item.leave_time,
      duration_hhmm: item.duration_hhmm,
      stay_type: item.stay_type,
      is_overnight: item.is_overnight,
      day_overlap_h: item.day_overlap_h,
      night_overlap_h: item.night_overlap_h,
      address: item.closest_address,
      area: item.area
    })),
    teleportations,
    hotspots
  };

  const stayExportRows = stays.map((item) => ({
    arrive_time: item.arrive_time,
    leave_time: item.leave_time,
    duration: item.duration_hhmm,
    area: item.area,
    lon: item.lon,
    lat: item.lat,
    address: item.closest_address,
    type: item.stay_type
  }));

  const hotspotExportRows = hotspots.map((item) => ({
    rank: item.rank,
    area: item.area,
    address: item.closest_address,
    visits: item.visits,
    total_duration: item.total_duration_hhmm,
    center_lon: item.center_lon,
    center_lat: item.center_lat
  }));

  const validationRows = stays.map((item) => ({
    start_id: item.start_id,
    next_id: item.next_id,
    arrive_time: item.arrive_time,
    leave_time: item.leave_time,
    duration: item.duration_hhmm,
    area: item.area,
    lon: item.lon,
    lat: item.lat,
    address: item.closest_address
  }));

  return {
    summary,
    stays,
    parking_60: parking60,
    overnight,
    hotspots,
    hourly_distribution: hourlyCounts,
    anomalies: {
      teleportations,
      others: anomalies.concat(
        teleportations.map((item) => ({
          type: item.type,
          time: item.time,
          description: item.description
        }))
      )
    },
    transitions,
    map: mapPayload,
    exports: {
      stay_csv: rowsToCsv(stayExportRows),
      hotspot_csv: rowsToCsv(hotspotExportRows),
      validation_csv: rowsToCsv(validationRows)
    }
  };
}

export async function parseWorkbookArrayBuffer(arrayBuffer) {
  if (typeof XLSX === "undefined") {
    throw new Error("XLSX parser is not available.");
  }

  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: false });
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) {
    throw new Error("No worksheet found.");
  }

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    if (rows.length > 0) {
      return rows;
    }
  }
  throw new Error("Worksheet has no rows.");
}



