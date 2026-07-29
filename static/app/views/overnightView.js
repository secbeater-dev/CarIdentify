import { els } from "../shared/dom.js?v=20260729c";
import { MAP_DEFAULT_VIEW, OVERNIGHT_MODE_DAY } from "../shared/constants.js?v=20260729c";
import { state } from "../shared/state.js?v=20260729c";
import { createBaseMap, ensureMapHost, fitMapToLatLngs, renderEmptyMapHost } from "../shared/leaflet.js?v=20260729c";
import { escapeHtml } from "../shared/utils.js?v=20260729c";
import { getOvernightRowsByMode } from "../analysis/selectors.js?v=20260729c";
import { renderTable } from "./tableView.js?v=20260729c";

let overnightMarkerByKey = new Map();
let activeOvernightKey = "";
let activeOvernightIndex = -1;
let activeOvernightMarker = null;

function buildOvernightRowKey(row) {
  return [
    row?.start_id ?? "",
    row?.next_id ?? "",
    row?.arrive_time ?? "",
    row?.leave_time ?? "",
    row?.lat ?? "",
    row?.lon ?? ""
  ].join("|");
}

function clearOvernightSelection(options = {}) {
  const clearKey = options.clearKey !== false;
  const marker = activeOvernightMarker;
  if (marker) {
    if (Number.isFinite(marker.__baseRadius)) {
      marker.setRadius(marker.__baseRadius);
    }
    marker.setStyle({
      color: marker.__baseColor || "#ffd166",
      fillColor: marker.__baseFillColor || "#ff9800",
      fillOpacity: Number.isFinite(marker.__baseFillOpacity) ? marker.__baseFillOpacity : 0.88,
      weight: Number.isFinite(marker.__baseWeight) ? marker.__baseWeight : 1.8
    });
  }
  activeOvernightMarker = null;
  if (clearKey) {
    activeOvernightKey = "";
    activeOvernightIndex = -1;
  }
}

function highlightOvernightMarker(marker) {
  clearOvernightSelection({ clearKey: false });
  if (!marker) return;
  if (Number.isFinite(marker.__baseRadius)) {
    marker.setRadius(Math.min(11, marker.__baseRadius + 2));
  }
  marker.setStyle({
    color: "#ffffff",
    fillColor: "#39ff14",
    fillOpacity: 0.96,
    weight: 2.4
  });
  activeOvernightMarker = marker;
}

function focusOvernightRow(row, options = {}) {
  if (!state.overnightMap || !row) return Promise.resolve();
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve();

  const rowKey = buildOvernightRowKey(row);
  const marker = overnightMarkerByKey.get(rowKey) || null;
  activeOvernightKey = rowKey;
  highlightOvernightMarker(marker);
  marker?.openPopup();

  if (options.focus === false) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.overnightMap.off("moveend", onMoveEnd);
      resolve();
    };
    const onMoveEnd = () => window.setTimeout(finish, 80);
    state.overnightMap.on("moveend", onMoveEnd);
    const zoom = state.overnightMap.getZoom();
    state.overnightMap.flyTo([lat, lon], zoom, {
      animate: true,
      duration: 0.75
    });
    window.setTimeout(finish, 1700);
  });
}

function initOvernightMapIfNeeded() {
  if (state.overnightMap || !els.overnightMap || typeof L === "undefined") return;
  ensureMapHost(els.overnightMap);
  state.overnightMap = createBaseMap(els.overnightMap);
  if (!state.overnightMap) return;
  state.overnightLayers.markers = L.layerGroup().addTo(state.overnightMap);
}

function clearOvernightMap() {
  if (state.overnightMap) {
    state.overnightMap.remove();
    state.overnightMap = null;
  }
  state.overnightLayers = {};
  overnightMarkerByKey = new Map();
  activeOvernightMarker = null;
}

function renderOvernightMap(rows) {
  if (!els.overnightMap) return;
  const points = Array.isArray(rows) ? rows.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon)) : [];
  if (!points.length) {
    clearOvernightSelection();
    clearOvernightMap();
    renderEmptyMapHost(els.overnightMap, "目前無符合條件的停駐時段地圖資料");
    return;
  }

  ensureMapHost(els.overnightMap);
  initOvernightMapIfNeeded();
  if (!state.overnightMap) return;
  state.overnightLayers.markers?.clearLayers();
  overnightMarkerByKey = new Map();
  activeOvernightMarker = null;

  const isDay = state.overnightMode === OVERNIGHT_MODE_DAY;
  const color = isDay ? "#4cc9f0" : "#ffd166";
  const fill = isDay ? "#118ab2" : "#ff9800";
  for (const row of points) {
    const overlap = isDay ? row.day_overlap_h : row.night_overlap_h;
    const marker = L.circleMarker([row.lat, row.lon], {
      radius: 6,
      color,
      fillColor: fill,
      fillOpacity: 0.88,
      weight: 1.8
    });
    marker.bindPopup(
      `<b>${escapeHtml(isDay ? "日間停駐" : "過夜停駐")}</b><br>${escapeHtml(row.arrive_time)} ~ ${escapeHtml(
        row.leave_time
      )}<br>${escapeHtml(row.duration_hhmm)}<br>重疊時數：${escapeHtml(overlap)} 小時<br>${escapeHtml(
        row.area || "未提供"
      )}<br>${escapeHtml(row.closest_address || "未提供")}`
    );
    marker.__baseRadius = 6;
    marker.__baseColor = color;
    marker.__baseFillColor = fill;
    marker.__baseFillOpacity = 0.88;
    marker.__baseWeight = 1.8;
    overnightMarkerByKey.set(buildOvernightRowKey(row), marker);
    marker.addTo(state.overnightLayers.markers);
  }

  fitMapToLatLngs(state.overnightMap, points.map((row) => [row.lat, row.lon]), MAP_DEFAULT_VIEW);
  window.setTimeout(() => state.overnightMap?.invalidateSize(), 80);
}

function renderOvernightTable(rows, overlapColumn) {
  renderTable(
    els.tableOvernight,
    rows,
    [
      { key: "arrive_time", label: "抵達時間" },
      { key: "leave_time", label: "離開時間" },
      { key: "duration_hhmm", label: "停留時長" },
      overlapColumn,
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" }
    ],
    {
      getRowKey: (row) => buildOvernightRowKey(row),
      activeRowIndex: activeOvernightIndex,
      activeRowKey: activeOvernightKey,
      onRowClick: (row, index) => {
        activeOvernightIndex = index;
        activeOvernightKey = buildOvernightRowKey(row);
        renderOvernightTable(rows, overlapColumn);
        void focusOvernightRow(row, { focus: true });
      }
    }
  );
}

export function updateOvernightModeUi() {
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

export function renderOvernightView(result) {
  const overnightRows = getOvernightRowsByMode(result?.stays || [], state.overnightMode);
  const overlapColumn = state.overnightMode === OVERNIGHT_MODE_DAY
    ? { key: "day_overlap_h", label: "日間重疊(小時)" }
    : { key: "night_overlap_h", label: "夜間重疊(小時)" };

  if (els.overnightCount) {
    els.overnightCount.textContent = `筆數：${overnightRows.length}`;
  }
  clearOvernightSelection();
  activeOvernightKey = "";
  activeOvernightIndex = -1;
  renderOvernightMap(overnightRows);
  renderOvernightTable(overnightRows, overlapColumn);
  updateOvernightModeUi();
}

export function invalidateOvernightMap() {
  if (state.overnightMap) {
    window.setTimeout(() => state.overnightMap?.invalidateSize(), 120);
  }
}



