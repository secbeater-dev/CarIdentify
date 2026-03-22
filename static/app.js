(() => {
  "use strict";

  const HOME = {
    address: "Taipei City Datong Dist Chongqing N Rd Sec 2 No.51 4F",
    lat: 25.0557,
    lon: 121.5139,
    radiusM: 600
  };

  const GEMINI_ENDPOINT_DEFAULT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
  const FIRST_OPEN_NOTICE_KEY = "sb-first-open-notice-20260322";
  const DEFAULT_AI_PROMPT = `角色： 專業刑事交通數據分析師（具備15年資深偵查、洗錢與毒品案背景）。
任務： 分析 LPR 汽機車路徑資料，識別停留點、識別日常作息，產出偵查報告與搜索聲請附件。

一、 資料前處理與異常清洗 (Cleaning)
時間格式化：將民國年（YYY/MM/DD HH:MM:SS）統一轉換為西元年（YYYY-MM-DD HH:MM:SS）並依時間排序。
傳送門過濾 (Teleportation Check)：
若相鄰兩筆紀錄平均移動速度 > 150 km/h，或距離相差超過 10 公里，視為車牌誤辨或異常資料，該筆必須排除，不得納入分析。

二、 停留點判定邏輯 (Stay Point Logic - 嚴格修正版)
停留定義：
起始點與結束點之經緯度座標不同，且時間差距 > 10 分鐘。
斷點處理 (關鍵規則)：
若兩筆紀錄時間差 > 6 小時，且期間該車輛在該地點（及周邊 100 公尺內）無重複辨識，必須判定為在該路口（或進入該處死角）持續停留。不得標註為追蹤斷點，應將該時段完整計入停留時間，以增強對象與地點的關聯強度。
時間格式：停留時長一律轉換為「o時o分」格式（例如：24時16分）。

三、 居住地地緣與作息分析 (Investigation Analysis)
地緣比對：輸入對象居住地為【】，若無輸入則從車輛軌跡中判斷。
專用術語：分析報告中，提及返回行為時，一律使用「返回住處」而非「歸府」或「回家」。
作息研判：出門規律：識別每日第一次離開住處周邊 600 公尺區域的時間與方向。
返回住處規律：識別每日最後一次進入住處周邊並靜止的時間。
長期停放區：識別除住處外，停留時間超過 24 小時的特定地點。

四、 輸出格式要求 (Output)
輸出 1：停留點清單 (CSV 表格)
欄位包含：抵達時間、離開時間、停留時長、行政區、經度、緯度、最接近地址。
輸出 2：熱點統計
列出停留次數最多的前 20 個地點，並統計各點總停留時長。
輸出 3：作息分析概述
條列式說明對象平均出門時間、返回住處時間、活動熱區及偵查建議。
輸出 4：驗證 CSV
依照原始資料順序，將「停留起始列」與「下一列位移點」成對保留，方便逐筆核對。`;

  const state = {
    analysis: null,
    map: null,
    layers: {},
    currentMarker: null,
    track: [],
    currentTrackIndex: 0,
    teleportVisible: false,
    isPlaying: false,
    playbackToken: 0,
    hourChart: null,
    modelsLoading: false,
    modelRefreshToken: 0,
    csvExports: {
      stay: "",
      hotspot: "",
      validation: ""
    }
  };

  const els = {
    menu: document.getElementById("menu"),
    views: Array.from(document.querySelectorAll(".view")),
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    analyzeForm: document.getElementById("analyze-form"),
    fileInput: document.getElementById("file-input"),
    strictDistance: document.getElementById("strict-distance"),
    status: document.getElementById("status"),
    staysCount: document.getElementById("stays-count"),
    parkingCount: document.getElementById("parking-count"),
    overnightCount: document.getElementById("overnight-count"),
    tableStays: document.getElementById("table-stays"),
    tableParking: document.getElementById("table-parking"),
    tableOvernight: document.getElementById("table-overnight"),
    tableHotspots: document.getElementById("table-hotspots"),
    tableTeleport: document.getElementById("table-teleport"),
    routineHourChart: document.getElementById("routine-hour-chart"),
    map: document.getElementById("map"),
    mapCurrentInfo: document.getElementById("map-current-info"),
    timelineSlider: document.getElementById("timeline-slider"),
    timelineCurrent: document.getElementById("timeline-current"),
    timelineSelect: document.getElementById("timeline-select"),
    timelinePicker: document.getElementById("timeline-picker"),
    toggleTeleport: document.getElementById("toggle-teleport"),
    playTimeline: document.getElementById("play-timeline"),
    playbackSpeed: document.getElementById("playback-speed"),
    playbackSpeedLabel: document.getElementById("playback-speed-label"),
    exportMenuToggle: document.getElementById("export-menu-toggle"),
    exportMenu: document.getElementById("export-menu"),
    exportType: document.getElementById("export-type"),
    exportDownload: document.getElementById("export-download"),
    aiEndpointUrl: document.getElementById("ai-endpoint-url"),
    aiEndpointPreview: document.getElementById("ai-endpoint-preview"),
    aiApiKey: document.getElementById("ai-api-key"),
    aiModelSelect: document.getElementById("ai-model-select"),
    refreshModels: document.getElementById("refresh-models"),
    aiModelCustom: document.getElementById("ai-model-custom"),
    aiPrompt: document.getElementById("ai-prompt"),
    runAiAnalysis: document.getElementById("run-ai-analysis"),
    aiOutput: document.getElementById("ai-output")
  };

  function setStatus(message, type) {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.classList.remove("success", "error");
    if (type) {
      els.status.classList.add(type);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function debounce(fn, delayMs) {
    let timer = null;
    return (...args) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        fn(...args);
      }, delayMs);
    };
  }

  function ensureDefaultAiPrompt() {
    if (!els.aiPrompt) return;
    if (!String(els.aiPrompt.value || "").trim()) {
      els.aiPrompt.value = DEFAULT_AI_PROMPT;
    }
  }

  function hasSeenFirstOpenNotice() {
    try {
      return window.localStorage.getItem(FIRST_OPEN_NOTICE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function markFirstOpenNoticeSeen() {
    try {
      window.localStorage.setItem(FIRST_OPEN_NOTICE_KEY, "1");
    } catch (error) {
      // Ignore storage write failures and keep app functional.
    }
  }

  function showFirstOpenNoticeIfNeeded() {
    if (hasSeenFirstOpenNotice()) return;

    const overlay = document.createElement("div");
    overlay.className = "first-open-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="first-open-modal">
        <h3>使用提醒</h3>
        <p>除 AI 功能外，資料均在本地運行，請安心使用。</p>
        <p>有任何需求可以私訊 <a href="https://t.me/secbeater" target="_blank" rel="noopener noreferrer">SecBetaer</a></p>
        <button type="button" class="run-btn first-open-close" data-action="close">我知道了</button>
      </div>
    `;

    const onClose = () => {
      markFirstOpenNoticeSeen();
      overlay.classList.add("is-closing");
      window.setTimeout(() => {
        document.removeEventListener("keydown", onEscClose);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 180);
    };

    const onEscClose = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        onClose();
      }
    });
    overlay.querySelector("[data-action='close']")?.addEventListener("click", onClose);

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onEscClose);
    window.requestAnimationFrame(() => {
      overlay.classList.add("is-open");
    });
  }

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizePlate(value) {
    return String(value ?? "")
      .toUpperCase()
      .trim()
      .replace(/-/g, "")
      .replace(/\s+/g, "");
  }

  function formatDateTime(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function formatDateInputValue(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function formatDuration(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    return `${hours}h ${mins}m`;
  }

  function parseRocDateTime(input) {
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      return new Date(input.getTime());
    }
    if (input === null || input === undefined) return null;

    const raw = String(input).trim();
    if (!raw) return null;

    const normalized = raw.replace("T", " ");
    const match = normalized.match(/^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (match) {
      let year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hour = Number(match[4]);
      const minute = Number(match[5]);
      const second = Number(match[6] || 0);
      if (year <= 300) year += 1911;
      const dt = new Date(year, month - 1, day, hour, minute, second);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }

    const fallback = new Date(raw);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
    return null;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const r = 6371.0088;
    const toRad = Math.PI / 180;
    const p1 = lat1 * toRad;
    const p2 = lat2 * toRad;
    const dphi = (lat2 - lat1) * toRad;
    const dlambda = (lon2 - lon1) * toRad;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  function overlapNightHours(start, end) {
    if (!(start instanceof Date) || !(end instanceof Date)) return 0;
    if (end <= start) return 0;

    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
    let total = 0;

    while (cursor < endDay) {
      const aStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 22, 0, 0, 0);
      const aEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0, 0);
      const bStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, 0, 0, 0);
      const bEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 6, 0, 0, 0);

      const windows = [[aStart, aEnd], [bStart, bEnd]];
      for (const [wStart, wEnd] of windows) {
        const left = Math.max(start.getTime(), wStart.getTime());
        const right = Math.min(end.getTime(), wEnd.getTime());
        if (right > left) {
          total += (right - left) / 3600000;
        }
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0, 0);
    }

    return total;
  }

  function normalizeHeaderKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_\-()/]/g, "");
  }

  function columnAliases() {
    return {
      id: ["編號", "id", "serial", "序號"],
      plate: ["車號", "車牌", "plate", "車牌號碼"],
      timestamp: ["時間", "time", "timestamp", "日期時間", "辨識時間"],
      lon: ["經度", "longitude", "lon", "lng", "x"],
      lat: ["緯度", "latitude", "lat", "y"],
      source: ["來源", "縣市", "source", "city", "行政區"],
      note: ["備註", "地址", "路口", "location", "place", "備考"]
    };
  }

  function detectColumns(rows) {
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
      const normalizedAliases = aliasList.map((a) => normalizeHeaderKey(a));
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

    const required = ["plate", "timestamp", "lon", "lat"];
    const missing = required.filter((key) => !selected[key]);
    if (missing.length) {
      throw new Error(`缺少必要欄位: ${missing.join(", ")}`);
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
    const valid = rows.filter((r) => r.lon > 0 && r.lat > 0);
    if (!valid.length) return { rows, swapped: false };

    const lonMed = median(valid.map((r) => r.lon));
    const latMed = median(valid.map((r) => r.lat));
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

  function normalizeRows(rawRows) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      throw new Error("Input rows are empty.");
    }

    const selected = detectColumns(rawRows);
    const output = rawRows.map((row, idx) => {
      const idRaw = selected.id ? row[selected.id] : idx + 1;
      const idNum = Number.parseInt(idRaw, 10);
      const lon = toNumber(row[selected.lon]);
      const lat = toNumber(row[selected.lat]);

      const sourceRaw = selected.source ? row[selected.source] : "";
      const noteRaw = selected.note ? row[selected.note] : "";
      const source = String(sourceRaw ?? "").trim() || "未提供";
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

    const parsed = output.filter((r) => r.timestamp instanceof Date && !Number.isNaN(r.timestamp.getTime()));
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
      let bestKey = "未提供";
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

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  }

  function rowsToCsv(rows, headers) {
    if (!rows.length) {
      return "\uFEFF";
    }
    const columns = headers || Object.keys(rows[0]);
    const lines = [columns.join(",")];
    for (const row of rows) {
      lines.push(columns.map((key) => csvEscape(row[key])).join(","));
    }
    return `\uFEFF${lines.join("\r\n")}`;
  }

  function analyzeRecords(rawRows, options = {}) {
    const strictDistanceTeleport = Boolean(options.strictDistanceTeleport);

    let normalized = normalizeRows(rawRows);
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

    for (let i = 0; i < clean.length - 1; i += 1) {
      const a = clean[i];
      const b = clean[i + 1];
      const dtMin = (b.timestamp.getTime() - a.timestamp.getTime()) / 60000;
      if (dtMin <= 0) continue;

      const distM = haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000;
      transitions.push({
        from_id: a.id,
        to_id: b.id,
        start_time: formatDateTime(a.timestamp),
        end_time: formatDateTime(b.timestamp),
        duration_min: Number(dtMin.toFixed(2)),
        distance_m: Number(distM.toFixed(1))
      });

      if (dtMin <= 10) continue;
      if (distM < 5) continue;

      const nightHours = overlapNightHours(a.timestamp, b.timestamp);
      const stay = {
        start_id: a.id,
        next_id: b.id,
        arrive_time: formatDateTime(a.timestamp),
        leave_time: formatDateTime(b.timestamp),
        duration_min: Number(dtMin.toFixed(2)),
        duration_hhmm: formatDuration(dtMin),
        area: a.source || "未提供",
        lon: Number(a.lon.toFixed(6)),
        lat: Number(a.lat.toFixed(6)),
        closest_address: a.note || a.source || "未提供",
        distance_to_next_m: Number(distM.toFixed(1)),
        is_breakpoint_6h: dtMin >= 360,
        night_overlap_h: Number(nightHours.toFixed(2)),
        is_overnight: dtMin >= 360 && nightHours >= 1.0
      };

      if (dtMin >= 1440) {
        stay.stay_type = "長期停放(>=24h)";
      } else if (dtMin >= 360) {
        stay.stay_type = "停駐點(>=6h)";
      } else if (dtMin >= 60) {
        stay.stay_type = "停留點(1-6h)";
      } else {
        stay.stay_type = "停留點(>10m)";
      }

      stays.push(stay);
      if (stay.is_overnight) {
        overnight.push(stay);
      }
    }

    const hotspots = clusterPoints(stays, 300).slice(0, 50);
    const parking60 = stays.filter((s) => s.duration_min >= 60);

    const hourlyCounts = Array(24).fill(0);
    for (const row of clean) {
      hourlyCounts[row.timestamp.getHours()] += 1;
    }

    const summary = {
      raw_records: base.length,
      clean_records: clean.length,
      teleportation_removed: teleportations.length,
      invalid_coord_removed: invalidCoordRows.length,
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
        area: row.source || "未提供",
        address: row.note || row.source || "未提供",
        timestamp_ms: row.timestamp.getTime()
      })),
      stays: stays.map((s) => ({
        start_id: s.start_id,
        next_id: s.next_id,
        lat: s.lat,
        lon: s.lon,
        arrive_time: s.arrive_time,
        leave_time: s.leave_time,
        duration_hhmm: s.duration_hhmm,
        stay_type: s.stay_type,
        is_overnight: s.is_overnight,
        address: s.closest_address,
        area: s.area
      })),
      teleportations,
      hotspots
    };

    const stayExportRows = stays.map((s) => ({
      arrive_time: s.arrive_time,
      leave_time: s.leave_time,
      duration: s.duration_hhmm,
      area: s.area,
      lon: s.lon,
      lat: s.lat,
      address: s.closest_address,
      type: s.stay_type
    }));

    const hotspotExportRows = hotspots.map((h) => ({
      rank: h.rank,
      area: h.area,
      address: h.closest_address,
      visits: h.visits,
      total_duration: h.total_duration_hhmm,
      center_lon: h.center_lon,
      center_lat: h.center_lat
    }));

    const validationRows = stays.map((s) => ({
      start_id: s.start_id,
      next_id: s.next_id,
      arrive_time: s.arrive_time,
      leave_time: s.leave_time,
      duration: s.duration_hhmm,
      area: s.area,
      lon: s.lon,
      lat: s.lat,
      address: s.closest_address
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
          teleportations.map((t) => ({
            type: t.type,
            time: t.time,
            description: t.description
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
function renderTable(container, rows, columns) {
    if (!container) return;
    if (!rows || rows.length === 0) {
      container.innerHTML = '<div class="empty">?∟???/div>';
      return;
    }

    const headerHtml = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("");
    const bodyHtml = rows
      .map((row) => {
        const tds = columns
          .map((col) => {
            const raw = col.format ? col.format(row[col.key], row) : row[col.key];
            return `<td>${escapeHtml(raw ?? "")}</td>`;
          })
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");

    container.innerHTML = `
      <table>
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    `;
  }

  function renderHourlyChart(hourlyCounts) {
    if (!els.routineHourChart || typeof Chart === "undefined") return;
    const labels = Array.from({ length: 24 }, (_, i) => `${pad2(i)}:00`);

    if (state.hourChart) {
      state.hourChart.destroy();
      state.hourChart = null;
    }

    // Avoid canvas height growth when rendering multiple times.
    els.routineHourChart.removeAttribute("height");
    els.routineHourChart.removeAttribute("width");
    els.routineHourChart.style.height = "100%";
    els.routineHourChart.style.width = "100%";

    state.hourChart = new Chart(els.routineHourChart, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "辨識數量",
            data: hourlyCounts,
            backgroundColor: "#f4f4f4",
            borderColor: "#d0d0d0",
            borderWidth: 1.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "#d9d9d9" },
            grid: { color: "rgba(255,255,255,0.08)" }
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#d9d9d9", precision: 0 },
            grid: { color: "rgba(255,255,255,0.08)" }
          }
        },
        plugins: {
          legend: { labels: { color: "#f0f0f0" } },
          tooltip: {
            callbacks: {
              label: (context) => `辨識數量: ${context.parsed.y}`
            }
          }
        }
      }
    });
  }

  function initMapIfNeeded() {
    if (state.map || !els.map || typeof L === "undefined") return;

    state.map = L.map(els.map, { preferCanvas: true }).setView([HOME.lat, HOME.lon], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(state.map);

    state.layers.trackLine = L.polyline([], { color: "#f3f3f3", weight: 3, opacity: 0.9 }).addTo(state.map);
    state.layers.trackDots = L.layerGroup().addTo(state.map);
    state.layers.stays = L.layerGroup().addTo(state.map);
    state.layers.hotspots = L.layerGroup().addTo(state.map);
    state.layers.home = L.layerGroup().addTo(state.map);
    state.layers.teleport = L.layerGroup();

    state.currentMarker = L.circleMarker([HOME.lat, HOME.lon], {
      radius: 8,
      color: "#ffffff",
      fillColor: "#000000",
      fillOpacity: 1,
      weight: 2
    }).addTo(state.map);
  }

  function parseTrackDate(trackPoint) {
    if (Number.isFinite(trackPoint.timestamp_ms)) {
      return new Date(trackPoint.timestamp_ms);
    }
    return parseRocDateTime(trackPoint.time);
  }

  function updateMapCurrentInfo(point) {
    if (!els.mapCurrentInfo) return;
    if (!point) {
      els.mapCurrentInfo.textContent = "Current: no data loaded";
      return;
    }

    const dt = parseTrackDate(point);
    const dateText = dt ? `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}` : "-";
    const timeText = dt ? `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}` : "-";
    const locationText = `${point.area || "未提供"} / ${point.address || "未提供"}`;
    const coordText = `${Number(point.lat).toFixed(6)}, ${Number(point.lon).toFixed(6)}`;
    els.mapCurrentInfo.textContent = `日期 ${dateText}｜時間 ${timeText}｜位置 ${locationText}｜座標 ${coordText}｜編號 ${point.id}`;
  }

  function setTeleportVisible(visible) {
    state.teleportVisible = visible;
    if (els.toggleTeleport) {
      els.toggleTeleport.textContent = `顯示異常傳送門：${visible ? "開" : "關"}`;
    }
    if (!state.map || !state.layers.teleport) return;
    if (visible) {
      if (!state.map.hasLayer(state.layers.teleport)) {
        state.layers.teleport.addTo(state.map);
      }
    } else if (state.map.hasLayer(state.layers.teleport)) {
      state.map.removeLayer(state.layers.teleport);
    }
  }

  function renderMap(payload) {
    initMapIfNeeded();
    if (!state.map) return;

    state.layers.trackLine.setLatLngs([]);
    state.layers.trackDots.clearLayers();
    state.layers.stays.clearLayers();
    state.layers.hotspots.clearLayers();
    state.layers.home.clearLayers();
    state.layers.teleport.clearLayers();

    state.track = Array.isArray(payload.track) ? payload.track : [];
    const trackLatLngs = state.track.map((p) => [p.lat, p.lon]);
    state.layers.trackLine.setLatLngs(trackLatLngs);

    const sampleStep = state.track.length > 800 ? 10 : 4;
    state.track.forEach((p, idx) => {
      if (idx % sampleStep !== 0 && idx !== 0 && idx !== state.track.length - 1) return;
      const marker = L.circleMarker([p.lat, p.lon], {
        radius: 3,
        color: "#bbbbbb",
        fillColor: "#ffffff",
        fillOpacity: 0.8,
        weight: 1
      });
      marker.bindPopup(`<b>${escapeHtml(p.time)}</b><br>${escapeHtml(p.address || p.area || "未提供")}`);
      marker.addTo(state.layers.trackDots);
    });

    for (const s of payload.stays || []) {
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: 5,
        color: "#f7f7f7",
        fillColor: s.is_overnight ? "#dcdcdc" : "#9f9f9f",
        fillOpacity: 0.9,
        weight: 1.4
      });
      marker.bindPopup(
        `<b>${escapeHtml(s.stay_type)}</b><br>${escapeHtml(s.arrive_time)} ~ ${escapeHtml(s.leave_time)}<br>${escapeHtml(s.duration_hhmm)}<br>${escapeHtml(s.address || s.area || "未提供")}`
      );
      marker.addTo(state.layers.stays);
    }

    for (const h of payload.hotspots || []) {
      const marker = L.circleMarker([h.center_lat, h.center_lon], {
        radius: 6,
        color: "#ffffff",
        fillColor: "#1c1c1c",
        fillOpacity: 1,
        weight: 2
      });
      marker.bindPopup(
        `<b>熱區 #${h.rank}</b><br>${escapeHtml(h.area || "未提供")}<br>${escapeHtml(h.closest_address || "未提供")}<br>次數: ${h.visits}<br>總停留: ${escapeHtml(h.total_duration_hhmm)}`
      );
      marker.addTo(state.layers.hotspots);
    }

    for (const tp of payload.teleportations || []) {
      const from = tp.from;
      const to = tp.to;
      if (!from || !to) continue;

      const line = L.polyline(
        [
          [from.lat, from.lon],
          [to.lat, to.lon]
        ],
        {
          color: "#ffffff",
          weight: 2,
          opacity: 0.95,
          dashArray: "5 5"
        }
      );
      line.bindPopup(`<b>異常傳送門</b><br>${escapeHtml(tp.description || "")}`);
      line.addTo(state.layers.teleport);

      const icon = L.divIcon({
        className: "",
        html: '<div class="anomaly-pin">!</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      L.marker([to.lat, to.lon], { icon })
        .bindPopup(`<b>異常點</b><br>${escapeHtml(to.time || "")}<br>${escapeHtml(tp.description || "")}`)
        .addTo(state.layers.teleport);
    }

    if (payload.home) {
      const center = [payload.home.lat, payload.home.lon];
      L.circle(center, {
        radius: payload.home.radius_m || HOME.radiusM,
        color: "#aaaaaa",
        weight: 1.5,
        fillColor: "#777777",
        fillOpacity: 0.08
      })
        .bindPopup(`住處基準：${escapeHtml(payload.home.address || HOME.address)}`)
        .addTo(state.layers.home);

      L.circleMarker(center, {
        radius: 5,
        color: "#dcdcdc",
        fillColor: "#f7f7f7",
        fillOpacity: 1,
        weight: 1
      })
        .bindPopup(`住處：${escapeHtml(payload.home.address || HOME.address)}`)
        .addTo(state.layers.home);
    }

    if (trackLatLngs.length) {
      state.map.fitBounds(trackLatLngs, { padding: [40, 40], maxZoom: 16 });
    } else {
      state.map.setView([HOME.lat, HOME.lon], 12);
    }

    setTeleportVisible(false);
    setupTimelineControls(state.track);
    setTimeout(() => state.map.invalidateSize(), 80);
  }
function setupTimelineControls(track) {
    const hasTrack = Array.isArray(track) && track.length > 0;
    if (!hasTrack) {
      els.timelineSlider.disabled = true;
      els.timelineSelect.disabled = true;
      els.timelinePicker.disabled = true;
      els.playTimeline.disabled = true;
      els.playTimeline.textContent = "播放";
      els.playTimeline.classList.remove("is-playing");
      updateMapCurrentInfo(null);
      els.timelineCurrent.textContent = "尚未載入軌跡時間";
      return;
    }

    els.timelineSlider.disabled = false;
    els.timelineSelect.disabled = false;
    els.timelinePicker.disabled = false;
    els.playTimeline.disabled = false;
    els.playTimeline.textContent = "播放";
    els.playTimeline.classList.remove("is-playing");

    els.timelineSlider.min = "0";
    els.timelineSlider.max = String(track.length - 1);
    els.timelineSlider.value = "0";

    const options = track
      .map((p, idx) => `<option value="${idx}">${idx + 1}. ${escapeHtml(p.time)}｜${escapeHtml(p.address || p.area || "未提供")}</option>`)
      .join("");
    els.timelineSelect.innerHTML = options;
    els.timelineSelect.value = "0";

    const firstDt = parseTrackDate(track[0]);
    const lastDt = parseTrackDate(track[track.length - 1]);
    if (firstDt && lastDt) {
      els.timelinePicker.min = formatDateInputValue(firstDt);
      els.timelinePicker.max = formatDateInputValue(lastDt);
      els.timelinePicker.value = formatDateInputValue(firstDt);
    } else {
      els.timelinePicker.value = "";
    }

    state.currentTrackIndex = 0;
    setTimelineIndex(0, { focus: false });
  }

  function findNearestTrackIndex(targetDate) {
    if (!state.track.length || !(targetDate instanceof Date)) return 0;
    const target = targetDate.getTime();
    let bestIdx = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < state.track.length; i += 1) {
      const dt = parseTrackDate(state.track[i]);
      if (!dt) continue;
      const diff = Math.abs(dt.getTime() - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function focusMapToTrackPoint(point) {
    if (!state.map || !point) return Promise.resolve();
    const zoom = Math.max(state.map.getZoom(), 16);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        state.map.off("moveend", onMoveEnd);
        resolve();
      };
      const onMoveEnd = () => setTimeout(finish, 90);
      state.map.on("moveend", onMoveEnd);
      state.map.flyTo([point.lat, point.lon], zoom, {
        animate: true,
        duration: 0.75
      });
      setTimeout(finish, 1600);
    });
  }

  async function setTimelineIndex(index, options = {}) {
    if (!state.track.length) return;
    const focus = options.focus !== false;

    const clampedIndex = clamp(index, 0, state.track.length - 1);
    state.currentTrackIndex = clampedIndex;
    const point = state.track[clampedIndex];
    if (!point) return;

    els.timelineSlider.value = String(clampedIndex);
    els.timelineSelect.value = String(clampedIndex);

    const dt = parseTrackDate(point);
    if (dt) {
      els.timelinePicker.value = formatDateInputValue(dt);
    }

    els.timelineCurrent.textContent = `${clampedIndex + 1}/${state.track.length}｜${point.time}｜${point.address || point.area || "未提供"}`;
    updateMapCurrentInfo(point);

    if (state.currentMarker) {
      state.currentMarker.setLatLng([point.lat, point.lon]);
      state.currentMarker.bindPopup(`<b>${escapeHtml(point.time)}</b><br>${escapeHtml(point.address || point.area || "未提供")}`);
    }

    if (focus) {
      await focusMapToTrackPoint(point);
    }
  }

  function updatePlaybackSpeedLabel() {
    const value = Number(els.playbackSpeed?.value || 1);
    if (els.playbackSpeedLabel) {
      els.playbackSpeedLabel.textContent = `${value.toFixed(1)}x`;
    }
  }

  function stopPlayback() {
    state.isPlaying = false;
    state.playbackToken += 1;
    if (els.playTimeline) {
      els.playTimeline.textContent = "播放";
      els.playTimeline.classList.remove("is-playing");
    }
  }

  async function togglePlayback() {
    if (!state.track.length) return;
    if (state.isPlaying) {
      stopPlayback();
      return;
    }

    state.isPlaying = true;
    state.playbackToken += 1;
    const token = state.playbackToken;
    els.playTimeline.textContent = "停止";
    els.playTimeline.classList.add("is-playing");

    let idx = state.currentTrackIndex;
    while (state.isPlaying && token === state.playbackToken && idx < state.track.length) {
      await setTimelineIndex(idx, { focus: true });
      const speed = Math.max(0.5, Number(els.playbackSpeed?.value || 1));
      const delay = Math.max(120, Math.round(850 / speed));
      await sleep(delay);
      idx += 1;
    }

    if (token === state.playbackToken) {
      state.isPlaying = false;
      els.playTimeline.textContent = "播放";
      els.playTimeline.classList.remove("is-playing");
    }
  }

  function renderResult(result, sourceLabel) {
    state.analysis = result;
    state.csvExports.stay = result.exports.stay_csv;
    state.csvExports.hotspot = result.exports.hotspot_csv;
    state.csvExports.validation = result.exports.validation_csv;

    if (els.staysCount) {
      els.staysCount.textContent = `筆數：${result.stays.length}`;
    }
    if (els.parkingCount) {
      els.parkingCount.textContent = `筆數：${result.parking_60.length}`;
    }
    if (els.overnightCount) {
      els.overnightCount.textContent = `筆數：${result.overnight.length}`;
    }

    renderTable(els.tableStays, result.stays, [
      { key: "arrive_time", label: "抵達時間" },
      { key: "leave_time", label: "離開時間" },
      { key: "duration_hhmm", label: "停留時長" },
      { key: "area", label: "行政區" },
      { key: "lon", label: "經度" },
      { key: "lat", label: "緯度" },
      { key: "closest_address", label: "最接近地址" },
      { key: "stay_type", label: "類型" }
    ]);

    renderTable(els.tableParking, result.parking_60, [
      { key: "arrive_time", label: "抵達時間" },
      { key: "leave_time", label: "離開時間" },
      { key: "duration_hhmm", label: "停留時長" },
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" }
    ]);

    renderTable(els.tableOvernight, result.overnight, [
      { key: "arrive_time", label: "抵達時間" },
      { key: "leave_time", label: "離開時間" },
      { key: "duration_hhmm", label: "停留時長" },
      { key: "night_overlap_h", label: "夜間重疊(小時)" },
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" }
    ]);

    renderTable(els.tableHotspots, result.hotspots, [
      { key: "rank", label: "排名" },
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" },
      { key: "visits", label: "停留次數" },
      { key: "total_duration_hhmm", label: "總停留時長" },
      { key: "center_lon", label: "中心經度" },
      { key: "center_lat", label: "中心緯度" }
    ]);

    renderTable(els.tableTeleport, result.anomalies.teleportations, [
      { key: "time", label: "時間" },
      {
        key: "from",
        label: "起點",
        format: (_, row) => `${row.from?.time || "-"} (${row.from?.lat?.toFixed(6) || "-"}, ${row.from?.lon?.toFixed(6) || "-"})`
      },
      {
        key: "to",
        label: "終點",
        format: (_, row) => `${row.to?.time || "-"} (${row.to?.lat?.toFixed(6) || "-"}, ${row.to?.lon?.toFixed(6) || "-"})`
      },
      { key: "distance_km", label: "距離(km)" },
      { key: "speed_kmh", label: "速度(km/h)" },
      { key: "description", label: "描述" }
    ]);

    renderHourlyChart(result.hourly_distribution);
    renderMap(result.map);

    if (els.exportMenuToggle) {
      els.exportMenuToggle.disabled = false;
    }
    if (els.runAiAnalysis) {
      els.runAiAnalysis.disabled = false;
    }

    const summary = result.summary;
    const sourceText = sourceLabel ? `來源 ${sourceLabel}；` : "";
    const swappedNote = summary.coordinate_swapped_fixed ? "（經緯度已自動修正）" : "";
    setStatus(
      `${sourceText}車牌 ${summary.plate_display}；原始 ${summary.raw_records} 筆，清洗後 ${summary.clean_records} 筆；傳送門剔除 ${summary.teleportation_removed} 筆${swappedNote}`,
      "success"
    );
  }
function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType || "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportSelectedCsv() {
    if (!els.exportType) return;
    const type = els.exportType.value;
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    if (type === "stay" && state.csvExports.stay) {
      downloadTextFile(`stay_over_10m_${stamp}.csv`, state.csvExports.stay, "text/csv;charset=utf-8;");
      return;
    }
    if (type === "hotspot" && state.csvExports.hotspot) {
      downloadTextFile(`hotspots_top50_${stamp}.csv`, state.csvExports.hotspot, "text/csv;charset=utf-8;");
      return;
    }
    if (type === "validation" && state.csvExports.validation) {
      downloadTextFile(`validation_pairs_${stamp}.csv`, state.csvExports.validation, "text/csv;charset=utf-8;");
      return;
    }
    setStatus("No export data yet. Please run analysis first.", "error");
  }

  function getCurrentAiModel() {
    if (!els.aiModelSelect) return "";
    if (els.aiModelSelect.value === "custom") {
      return String(els.aiModelCustom?.value || "").trim();
    }
    return String(els.aiModelSelect.value || "").trim();
  }

  function setModelCustomInputState() {
    if (!els.aiModelCustom || !els.aiModelSelect) return;
    const isCustom = els.aiModelSelect.value === "custom";
    els.aiModelCustom.disabled = !isCustom;
  }

  function ensureModelSelectPlaceholder() {
    if (!els.aiModelSelect) return;
    if (els.aiModelSelect.options.length === 0) {
      els.aiModelSelect.innerHTML = "";
    }

    const firstValue = String(els.aiModelSelect.options[0]?.value || "");
    if (els.aiModelSelect.options.length <= 2 && (firstValue === "" || firstValue === "custom")) {
      els.aiModelSelect.innerHTML = "";
      const tip = document.createElement("option");
      tip.value = "";
      tip.textContent = "Please input API key to load models";
      tip.disabled = true;
      tip.selected = true;
      els.aiModelSelect.appendChild(tip);

      const custom = document.createElement("option");
      custom.value = "custom";
      custom.textContent = "custom";
      els.aiModelSelect.appendChild(custom);
    }
  }

  function normalizeModelName(modelName) {
    const raw = String(modelName || "").trim();
    return raw.startsWith("models/") ? raw.slice(7) : raw;
  }

  function buildGeminiEndpoint(endpointTemplate, model, apiKey) {
    let endpoint = String(endpointTemplate || GEMINI_ENDPOINT_DEFAULT).trim();
    if (!endpoint) endpoint = GEMINI_ENDPOINT_DEFAULT;

    if (endpoint.includes("{model}")) {
      endpoint = endpoint.replace(/\{model\}/g, model);
    } else if (/\/v1beta\/?$/.test(endpoint) || /\/v1\/?$/.test(endpoint)) {
      endpoint = `${endpoint.replace(/\/$/, "")}/models/${model}:generateContent`;
    }

    const url = new URL(endpoint);
    url.searchParams.delete("key");
    if (apiKey) {
      url.searchParams.append("key", apiKey);
    }
    return url.toString();
  }

  function safeEndpointDisplay(endpointWithKey) {
    try {
      const url = new URL(endpointWithKey);
      if (url.searchParams.has("key")) {
        url.searchParams.set("key", "***");
      }
      return url.toString();
    } catch (error) {
      return endpointWithKey;
    }
  }

  function buildGeminiModelsEndpoint(endpointTemplate, apiKey, pageToken = "") {
    const endpointRaw = String(endpointTemplate || GEMINI_ENDPOINT_DEFAULT).trim() || GEMINI_ENDPOINT_DEFAULT;
    const seed = endpointRaw.includes("{model}") ? endpointRaw.replace(/\{model\}/g, "gemini-2.5-flash") : endpointRaw;
    const url = new URL(seed);

    let path = url.pathname;
    if (path.includes("/models/")) {
      path = `${path.split("/models/")[0]}/models`;
    } else if (/\/v1beta\/?$/.test(path) || /\/v1\/?$/.test(path)) {
      path = `${path.replace(/\/$/, "")}/models`;
    } else if (!/\/models\/?$/.test(path)) {
      path = `${path.replace(/\/$/, "")}/models`;
    }
    url.pathname = path;

    url.search = "";
    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }
    url.searchParams.set("pageSize", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    return url.toString();
  }

  async function fetchGeminiModelsFromApi(apiKey) {
    const found = [];
    let pageToken = "";

    for (let i = 0; i < 5; i += 1) {
      const endpoint = buildGeminiModelsEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, apiKey, pageToken);
      const response = await fetch(endpoint, { method: "GET" });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const models = Array.isArray(payload?.models) ? payload.models : [];
      for (const model of models) {
        const name = normalizeModelName(model?.name);
        if (!name) continue;
        if (!/^gemini/i.test(name)) continue;

        const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
        if (methods.length > 0 && !methods.includes("generateContent")) continue;

        found.push(name);
      }

      pageToken = String(payload?.nextPageToken || "");
      if (!pageToken) break;
    }

    const deduped = Array.from(new Set(found));
    deduped.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    return deduped;
  }

  function applyModelOptions(modelNames) {
    if (!els.aiModelSelect) return;
    const previous = getCurrentAiModel();
    const wasCustom = els.aiModelSelect.value === "custom";

    els.aiModelSelect.innerHTML = "";

    if (!modelNames.length) {
      const tip = document.createElement("option");
      tip.value = "";
      tip.textContent = "No models loaded";
      tip.disabled = true;
      tip.selected = true;
      els.aiModelSelect.appendChild(tip);
    } else {
      for (const modelName of modelNames) {
        const option = document.createElement("option");
        option.value = modelName;
        option.textContent = modelName;
        els.aiModelSelect.appendChild(option);
      }
    }

    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "custom";
    els.aiModelSelect.appendChild(customOption);

    if (previous && modelNames.includes(previous)) {
      els.aiModelSelect.value = previous;
    } else if (wasCustom || (previous && !modelNames.includes(previous))) {
      els.aiModelSelect.value = "custom";
      if (els.aiModelCustom && previous && !els.aiModelCustom.value) {
        els.aiModelCustom.value = previous;
      }
    } else if (modelNames.length) {
      els.aiModelSelect.value = modelNames[0];
    } else {
      els.aiModelSelect.value = "custom";
    }

    setModelCustomInputState();
  }

  async function refreshGeminiModels(options = {}) {
    const silent = Boolean(options.silent);
    const apiKey = String(els.aiApiKey?.value || "").trim();
    ensureModelSelectPlaceholder();

    if (!apiKey) {
      if (!silent) {
        setStatus("Please enter Gemini API key first.", "error");
      }
      applyModelOptions([]);
      updateAiEndpointPreview();
      return;
    }

    state.modelRefreshToken += 1;
    const token = state.modelRefreshToken;
    state.modelsLoading = true;

    const previousButtonText = els.refreshModels?.textContent || "";
    if (els.refreshModels) {
      els.refreshModels.disabled = true;
      els.refreshModels.textContent = "更新中...";
    }

    if (!silent) {
      setStatus("Loading Gemini models...", "");
    }

    try {
      const models = await fetchGeminiModelsFromApi(apiKey);
      if (token !== state.modelRefreshToken) return;
      applyModelOptions(models);
      if (!silent) {
        setStatus(`Gemini models loaded: ${models.length}`, "success");
      }
    } catch (error) {
      if (token !== state.modelRefreshToken) return;
      if (!silent) {
        setStatus(`Load model list failed: ${error.message}`, "error");
      }
    } finally {
      if (token === state.modelRefreshToken) {
        state.modelsLoading = false;
        if (els.refreshModels) {
          els.refreshModels.disabled = false;
          els.refreshModels.textContent = previousButtonText || "更新模型";
        }
        updateAiEndpointPreview();
      }
    }
  }

  function updateAiEndpointPreview() {
    if (!els.aiEndpointPreview) return;
    const model = getCurrentAiModel() || "gemini-2.5-flash";
    try {
      const endpoint = buildGeminiEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, model, "YOUR_KEY");
      const modelsEndpoint = buildGeminiModelsEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, "YOUR_KEY");
      els.aiEndpointPreview.textContent = `generateContent: ${safeEndpointDisplay(endpoint)} | listModels: ${safeEndpointDisplay(modelsEndpoint)}`;
    } catch (error) {
      els.aiEndpointPreview.textContent = `URL error: ${error.message}`;
    }
  }
function extractGeminiText(payload) {
    const chunks = [];
    const candidates = payload?.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts || [];
      for (const part of parts) {
        if (part?.text) {
          chunks.push(part.text);
        }
      }
    }
    return chunks.join("\n\n").trim();
  }

  function buildAiContext() {
    if (!state.analysis) return {};
    return {
      summary: state.analysis.summary,
      stays: state.analysis.stays.slice(0, 300),
      parking_60: state.analysis.parking_60.slice(0, 200),
      overnight: state.analysis.overnight.slice(0, 200),
      hotspots: state.analysis.hotspots.slice(0, 50),
      teleportations: state.analysis.anomalies.teleportations.slice(0, 200),
      hourly_distribution: state.analysis.hourly_distribution
    };
  }

  async function runGeminiAnalysis() {
    if (!state.analysis) {
      setStatus("Please run data analysis before AI analysis.", "error");
      return;
    }

    const apiKey = String(els.aiApiKey?.value || "").trim();
    const prompt = String(els.aiPrompt?.value || "").trim();
    const model = getCurrentAiModel();

    if (!apiKey) {
      setStatus("Please enter Gemini API key.", "error");
      return;
    }
    if (!model) {
      setStatus("Please choose a Gemini model.", "error");
      return;
    }
    if (!prompt) {
      setStatus("Please enter a prompt.", "error");
      return;
    }

    const context = buildAiContext();
    const composedPrompt = `${prompt}\n\n以下為系統分析資料(JSON)，請基於此資料回答，避免憑空推測：\n${JSON.stringify(context, null, 2)}`;

    let endpoint = "";
    try {
      endpoint = buildGeminiEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, model, apiKey);
    } catch (error) {
      setStatus(`API URL error: ${error.message}`, "error");
      return;
    }

    if (els.aiOutput) {
      els.aiOutput.textContent = "Gemini analyzing...";
    }
    setStatus("Calling Gemini API...", "");

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: composedPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const text = extractGeminiText(payload);
      if (!text) {
        throw new Error("Gemini returned empty text.");
      }
      if (els.aiOutput) {
        els.aiOutput.textContent = `[model] ${model}\n[API] ${safeEndpointDisplay(endpoint)}\n\n${text}`;
      }
      setStatus("Gemini analysis completed.", "success");
    } catch (error) {
      if (els.aiOutput) {
        els.aiOutput.textContent = `Gemini failed: ${error.message}`;
      }
      setStatus(`Gemini failed: ${error.message}`, "error");
    }
  }

  async function parseWorkbookArrayBuffer(arrayBuffer) {
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

  async function analyzeWithRows(rows, sourceLabel) {
    stopPlayback();
    setStatus("Analyzing data...", "");
    const strict = Boolean(els.strictDistance?.checked);
    const result = analyzeRecords(rows, { strictDistanceTeleport: strict });
    renderResult(result, sourceLabel);
  }

  async function handleAnalyzeSubmit(event) {
    event.preventDefault();
    const file = els.fileInput?.files?.[0];
    if (!file) {
      setStatus("Please choose a file.", "error");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const rows = await parseWorkbookArrayBuffer(buffer);
      await analyzeWithRows(rows, file.name);
    } catch (error) {
      setStatus(`Analyze failed: ${error.message}`, "error");
    }
  }

function setActiveView(viewKey) {
    const menuItems = Array.from(document.querySelectorAll(".menu-item"));
    menuItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.view === viewKey);
    });

    els.views.forEach((view) => {
      view.classList.toggle("active", view.id === `view-${viewKey}`);
    });

    if (viewKey === "map" && state.map) {
      setTimeout(() => state.map.invalidateSize(), 120);
    }
  }

  function bindEvents() {
    if (els.menu) {
      els.menu.addEventListener("click", (event) => {
        const button = event.target.closest(".menu-item");
        if (!button) return;
        setActiveView(button.dataset.view);
      });
    }

    els.sidebarToggle?.addEventListener("click", () => {
      els.sidebar?.classList.toggle("collapsed");
      const icon = els.sidebarToggle.querySelector(".material-symbols-rounded");
      if (icon) {
        icon.textContent = els.sidebar?.classList.contains("collapsed") ? "left_panel_close" : "left_panel_open";
      }
      if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 200);
      }
    });

    els.analyzeForm?.addEventListener("submit", handleAnalyzeSubmit);

    els.toggleTeleport?.addEventListener("click", () => {
      setTeleportVisible(!state.teleportVisible);
    });

    els.timelineSlider?.addEventListener("input", async (event) => {
      stopPlayback();
      const value = Number(event.target.value);
      await setTimelineIndex(value, { focus: true });
    });

    els.timelineSelect?.addEventListener("change", async (event) => {
      stopPlayback();
      const value = Number(event.target.value);
      await setTimelineIndex(value, { focus: true });
    });

    els.timelinePicker?.addEventListener("change", async (event) => {
      stopPlayback();
      const dt = parseRocDateTime(event.target.value);
      if (!dt) return;
      const idx = findNearestTrackIndex(dt);
      await setTimelineIndex(idx, { focus: true });
    });

    els.playTimeline?.addEventListener("click", togglePlayback);
    els.playbackSpeed?.addEventListener("input", updatePlaybackSpeedLabel);

    els.exportMenuToggle?.addEventListener("click", () => {
      els.exportMenu?.classList.toggle("hidden");
    });
    els.exportDownload?.addEventListener("click", exportSelectedCsv);

    const debouncedModelRefresh = debounce(() => {
      refreshGeminiModels({ silent: true });
    }, 700);

    els.aiModelSelect?.addEventListener("change", () => {
      setModelCustomInputState();
      updateAiEndpointPreview();
    });
    els.aiModelCustom?.addEventListener("input", updateAiEndpointPreview);

    els.aiApiKey?.addEventListener("input", () => {
      debouncedModelRefresh();
    });
    els.aiApiKey?.addEventListener("change", () => {
      refreshGeminiModels({ silent: true });
    });

    els.aiEndpointUrl?.addEventListener("input", () => {
      updateAiEndpointPreview();
      debouncedModelRefresh();
    });

    els.refreshModels?.addEventListener("click", () => {
      refreshGeminiModels({ silent: false });
    });
    els.runAiAnalysis?.addEventListener("click", runGeminiAnalysis);

    window.addEventListener("resize", () => {
      if (state.map) {
        state.map.invalidateSize();
      }
    });
  }

  function init() {
    bindEvents();
    ensureDefaultAiPrompt();
    initMapIfNeeded();
    updatePlaybackSpeedLabel();
    ensureModelSelectPlaceholder();
    updateAiEndpointPreview();
    setModelCustomInputState();
    if (els.exportMenuToggle) {
      els.exportMenuToggle.disabled = true;
    }
    if (els.runAiAnalysis) {
      els.runAiAnalysis.disabled = true;
    }
    if (String(els.aiApiKey?.value || "").trim()) {
      refreshGeminiModels({ silent: true });
    }
    setTeleportVisible(false);
    showFirstOpenNoticeIfNeeded();
  }

  init();
})();





