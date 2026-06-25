import {
  DEFAULT_AI_PROMPT,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_NORMAL_DRIVING_SPEED_KMH,
  DEFAULT_PARKING_SETTINGS,
  GEMINI_ENDPOINT_DEFAULT,
  HOME,
  MAP_DEFAULT_VIEW,
  MAP_SETTINGS_KEY,
  MAX_NORMAL_DRIVING_SPEED_KMH,
  MIN_NORMAL_DRIVING_SPEED_KMH,
  OVERNIGHT_MODE_DAY,
  OVERNIGHT_MODE_NIGHT,
  PARKING_CLUSTER_RADIUS_M,
  PARKING_SETTINGS_KEY
} from "./shared/constants.js?v=20260607a";
import { els } from "./shared/dom.js?v=20260625a";
import { state } from "./shared/state.js?v=20260607a";
import { renderOvernightView as renderOvernightPanel, invalidateOvernightMap, updateOvernightModeUi as syncOvernightModeUi } from "./views/overnightView.js?v=20260607a";
import { renderHotspotsView, invalidateHotspotsMap } from "./views/hotspotsView.js?v=20260607a";
import {
  invalidateRoutineMap,
  renderRoutineView,
  resetRoutineDraftHours,
  selectAllRoutineDraftHours,
  syncRoutineFilterUi,
  toggleRoutineDraftHour
} from "./views/routineView.js?v=20260607a";
import { renderTable } from "./views/tableView.js?v=20260607a";
import { createParkingView } from "./views/parkingView.js?v=20260607a";
import { createMainMapView } from "./views/mainMapView.js?v=20260625a";
import { createAiView } from "./views/aiView.js?v=20260607a";
import { normalizeRoutineFilter } from "./analysis/timeFilters.js?v=20260607a";

const FIRST_OPEN_NOTICE_DAILY_KEY = "sb-first-open-notice-20260625-daily";
const THEME_COOKIE_NAME = "caridentify-theme";
const DISQUS_SHORTNAME = "secbeatercom";
const DISQUS_THREAD_URL = "https://car.secbeater.com/?view=comments";
const DISQUS_THREAD_IDENTIFIER = "caridentify-comments";
const DISQUS_THREAD_TITLE = "車輛辨識系統留言板";
let disqusLoaded = false;
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

  function loadStorageJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveStorageJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Keep app functional if storage is unavailable.
    }
  }

  function readCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function writeCookie(name, value, days = 365) {
    const maxAge = Math.max(1, Math.round(days * 86400));
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  }

  function getPreferredTheme() {
    const stored = readCookie(THEME_COOKIE_NAME);
    return stored === "dark" ? "dark" : "light";
  }

  function getThemeElements() {
    return {
      toggle: els.themeToggle || document.getElementById("theme-toggle"),
      icon: els.themeToggleIcon || document.getElementById("theme-toggle-icon"),
      label: els.themeToggleLabel || document.getElementById("theme-toggle-label")
    };
  }

  function syncThemeToggleUi(theme) {
    const isDark = theme === "dark";
    const themeEls = getThemeElements();
    if (themeEls.toggle) {
      themeEls.toggle.title = isDark ? "切換淺色模式" : "切換深色模式";
      themeEls.toggle.setAttribute("aria-label", themeEls.toggle.title);
      themeEls.toggle.setAttribute("aria-pressed", String(isDark));
    }
    if (themeEls.icon) {
      themeEls.icon.textContent = isDark ? "light_mode" : "dark_mode";
    }
    if (themeEls.label) {
      themeEls.label.textContent = isDark ? "淺色模式" : "深色模式";
    }
  }

  function applyTheme(theme, options = {}) {
    const normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = normalized;
    if (options.persist !== false) {
      writeCookie(THEME_COOKIE_NAME, normalized);
    }
    syncThemeToggleUi(normalized);
    rerenderMapIfReady();
    rerenderParkingIfReady();
    rerenderRoutineIfReady();
    invalidateOvernightMap();
    invalidateHotspotsMap();
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function loadDisqusComments() {
    const disqusThread = els.disqusThread || document.getElementById("disqus_thread");
    if (disqusLoaded || !disqusThread || !DISQUS_SHORTNAME) return;
    disqusLoaded = true;
    window.disqus_config = function () {
      this.page.url = DISQUS_THREAD_URL;
      this.page.identifier = DISQUS_THREAD_IDENTIFIER;
      this.page.title = DISQUS_THREAD_TITLE;
      this.language = "zh_TW";
    };
    const script = document.createElement("script");
    script.src = `https://${DISQUS_SHORTNAME}.disqus.com/embed.js`;
    script.id = "dsq-embed-scr";
    script.setAttribute("data-timestamp", String(Date.now()));
    script.async = true;
    script.onerror = () => {
      if (disqusThread) {
        disqusThread.innerHTML = '<div class="comments-placeholder is-error">留言板暫時無法載入，請稍後再試。</div>';
      }
    };
    (document.head || document.body).appendChild(script);
  }

  function configureSidebarYoutubeEmbed() {
    const iframe = els.sidebarYoutube;
    if (!iframe) return;

    const protocol = String(window.location?.protocol || "").toLowerCase();
    const isHttpLike = protocol === "http:" || protocol === "https:";
    if (!isHttpLike) {
      iframe.classList.add("hidden");
      els.sidebarYoutubeFallback?.classList.remove("hidden");
      return;
    }

    const originRaw = String(window.location?.origin || "").trim();
    const origin = originRaw && originRaw !== "null" ? originRaw : "https://car.secbeater.com";
    const url = new URL("https://www.youtube.com/embed/sKAnrjRpt40");
    url.searchParams.set("rel", "0");
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("modestbranding", "1");
    url.searchParams.set("origin", origin);
    iframe.src = url.toString();
    iframe.classList.remove("hidden");
    els.sidebarYoutubeFallback?.classList.add("hidden");
  }

  function normalizeMapSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    return {
      pointColor: /^#[0-9a-f]{6}$/i.test(String(input.pointColor || "")) ? String(input.pointColor) : DEFAULT_MAP_SETTINGS.pointColor,
      pointRadius: clamp(Number(input.pointRadius) || DEFAULT_MAP_SETTINGS.pointRadius, 2, 24),
      showPointNumbers: input.showPointNumbers !== false,
      showPointDetails: Boolean(input.showPointDetails),
      focusWindowOnly: Boolean(input.focusWindowOnly),
      textOpacity: clamp(Number(input.textOpacity) || DEFAULT_MAP_SETTINGS.textOpacity, 0, 100),
      textSize: clamp(Number(input.textSize) || DEFAULT_MAP_SETTINGS.textSize, 8, 24),
      lineColor: /^#[0-9a-f]{6}$/i.test(String(input.lineColor || "")) ? String(input.lineColor) : DEFAULT_MAP_SETTINGS.lineColor,
      lineStyle: ["solid", "dashed", "dashed-arrow", "arrow"].includes(String(input.lineStyle || ""))
        ? String(input.lineStyle)
        : DEFAULT_MAP_SETTINGS.lineStyle,
      lineWeight: clamp(Number(input.lineWeight) || DEFAULT_MAP_SETTINGS.lineWeight, 1, 10),
      roadRouting: Boolean(input.roadRouting)
    };
  }

  function normalizeParkingSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const category = ["4-6", "10-60", "60+", "custom"].includes(String(input.durationCategory || ""))
      ? String(input.durationCategory)
      : DEFAULT_PARKING_SETTINGS.durationCategory;

    const customMin = Math.max(0, Number.parseFloat(input.customMin));
    const customMax = Math.max(0, Number.parseFloat(input.customMax));
    const popupOpacity = clamp(Number(input.popupOpacity) || DEFAULT_PARKING_SETTINGS.popupOpacity, 35, 100);
    return {
      durationCategory: category,
      customMin: Number.isFinite(customMin) ? customMin : DEFAULT_PARKING_SETTINGS.customMin,
      customMax: Number.isFinite(customMax) ? customMax : DEFAULT_PARKING_SETTINGS.customMax,
      popupOpacity: Number.isFinite(popupOpacity) ? popupOpacity : DEFAULT_PARKING_SETTINGS.popupOpacity
    };
  }

  function loadUserSettings() {
    state.mapSettings = normalizeMapSettings(loadStorageJson(MAP_SETTINGS_KEY, DEFAULT_MAP_SETTINGS));
    state.parkingSettings = normalizeParkingSettings(loadStorageJson(PARKING_SETTINGS_KEY, DEFAULT_PARKING_SETTINGS));
  }

  function saveMapSettings() {
    saveStorageJson(MAP_SETTINGS_KEY, state.mapSettings);
  }

  function saveParkingSettings() {
    saveStorageJson(PARKING_SETTINGS_KEY, state.parkingSettings);
  }

  function syncMapSettingsUi() {
    const settings = state.mapSettings;
    if (els.mapPointColor) els.mapPointColor.value = settings.pointColor;
    if (els.mapPointNumbering) els.mapPointNumbering.checked = settings.showPointNumbers;
    if (els.mapPointDetails) els.mapPointDetails.checked = settings.showPointDetails;
    if (els.mapFocusWindowOnly) els.mapFocusWindowOnly.checked = settings.focusWindowOnly;
    if (els.mapTextOpacity) els.mapTextOpacity.value = String(settings.textOpacity);
    if (els.mapTextSize) els.mapTextSize.value = String(settings.textSize);
    if (els.mapLineColor) els.mapLineColor.value = settings.lineColor;
    if (els.mapLineStyle) els.mapLineStyle.value = settings.lineStyle;
    if (els.mapLineWeight) els.mapLineWeight.value = String(settings.lineWeight);
    if (els.mapRoadRouting) els.mapRoadRouting.checked = settings.roadRouting;

    if (els.mapTextOpacityLabel) {
      els.mapTextOpacityLabel.textContent = `${Math.round(settings.textOpacity)}%`;
    }
    if (els.mapLineWeightLabel) {
      els.mapLineWeightLabel.textContent = `${Math.round(settings.lineWeight)}px`;
    }
  }

  function syncParkingSettingsUi() {
    const settings = state.parkingSettings;
    for (const radio of els.parkingDurationRadios) {
      radio.checked = radio.value === settings.durationCategory;
    }
    if (els.parkingCustomMin) els.parkingCustomMin.value = String(settings.customMin);
    if (els.parkingCustomMax) els.parkingCustomMax.value = String(settings.customMax);
    if (els.parkingPopupOpacity) els.parkingPopupOpacity.value = String(settings.popupOpacity);
    if (els.parkingPopupOpacityLabel) els.parkingPopupOpacityLabel.textContent = `${Math.round(settings.popupOpacity)}%`;
    applyParkingPopupOpacityCss(settings.popupOpacity);
  }

  function applyParkingPopupOpacityCss(opacityPercent) {
    const normalized = clamp(Number(opacityPercent) || DEFAULT_PARKING_SETTINGS.popupOpacity, 35, 100);
    const alpha = Math.max(0.35, Math.min(1, normalized / 100));
    document.documentElement.style.setProperty("--parking-popup-opacity", alpha.toFixed(2));
  }

  function normalizeNormalDrivingSpeed(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_NORMAL_DRIVING_SPEED_KMH;
    }
    return clamp(Math.round(parsed), MIN_NORMAL_DRIVING_SPEED_KMH, MAX_NORMAL_DRIVING_SPEED_KMH);
  }

  function getNormalDrivingSpeedFromUi(options = {}) {
    const syncInput = options.syncInput !== false;
    const normalized = normalizeNormalDrivingSpeed(els.normalDrivingSpeed?.value);
    if (syncInput && els.normalDrivingSpeed) {
      els.normalDrivingSpeed.value = String(normalized);
    }
    return normalized;
  }

  function resetNormalDrivingSpeedToDefault() {
    if (els.normalDrivingSpeed) {
      els.normalDrivingSpeed.value = String(DEFAULT_NORMAL_DRIVING_SPEED_KMH);
    }
  }

  function getParkingDurationRange(settings) {
    const category = String(settings.durationCategory || "");
    if (category === "4-6") {
      return { min: 4, max: 6, label: "4–6 分鐘" };
    }
    if (category === "60+") {
      return { min: 60, max: Number.POSITIVE_INFINITY, label: "60 分鐘以上" };
    }
    if (category === "custom") {
      const min = Math.max(0, Number(settings.customMin) || 0);
      const maxRaw = Math.max(0, Number(settings.customMax) || 0);
      const [a, b] = min <= maxRaw ? [min, maxRaw] : [maxRaw, min];
      return { min: a, max: b, label: `${a}–${b} 分鐘` };
    }
    return { min: 10, max: 59, label: "10–59 分鐘" };
  }

  function clearLocalSettingsAndReload() {
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

  function getDailyNoticeStamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function hasSeenFirstOpenNoticeToday() {
    try {
      return window.localStorage.getItem(FIRST_OPEN_NOTICE_DAILY_KEY) === getDailyNoticeStamp();
    } catch (error) {
      return false;
    }
  }

  function markFirstOpenNoticeShownToday() {
    try {
      window.localStorage.setItem(FIRST_OPEN_NOTICE_DAILY_KEY, getDailyNoticeStamp());
    } catch (error) {
      // Ignore storage write failures and keep the app functional.
    }
  }

  function showFirstOpenNoticeIfNeeded() {
    if (hasSeenFirstOpenNoticeToday()) return;
    markFirstOpenNoticeShownToday();

    const overlay = document.createElement("div");
    overlay.className = "first-open-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="first-open-modal first-open-welcome-modal">
        <div class="first-open-copy">
          <h3>使用提醒</h3>
          <p>資料均在本地運行，請安心使用。</p>
          <p>任何問題歡迎於 <a href="https://t.me/secbeater" target="_blank" rel="noopener noreferrer">Telegram</a> 中提出。</p>
          <h4>今日重點（2026-06-25）</h4>
          <ul class="first-open-changes">
            <li>新增淺色模式。</li>
            <li>新增留言板。</li>
          </ul>
          <p class="first-open-note">備註：一鍵更新會清除本機設定（地圖/停車/彈窗狀態），並強制重載最新版（等同 Ctrl+F5）。</p>
          <div class="first-open-actions">
            <button type="button" class="ghost-btn first-open-refresh" data-action="refresh">一鍵更新（Ctrl+F5＋清除設定）</button>
            <button type="button" class="run-btn first-open-close" data-action="close">我知道了</button>
          </div>
        </div>
        <a class="first-open-community-card" href="https://t.me/secbeater" target="_blank" rel="noopener noreferrer" aria-label="加入 Telegram">
          <img src="https://cdn.rafled.com/anime-icons/images/6nuiK8b9XPLt.jpg" alt="Telegram" class="first-open-community-image">
          <span>一起跟上 AI 時代，讓 Gemini Pro 成為你的效率夥伴。一年會員限量優惠 NT$1,500（原價 NT$8,280），真誠推薦給想提升自己的你。</span>
        </a>
      </div>
    `;

    const onClose = () => {
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
    overlay.querySelector("[data-action='refresh']")?.addEventListener("click", clearLocalSettingsAndReload);

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

  function formatDurationDhm(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    const days = Math.floor(rounded / 1440);
    const hours = Math.floor((rounded % 1440) / 60);
    const mins = rounded % 60;
    return `${days}天${hours}小時${mins}分鐘`;
  }

  function getTimeOfDaySeconds(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return NaN;
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }

  function formatTimeOfDay(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "-";
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
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

  function overlapDayHours(start, end) {
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
      timestamp: ["時間", "time", "timestamp", "日期時間", "辨識時間", "偵測日期"],
      coord: ["經緯度", "座標", "坐標", "coordinates", "coordinate", "latlon", "lonlat", "gps"],
      lon: ["經度", "longitude", "lon", "lng", "x"],
      lat: ["緯度", "latitude", "lat", "y"],
      source: ["來源", "縣市", "source", "city", "行政區", "國道系統", "行進方向", "門架名稱"],
      note: ["備註", "地址", "路口", "location", "place", "備考", "門架名稱", "國道系統", "行進方向"]
    };
  }

  function detectDatasetFormat(rows) {
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
      "軌跡編號",
      "攝影機名稱",
      "車牌",
      "單位",
      "日期",
      "時間",
      "攝影機",
      "經度",
      "緯度"
    ].every((name) => has(name));
    if (isIdkcityCamera) {
      return "idkcity_camera";
    }
    const isCombinedCoordinate = ["編號", "車號", "時間", "來源", "備註", "經緯度"].every((name) => has(name));
    if (isCombinedCoordinate) {
      return "combined_coordinate";
    }
    if (has("偵測日期") && has("門架名稱") && (has("eTag序號") || has("國道系統") || has("車牌號碼"))) {
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
        throw new Error(`缺少必要欄位: ${displayName}`);
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

  function parseCoordinatePair(value) {
    const matches = String(value ?? "").match(/[-+]?\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 2) {
      return { lon: NaN, lat: NaN };
    }

    const first = Number.parseFloat(matches[0]);
    const second = Number.parseFloat(matches[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return { lon: NaN, lat: NaN };
    }

    const looksLikeTaiwanLon = (num) => num >= 110 && num <= 130;
    const looksLikeTaiwanLat = (num) => num >= 20 && num <= 30;
    if (looksLikeTaiwanLon(first) && looksLikeTaiwanLat(second)) {
      return { lon: first, lat: second };
    }
    if (looksLikeTaiwanLat(first) && looksLikeTaiwanLon(second)) {
      return { lon: second, lat: first };
    }
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
      return { lon: first, lat: second };
    }
    if (Math.abs(second) > 90 && Math.abs(first) <= 90) {
      return { lon: second, lat: first };
    }
    return { lon: first, lat: second };
  }

  function normalizeIdkcityRows(rawRows) {
    const columns = resolveNormalizedColumns(rawRows, {
      trackId: "軌跡編號",
      cameraName: "攝影機名稱",
      plate: "車牌",
      unit: "單位",
      date: "日期",
      time: "時間",
      cameraId: "攝影機",
      lon: "經度",
      lat: "緯度"
    });

    const output = rawRows.map((row, idx) => {
      const cameraIdRaw = row?.[columns.cameraId];
      const cameraIdNum = Number.parseInt(cameraIdRaw, 10);
      const lon = toNumber(row?.[columns.lon]);
      const lat = toNumber(row?.[columns.lat]);
      const dateRaw = row?.[columns.date];
      const timeRaw = row?.[columns.time];
      const timestamp = combineDateAndTime(dateRaw, timeRaw);
      const source = String(row?.[columns.unit] ?? "").trim() || "未提供";
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
          if ((std === "lon" || std === "lat") && selected.coord && key === selected.coord) {
            continue;
          }
          const nk = normalizeHeaderKey(key);
          if (normalizedAliases.some((alias) => nk.includes(alias))) {
            hit = key;
            break;
          }
        }
      }
      if (hit) selected[std] = hit;
    });

    // Fallback: infer timestamp column from values when header aliases are not reliable.
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

    const missing = ["plate", "timestamp"].filter((key) => !selected[key]);
    if (!selected.coord) {
      if (!selected.lon) missing.push("lon");
      if (!selected.lat) missing.push("lat");
    }
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

    if (detectDatasetFormat(rawRows) === "idkcity_camera") {
      return normalizeIdkcityRows(rawRows);
    }

    const selected = detectColumns(rawRows);
    const output = rawRows.map((row, idx) => {
      const idRaw = selected.id ? row[selected.id] : idx + 1;
      const idNum = Number.parseInt(idRaw, 10);
      const coordinatePair = selected.coord ? parseCoordinatePair(row[selected.coord]) : null;
      const lon = coordinatePair ? coordinatePair.lon : toNumber(row[selected.lon]);
      const lat = coordinatePair ? coordinatePair.lat : toNumber(row[selected.lat]);

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
        area: a.source || "未提供",
        lon: Number(a.lon.toFixed(6)),
        lat: Number(a.lat.toFixed(6)),
        closest_address: a.note || a.source || "未提供",
        distance_to_next_m: Number(distM.toFixed(1)),
        speed_kmh: Number(speedKmh.toFixed(2)),
        is_breakpoint_6h: dtMin >= 360,
        day_overlap_h: Number(dayHours.toFixed(2)),
        night_overlap_h: Number(nightHours.toFixed(2)),
        is_overnight: dtMin >= 360 && nightHours >= 1.0,
        is_daytime_long_stay: dtMin >= 360 && dayHours >= 1.0
      };

      if (dtMin >= 1440) {
        stay.stay_type = "長期停放(>=24h)";
      } else if (dtMin >= 360) {
        stay.stay_type = "停駐點(>=6h)";
      } else if (dtMin >= 60) {
        stay.stay_type = "停留點(1-6h)";
      } else {
        stay.stay_type = "停留點(>4m)";
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
        day_overlap_h: s.day_overlap_h,
        night_overlap_h: s.night_overlap_h,
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
  const {
    renderParkingView,
    renderParkingPlaybackSelect,
    setParkingPlaybackButtonUi,
    setParkingPlaybackControlsEnabled,
    setParkingPlaybackIndex,
    stopParkingPlayback,
    toggleParkingPlayback,
    updateParkingPlaybackCurrent,
    updateParkingPlaybackSpeedLabel
  } = createParkingView({
    els,
    state,
    L: typeof L === "undefined" ? undefined : L,
    MAP_DEFAULT_VIEW,
    PARKING_CLUSTER_RADIUS_M,
    clamp,
    escapeHtml,
    formatDateTime,
    formatDuration,
    formatDurationDhm,
    formatTimeOfDay,
    getParkingDurationRange,
    getTimeOfDaySeconds,
    haversineKm,
    parseRocDateTime,
    renderTable,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  });

  const {
    findNearestTrackIndex,
    initMapIfNeeded,
    renderMap,
    setTeleportVisible,
    setTimelineIndex,
    stopPlayback,
    togglePlayback,
    updatePlaybackSpeedLabel
  } = createMainMapView({
    els,
    state,
    HOME,
    MAP_DEFAULT_VIEW,
    clamp,
    escapeHtml,
    formatDateInputValue,
    normalizeMapSettings,
    pad2,
    parseRocDateTime
  });

  const {
    ensureDefaultAiPrompt,
    ensureModelSelectPlaceholder,
    refreshGeminiModels,
    runGeminiAnalysis,
    setModelCustomInputState,
    updateAiEndpointPreview
  } = createAiView({
    DEFAULT_AI_PROMPT,
    GEMINI_ENDPOINT_DEFAULT,
    els,
    state,
    setStatus
  });

  function renderResult(result, sourceLabel) {
    state.analysis = result;
    state.csvExports.stay = result.exports.stay_csv;
    state.csvExports.hotspot = result.exports.hotspot_csv;
    state.csvExports.validation = result.exports.validation_csv;
    stopParkingPlayback({ clearHighlight: true, resetIndex: true });
    state.parkingPlaybackSequence = [];
    state.parkingPlaybackMarkerByCluster = new Map();
    state.parkingMapAutoFitKeys.clear();
    state.parkingMapUserAdjusted = false;

    renderParkingView(result);
    renderOvernightPanel(result);
    renderHotspotsView(result);

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

    renderRoutineView(result);
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
    const cleaningText = summary.cleaning_skipped
      ? "資料清洗：已略過（車輛辨識格式）"
      : `傳送門剔除 ${summary.teleportation_removed} 筆`;
    const speedFilterText = `正常行駛速度門檻 ${summary.normal_speed_threshold_kmh} km/h，停留排除 ${summary.normal_speed_excluded} 筆`;
    setStatus(
      `${sourceText}車牌 ${summary.plate_display}；原始 ${summary.raw_records} 筆，分析樣本 ${summary.clean_records} 筆；${cleaningText}；${speedFilterText}${swappedNote}`,
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
    if (type === "stay" && state.analysis) {
      const range = getParkingDurationRange(state.parkingSettings);
      const rows = (state.analysis.stays || [])
        .filter((row) => Number(row.duration_min) >= range.min && Number(row.duration_min) <= range.max)
        .map((row) => ({
          arrive_time: row.arrive_time,
          leave_time: row.leave_time,
          duration: row.duration_hhmm,
          area: row.area,
          lon: row.lon,
          lat: row.lat,
          address: row.closest_address,
          type: row.stay_type
        }));
      const csv = rowsToCsv(rows, ["arrive_time", "leave_time", "duration", "area", "lon", "lat", "address", "type"]);
      const rangeTag = Number.isFinite(range.max) ? `${range.min}-${range.max}m` : `${range.min}m_plus`;
      downloadTextFile(`parking_${rangeTag}_${stamp}.csv`, csv, "text/csv;charset=utf-8;");
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
    setStatus("尚無可匯出資料，請先完成分析。", "error");
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

  async function analyzeWithRows(rows, sourceLabel, options = {}) {
    stopPlayback();
    setStatus("分析中...", "");
    const strict = Boolean(els.strictDistance?.checked);
    const normalDrivingSpeedKmh = getNormalDrivingSpeedFromUi();
    const result = analyzeRecords(rows, {
      strictDistanceTeleport: strict,
      normalizedRows: options.rowsNormalized ? rows : undefined,
      skipCleaning: Boolean(options.skipCleaning),
      normalDrivingSpeedKmh
    });
    renderResult(result, sourceLabel);
  }

  async function handleAnalyzeSubmit(event) {
    event.preventDefault();
    const files = Array.from(els.fileInput?.files || []);
    if (!files.length) {
      setStatus("請先選擇至少 1 個檔案。", "error");
      return;
    }

    try {
      setStatus(`正在載入 ${files.length} 個檔案...`, "");
      const mergedNormalizedRows = [];
      const datasetFormats = [];
      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          const rows = await parseWorkbookArrayBuffer(buffer);
          datasetFormats.push(detectDatasetFormat(rows));
          const normalizedRows = normalizeRows(rows);
          mergedNormalizedRows.push(...normalizedRows);
        } catch (error) {
          throw new Error(`${file.name}：${error.message}`);
        }
      }
      if (mergedNormalizedRows.length < 2) {
        throw new Error("有效資料不足（至少需要 2 筆有效軌跡）。");
      }
      const sourceLabel = files.length === 1 ? files[0].name : `${files.length} 個檔案`;
      const skipCleaning = datasetFormats.some((format) => format === "vehicle_recognition");
      await analyzeWithRows(mergedNormalizedRows, sourceLabel, { rowsNormalized: true, skipCleaning });
    } catch (error) {
      setStatus(`分析失敗：${error.message}`, "error");
    }
  }

  function rerenderMapIfReady() {
    if (state.analysis?.map) {
      renderMap(state.analysis.map);
    }
  }

  function rerenderParkingIfReady() {
    if (state.analysis) {
      renderParkingView(state.analysis);
    }
  }

  function rerenderOvernightIfReady() {
    if (state.analysis) {
      renderOvernightPanel(state.analysis);
    } else {
      syncOvernightModeUi();
    }
  }

  function rerenderHotspotsIfReady() {
    if (state.analysis) {
      renderHotspotsView(state.analysis);
    }
  }

  function rerenderRoutineIfReady() {
    if (state.analysis) {
      renderRoutineView(state.analysis);
    } else {
      syncRoutineFilterUi();
    }
  }

  function updateMapSettingsFromInputs() {
    state.mapSettings = normalizeMapSettings({
      ...state.mapSettings,
      pointColor: els.mapPointColor?.value,
      showPointNumbers: Boolean(els.mapPointNumbering?.checked),
      showPointDetails: Boolean(els.mapPointDetails?.checked),
      focusWindowOnly: Boolean(els.mapFocusWindowOnly?.checked),
      textOpacity: Number(els.mapTextOpacity?.value),
      textSize: Number(els.mapTextSize?.value),
      lineColor: els.mapLineColor?.value,
      lineStyle: els.mapLineStyle?.value,
      lineWeight: Number(els.mapLineWeight?.value),
      roadRouting: Boolean(els.mapRoadRouting?.checked)
    });
    syncMapSettingsUi();
    saveMapSettings();
    rerenderMapIfReady();
    rerenderRoutineIfReady();
  }

  function updateParkingCategoryFromUi(category) {
    stopParkingPlayback({ clearHighlight: true, resetIndex: true });
    state.parkingSettings = normalizeParkingSettings({
      ...state.parkingSettings,
      durationCategory: category
    });
    syncParkingSettingsUi();
    saveParkingSettings();
    if (category === "custom") {
      els.parkingSettingsPanel?.classList.remove("hidden");
    }
    rerenderParkingIfReady();
  }

  function applyParkingCustomRange() {
    stopParkingPlayback({ clearHighlight: true, resetIndex: true });
    const min = Number(els.parkingCustomMin?.value);
    const max = Number(els.parkingCustomMax?.value);
    state.parkingSettings = normalizeParkingSettings({
      ...state.parkingSettings,
      durationCategory: "custom",
      customMin: Number.isFinite(min) ? min : state.parkingSettings.customMin,
      customMax: Number.isFinite(max) ? max : state.parkingSettings.customMax
    });
    syncParkingSettingsUi();
    saveParkingSettings();
    rerenderParkingIfReady();
  }

  function updateParkingAdvancedSettingsFromUi(options = {}) {
    state.parkingSettings = normalizeParkingSettings({
      ...state.parkingSettings,
      popupOpacity: Number(els.parkingPopupOpacity?.value)
    });
    syncParkingSettingsUi();
    saveParkingSettings();
    if (options.rerender !== false) {
      rerenderParkingIfReady();
    }
  }

  function setOvernightMode(mode) {
    state.overnightMode = mode === OVERNIGHT_MODE_DAY ? OVERNIGHT_MODE_DAY : OVERNIGHT_MODE_NIGHT;
    rerenderOvernightIfReady();
  }

function setActiveView(viewKey) {
    if (viewKey !== "parking" && state.parkingPlaybackRunning) {
      stopParkingPlayback({ clearHighlight: false, resetIndex: false });
    }
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
    if (viewKey === "parking" && state.parkingMap) {
      setTimeout(() => state.parkingMap.invalidateSize(), 120);
    }
    if (viewKey === "overnight") {
      invalidateOvernightMap();
    }
    if (viewKey === "hotspots") {
      invalidateHotspotsMap();
    }
    if (viewKey === "routine") {
      invalidateRoutineMap();
    }
    if (viewKey === "comments") {
      loadDisqusComments();
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

    const themeToggle = els.themeToggle || document.getElementById("theme-toggle");
    themeToggle?.addEventListener("click", toggleTheme);

    els.sidebarToggle?.addEventListener("click", () => {
      els.sidebar?.classList.toggle("collapsed");
      const icon = els.sidebarToggle.querySelector(".material-symbols-rounded");
      if (icon) {
        icon.textContent = els.sidebar?.classList.contains("collapsed") ? "left_panel_close" : "left_panel_open";
      }
      if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 200);
      }
      if (state.parkingMap) {
        setTimeout(() => state.parkingMap.invalidateSize(), 200);
      }
      invalidateOvernightMap();
      invalidateHotspotsMap();
      invalidateRoutineMap();
    });

    els.analyzeForm?.addEventListener("submit", handleAnalyzeSubmit);
    els.normalDrivingSpeed?.addEventListener("change", () => {
      getNormalDrivingSpeedFromUi();
    });
    els.normalDrivingSpeedReset?.addEventListener("click", () => {
      resetNormalDrivingSpeedToDefault();
      getNormalDrivingSpeedFromUi();
    });

    for (const radio of els.parkingDurationRadios) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        updateParkingCategoryFromUi(radio.value);
      });
    }
    els.parkingSettingsToggle?.addEventListener("click", () => {
      els.parkingSettingsPanel?.classList.toggle("hidden");
    });
    els.parkingCustomApply?.addEventListener("click", applyParkingCustomRange);
    els.parkingPopupOpacity?.addEventListener("input", () => {
      updateParkingAdvancedSettingsFromUi({ rerender: false });
    });
    els.parkingPlaybackToggle?.addEventListener("click", toggleParkingPlayback);
    els.parkingPlaybackSpeed?.addEventListener("input", updateParkingPlaybackSpeedLabel);
    els.parkingPlaybackSelect?.addEventListener("change", async (event) => {
      stopParkingPlayback({ clearHighlight: true, resetIndex: false });
      const idx = Number(event.target.value);
      if (!Number.isFinite(idx)) return;
      await setParkingPlaybackIndex(idx, { focus: true });
    });

    els.overnightModeNight?.addEventListener("click", () => {
      setOvernightMode(OVERNIGHT_MODE_NIGHT);
    });
    els.overnightModeDay?.addEventListener("click", () => {
      setOvernightMode(OVERNIGHT_MODE_DAY);
    });

    els.routineHourGrid?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-hour]");
      if (!button) return;
      toggleRoutineDraftHour(button.dataset.hour);
      syncRoutineFilterUi({ syncDraft: false });
    });
    els.routineFilterSelectAll?.addEventListener("click", () => {
      selectAllRoutineDraftHours();
      syncRoutineFilterUi({ syncDraft: false });
    });
    els.routineFilterApply?.addEventListener("click", () => {
      state.routineFilter = normalizeRoutineFilter(state.routineFilterDraft);
      syncRoutineFilterUi({ syncDraft: false });
      rerenderRoutineIfReady();
    });
    els.routineFilterReset?.addEventListener("click", () => {
      resetRoutineDraftHours();
      syncRoutineFilterUi({ syncDraft: false });
    });

    els.mapSettingsToggle?.addEventListener("click", () => {
      els.mapSettingsPanel?.classList.toggle("hidden");
    });
    els.mapPointColor?.addEventListener("input", updateMapSettingsFromInputs);
    els.mapPointNumbering?.addEventListener("change", updateMapSettingsFromInputs);
    els.mapPointDetails?.addEventListener("change", updateMapSettingsFromInputs);
    els.mapFocusWindowOnly?.addEventListener("change", updateMapSettingsFromInputs);
    els.mapTextOpacity?.addEventListener("input", updateMapSettingsFromInputs);
    els.mapTextSize?.addEventListener("input", updateMapSettingsFromInputs);
    els.mapLineColor?.addEventListener("input", updateMapSettingsFromInputs);
    els.mapLineStyle?.addEventListener("change", updateMapSettingsFromInputs);
    els.mapLineWeight?.addEventListener("input", updateMapSettingsFromInputs);
    els.mapRoadRouting?.addEventListener("change", updateMapSettingsFromInputs);

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
      if (state.parkingMap) {
        state.parkingMap.invalidateSize();
      }
      invalidateOvernightMap();
      invalidateHotspotsMap();
      invalidateRoutineMap();
    });
  }

  function init() {
    applyTheme(getPreferredTheme(), { persist: false });
    loadUserSettings();
    syncMapSettingsUi();
    syncParkingSettingsUi();
    resetNormalDrivingSpeedToDefault();
    getNormalDrivingSpeedFromUi();
    setParkingPlaybackControlsEnabled(false);
    setParkingPlaybackButtonUi(false);
    renderParkingPlaybackSelect([]);
    updateParkingPlaybackSpeedLabel();
    updateParkingPlaybackCurrent("尚未開始播放");
    syncOvernightModeUi();
    state.routineFilter = normalizeRoutineFilter(state.routineFilter);
    state.routineFilterDraft = normalizeRoutineFilter(state.routineFilter);
    syncRoutineFilterUi();
    configureSidebarYoutubeEmbed();
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
    window.__CARIDENTIFY_APP_READY__ = true;
    document.documentElement.dataset.appReady = "true";
  }

  if (typeof window === "undefined" || window.__CARIDENTIFY_SKIP_AUTO_INIT__ !== true) {
    init();
  }








