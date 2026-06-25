import { els } from "../shared/dom.js?v=20260408e";
import { DEFAULT_ROUTINE_FILTER, MAP_DEFAULT_VIEW, ROUTINE_HOUR_OPTIONS } from "../shared/constants.js?v=20260408e";
import { state } from "../shared/state.js?v=20260408e";
import { createBaseMap, ensureMapHost, fitMapToLatLngs, renderEmptyMapHost } from "../shared/leaflet.js?v=20260408e";
import { buildRoutineViewModel } from "../analysis/selectors.js?v=20260408e";
import { normalizeMapSettings, pad2 } from "../shared/utils.js?v=20260408e";
import {
  areRoutineFiltersEqual,
  formatRoutineSelectedHours,
  getRoutineFilterLabel,
  normalizeRoutineFilter
} from "../analysis/timeFilters.js?v=20260408e";
import { renderTable } from "./tableView.js?v=20260408e";

let routineMarkerByKey = new Map();
let activeRoutineKey = "";
let activeRoutineMarker = null;

function formatRoutineCoord(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(6) : "";
}

function buildRoutinePointKey(point) {
  return [
    point?.id ?? "",
    point?.timestamp_ms ?? point?.time ?? "",
    point?.lat ?? "",
    point?.lon ?? ""
  ].join("|");
}

function clearRoutineSelection(options = {}) {
  const clearKey = options.clearKey !== false;
  const marker = activeRoutineMarker;
  if (marker) {
    if (Number.isFinite(marker.__baseRadius)) {
      marker.setRadius(marker.__baseRadius);
    }
    marker.setStyle({
      color: marker.__baseColor || state.mapSettings.pointColor,
      fillColor: marker.__baseFillColor || state.mapSettings.pointColor,
      fillOpacity: Number.isFinite(marker.__baseFillOpacity) ? marker.__baseFillOpacity : 0.5,
      weight: Number.isFinite(marker.__baseWeight) ? marker.__baseWeight : 1.3
    });
  }
  activeRoutineMarker = null;
  if (clearKey) {
    activeRoutineKey = "";
  }
}

function highlightRoutineMarker(marker) {
  clearRoutineSelection({ clearKey: false });
  if (!marker) return;
  if (Number.isFinite(marker.__baseRadius)) {
    marker.setRadius(Math.min(12, marker.__baseRadius + 2));
  }
  marker.setStyle({
    color: "#ffffff",
    fillColor: "#39ff14",
    fillOpacity: 0.96,
    weight: 2.2
  });
  activeRoutineMarker = marker;
}

function focusRoutinePoint(point, options = {}) {
  if (!state.routineMap || !point) return Promise.resolve();
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve();

  const pointKey = buildRoutinePointKey(point);
  const marker = routineMarkerByKey.get(pointKey) || null;
  activeRoutineKey = pointKey;
  highlightRoutineMarker(marker);
  marker?.openPopup();

  if (options.focus === false) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.routineMap.off("moveend", onMoveEnd);
      resolve();
    };
    const onMoveEnd = () => window.setTimeout(finish, 80);
    state.routineMap.on("moveend", onMoveEnd);
    const zoom = state.routineMap.getZoom();
    state.routineMap.flyTo([lat, lon], zoom, {
      animate: true,
      duration: 0.75
    });
    window.setTimeout(finish, 1700);
  });
}

function initRoutineMapIfNeeded() {
  if (state.routineMap || !els.routineMap || typeof L === "undefined") return;
  ensureMapHost(els.routineMap);
  state.routineMap = createBaseMap(els.routineMap);
  if (!state.routineMap) return;
  state.routineLayers.points = L.layerGroup().addTo(state.routineMap);
}

function clearRoutineMap() {
  if (state.routineMap) {
    state.routineMap.remove();
    state.routineMap = null;
  }
  state.routineLayers = {};
  routineMarkerByKey = new Map();
  activeRoutineMarker = null;
}

function renderRoutineMap(track) {
  if (!els.routineMap) return;
  const points = Array.isArray(track) ? track.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon)) : [];
  if (!points.length) {
    clearRoutineSelection();
    clearRoutineMap();
    renderEmptyMapHost(els.routineMap, "目前無符合條件的軌跡點");
    return;
  }

  ensureMapHost(els.routineMap);
  initRoutineMapIfNeeded();
  if (!state.routineMap) return;
  state.routineLayers.points?.clearLayers();
  routineMarkerByKey = new Map();
  activeRoutineMarker = null;

  const mapSettings = normalizeMapSettings(state.mapSettings);
  for (const point of points) {
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: mapSettings.pointRadius,
      color: mapSettings.pointColor,
      fillColor: mapSettings.pointColor,
      fillOpacity: 0.5,
      weight: 1.3
    });
    marker.bindPopup(
      `<b>${point.time}</b><br>${point.address || point.area || "未提供"}<br>${Number(point.lat).toFixed(6)}, ${Number(
        point.lon
      ).toFixed(6)}<br>編號 ${point.id}`
    );
    marker.__baseRadius = mapSettings.pointRadius;
    marker.__baseColor = mapSettings.pointColor;
    marker.__baseFillColor = mapSettings.pointColor;
    marker.__baseFillOpacity = 0.5;
    marker.__baseWeight = 1.3;
    routineMarkerByKey.set(buildRoutinePointKey(point), marker);
    marker.addTo(state.routineLayers.points);
  }

  fitMapToLatLngs(state.routineMap, points.map((point) => [point.lat, point.lon]), MAP_DEFAULT_VIEW);
  window.setTimeout(() => state.routineMap?.invalidateSize(), 80);
}

function renderRoutineTable(track) {
  renderTable(
    els.tableRoutine,
    track,
    [
      { key: "time", label: "時間" },
      { key: "area", label: "行政區" },
      { key: "address", label: "地址" },
      { key: "lon", label: "經度", format: formatRoutineCoord },
      { key: "lat", label: "緯度", format: formatRoutineCoord },
      { key: "id", label: "編號" }
    ],
    {
      getRowKey: (row) => buildRoutinePointKey(row),
      activeRowKey: activeRoutineKey,
      onRowClick: (row) => {
        activeRoutineKey = buildRoutinePointKey(row);
        renderRoutineTable(track);
        void focusRoutinePoint(row, { focus: true });
      }
    }
  );
}

function renderRoutineHourGrid(draftFilter, appliedFilter) {
  if (!els.routineHourGrid) return;
  const draftHours = new Set(draftFilter.selectedHours);
  const appliedHours = new Set(appliedFilter.selectedHours);

  els.routineHourGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const hour of ROUTINE_HOUR_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "routine-hour-chip";
    button.dataset.hour = String(hour);
    button.title = `${pad2(hour)}:00-${pad2(hour)}:59`;
    button.setAttribute("aria-label", `選擇 ${pad2(hour)} 點時段`);
    button.setAttribute("aria-pressed", draftHours.has(hour) ? "true" : "false");
    if (draftHours.has(hour)) {
      button.classList.add("is-selected");
    }
    if (appliedHours.has(hour)) {
      button.classList.add("is-applied");
    }
    if (draftHours.has(hour) !== appliedHours.has(hour)) {
      button.classList.add("is-pending");
    }
    button.innerHTML = `<span class="routine-hour-chip-label">${pad2(hour)}</span>`;
    fragment.appendChild(button);
  }

  els.routineHourGrid.appendChild(fragment);
}

function buildRoutineStatusText(draftFilter, appliedFilter) {
  const count = draftFilter.selectedHours.length;
  const dirty = !areRoutineFiltersEqual(draftFilter, appliedFilter);
  if (!count) {
    return dirty ? "目前未選任何時段，按套用後會清空結果" : "目前未選任何時段";
  }
  if (dirty) {
    return `已選 ${count}/24 個時段，尚未套用變更`;
  }
  return `已套用 ${count}/24 個時段`;
}

export function syncRoutineFilterUi(options = {}) {
  const syncDraft = options.syncDraft !== false;
  const appliedFilter = normalizeRoutineFilter(state.routineFilter || DEFAULT_ROUTINE_FILTER);
  state.routineFilter = { selectedHours: appliedFilter.selectedHours.slice() };
  if (syncDraft) {
    state.routineFilterDraft = { selectedHours: appliedFilter.selectedHours.slice() };
  } else {
    state.routineFilterDraft = normalizeRoutineFilter(state.routineFilterDraft || appliedFilter);
  }
  const draftFilter = normalizeRoutineFilter(state.routineFilterDraft || appliedFilter);
  state.routineFilterDraft = { selectedHours: draftFilter.selectedHours.slice() };

  renderRoutineHourGrid(draftFilter, appliedFilter);

  const draftCount = draftFilter.selectedHours.length;
  const dirty = !areRoutineFiltersEqual(draftFilter, appliedFilter);
  if (els.routineFilterStatus) {
    els.routineFilterStatus.textContent = buildRoutineStatusText(draftFilter, appliedFilter);
    els.routineFilterStatus.classList.toggle("is-dirty", dirty);
  }
  if (els.routineFilterApply) {
    els.routineFilterApply.disabled = !dirty;
  }
  if (els.routineFilterSelectAll) {
    els.routineFilterSelectAll.disabled = draftCount === ROUTINE_HOUR_OPTIONS.length;
  }
  if (els.routineFilterReset) {
    els.routineFilterReset.disabled = draftCount === 0;
  }
  if (els.routineFilterSummary && !state.analysis) {
    els.routineFilterSummary.textContent = `目前顯示：${getRoutineFilterLabel(appliedFilter)}`;
  }
}

export function toggleRoutineDraftHour(hour) {
  const normalizedHour = Number(hour);
  if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) return;
  const draftFilter = normalizeRoutineFilter(state.routineFilterDraft || state.routineFilter || DEFAULT_ROUTINE_FILTER);
  const nextHours = new Set(draftFilter.selectedHours);
  if (nextHours.has(normalizedHour)) {
    nextHours.delete(normalizedHour);
  } else {
    nextHours.add(normalizedHour);
  }
  state.routineFilterDraft = normalizeRoutineFilter({ selectedHours: Array.from(nextHours) });
}

export function selectAllRoutineDraftHours() {
  state.routineFilterDraft = normalizeRoutineFilter({ selectedHours: ROUTINE_HOUR_OPTIONS });
}

export function resetRoutineDraftHours() {
  state.routineFilterDraft = normalizeRoutineFilter({ selectedHours: [] });
}

export function getRoutineDraftLabel() {
  const draftFilter = normalizeRoutineFilter(state.routineFilterDraft || DEFAULT_ROUTINE_FILTER);
  return `${formatRoutineSelectedHours(draftFilter.selectedHours)}（${draftFilter.selectedHours.length}/24）`;
}

export function renderHourlyChart(hourlyCounts) {
  if (!els.routineHourChart || typeof Chart === "undefined") return;
  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const isLightTheme = document.documentElement.dataset.theme !== "dark";
  const palette = isLightTheme
    ? {
        bar: "rgba(15, 118, 110, 0.88)",
        barHover: "rgba(12, 95, 88, 0.98)",
        border: "#0b5f58",
        text: "#172019",
        mutedText: "#304038",
        grid: "rgba(23, 32, 25, 0.16)",
        zeroGrid: "rgba(23, 32, 25, 0.34)",
        tooltipBg: "rgba(12, 31, 28, 0.96)",
        tooltipText: "#ffffff"
      }
    : {
        bar: "rgba(63, 220, 196, 0.82)",
        barHover: "rgba(121, 255, 229, 0.95)",
        border: "#a7fff1",
        text: "#f7fffc",
        mutedText: "#d5fff6",
        grid: "rgba(213, 255, 246, 0.18)",
        zeroGrid: "rgba(213, 255, 246, 0.38)",
        tooltipBg: "rgba(2, 20, 18, 0.96)",
        tooltipText: "#f7fffc"
      };
  const axisFont = {
    size: 13,
    weight: "700",
    family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  };
  const titleFont = {
    size: 14,
    weight: "800",
    family: axisFont.family
  };

  if (state.hourChart) {
    state.hourChart.destroy();
    state.hourChart = null;
  }

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
          backgroundColor: palette.bar,
          hoverBackgroundColor: palette.barHover,
          borderColor: palette.border,
          hoverBorderColor: palette.border,
          borderWidth: 2,
          borderRadius: 7,
          borderSkipped: false,
          maxBarThickness: 34
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "時段",
            color: palette.text,
            font: titleFont,
            padding: { top: 8 }
          },
          ticks: {
            color: palette.text,
            font: axisFont,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          },
          grid: {
            color: palette.grid,
            tickColor: palette.grid,
            lineWidth: 1
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "辨識數量",
            color: palette.text,
            font: titleFont,
            padding: { bottom: 8 }
          },
          ticks: {
            color: palette.text,
            precision: 0,
            font: axisFont,
            padding: 8
          },
          grid: {
            color: (context) => (context.tick?.value === 0 ? palette.zeroGrid : palette.grid),
            tickColor: palette.grid,
            lineWidth: (context) => (context.tick?.value === 0 ? 1.4 : 1)
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: palette.text,
            font: titleFont,
            boxWidth: 16,
            boxHeight: 12,
            padding: 18
          }
        },
        tooltip: {
          backgroundColor: palette.tooltipBg,
          titleColor: palette.tooltipText,
          bodyColor: palette.tooltipText,
          borderColor: palette.border,
          borderWidth: 1,
          padding: 12,
          titleFont: { size: 14, weight: "800", family: axisFont.family },
          bodyFont: { size: 14, weight: "700", family: axisFont.family },
          callbacks: {
            label: (context) => `辨識數量：${context.parsed.y} 筆`
          }
        }
      }
    }
  });
}

export function renderRoutineView(result) {
  const viewModel = buildRoutineViewModel(result, state.routineFilter);
  state.routineFilteredTrack = viewModel.filteredTrack.slice();
  clearRoutineSelection();
  renderHourlyChart(viewModel.hourlyCounts);
  renderRoutineMap(viewModel.filteredTrack);
  renderRoutineTable(viewModel.filteredTrack);
  if (els.routineFilterSummary) {
    els.routineFilterSummary.textContent = viewModel.summary;
  }
  syncRoutineFilterUi({ syncDraft: false });
}

export function invalidateRoutineMap() {
  if (state.routineMap) {
    window.setTimeout(() => state.routineMap?.invalidateSize(), 120);
  }
}


