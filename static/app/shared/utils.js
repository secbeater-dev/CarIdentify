import {
  DEFAULT_MAP_SETTINGS,
  DEFAULT_NORMAL_DRIVING_SPEED_KMH,
  DEFAULT_PARKING_SETTINGS,
  FIRST_OPEN_NOTICE_KEY,
  MAP_SETTINGS_KEY,
  MAX_NORMAL_DRIVING_SPEED_KMH,
  MIN_NORMAL_DRIVING_SPEED_KMH,
  PARKING_SETTINGS_KEY
} from "./constants.js?v=20260408e";

export function pad2(value) {
  return String(value).padStart(2, "0");
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, delayMs) {
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

export function loadStorageJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

export function saveStorageJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Keep app functional if storage is unavailable.
  }
}

export function loadUserSettings() {
  return {
    mapSettings: normalizeMapSettings(loadStorageJson(MAP_SETTINGS_KEY, DEFAULT_MAP_SETTINGS)),
    parkingSettings: normalizeParkingSettings(loadStorageJson(PARKING_SETTINGS_KEY, DEFAULT_PARKING_SETTINGS))
  };
}

export function saveMapSettings(value) {
  saveStorageJson(MAP_SETTINGS_KEY, value);
}

export function saveParkingSettings(value) {
  saveStorageJson(PARKING_SETTINGS_KEY, value);
}

export function normalizeMapSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_MAP_SETTINGS,
    pointColor: String(source.pointColor || DEFAULT_MAP_SETTINGS.pointColor),
    pointRadius: clamp(Number(source.pointRadius) || DEFAULT_MAP_SETTINGS.pointRadius, 3, 14),
    showPointNumbers: source.showPointNumbers !== false,
    showPointDetails: Boolean(source.showPointDetails),
    focusWindowOnly: Boolean(source.focusWindowOnly),
    textOpacity: clamp(Number(source.textOpacity) || DEFAULT_MAP_SETTINGS.textOpacity, 0, 100),
    textSize: clamp(Number(source.textSize) || DEFAULT_MAP_SETTINGS.textSize, 8, 24),
    lineColor: String(source.lineColor || DEFAULT_MAP_SETTINGS.lineColor),
    lineStyle: ["solid", "dashed", "dashed-arrow", "arrow"].includes(source.lineStyle)
      ? source.lineStyle
      : DEFAULT_MAP_SETTINGS.lineStyle,
    lineWeight: clamp(Number(source.lineWeight) || DEFAULT_MAP_SETTINGS.lineWeight, 1, 10),
    roadRouting: Boolean(source.roadRouting)
  };
}

export function normalizeParkingSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const durationCategory = ["4-6", "10-60", "60+", "custom"].includes(source.durationCategory)
    ? source.durationCategory
    : DEFAULT_PARKING_SETTINGS.durationCategory;
  const customMin = Math.max(0, Math.round(Number(source.customMin) || DEFAULT_PARKING_SETTINGS.customMin));
  const customMax = Math.max(0, Math.round(Number(source.customMax) || DEFAULT_PARKING_SETTINGS.customMax));
  return {
    ...DEFAULT_PARKING_SETTINGS,
    durationCategory,
    customMin,
    customMax,
    popupOpacity: clamp(Number(source.popupOpacity) || DEFAULT_PARKING_SETTINGS.popupOpacity, 35, 100)
  };
}

export function applyParkingPopupOpacityCss(opacityPercent) {
  const normalized = clamp(Number(opacityPercent) || DEFAULT_PARKING_SETTINGS.popupOpacity, 35, 100);
  document.documentElement.style.setProperty("--parking-popup-opacity", `${normalized / 100}`);
}

export function normalizeNormalDrivingSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_NORMAL_DRIVING_SPEED_KMH;
  }
  return clamp(Math.round(parsed), MIN_NORMAL_DRIVING_SPEED_KMH, MAX_NORMAL_DRIVING_SPEED_KMH);
}

export function getParkingDurationRange(settings) {
  const category = String(settings?.durationCategory || "10-60");
  if (category === "4-6") {
    return { min: 4, max: 6, label: "4–6 分鐘" };
  }
  if (category === "60+") {
    return { min: 60, max: Number.POSITIVE_INFINITY, label: "60 分鐘以上" };
  }
  if (category === "custom") {
    const min = Math.max(0, Number(settings?.customMin) || 0);
    const maxRaw = Math.max(0, Number(settings?.customMax) || 0);
    const [a, b] = min <= maxRaw ? [min, maxRaw] : [maxRaw, min];
    return { min: a, max: b, label: `${a}–${b} 分鐘` };
  }
  return { min: 10, max: 59, label: "10–59 分鐘" };
}

export function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizePlate(value) {
  return String(value ?? "")
    .toUpperCase()
    .trim()
    .replace(/-/g, "")
    .replace(/\s+/g, "");
}

export function formatDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatDuration(minutes) {
  const rounded = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `${hours}小時${mins}分鐘`;
}

export function formatDurationDhm(minutes) {
  const rounded = Math.max(0, Math.round(Number(minutes) || 0));
  const days = Math.floor(rounded / 1440);
  const hours = Math.floor((rounded % 1440) / 60);
  const mins = rounded % 60;
  if (days > 0) return `${days}天${hours}小時${mins}分鐘`;
  return `${hours}小時${mins}分鐘`;
}

export function getTimeOfDaySeconds(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return NaN;
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

export function getTimeOfDayMinutes(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return NaN;
  return date.getHours() * 60 + date.getMinutes();
}

export function formatTimeOfDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "-";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function parseRocDateTime(input) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return new Date(input.getTime());
  }
  if (input === null || input === undefined) return null;

  const raw = String(input).trim();
  if (!raw) return null;

  const normalized = raw.replace("T", " ");
  const match = normalized.match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
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

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371.0088;
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dphi = (lat2 - lat1) * toRad;
  const dlambda = (lon2 - lon1) * toRad;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function overlapNightHours(start, end) {
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

    for (const [wStart, wEnd] of [[aStart, aEnd], [bStart, bEnd]]) {
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

export function overlapDayHours(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (end <= start) return 0;

  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
  let total = 0;

  while (cursor < endDay) {
    const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 6, 0, 0, 0);
    const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 22, 0, 0, 0);
    const left = Math.max(start.getTime(), dayStart.getTime());
    const right = Math.min(end.getTime(), dayEnd.getTime());
    if (right > left) {
      total += (right - left) / 3600000;
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0, 0);
  }

  return total;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function rowsToCsv(rows, headers) {
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

export function minuteToTimeInput(totalMinutes) {
  const normalized = ((Math.round(Number(totalMinutes) || 0) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function timeInputToMinute(value, fallback = 0) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = clamp(Number(match[1]), 0, 23);
  const minutes = clamp(Number(match[2]), 0, 59);
  return hours * 60 + minutes;
}

export function hasSeenFirstOpenNotice() {
  try {
    return window.localStorage.getItem(FIRST_OPEN_NOTICE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

export function markFirstOpenNoticeSeen() {
  try {
    window.localStorage.setItem(FIRST_OPEN_NOTICE_KEY, "1");
  } catch (error) {
    // Ignore storage write failures.
  }
}

export function clearLocalSettingsAndReload() {
  const clearMatchingKeys = (storage) => {
    if (!storage) return;
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (key.startsWith("caridentify-") || key.startsWith("sb-first-open-notice-")) {
        storage.removeItem(key);
      }
    }
  };

  try {
    clearMatchingKeys(window.localStorage);
    clearMatchingKeys(window.sessionStorage);
  } catch (error) {
    // Ignore storage failures and continue to reload.
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("_refresh", String(Date.now()));
  window.location.replace(nextUrl.toString());
}

export function configureSidebarYoutubeEmbed(sidebarYoutube, sidebarYoutubeFallback) {
  const iframe = sidebarYoutube;
  if (!iframe) return;

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const isHttpLike = protocol === "http:" || protocol === "https:";
  if (!isHttpLike) {
    iframe.classList.add("hidden");
    sidebarYoutubeFallback?.classList.remove("hidden");
    return;
  }

  const originRaw = String(window.location?.origin || "").trim();
  const origin = originRaw && originRaw !== "null" ? originRaw : "https://car.secbeater.com";
  const url = new URL("https://www.youtube.com/embed/DsLqD3MINT8");
  url.searchParams.set("rel", "0");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("modestbranding", "1");
  url.searchParams.set("origin", origin);
  iframe.src = url.toString();
  iframe.classList.remove("hidden");
  sidebarYoutubeFallback?.classList.add("hidden");
}



