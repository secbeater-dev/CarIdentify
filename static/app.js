(() => {
  "use strict";

  const HOME = {
    address: "Taipei City Datong Dist Chongqing N Rd Sec 2 No.51 4F",
    lat: 25.0557,
    lon: 121.5139,
    radiusM: 600
  };
  const MAP_DEFAULT_VIEW = {
    lat: 24.4278,
    lon: 118.3592,
    zoom: 13
  };

  const GEMINI_ENDPOINT_DEFAULT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
  const FIRST_OPEN_NOTICE_KEY = "sb-first-open-notice-20260401-update-a";
  const MAP_SETTINGS_KEY = "caridentify-map-settings";
  const PARKING_SETTINGS_KEY = "caridentify-parking-settings";
  const OVERNIGHT_MODE_NIGHT = "night";
  const OVERNIGHT_MODE_DAY = "day";
  const DEFAULT_MAP_SETTINGS = {
    pointColor: "#ff0000",
    pointRadius: 6,
    showPointNumbers: true,
    showPointDetails: false,
    focusWindowOnly: false,
    textOpacity: 85,
    textSize: 12,
    lineColor: "#000000",
    lineStyle: "solid",
    lineWeight: 3,
    roadRouting: false
  };
  const DEFAULT_PARKING_SETTINGS = {
    durationCategory: "10-60",
    customMin: 360,
    customMax: 99999,
    popupOpacity: 65
  };
  const DEFAULT_NORMAL_DRIVING_SPEED_KMH = 40;
  const MIN_NORMAL_DRIVING_SPEED_KMH = 1;
  const MAX_NORMAL_DRIVING_SPEED_KMH = 150;
  const PARKING_CLUSTER_RADIUS_M = 100;
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
    parkingMap: null,
    layers: {},
    parkingLayers: {},
    currentMarker: null,
    track: [],
    currentTrackIndex: 0,
    teleportVisible: false,
    isPlaying: false,
    playbackToken: 0,
    routeRequestToken: 0,
    hourChart: null,
    modelsLoading: false,
    modelRefreshToken: 0,
    overnightMode: OVERNIGHT_MODE_NIGHT,
    mapSettings: { ...DEFAULT_MAP_SETTINGS },
    parkingSettings: { ...DEFAULT_PARKING_SETTINGS },
    parkingMapAutoFitKeys: new Set(),
    parkingMapProgrammaticMove: false,
    parkingMapUserAdjusted: false,
    parkingPlaybackRunning: false,
    parkingPlaybackToken: 0,
    parkingPlaybackIndex: 0,
    parkingPlaybackRangeKey: "",
    parkingPlaybackSequence: [],
    parkingPlaybackMarkerByCluster: new Map(),
    parkingPlaybackActiveMarker: null,
    parkingClusterByIndex: new Map(),
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
    sidebarYoutube: document.getElementById("sidebar-youtube"),
    sidebarYoutubeFallback: document.getElementById("sidebar-youtube-fallback"),
    analyzeForm: document.getElementById("analyze-form"),
    fileInput: document.getElementById("file-input"),
    strictDistance: document.getElementById("strict-distance"),
    normalDrivingSpeed: document.getElementById("normal-driving-speed"),
    normalDrivingSpeedReset: document.getElementById("normal-driving-speed-reset"),
    status: document.getElementById("status"),
    parkingCount: document.getElementById("parking-count"),
    parkingDurationRadios: Array.from(document.querySelectorAll("input[name='parking-duration']")),
    parkingCustomMin: document.getElementById("parking-custom-min"),
    parkingCustomMax: document.getElementById("parking-custom-max"),
    parkingCustomApply: document.getElementById("parking-custom-apply"),
    parkingSettingsToggle: document.getElementById("parking-settings-toggle"),
    parkingSettingsPanel: document.getElementById("parking-settings-panel"),
    parkingPopupOpacity: document.getElementById("parking-popup-opacity"),
    parkingPopupOpacityLabel: document.getElementById("parking-popup-opacity-label"),
    parkingMap: document.getElementById("parking-map"),
    parkingPlaybackSelect: document.getElementById("parking-playback-select"),
    parkingPlaybackToggle: document.getElementById("parking-playback-toggle"),
    parkingPlaybackSpeed: document.getElementById("parking-playback-speed"),
    parkingPlaybackSpeedLabel: document.getElementById("parking-playback-speed-label"),
    parkingPlaybackCurrent: document.getElementById("parking-playback-current"),
    parkingMapSummary: document.getElementById("parking-map-summary"),
    parkingMapLegend: document.getElementById("parking-map-legend"),
    overnightCount: document.getElementById("overnight-count"),
    overnightModeNight: document.getElementById("overnight-mode-night"),
    overnightModeDay: document.getElementById("overnight-mode-day"),
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
    mapSettingsToggle: document.getElementById("map-settings-toggle"),
    mapSettingsPanel: document.getElementById("map-settings-panel"),
    mapPointColor: document.getElementById("map-point-color"),
    mapPointNumbering: document.getElementById("map-point-numbering"),
    mapPointDetails: document.getElementById("map-point-details"),
    mapFocusWindowOnly: document.getElementById("map-focus-window-only"),
    mapTextOpacity: document.getElementById("map-text-opacity"),
    mapTextOpacityLabel: document.getElementById("map-text-opacity-label"),
    mapTextSize: document.getElementById("map-text-size"),
    mapLineColor: document.getElementById("map-line-color"),
    mapLineStyle: document.getElementById("map-line-style"),
    mapLineWeight: document.getElementById("map-line-weight"),
    mapLineWeightLabel: document.getElementById("map-line-weight-label"),
    mapRoadRouting: document.getElementById("map-road-routing"),
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
        <h4>今日更新（2026-04-01）</h4>
        <ul class="first-open-changes">
          <li>停車分析上方控制列整併為同一行，查看更直覺。</li>
          <li>播放排序選項已移除，播放順序固定為次數優先。</li>
          <li>地圖上方案件/地圖筆數/圖例資訊列已隱藏，畫面更精簡。</li>
          <li>提供一鍵更新：清除本機相關設定並重新載入最新版。</li>
        </ul>
        <p class="first-open-note">備註：一鍵更新會清除本機設定（地圖/停車/彈窗狀態），並強制重載最新版（等同 Ctrl+F5）。</p>
        <div class="first-open-actions">
          <button type="button" class="ghost-btn first-open-refresh" data-action="refresh">一鍵更新（Ctrl+F5＋清除設定）</button>
          <button type="button" class="run-btn first-open-close" data-action="close">我知道了</button>
        </div>
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
    if (has("偵測日期") && has("門架名稱") && (has("eTag序號") || has("國道系統") || has("車牌號碼"))) {
      return "vehicle_recognition";
    }
    return "generic";
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
  function renderTable(container, rows, columns) {
    if (!container) return;
    if (!rows || rows.length === 0) {
      container.innerHTML = '<div class="empty">目前無資料</div>';
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

  function getOvernightRowsByMode(stays, mode) {
    const source = Array.isArray(stays) ? stays : [];
    if (mode === OVERNIGHT_MODE_DAY) {
      return source.filter((s) => Number(s.duration_min) >= 360 && Number(s.day_overlap_h) >= 1);
    }
    return source.filter((s) => Number(s.duration_min) >= 360 && Number(s.night_overlap_h) >= 1);
  }

  function updateOvernightModeUi() {
    const isDay = state.overnightMode === OVERNIGHT_MODE_DAY;
    if (els.overnightModeNight) {
      const active = !isDay;
      els.overnightModeNight.classList.toggle("is-active", active);
      els.overnightModeNight.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (els.overnightModeDay) {
      const active = isDay;
      els.overnightModeDay.classList.toggle("is-active", active);
      els.overnightModeDay.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  function renderOvernightView(result) {
    const overnightRows = getOvernightRowsByMode(result?.stays || [], state.overnightMode);
    const overlapColumn = state.overnightMode === OVERNIGHT_MODE_DAY
      ? { key: "day_overlap_h", label: "日間重疊(小時)" }
      : { key: "night_overlap_h", label: "夜間重疊(小時)" };

    if (els.overnightCount) {
      els.overnightCount.textContent = `筆數：${overnightRows.length}`;
    }
    renderTable(els.tableOvernight, overnightRows, [
      { key: "arrive_time", label: "抵達時間" },
      { key: "leave_time", label: "離開時間" },
      { key: "duration_hhmm", label: "停留時長" },
      overlapColumn,
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" }
    ]);
    updateOvernightModeUi();
  }

  function getParkingRangeKey(settings, range) {
    const category = String(settings?.durationCategory || "10-60");
    if (category === "custom") {
      return `custom:${range.min}-${range.max}`;
    }
    return category;
  }

  function getParkingMapTheme(settings) {
    const category = String(settings?.durationCategory || "10-60");
    if (category === "4-6") {
      return {
        categoryLabel: "4–6 分鐘",
        rawColor: "#ffd166",
        clusterColor: "#ffb703",
        clusterStroke: "#8f5a00"
      };
    }
    if (category === "60+") {
      return {
        categoryLabel: "60 分鐘以上",
        rawColor: "#ff6b6b",
        clusterColor: "#d90429",
        clusterStroke: "#7a0014"
      };
    }
    if (category === "custom") {
      return {
        categoryLabel: "自訂區間",
        rawColor: "#66d9ff",
        clusterColor: "#119da4",
        clusterStroke: "#0b5960"
      };
    }
    return {
      categoryLabel: "10–59 分鐘",
      rawColor: "#f4a261",
      clusterColor: "#e76f51",
      clusterStroke: "#7b341e"
    };
  }

  function getParkingAnalysisDays(summary) {
    const start = parseRocDateTime(summary?.period_start);
    const end = parseRocDateTime(summary?.period_end);
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) return 1;
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) return 1;
    const diffDays = (end.getTime() - start.getTime()) / 86400000;
    if (!Number.isFinite(diffDays)) return 1;
    return Math.max(1, diffDays);
  }

  function topCounterEntry(counterMap) {
    let bestKey = "未提供";
    let bestVal = -1;
    for (const [key, value] of counterMap.entries()) {
      if (value > bestVal) {
        bestVal = value;
        bestKey = key;
      }
    }
    return bestKey;
  }

  function buildParkingClusters(rows, radiusM, analysisDays) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const clusters = [];
    const assignments = new Array(sourceRows.length).fill(-1);

    for (let idx = 0; idx < sourceRows.length; idx += 1) {
      const row = sourceRows[idx];
      if (!row || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;

      let assignedIndex = -1;
      for (let i = 0; i < clusters.length; i += 1) {
        const cluster = clusters[i];
        const distM = haversineKm(row.lat, row.lon, cluster.centerLat, cluster.centerLon) * 1000;
        if (distM <= radiusM) {
          assignedIndex = i;
          break;
        }
      }

      if (assignedIndex < 0) {
        clusters.push({
          centerLat: row.lat,
          centerLon: row.lon,
          visits: 0,
          durationMin: 0,
          areaCounter: new Map(),
          addrCounter: new Map(),
          firstArrive: null,
          lastLeave: null,
          arriveTimeMinByClock: null,
          arriveTimeMaxByClock: null,
          leaveTimeMinByClock: null,
          leaveTimeMaxByClock: null,
          longestStay: null,
          shortestStay: null,
          records: []
        });
        assignedIndex = clusters.length - 1;
      }

      assignments[idx] = assignedIndex;
      const assigned = clusters[assignedIndex];
      const durationRaw = Number(row.duration_min);
      const durationMin = Number.isFinite(durationRaw) ? Math.max(0, durationRaw) : 0;
      const arriveRaw = String(row.arrive_time || "-");
      const leaveRaw = String(row.leave_time || "-");
      assigned.visits += 1;
      assigned.durationMin += durationMin;
      assigned.areaCounter.set(row.area || "未提供", (assigned.areaCounter.get(row.area || "未提供") || 0) + 1);
      assigned.addrCounter.set(
        row.closest_address || row.address || row.area || "未提供",
        (assigned.addrCounter.get(row.closest_address || row.address || row.area || "未提供") || 0) + 1
      );

      const arriveDt = parseRocDateTime(row.arrive_time);
      const leaveDt = parseRocDateTime(row.leave_time);
      if (arriveDt && (!assigned.firstArrive || arriveDt < assigned.firstArrive)) {
        assigned.firstArrive = arriveDt;
      }
      if (leaveDt && (!assigned.lastLeave || leaveDt > assigned.lastLeave)) {
        assigned.lastLeave = leaveDt;
      }
      if (arriveDt) {
        const arriveSec = getTimeOfDaySeconds(arriveDt);
        if (
          Number.isFinite(arriveSec) &&
          (!assigned.arriveTimeMinByClock || arriveSec < assigned.arriveTimeMinByClock.seconds)
        ) {
          assigned.arriveTimeMinByClock = { seconds: arriveSec, dt: arriveDt, raw: arriveRaw };
        }
        if (
          Number.isFinite(arriveSec) &&
          (!assigned.arriveTimeMaxByClock || arriveSec > assigned.arriveTimeMaxByClock.seconds)
        ) {
          assigned.arriveTimeMaxByClock = { seconds: arriveSec, dt: arriveDt, raw: arriveRaw };
        }
      }
      if (leaveDt) {
        const leaveSec = getTimeOfDaySeconds(leaveDt);
        if (
          Number.isFinite(leaveSec) &&
          (!assigned.leaveTimeMinByClock || leaveSec < assigned.leaveTimeMinByClock.seconds)
        ) {
          assigned.leaveTimeMinByClock = { seconds: leaveSec, dt: leaveDt, raw: leaveRaw };
        }
        if (
          Number.isFinite(leaveSec) &&
          (!assigned.leaveTimeMaxByClock || leaveSec > assigned.leaveTimeMaxByClock.seconds)
        ) {
          assigned.leaveTimeMaxByClock = { seconds: leaveSec, dt: leaveDt, raw: leaveRaw };
        }
      }

      if (Number.isFinite(durationRaw)) {
        if (!assigned.longestStay || durationRaw > assigned.longestStay.durationMin) {
          assigned.longestStay = {
            durationMin: durationRaw,
            arriveRaw,
            leaveRaw
          };
        }
        if (!assigned.shortestStay || durationRaw < assigned.shortestStay.durationMin) {
          assigned.shortestStay = {
            durationMin: durationRaw,
            arriveRaw,
            leaveRaw
          };
        }
      }

      assigned.records.push({
        arrive_raw: arriveRaw,
        leave_raw: leaveRaw,
        duration_text: String(row.duration_hhmm || formatDuration(durationMin)),
        duration_min: durationMin,
        arrive_ts: arriveDt ? arriveDt.getTime() : NaN
      });

      const w = assigned.visits;
      assigned.centerLat = (assigned.centerLat * (w - 1) + row.lat) / w;
      assigned.centerLon = (assigned.centerLon * (w - 1) + row.lon) / w;
    }

    const total = Math.max(1, sourceRows.length);
    const safeDays = Math.max(1, analysisDays || 1);
    const normalized = clusters.map((cluster, clusterIndex) => {
      const sharePct = (cluster.visits / total) * 100;
      const dailyFreq = cluster.visits / safeDays;
      return {
        clusterIndex,
        visits: cluster.visits,
        total_duration_min: Number(cluster.durationMin.toFixed(2)),
        total_duration_hhmm: formatDuration(cluster.durationMin),
        center_lat: Number(cluster.centerLat.toFixed(6)),
        center_lon: Number(cluster.centerLon.toFixed(6)),
        area: topCounterEntry(cluster.areaCounter),
        closest_address: topCounterEntry(cluster.addrCounter),
        first_arrive: cluster.firstArrive ? formatDateTime(cluster.firstArrive) : "-",
        last_leave: cluster.lastLeave ? formatDateTime(cluster.lastLeave) : "-",
        arrive_time_earliest_clock: cluster.arriveTimeMinByClock ? formatTimeOfDay(cluster.arriveTimeMinByClock.dt) : "-",
        arrive_time_earliest_raw: cluster.arriveTimeMinByClock?.raw || "-",
        arrive_time_latest_clock: cluster.arriveTimeMaxByClock ? formatTimeOfDay(cluster.arriveTimeMaxByClock.dt) : "-",
        arrive_time_latest_raw: cluster.arriveTimeMaxByClock?.raw || "-",
        leave_time_earliest_clock: cluster.leaveTimeMinByClock ? formatTimeOfDay(cluster.leaveTimeMinByClock.dt) : "-",
        leave_time_earliest_raw: cluster.leaveTimeMinByClock?.raw || "-",
        leave_time_latest_clock: cluster.leaveTimeMaxByClock ? formatTimeOfDay(cluster.leaveTimeMaxByClock.dt) : "-",
        leave_time_latest_raw: cluster.leaveTimeMaxByClock?.raw || "-",
        longest_stay_text: cluster.longestStay ? formatDurationDhm(cluster.longestStay.durationMin) : "-",
        longest_stay_raw: cluster.longestStay
          ? `${cluster.longestStay.arriveRaw} 至 ${cluster.longestStay.leaveRaw}`
          : "-",
        shortest_stay_text: cluster.shortestStay ? formatDurationDhm(cluster.shortestStay.durationMin) : "-",
        shortest_stay_raw: cluster.shortestStay
          ? `${cluster.shortestStay.arriveRaw} 至 ${cluster.shortestStay.leaveRaw}`
          : "-",
        share_pct: Number(sharePct.toFixed(1)),
        daily_freq: Number(dailyFreq.toFixed(2)),
        marker_radius: clamp(6 + Math.sqrt(cluster.visits) * 2.2, 6, 20),
        label_text: `${cluster.visits}次｜${sharePct.toFixed(1)}%｜${dailyFreq.toFixed(2)}次/日`,
        records: cluster.records.slice()
      };
    });

    return { clusters: normalized, assignments };
  }

  function buildParkingClusterRecordRowsHtml(records) {
    const source = Array.isArray(records) ? records.slice() : [];
    if (!source.length) {
      return '<div class="parking-popup-record-empty">目前無詳細停車紀錄</div>';
    }

    source.sort((a, b) => {
      const aTs = Number(a?.arrive_ts);
      const bTs = Number(b?.arrive_ts);
      if (Number.isFinite(aTs) && Number.isFinite(bTs)) return aTs - bTs;
      if (Number.isFinite(aTs)) return -1;
      if (Number.isFinite(bTs)) return 1;
      return 0;
    });

    return `
      <ol class="parking-popup-record-list">
        ${source
          .map(
            (record, idx) =>
              `<li><span class="parking-popup-record-index">#${idx + 1}</span><span class="parking-popup-record-time">${escapeHtml(
                record.arrive_raw
              )} ~ ${escapeHtml(record.leave_raw)}</span><span class="parking-popup-record-duration">${escapeHtml(
                record.duration_text
              )}</span></li>`
          )
          .join("")}
      </ol>
    `;
  }

  function buildParkingClusterPopupHtml(cluster) {
    if (!cluster) return "<b>停車統計點</b>";
    return `
      <div class="parking-popup-block">
        <div class="parking-popup-title">停車統計點</div>
        <div>次數：${cluster.visits}</div>
        <div>占比：${cluster.share_pct}%</div>
        <div>日均：${cluster.daily_freq} 次/日</div>
        <div>總停留：${escapeHtml(cluster.total_duration_hhmm)}</div>
        <div>主要地點：${escapeHtml(cluster.closest_address || cluster.area || "未提供")}</div>
        <button
          type="button"
          class="parking-popup-toggle-btn"
          data-role="parking-popup-toggle"
          data-cluster-index="${cluster.clusterIndex}"
        >查看詳情</button>
      </div>
    `;
  }

  function buildParkingClusterDetailModalContent(cluster) {
    const recordsHtml = buildParkingClusterRecordRowsHtml(cluster?.records);
    return `
      <div class="parking-popup-section">
        <div class="parking-popup-section-title">抵達時間：</div>
        <div>最早：${escapeHtml(cluster?.arrive_time_earliest_clock)} <span class="parking-popup-raw">(原始資料 ${escapeHtml(
          cluster?.arrive_time_earliest_raw
        )})</span></div>
        <div>最晚：${escapeHtml(cluster?.arrive_time_latest_clock)} <span class="parking-popup-raw">(原始資料 ${escapeHtml(
          cluster?.arrive_time_latest_raw
        )})</span></div>
      </div>
      <div class="parking-popup-section">
        <div class="parking-popup-section-title">離開時間：</div>
        <div>最早：${escapeHtml(cluster?.leave_time_earliest_clock)} <span class="parking-popup-raw">(原始資料 ${escapeHtml(
          cluster?.leave_time_earliest_raw
        )})</span></div>
        <div>最晚：${escapeHtml(cluster?.leave_time_latest_clock)} <span class="parking-popup-raw">(原始資料 ${escapeHtml(
          cluster?.leave_time_latest_raw
        )})</span></div>
      </div>
      <div class="parking-popup-section">
        <div class="parking-popup-section-title">停留停車時間：</div>
        <div>最長：${escapeHtml(cluster?.longest_stay_text)} <span class="parking-popup-raw">(原始資料 ${escapeHtml(
          cluster?.longest_stay_raw
        )})</span></div>
        <div>最短：${escapeHtml(cluster?.shortest_stay_text)} <span class="parking-popup-raw">(原始資料 ${escapeHtml(
          cluster?.shortest_stay_raw
        )})</span></div>
      </div>
      <div class="parking-popup-section">
        <div class="parking-popup-section-title">逐筆停車紀錄：</div>
        ${recordsHtml}
      </div>
    `;
  }

  function showParkingDetailModal(cluster) {
    if (!cluster) return;
    const overlay = document.createElement("div");
    overlay.className = "first-open-overlay parking-detail-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="first-open-modal parking-detail-modal">
        <h3>停車詳細資訊</h3>
        <p>統計點：${escapeHtml(cluster.closest_address || cluster.area || "未提供")}｜${cluster.visits} 次</p>
        <div class="parking-detail-modal-content">
          ${buildParkingClusterDetailModalContent(cluster)}
        </div>
        <button type="button" class="run-btn first-open-close" data-action="close">關閉</button>
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

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onEscClose);
    window.requestAnimationFrame(() => {
      overlay.classList.add("is-open");
    });
  }

  function withParkingMapProgrammaticMove(action, holdMs = 260) {
    state.parkingMapProgrammaticMove = true;
    action();
    window.setTimeout(() => {
      state.parkingMapProgrammaticMove = false;
    }, Math.max(120, Number(holdMs) || 260));
  }

  function setParkingPlaybackButtonUi(running) {
    if (!els.parkingPlaybackToggle) return;
    els.parkingPlaybackToggle.textContent = running ? "停止播放" : "播放案件";
    els.parkingPlaybackToggle.classList.toggle("is-playing", Boolean(running));
  }

  function setParkingPlaybackControlsEnabled(enabled) {
    const active = Boolean(enabled);
    if (els.parkingPlaybackToggle) els.parkingPlaybackToggle.disabled = !active;
    if (els.parkingPlaybackSpeed) els.parkingPlaybackSpeed.disabled = !active;
    if (els.parkingPlaybackSelect) els.parkingPlaybackSelect.disabled = !active;
  }

  function updateParkingPlaybackCurrent(text) {
    if (!els.parkingPlaybackCurrent) return;
    els.parkingPlaybackCurrent.textContent = text;
  }

  function updateParkingPlaybackSpeedLabel() {
    const value = Math.max(0.5, Number(els.parkingPlaybackSpeed?.value || 1));
    if (els.parkingPlaybackSpeedLabel) {
      els.parkingPlaybackSpeedLabel.textContent = `${value.toFixed(1)}x`;
    }
  }

  function renderParkingPlaybackSelect(sequence) {
    if (!els.parkingPlaybackSelect) return;

    const seq = Array.isArray(sequence) ? sequence : [];
    if (!seq.length) {
      els.parkingPlaybackSelect.innerHTML = '<option value="">尚無案件</option>';
      els.parkingPlaybackSelect.value = "";
      return;
    }

    const current = clamp(state.parkingPlaybackIndex, 0, seq.length - 1);
    state.parkingPlaybackIndex = current;
    els.parkingPlaybackSelect.innerHTML = seq
      .map(
        (cluster, idx) =>
          `<option value="${idx}">#${idx + 1}｜${cluster.visits}次｜${cluster.share_pct}%｜${cluster.daily_freq}次/日</option>`
      )
      .join("");
    els.parkingPlaybackSelect.value = String(current);
  }

  function getParkingPlaybackSequence(clusters) {
    const source = Array.isArray(clusters) ? clusters.slice() : [];
    return source.sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      if (b.daily_freq !== a.daily_freq) return b.daily_freq - a.daily_freq;
      if (b.share_pct !== a.share_pct) return b.share_pct - a.share_pct;
      return b.total_duration_min - a.total_duration_min;
    });
  }

  function clearParkingPlaybackHighlight() {
    const marker = state.parkingPlaybackActiveMarker;
    if (!marker) return;

    if (Number.isFinite(marker.__baseRadius)) {
      marker.setRadius(marker.__baseRadius);
    }
    marker.setStyle({
      color: marker.__baseColor || "#7b341e",
      fillColor: marker.__baseFillColor || "#e76f51",
      fillOpacity: Number.isFinite(marker.__baseFillOpacity) ? marker.__baseFillOpacity : 0.82,
      weight: Number.isFinite(marker.__baseWeight) ? marker.__baseWeight : 1.8
    });
    state.parkingPlaybackActiveMarker = null;
  }

  function highlightParkingPlaybackMarker(marker) {
    clearParkingPlaybackHighlight();
    if (!marker) return;

    if (Number.isFinite(marker.__baseRadius)) {
      marker.setRadius(Math.min(24, marker.__baseRadius + 2.8));
    }
    marker.setStyle({
      color: "#ffffff",
      fillColor: "#39ff14",
      fillOpacity: 0.96,
      weight: 2.5
    });
    state.parkingPlaybackActiveMarker = marker;
  }

  function focusParkingCluster(cluster, focus = true) {
    if (!state.parkingMap || !cluster || !focus) return Promise.resolve();
    const lat = Number(cluster.center_lat);
    const lon = Number(cluster.center_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve();

    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        state.parkingMap.off("moveend", onMoveEnd);
        resolve();
      };
      const onMoveEnd = () => window.setTimeout(finish, 80);
      state.parkingMap.on("moveend", onMoveEnd);
      const zoom = state.parkingMap.getZoom();
      withParkingMapProgrammaticMove(() => {
        state.parkingMap.flyTo([lat, lon], zoom, {
          animate: true,
          duration: 0.75
        });
      }, 1500);
      window.setTimeout(finish, 1700);
    });
  }

  async function setParkingPlaybackIndex(index, options = {}) {
    const seq = state.parkingPlaybackSequence;
    if (!Array.isArray(seq) || !seq.length) {
      updateParkingPlaybackCurrent("目前無可播放地點");
      return;
    }

    const clamped = clamp(index, 0, seq.length - 1);
    state.parkingPlaybackIndex = clamped;
    if (els.parkingPlaybackSelect) {
      els.parkingPlaybackSelect.value = String(clamped);
    }
    const cluster = seq[clamped];
    if (!cluster) return;

    const marker = state.parkingPlaybackMarkerByCluster.get(cluster.clusterIndex) || null;
    highlightParkingPlaybackMarker(marker);
    marker?.openPopup();

    updateParkingPlaybackCurrent(
      `案件 ${clamped + 1}/${seq.length}｜${cluster.visits}次｜${cluster.share_pct}%｜${cluster.daily_freq}/日`
    );

    await focusParkingCluster(cluster, options.focus !== false);
  }

  function stopParkingPlayback(options = {}) {
    state.parkingPlaybackRunning = false;
    state.parkingPlaybackToken += 1;
    setParkingPlaybackButtonUi(false);

    if (options.clearHighlight) {
      clearParkingPlaybackHighlight();
    }
    if (options.resetIndex) {
      state.parkingPlaybackIndex = 0;
    }
  }

  async function toggleParkingPlayback() {
    if (!state.parkingPlaybackSequence.length) return;

    if (state.parkingPlaybackRunning) {
      stopParkingPlayback({ clearHighlight: false, resetIndex: false });
      return;
    }

    state.parkingPlaybackRunning = true;
    state.parkingPlaybackToken += 1;
    const token = state.parkingPlaybackToken;
    setParkingPlaybackButtonUi(true);

    let idx = clamp(state.parkingPlaybackIndex, 0, state.parkingPlaybackSequence.length - 1);
    while (state.parkingPlaybackRunning && token === state.parkingPlaybackToken && idx < state.parkingPlaybackSequence.length) {
      await setParkingPlaybackIndex(idx, { focus: true });
      const speed = Math.max(0.5, Number(els.parkingPlaybackSpeed?.value || 1));
      const delay = Math.max(180, Math.round(1050 / speed));
      await sleep(delay);
      idx += 1;
    }

    if (token === state.parkingPlaybackToken) {
      state.parkingPlaybackRunning = false;
      setParkingPlaybackButtonUi(false);
      updateParkingPlaybackCurrent(`播放完成｜已巡覽 ${state.parkingPlaybackSequence.length} 個統計點`);
    }
  }

  function initParkingMapIfNeeded() {
    if (state.parkingMap || !els.parkingMap || typeof L === "undefined") return;

    state.parkingMap = L.map(els.parkingMap, { preferCanvas: true }).setView(
      [MAP_DEFAULT_VIEW.lat, MAP_DEFAULT_VIEW.lon],
      MAP_DEFAULT_VIEW.zoom
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(state.parkingMap);

    state.parkingLayers.rawPoints = L.layerGroup().addTo(state.parkingMap);
    state.parkingLayers.clusterPoints = L.layerGroup().addTo(state.parkingMap);

    state.parkingMap.on("moveend", () => {
      if (state.parkingMapProgrammaticMove) return;
      state.parkingMapUserAdjusted = true;
    });

    state.parkingMap.on("popupopen", (event) => {
      const popupEl = event?.popup?.getElement?.();
      if (!popupEl) return;
      const toggleBtn = popupEl.querySelector("[data-role='parking-popup-toggle']");
      if (!toggleBtn) return;
      if (toggleBtn.dataset.bound === "1") return;
      toggleBtn.dataset.bound = "1";

      toggleBtn.addEventListener("click", () => {
        const clusterIndex = Number(toggleBtn.getAttribute("data-cluster-index"));
        if (!Number.isFinite(clusterIndex)) return;
        const cluster = state.parkingClusterByIndex.get(clusterIndex);
        if (!cluster) return;
        showParkingDetailModal(cluster);
      });
    });
  }

  function renderParkingMapLegend(theme) {
    if (!els.parkingMapLegend) return;
    els.parkingMapLegend.innerHTML = `
      <span class="parking-legend-chip"><i style="background:${theme.rawColor};"></i>逐筆停留點</span>
      <span class="parking-legend-chip"><i style="background:${theme.clusterColor};border-color:${theme.clusterStroke};"></i>100m 統計點</span>
    `;
  }

  function renderParkingMap(rows, range, result) {
    initParkingMapIfNeeded();
    if (!state.parkingMap) return;

    state.parkingLayers.rawPoints?.clearLayers();
    state.parkingLayers.clusterPoints?.clearLayers();

    const theme = getParkingMapTheme(state.parkingSettings);
    renderParkingMapLegend(theme);
    const rangeKey = getParkingRangeKey(state.parkingSettings, range);
    const previousRangeKey = state.parkingPlaybackRangeKey;
    state.parkingPlaybackRangeKey = rangeKey;

    const validRows = (Array.isArray(rows) ? rows : []).filter(
      (row) => row && Number.isFinite(row.lat) && Number.isFinite(row.lon)
    );

    if (!validRows.length) {
      stopParkingPlayback({ clearHighlight: true, resetIndex: true });
      state.parkingPlaybackSequence = [];
      state.parkingPlaybackMarkerByCluster = new Map();
      state.parkingClusterByIndex = new Map();
      renderParkingPlaybackSelect([]);
      setParkingPlaybackControlsEnabled(false);
      updateParkingPlaybackCurrent("目前無可播放地點");
      if (els.parkingMapSummary) {
        els.parkingMapSummary.textContent = `地圖筆數：0（篩選：${range.label}）`;
      }
      window.setTimeout(() => state.parkingMap?.invalidateSize(), 80);
      return;
    }

    const analysisDays = getParkingAnalysisDays(result?.summary);
    const { clusters, assignments } = buildParkingClusters(validRows, PARKING_CLUSTER_RADIUS_M, analysisDays);
    const clusterByIndex = new Map(clusters.map((cluster) => [cluster.clusterIndex, cluster]));
    const clusterMarkerByIndex = new Map();
    state.parkingClusterByIndex = clusterByIndex;

    if (els.parkingMapSummary) {
      els.parkingMapSummary.textContent = `地圖筆數：${validRows.length}（篩選：${range.label}；期間 ${analysisDays.toFixed(2)} 天）`;
    }

    validRows.forEach((row, idx) => {
      const marker = L.circleMarker([row.lat, row.lon], {
        radius: 4.2,
        color: theme.rawColor,
        fillColor: theme.rawColor,
        fillOpacity: 0.3,
        weight: 1.1
      });

      const cluster = clusterByIndex.get(assignments[idx]);
      const clusterStat = cluster
        ? `群組統計：${cluster.visits} 次｜${cluster.share_pct}%｜${cluster.daily_freq} 次/日`
        : "群組統計：未提供";

      marker.bindPopup(
        `<b>${escapeHtml(range.label)}</b><br>${escapeHtml(row.arrive_time)} ~ ${escapeHtml(row.leave_time)}<br>${escapeHtml(
          row.duration_hhmm
        )}<br>${escapeHtml(row.closest_address || row.area || "未提供")}<br>${escapeHtml(clusterStat)}`
      );
      marker.addTo(state.parkingLayers.rawPoints);
    });

    clusters
      .slice()
      .sort((a, b) => a.visits - b.visits)
      .forEach((cluster) => {
        const marker = L.circleMarker([cluster.center_lat, cluster.center_lon], {
          radius: cluster.marker_radius,
          color: theme.clusterStroke,
          fillColor: theme.clusterColor,
          fillOpacity: 0.82,
          weight: 1.8
        });

        marker.bindPopup(buildParkingClusterPopupHtml(cluster), {
          minWidth: 240,
          maxWidth: 380,
          className: "parking-detail-popup",
          autoPanPadding: [28, 28]
        });

        marker.bindTooltip(`<span class="parking-cluster-label">${escapeHtml(cluster.label_text)}</span>`, {
          permanent: true,
          direction: "right",
          offset: [10, 0],
          className: "parking-cluster-tooltip"
        });

        marker.__baseRadius = cluster.marker_radius;
        marker.__baseColor = theme.clusterStroke;
        marker.__baseFillColor = theme.clusterColor;
        marker.__baseFillOpacity = 0.82;
        marker.__baseWeight = 1.8;
        clusterMarkerByIndex.set(cluster.clusterIndex, marker);
        marker.addTo(state.parkingLayers.clusterPoints);
      });

    const playbackSequence = getParkingPlaybackSequence(clusters);
    state.parkingPlaybackSequence = playbackSequence;
    state.parkingPlaybackMarkerByCluster = clusterMarkerByIndex;
    renderParkingPlaybackSelect(playbackSequence);
    setParkingPlaybackControlsEnabled(playbackSequence.length > 0);
    updateParkingPlaybackSpeedLabel();

    if (state.parkingPlaybackRunning && previousRangeKey !== rangeKey) {
      stopParkingPlayback({ clearHighlight: true, resetIndex: true });
    }

    if (!state.parkingPlaybackRunning) {
      if (!playbackSequence.length) {
        updateParkingPlaybackCurrent("目前無可播放地點");
      } else {
        state.parkingPlaybackIndex = clamp(state.parkingPlaybackIndex, 0, playbackSequence.length - 1);
        void setParkingPlaybackIndex(state.parkingPlaybackIndex, { focus: false });
      }
    }

    const shouldAutoFit = !state.parkingMapUserAdjusted && !state.parkingMapAutoFitKeys.has(rangeKey);
    if (shouldAutoFit) {
      const bounds = L.latLngBounds(validRows.map((row) => [row.lat, row.lon]));
      withParkingMapProgrammaticMove(() => {
        state.parkingMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 17, animate: false });
      });
      state.parkingMapAutoFitKeys.add(rangeKey);
    }

    window.setTimeout(() => state.parkingMap?.invalidateSize(), 80);
  }

  function renderParkingView(result) {
    const stays = Array.isArray(result?.stays) ? result.stays : [];
    const range = getParkingDurationRange(state.parkingSettings);
    const rows = stays.filter((row) => {
      const duration = Number(row.duration_min);
      if (!Number.isFinite(duration)) return false;
      return duration >= range.min && duration <= range.max;
    });

    if (els.parkingCount) {
      els.parkingCount.textContent = `筆數：${rows.length}（篩選：${range.label}）`;
    }
    renderTable(els.tableParking, rows, [
      { key: "arrive_time", label: "抵達時間" },
      { key: "leave_time", label: "離開時間" },
      { key: "duration_hhmm", label: "停留時長" },
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" },
      { key: "stay_type", label: "類型" }
    ]);
    renderParkingMap(rows, range, result);
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

    state.map = L.map(els.map, { preferCanvas: true }).setView([MAP_DEFAULT_VIEW.lat, MAP_DEFAULT_VIEW.lon], MAP_DEFAULT_VIEW.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(state.map);

    state.layers.trackLine = L.polyline([], { color: "#f3f3f3", weight: 3, opacity: 0.9 }).addTo(state.map);
    state.layers.trackDots = L.layerGroup().addTo(state.map);
    state.layers.trackLabels = L.layerGroup().addTo(state.map);
    state.layers.trackArrows = L.layerGroup().addTo(state.map);
    state.layers.stays = L.layerGroup().addTo(state.map);
    state.layers.hotspots = L.layerGroup().addTo(state.map);
    state.layers.home = L.layerGroup().addTo(state.map);
    state.layers.teleport = L.layerGroup();

    state.currentMarker = L.circleMarker([MAP_DEFAULT_VIEW.lat, MAP_DEFAULT_VIEW.lon], {
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

  function getLineDashArray(lineStyle) {
    if (lineStyle === "dashed" || lineStyle === "dashed-arrow") {
      return "8 8";
    }
    return null;
  }

  function getSegmentAngle(fromLatLng, toLatLng) {
    const dy = toLatLng[0] - fromLatLng[0];
    const dx = toLatLng[1] - fromLatLng[1];
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }

  function createTrackArrowIcon(angleDeg, color) {
    return L.divIcon({
      className: "map-arrow-icon",
      html: `<span style="--arrow-rotation:${angleDeg}deg;--arrow-color:${color};"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  function getRenderedTrackIndices(trackLength, currentIndex, mapSettings) {
    if (trackLength <= 0) return [];

    if (mapSettings.focusWindowOnly) {
      const center = clamp(currentIndex, 0, trackLength - 1);
      const from = Math.max(0, center - 1);
      const to = Math.min(trackLength - 1, center + 1);
      const indices = [];
      for (let i = from; i <= to; i += 1) {
        indices.push(i);
      }
      return indices;
    }

    const sampleStep = trackLength > 800 ? 10 : 4;
    const out = [];
    for (let i = 0; i < trackLength; i += 1) {
      if (i % sampleStep !== 0 && i !== 0 && i !== trackLength - 1) continue;
      out.push(i);
    }
    return out;
  }

  function getFocusWindowTrackPoints(mapSettings) {
    if (!Array.isArray(state.track) || !state.track.length) return [];
    if (!mapSettings.focusWindowOnly) {
      return state.track.slice();
    }
    const indices = getRenderedTrackIndices(state.track.length, state.currentTrackIndex, mapSettings);
    return indices
      .map((idx) => state.track[idx])
      .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }

  function getFocusWindowTrackLatLngs(mapSettings) {
    return getFocusWindowTrackPoints(mapSettings).map((p) => [p.lat, p.lon]);
  }

  function renderTrackLineByCurrentWindow(mapSettings) {
    const latLngs = getFocusWindowTrackLatLngs(mapSettings);
    state.layers.trackLine.setLatLngs(latLngs);
    renderTrackArrows(latLngs, mapSettings);
  }

  function scheduleRoadFollowingForCurrentView(mapSettings, requestToken) {
    if (!mapSettings.roadRouting) return;
    const routePoints = mapSettings.focusWindowOnly ? getFocusWindowTrackPoints(mapSettings) : state.track;
    scheduleRoadFollowingTrack(routePoints, mapSettings, requestToken);
  }

  function renderTrackPointMarkers(mapSettings) {
    state.layers.trackDots?.clearLayers();
    state.layers.trackLabels?.clearLayers();
    if (!Array.isArray(state.track) || !state.track.length) return;

    const indices = getRenderedTrackIndices(state.track.length, state.currentTrackIndex, mapSettings);
    for (const idx of indices) {
      const p = state.track[idx];
      if (!p) continue;
      const isCurrent = idx === state.currentTrackIndex;
      const marker = L.circleMarker([p.lat, p.lon], {
        radius: isCurrent ? mapSettings.pointRadius + 1.5 : mapSettings.pointRadius,
        color: mapSettings.pointColor,
        fillColor: mapSettings.pointColor,
        fillOpacity: isCurrent ? 0.72 : 0.45,
        weight: isCurrent ? 1.9 : 1.3
      });
      marker.bindPopup(`<b>${escapeHtml(p.time)}</b><br>${escapeHtml(p.address || p.area || "未提供")}`);

      if (mapSettings.showPointDetails) {
        const detailHtml = `<span class="map-point-detail" style="background:rgba(0,0,0,${mapSettings.textOpacity / 100});font-size:${mapSettings.textSize}px;">${escapeHtml(`${idx + 1}. ${p.time}`)}</span>`;
        marker.bindTooltip(detailHtml, {
          permanent: true,
          direction: "top",
          offset: [0, -(mapSettings.pointRadius + 6)],
          className: "map-point-detail-tooltip"
        });
      }
      marker.addTo(state.layers.trackDots);

      if (mapSettings.showPointNumbers && state.layers.trackLabels) {
        const icon = L.divIcon({
          className: "map-point-number-icon",
          html: `<span style="border-color:${mapSettings.pointColor};color:${mapSettings.pointColor};">${idx + 1}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
        L.marker([p.lat, p.lon], { icon, interactive: false, keyboard: false }).addTo(state.layers.trackLabels);
      }
    }
  }

  function renderTrackArrows(trackLatLngs, mapSettings) {
    if (!state.layers.trackArrows) return;
    state.layers.trackArrows.clearLayers();

    if (!Array.isArray(trackLatLngs) || trackLatLngs.length < 2) return;
    const lineStyle = mapSettings.lineStyle;
    if (lineStyle !== "arrow" && lineStyle !== "dashed-arrow") return;

    if (lineStyle === "arrow") {
      const from = trackLatLngs[trackLatLngs.length - 2];
      const to = trackLatLngs[trackLatLngs.length - 1];
      const angle = getSegmentAngle(from, to);
      L.marker(to, { icon: createTrackArrowIcon(angle, mapSettings.lineColor), interactive: false }).addTo(state.layers.trackArrows);
      return;
    }

    const step = Math.max(2, Math.floor(trackLatLngs.length / 42));
    for (let i = step; i < trackLatLngs.length; i += step) {
      const from = trackLatLngs[Math.max(0, i - 1)];
      const to = trackLatLngs[i];
      const angle = getSegmentAngle(from, to);
      L.marker(to, { icon: createTrackArrowIcon(angle, mapSettings.lineColor), interactive: false }).addTo(state.layers.trackArrows);
    }
  }

  async function fetchRoadFollowingTrack(track) {
    if (!Array.isArray(track) || track.length < 2) return null;

    const maxPoints = 80;
    const step = Math.max(1, Math.ceil(track.length / maxPoints));
    const sampled = track.filter((_, idx) => idx === 0 || idx === track.length - 1 || idx % step === 0);
    if (sampled.length < 2) return null;

    const coordText = sampled.map((p) => `${Number(p.lon).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(";");
    const endpoint = `https://router.project-osrm.org/route/v1/driving/${coordText}?overview=full&geometries=geojson`;

    const response = await fetch(endpoint, { method: "GET" });
    if (!response.ok) return null;
    const payload = await response.json();
    const coords = payload?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return coords
      .filter((item) => Array.isArray(item) && item.length >= 2)
      .map((item) => [Number(item[1]), Number(item[0])])
      .filter((item) => Number.isFinite(item[0]) && Number.isFinite(item[1]));
  }

  function scheduleRoadFollowingTrack(track, mapSettings, requestToken) {
    if (!mapSettings.roadRouting) return;

    fetchRoadFollowingTrack(track)
      .then((routeLatLngs) => {
        if (requestToken !== state.routeRequestToken) return;
        if (!Array.isArray(routeLatLngs) || routeLatLngs.length < 2) return;
        state.layers.trackLine.setLatLngs(routeLatLngs);
        renderTrackArrows(routeLatLngs, mapSettings);
      })
      .catch(() => {
        // Fall back to straight polyline silently.
      });
  }

  function renderMap(payload) {
    initMapIfNeeded();
    if (!state.map) return;

    state.layers.trackLine.setLatLngs([]);
    state.layers.trackDots.clearLayers();
    state.layers.trackLabels?.clearLayers();
    state.layers.trackArrows?.clearLayers();
    state.layers.stays.clearLayers();
    state.layers.hotspots.clearLayers();
    state.layers.home.clearLayers();
    state.layers.teleport.clearLayers();

    const mapSettings = normalizeMapSettings(state.mapSettings);
    state.mapSettings = mapSettings;
    state.layers.trackLine.setStyle({
      color: mapSettings.lineColor,
      weight: mapSettings.lineWeight,
      opacity: 0.95,
      dashArray: getLineDashArray(mapSettings.lineStyle)
    });

    state.track = Array.isArray(payload.track) ? payload.track : [];
    state.currentTrackIndex = 0;
    const trackLatLngs = state.track.map((p) => [p.lat, p.lon]);
    state.routeRequestToken += 1;
    const routeToken = state.routeRequestToken;
    renderTrackLineByCurrentWindow(mapSettings);
    scheduleRoadFollowingForCurrentView(mapSettings, routeToken);
    renderTrackPointMarkers(mapSettings);

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
      state.map.setView([MAP_DEFAULT_VIEW.lat, MAP_DEFAULT_VIEW.lon], MAP_DEFAULT_VIEW.zoom);
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
    const zoom = state.map.getZoom();
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

    if (state.mapSettings.focusWindowOnly) {
      state.routeRequestToken += 1;
      const routeToken = state.routeRequestToken;
      renderTrackLineByCurrentWindow(state.mapSettings);
      scheduleRoadFollowingForCurrentView(state.mapSettings, routeToken);
      renderTrackPointMarkers(state.mapSettings);
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
    stopParkingPlayback({ clearHighlight: true, resetIndex: true });
    state.parkingPlaybackSequence = [];
    state.parkingPlaybackMarkerByCluster = new Map();
    state.parkingMapAutoFitKeys.clear();
    state.parkingMapUserAdjusted = false;

    renderParkingView(result);
    renderOvernightView(result);

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
      renderOvernightView(state.analysis);
    } else {
      updateOvernightModeUi();
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
      if (state.parkingMap) {
        setTimeout(() => state.parkingMap.invalidateSize(), 200);
      }
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
    });
  }

  function init() {
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
    updateOvernightModeUi();
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
  }

  init();
})();





