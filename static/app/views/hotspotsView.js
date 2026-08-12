import { els } from "../shared/dom.js?v=20260812a";
import { MAP_DEFAULT_VIEW } from "../shared/constants.js?v=20260812a";
import { state } from "../shared/state.js?v=20260812a";
import { createBaseMap, ensureMapHost, fitMapToLatLngs, renderEmptyMapHost } from "../shared/leaflet.js?v=20260812a";
import { escapeHtml } from "../shared/utils.js?v=20260812a";
import { getHotspotRows } from "../analysis/selectors.js?v=20260812a";
import { renderTable } from "./tableView.js?v=20260812a";

let hotspotMarkerByKey = new Map();
let activeHotspotKey = "";
let activeHotspotMarker = null;

function buildHotspotKey(row) {
  return [row?.rank ?? "", row?.center_lat ?? "", row?.center_lon ?? ""].join("|");
}

function clearHotspotSelection(options = {}) {
  const clearKey = options.clearKey !== false;
  const marker = activeHotspotMarker;
  if (marker) {
    if (Number.isFinite(marker.__baseRadius)) {
      marker.setRadius(marker.__baseRadius);
    }
    marker.setStyle({
      color: marker.__baseColor || "#ffffff",
      fillColor: marker.__baseFillColor || "#1f1f1f",
      fillOpacity: Number.isFinite(marker.__baseFillOpacity) ? marker.__baseFillOpacity : 0.95,
      weight: Number.isFinite(marker.__baseWeight) ? marker.__baseWeight : 2
    });
  }
  activeHotspotMarker = null;
  if (clearKey) {
    activeHotspotKey = "";
  }
}

function highlightHotspotMarker(marker) {
  clearHotspotSelection({ clearKey: false });
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
  activeHotspotMarker = marker;
}

function focusHotspotRow(row, options = {}) {
  if (!state.hotspotsMap || !row) return Promise.resolve();
  const lat = Number(row.center_lat);
  const lon = Number(row.center_lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve();

  const rowKey = buildHotspotKey(row);
  const marker = hotspotMarkerByKey.get(rowKey) || null;
  activeHotspotKey = rowKey;
  highlightHotspotMarker(marker);
  marker?.openPopup();

  if (options.focus === false) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.hotspotsMap.off("moveend", onMoveEnd);
      resolve();
    };
    const onMoveEnd = () => window.setTimeout(finish, 80);
    state.hotspotsMap.on("moveend", onMoveEnd);
    const zoom = state.hotspotsMap.getZoom();
    state.hotspotsMap.flyTo([lat, lon], zoom, {
      animate: true,
      duration: 0.75
    });
    window.setTimeout(finish, 1700);
  });
}

function initHotspotsMapIfNeeded() {
  if (state.hotspotsMap || !els.hotspotsMap || typeof L === "undefined") return;
  ensureMapHost(els.hotspotsMap);
  state.hotspotsMap = createBaseMap(els.hotspotsMap);
  if (!state.hotspotsMap) return;
  state.hotspotsLayers.markers = L.layerGroup().addTo(state.hotspotsMap);
}

function clearHotspotsMap() {
  if (state.hotspotsMap) {
    state.hotspotsMap.remove();
    state.hotspotsMap = null;
  }
  state.hotspotsLayers = {};
  hotspotMarkerByKey = new Map();
  activeHotspotMarker = null;
}

function renderHotspotsMap(rows) {
  if (!els.hotspotsMap) return;
  const points = Array.isArray(rows)
    ? rows.filter((row) => Number.isFinite(row.center_lat) && Number.isFinite(row.center_lon))
    : [];
  if (!points.length) {
    clearHotspotSelection();
    clearHotspotsMap();
    renderEmptyMapHost(els.hotspotsMap, "目前無熱區地圖資料");
    return;
  }

  ensureMapHost(els.hotspotsMap);
  initHotspotsMapIfNeeded();
  if (!state.hotspotsMap) return;
  state.hotspotsLayers.markers?.clearLayers();
  hotspotMarkerByKey = new Map();
  activeHotspotMarker = null;

  for (const row of points) {
    const marker = L.circleMarker([row.center_lat, row.center_lon], {
      radius: 7,
      color: "#ffffff",
      fillColor: "#1f1f1f",
      fillOpacity: 0.95,
      weight: 2
    });
    marker.bindTooltip(`<span class="parking-cluster-label">#${escapeHtml(row.rank)}</span>`, {
      permanent: true,
      direction: "top",
      offset: [0, -6],
      className: "parking-cluster-tooltip"
    });
    marker.bindPopup(
      `<b>熱區 #${escapeHtml(row.rank)}</b><br>次數：${escapeHtml(row.visits)}<br>總停留：${escapeHtml(
        row.total_duration_hhmm
      )}<br>${escapeHtml(row.area || "未提供")}<br>${escapeHtml(row.closest_address || "未提供")}`
    );
    marker.__baseRadius = 7;
    marker.__baseColor = "#ffffff";
    marker.__baseFillColor = "#1f1f1f";
    marker.__baseFillOpacity = 0.95;
    marker.__baseWeight = 2;
    hotspotMarkerByKey.set(buildHotspotKey(row), marker);
    marker.addTo(state.hotspotsLayers.markers);
  }

  fitMapToLatLngs(state.hotspotsMap, points.map((row) => [row.center_lat, row.center_lon]), MAP_DEFAULT_VIEW);
  window.setTimeout(() => state.hotspotsMap?.invalidateSize(), 80);
}

function renderHotspotsTable(rows) {
  renderTable(
    els.tableHotspots,
    rows,
    [
      { key: "rank", label: "排名" },
      { key: "area", label: "行政區" },
      { key: "closest_address", label: "最接近地址" },
      { key: "visits", label: "停留次數" },
      { key: "total_duration_hhmm", label: "總停留時長" },
      { key: "center_lon", label: "中心經度" },
      { key: "center_lat", label: "中心緯度" }
    ],
    {
      getRowKey: (row) => buildHotspotKey(row),
      activeRowKey: activeHotspotKey,
      onRowClick: (row) => {
        activeHotspotKey = buildHotspotKey(row);
        renderHotspotsTable(rows);
        void focusHotspotRow(row, { focus: true });
      }
    }
  );
}

export function renderHotspotsView(result) {
  const rows = getHotspotRows(result?.hotspots || []);
  clearHotspotSelection();
  renderHotspotsMap(rows);
  renderHotspotsTable(rows);
}

export function invalidateHotspotsMap() {
  if (state.hotspotsMap) {
    window.setTimeout(() => state.hotspotsMap?.invalidateSize(), 120);
  }
}



