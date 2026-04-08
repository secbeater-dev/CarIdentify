export function createParkingView(deps) {
  const {
    els,
    state,
    L,
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
    sleep
  } = deps;
  let parkingStayMarkerByKey = new Map();
  let activeParkingStayKey = "";
  let activeParkingStayIndex = -1;
  let activeParkingStayMarker = null;

  function buildParkingStayKey(row, index = -1) {
    if (row?.__parkingViewKey) {
      return row.__parkingViewKey;
    }
    return [
      row?.start_id ?? "",
      row?.next_id ?? "",
      row?.arrive_time ?? "",
      row?.leave_time ?? "",
      row?.lat ?? "",
      row?.lon ?? "",
      index >= 0 ? index : ""
    ].join("|");
  }

  function clearParkingStayHighlight(options = {}) {
    const clearKey = options.clearKey !== false;
    const marker = activeParkingStayMarker;
    if (marker) {
      if (Number.isFinite(marker.__baseRadius)) {
        marker.setRadius(marker.__baseRadius);
      }
      marker.setStyle({
        color: marker.__baseColor || "#f4a261",
        fillColor: marker.__baseFillColor || "#f4a261",
        fillOpacity: Number.isFinite(marker.__baseFillOpacity) ? marker.__baseFillOpacity : 0.3,
        weight: Number.isFinite(marker.__baseWeight) ? marker.__baseWeight : 1.1
      });
    }
    activeParkingStayMarker = null;
    if (clearKey) {
      activeParkingStayKey = "";
      activeParkingStayIndex = -1;
    }
  }

  function highlightParkingStayMarker(marker) {
    clearParkingStayHighlight({ clearKey: false });
    if (!marker) return;
    if (Number.isFinite(marker.__baseRadius)) {
      marker.setRadius(Math.min(12, marker.__baseRadius + 2.2));
    }
    marker.setStyle({
      color: "#ffffff",
      fillColor: "#39ff14",
      fillOpacity: 0.95,
      weight: 2.2
    });
    activeParkingStayMarker = marker;
  }

  function focusParkingStayRow(row, options = {}) {
    if (!state.parkingMap || !row) return Promise.resolve();
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve();

    const rowKey = buildParkingStayKey(row);
    const marker = parkingStayMarkerByKey.get(rowKey) || null;
    activeParkingStayKey = rowKey;
    highlightParkingStayMarker(marker);
    marker?.openPopup();

    if (options.focus === false) {
      return Promise.resolve();
    }

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
    parkingStayMarkerByKey = new Map();
    activeParkingStayMarker = null;

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
      clearParkingStayHighlight();
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
      marker.__baseRadius = 4.2;
      marker.__baseColor = theme.rawColor;
      marker.__baseFillColor = theme.rawColor;
      marker.__baseFillOpacity = 0.3;
      marker.__baseWeight = 1.1;
      parkingStayMarkerByKey.set(buildParkingStayKey(row), marker);
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

  function renderParkingTable(rows, range) {
    renderTable(
      els.tableParking,
      rows,
      [
        { key: "arrive_time", label: "抵達時間" },
        { key: "leave_time", label: "離開時間" },
        { key: "duration_hhmm", label: "停留時長" },
        { key: "area", label: "行政區" },
        { key: "closest_address", label: "最接近地址" },
        { key: "stay_type", label: "類型" }
      ],
      {
        getRowKey: (row) => buildParkingStayKey(row),
        activeRowIndex: activeParkingStayIndex,
        activeRowKey: activeParkingStayKey,
        onRowClick: (row, index) => {
          stopParkingPlayback({ clearHighlight: true, resetIndex: false });
          activeParkingStayIndex = index;
          activeParkingStayKey = buildParkingStayKey(row);
          renderParkingTable(rows, range);
          void focusParkingStayRow(row, { focus: true });
        }
      }
    );
  }

  function renderParkingView(result) {
    const stays = Array.isArray(result?.stays) ? result.stays : [];
    const range = getParkingDurationRange(state.parkingSettings);
    const rows = stays
      .filter((row) => {
        const duration = Number(row.duration_min);
        if (!Number.isFinite(duration)) return false;
        return duration >= range.min && duration <= range.max;
      })
      .map((row, index) => ({
        ...row,
        __parkingViewKey: buildParkingStayKey(row, index)
      }));

    if (els.parkingCount) {
      els.parkingCount.textContent = `筆數：${rows.length}（篩選：${range.label}）`;
    }
    clearParkingStayHighlight();
    activeParkingStayKey = "";
    activeParkingStayIndex = -1;
    renderParkingMap(rows, range, result);
    renderParkingTable(rows, range);
  }



  return {
    renderParkingView,
    renderParkingPlaybackSelect,
    setParkingPlaybackButtonUi,
    setParkingPlaybackControlsEnabled,
    setParkingPlaybackIndex,
    stopParkingPlayback,
    toggleParkingPlayback,
    updateParkingPlaybackCurrent,
    updateParkingPlaybackSpeedLabel
  };
}
