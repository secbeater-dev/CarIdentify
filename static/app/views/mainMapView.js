import { renderPlateImageThumbnailHtml } from "./plateImageView.js?v=20260812a";

export function createMainMapView(deps) {
  const {
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
  } = deps;

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

  function hasPlateImageField(point) {
    return Boolean(point && Object.prototype.hasOwnProperty.call(point, "image_url"));
  }

  function renderTrackPointPopup(point) {
    const location = point.address || point.area || "未提供";
    const imageHtml = hasPlateImageField(point)
      ? `<div class="map-popup-plate-image">${renderPlateImageThumbnailHtml(point.image_url)}</div>`
      : "";
    return `<b>${escapeHtml(point.time || "")}</b><br>${escapeHtml(location)}${imageHtml}`;
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
    const detailText = `日期 ${dateText}｜時間 ${timeText}｜位置 ${locationText}｜座標 ${coordText}｜編號 ${point.id}`;
    if (!hasPlateImageField(point)) {
      els.mapCurrentInfo.textContent = detailText;
      return;
    }
    els.mapCurrentInfo.innerHTML = `<span>${escapeHtml(detailText)}</span><span class="map-current-plate-image">${renderPlateImageThumbnailHtml(point.image_url)}</span>`;
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
      marker.bindPopup(renderTrackPointPopup(p));

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
        const numberTextColor = document.documentElement.dataset.theme === "light" ? "#111111" : mapSettings.pointColor;
        const icon = L.divIcon({
          className: "map-point-number-icon",
          html: `<span style="border-color:${mapSettings.pointColor};color:${numberTextColor};">${idx + 1}</span>`,
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
      state.currentMarker.bindPopup(renderTrackPointPopup(point));
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



  return {
    findNearestTrackIndex,
    initMapIfNeeded,
    renderMap,
    setTeleportVisible,
    setTimelineIndex,
    stopPlayback,
    togglePlayback,
    updatePlaybackSpeedLabel
  };
}
