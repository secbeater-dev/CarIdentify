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
} from "./shared/constants.js?v=20260827a";
import { els } from "./shared/dom.js?v=20260827a";
import { state } from "./shared/state.js?v=20260827a";
import { rowsToCsv } from "./shared/utils.js?v=20260827a";
import { extractPlateImageRecordImages } from "./analysis/workbookFormats.js?v=20260827a";
import { importWorkbooks, runWorkbookImport } from "./analysis/importClient.js?v=20260827a";
import { renderOvernightView as renderOvernightPanel, invalidateOvernightMap, updateOvernightModeUi as syncOvernightModeUi } from "./views/overnightView.js?v=20260827a";
import { renderHotspotsView, invalidateHotspotsMap } from "./views/hotspotsView.js?v=20260827a";
import {
  invalidateRoutineMap,
  renderRoutineView,
  resetRoutineDraftHours,
  selectAllRoutineDraftHours,
  syncRoutineFilterUi,
  toggleRoutineDraftHour
} from "./views/routineView.js?v=20260827a";
import { renderTable } from "./views/tableView.js?v=20260827a";
import { createParkingView } from "./views/parkingView.js?v=20260827a";
import { createMainMapView } from "./views/mainMapView.js?v=20260827a";
import { createAiView } from "./views/aiView.js?v=20260827a";
import { initPlateImageViewer } from "./views/plateImageView.js?v=20260827a";
import { normalizeRoutineFilter } from "./analysis/timeFilters.js?v=20260827a";

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
    const url = new URL("https://www.youtube.com/embed/DsLqD3MINT8");
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

  function hardReloadLatest() {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("_refresh", String(Date.now()));
    window.location.replace(nextUrl.toString());
  }

  function showFirstOpenNoticeIfNeeded() {
    const overlay = document.createElement("div");
    overlay.className = "first-open-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="first-open-modal first-open-welcome-modal">
        <div class="first-open-copy">
          <h3>使用提醒</h3>
          <p>資料均在本地運行，請安心使用。</p>
          <p>支援檔案類型：請私訊作者 <a href="https://t.me/tg_secbeater" target="_blank" rel="noopener noreferrer">https://t.me/tg_secbeater</a></p>
          <p class="first-open-note">備註：若畫面仍是舊版，請使用強制重載最新版（等同 Ctrl+F5）。</p>
          <div class="first-open-actions">
            <button type="button" class="ghost-btn first-open-refresh" data-action="refresh">強制重啟</button>
            <button type="button" class="run-btn first-open-close" data-action="close">我知道了</button>
          </div>
        </div>
        <div class="first-open-product-cards">
          <a class="first-open-community-card" href="https://phone.secbeater.com/" target="_blank" rel="noopener noreferrer">
            <img src="./static/link-phone-analysis.jpg" alt="通聯資料分析工具" class="first-open-community-image">
            <span>通聯資料分析工具</span>
          </a>
          <a class="first-open-community-card" href="https://shrimp.secbeater.com/" target="_blank" rel="noopener noreferrer">
            <img src="./static/link-shrimp-analysis.jpg" alt="蝦殼分析網站" class="first-open-community-image">
            <span>蝦殼分析網站</span>
          </a>
        </div>
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
    overlay.querySelector("[data-action='refresh']")?.addEventListener("click", hardReloadLatest);

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

  function getActiveViewKey() {
    return document.querySelector(".menu-item.active")?.dataset.view || "map";
  }

  function renderTeleportTable(result) {
    renderTable(els.tableTeleport, result?.anomalies?.teleportations || [], [
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
  }

  function renderAnalysisView(viewKey, result) {
    if (!result) return;
    const key = String(viewKey || "map");
    if (state.renderedViews.has(key)) return;

    if (key === "map") {
      renderMap(result.map);
    } else if (key === "parking") {
      renderParkingView(result);
    } else if (key === "overnight") {
      renderOvernightPanel(result);
    } else if (key === "hotspots") {
      renderHotspotsView(result);
    } else if (key === "routine") {
      renderRoutineView(result);
    } else if (key === "anomalies") {
      renderTeleportTable(result);
    }

    state.renderedViews.add(key);
  }

  function renderResult(result, sourceLabel) {
    state.analysis = result;
    state.csvExports.stay = "";
    state.csvExports.hotspot = "";
    state.csvExports.validation = "";
    state.renderedViews = new Set();
    stopParkingPlayback({ clearHighlight: true, resetIndex: true });
    state.parkingPlaybackSequence = [];
    state.parkingPlaybackMarkerByCluster = new Map();
    state.parkingMapAutoFitKeys.clear();
    state.parkingMapUserAdjusted = false;

    renderAnalysisView(getActiveViewKey(), result);

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

  function exportStamp() {
    const now = new Date();
    return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  }

  function exportSelectedCsv() {
    if (!els.exportType) return;
    const type = els.exportType.value;
    const stamp = exportStamp();
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
    if (type === "hotspot" && state.analysis) {
      const rows = (state.analysis.hotspots || []).map((row) => ({
        rank: row.rank,
        area: row.area,
        address: row.closest_address,
        visits: row.visits,
        total_duration: row.total_duration_hhmm,
        center_lon: row.center_lon,
        center_lat: row.center_lat
      }));
      const csv = rowsToCsv(rows, ["rank", "area", "address", "visits", "total_duration", "center_lon", "center_lat"]);
      downloadTextFile(`hotspots_top50_${stamp}.csv`, csv, "text/csv;charset=utf-8;");
      return;
    }
    if (type === "validation" && state.analysis) {
      const rows = (state.analysis.stays || []).map((row) => ({
        start_id: row.start_id,
        next_id: row.next_id,
        arrive_time: row.arrive_time,
        leave_time: row.leave_time,
        duration: row.duration_hhmm,
        area: row.area,
        lon: row.lon,
        lat: row.lat,
        address: row.closest_address
      }));
      const csv = rowsToCsv(rows, ["start_id", "next_id", "arrive_time", "leave_time", "duration", "area", "lon", "lat", "address"]);
      downloadTextFile(`validation_pairs_${stamp}.csv`, csv, "text/csv;charset=utf-8;");
      return;
    }
    setStatus("尚無可匯出資料，請先完成分析。", "error");
  }

  function revokeWorkbookImageUrls(urls) {
    for (const url of new Set(Array.isArray(urls) ? urls : [])) {
      if (String(url).startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
  }

  function replaceWorkbookImageUrls(nextUrls) {
    const previousUrls = state.workbookImageUrls.slice();
    if (els.plateImageDialog?.open) {
      els.plateImageDialog.close();
    }
    els.plateImageDialogImage?.removeAttribute("src");
    state.workbookImageUrls = Array.from(new Set(nextUrls));
    revokeWorkbookImageUrls(previousUrls);
  }

  function nextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
  }

  function getImportOverlay() {
    let overlay = document.getElementById("import-progress-overlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "import-progress-overlay";
    overlay.className = "import-progress-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="import-progress-modal" role="status" aria-live="polite">
        <div class="import-progress-spinner" aria-hidden="true"></div>
        <h3>正在處理檔案</h3>
        <p id="import-progress-message">準備中...</p>
        <p id="import-progress-hint" class="import-progress-hint" hidden>檔案較大，解析需一些時間，請勿關閉分頁。</p>
        <div class="import-progress-bar" aria-hidden="true"><span id="import-progress-fill"></span></div>
        <p id="import-progress-percent">0%</p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function setImportProgress(progress = {}) {
    const overlay = getImportOverlay();
    const message = overlay.querySelector("#import-progress-message");
    const hint = overlay.querySelector("#import-progress-hint");
    const fill = overlay.querySelector("#import-progress-fill");
    const percentLabel = overlay.querySelector("#import-progress-percent");
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    if (message) message.textContent = progress.message || "處理中...";
    if (hint) hint.hidden = !progress.largeFile;
    if (fill) fill.style.width = `${percent}%`;
    if (percentLabel) percentLabel.textContent = `${percent}%`;
  }

  function showImportProgress() {
    const overlay = getImportOverlay();
    overlay.hidden = false;
    overlay.classList.add("is-open");
    setImportProgress({ message: "準備中...", percent: 2 });
  }

  function hideImportProgress() {
    const overlay = document.getElementById("import-progress-overlay");
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.hidden = true;
  }

  function setImportUiBusy(busy) {
    const submit = els.analyzeForm?.querySelector('button[type="submit"]');
    if (els.fileInput) els.fileInput.disabled = busy;
    if (submit) submit.disabled = busy;
  }

  async function readFilePayloads(fileList) {
    const payloads = [];
    const files = Array.from(fileList || []);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setImportProgress({
        message: `讀取檔案（${index + 1}/${files.length}）：${file.name}`,
        percent: Math.round((index / Math.max(files.length, 1)) * 8),
        largeFile: file.size > 15 * 1024 * 1024
      });
      payloads.push({
        name: file.name,
        buffer: await file.arrayBuffer(),
        size: file.size
      });
    }
    return payloads;
  }

  async function attachPlateImages(analysis, plateImageJobs) {
    const pendingUrls = [];
    const urlById = new Map();
    for (const job of Array.isArray(plateImageJobs) ? plateImageJobs : []) {
      if (!job?.buffer) continue;
      const imageUrlByRow = await extractPlateImageRecordImages(job.buffer, job.sheetName, job.rowIndexes);
      const orders = Array.isArray(job.orders) ? job.orders : [];
      const rowIndexes = Array.isArray(job.rowIndexes) ? job.rowIndexes : [];
      for (let index = 0; index < rowIndexes.length; index += 1) {
        const url = imageUrlByRow.get(rowIndexes[index]) || "";
        if (!url) continue;
        pendingUrls.push(url);
        const idNum = Number.parseInt(orders[index], 10);
        if (Number.isFinite(idNum)) {
          urlById.set(idNum, url);
        }
      }
    }
    for (const point of analysis?.map?.track || []) {
      if (urlById.has(point.id)) {
        point.image_url = urlById.get(point.id);
      }
    }
    return pendingUrls;
  }

  async function handleAnalyzeSubmit(event) {
    event.preventDefault();
    const files = Array.from(els.fileInput?.files || []);
    if (!files.length) {
      setStatus("請先選擇至少 1 個檔案。", "error");
      return;
    }

    const pendingImageUrls = [];
    const analysisOptions = {
      strictDistanceTeleport: Boolean(els.strictDistance?.checked),
      normalDrivingSpeedKmh: getNormalDrivingSpeedFromUi()
    };
    const sourceLabel = files.length === 1 ? files[0].name : `${files.length} 個檔案`;

    showImportProgress();
    setImportUiBusy(true);
    await nextPaint();
    setStatus(`正在載入 ${files.length} 個檔案...`, "");

    try {
      stopPlayback();
      let payloads = await readFilePayloads(files);
      let imported;
      try {
        imported = await runWorkbookImport(payloads, analysisOptions, setImportProgress);
      } catch (error) {
        if (!error?.needsReread) throw error;
        payloads = await readFilePayloads(files);
        imported = await importWorkbooks(payloads, analysisOptions, setImportProgress);
      }

      setImportProgress({ message: "處理牌照圖片...", percent: 92, largeFile: false });
      pendingImageUrls.push(...await attachPlateImages(imported.analysis, imported.plateImageJobs));
      setImportProgress({ message: "繪製畫面...", percent: 96, largeFile: false });
      renderResult(imported.analysis, sourceLabel);
      replaceWorkbookImageUrls(pendingImageUrls);
    } catch (error) {
      revokeWorkbookImageUrls(pendingImageUrls);
      setStatus(`分析失敗：${error.message}`, "error");
    } finally {
      setImportUiBusy(false);
      hideImportProgress();
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

    renderAnalysisView(viewKey, state.analysis);

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
    window.addEventListener("beforeunload", () => {
      revokeWorkbookImageUrls(state.workbookImageUrls);
      state.workbookImageUrls = [];
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
    initPlateImageViewer();
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








