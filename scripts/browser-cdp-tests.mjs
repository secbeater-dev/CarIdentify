import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] || "http://127.0.0.1:8124/");
const debugPort = Number(args["debug-port"] || 9223);
const xlsxPath = path.resolve(String(args.xlsx || "H:/CarIdentify/pegion_Car_Identfy.xlsx"));
const csvPath = path.resolve(String(args.csv || "H:/CarIdentify/Pegion_Freeway_ETC_Record.csv"));
const idkcityPath = path.resolve(String(args.idkcity || "H:/CarIdentify/Pegion_IDKCity_Car_Identfy.xlsx"));
const combinedCoordPath = args["combined-coord"] ? path.resolve(String(args["combined-coord"])) : "";
const timeoutMs = Number(args.timeout || 30000);
const requestedCase = args.case ? String(args.case) : "";
const MODULE_VERSION = "20260607a";

const requiredFilesByCase = {
  "xlsx-single": [xlsxPath],
  "csv-single": [csvPath],
  "merged-upload": [xlsxPath, csvPath],
  "idkcity-single": [idkcityPath],
  "combined-coordinate-sensitive": [combinedCoordPath]
};
const requiredFiles = requestedCase
  ? requiredFilesByCase[requestedCase] || []
  : [xlsxPath, csvPath, idkcityPath].concat(combinedCoordPath ? [combinedCoordPath] : []);

for (const filePath of requiredFiles) {
  if (!filePath) {
    console.error(`Missing path for test case: ${requestedCase || "full suite"}`);
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`Missing test file: ${filePath}`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientContextError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("Cannot find context with specified id") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Inspected target navigated or closed")
  );
}

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function valueLiteral(value) {
  return JSON.stringify(value);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (event) => reject(new Error(`WebSocket connect failed: ${event?.message || "unknown error"}`));
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`${message.error.message || "CDP error"}`));
        } else {
          pending.resolve(message.result || {});
        }
      };
      ws.onclose = () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();
      };
    });
  }

  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket is not open for ${method}`);
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    const result = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
    return result;
  }

  async close() {
    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

async function getPageWebSocketUrl() {
  const deadline = Date.now() + timeoutMs;
  const expected = normalizeUrl(baseUrl);
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
      const match =
        pages.find((target) => normalizeUrl(target.url) === expected) ||
        pages.find((target) => normalizeUrl(target.url).startsWith(expected)) ||
        pages[0];
      if (match?.webSocketDebuggerUrl) {
        return match.webSocketDebuggerUrl;
      }
    } catch (error) {
      // Retry until timeout.
    }
    await sleep(250);
  }
  throw new Error(`Could not find page target for ${baseUrl}`);
}

async function evaluate(client, expression) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return result.result?.value;
    } catch (error) {
      if (!isTransientContextError(error) || attempt === 11) {
        throw error;
      }
      lastError = error;
      await sleep(150);
    }
  }
  throw lastError || new Error("Runtime.evaluate failed");
}

async function waitFor(client, description, predicate, options = {}) {
  const timeout = options.timeout ?? timeoutMs;
  const interval = options.interval ?? 200;
  const deadline = Date.now() + timeout;
  let lastValue = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await predicate();
    } catch (error) {
      if (!isTransientContextError(error)) {
        throw error;
      }
      lastValue = null;
    }
    if (lastValue) {
      return lastValue;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

async function waitForPageReady(client) {
  await waitFor(client, "document ready", async () => {
    const info = await evaluate(client, `(() => ({
      ready: document.readyState === "complete",
      hasFileInput: Boolean(document.querySelector("#file-input")),
      appReady: window.__CARIDENTIFY_APP_READY__ === true
    }))()`);
    return info?.ready && info?.hasFileInput && info?.appReady ? info : null;
  }, { interval: 150, timeout: 20000 });
}

async function navigateToBaseUrl(client) {
  await client.send("Page.navigate", { url: baseUrl });
  await sleep(500);
  await waitForPageReady(client);
}

async function closeFirstOpenOverlayIfPresent(client) {
  const hasOverlay = await evaluate(client, `Boolean(document.querySelector('.first-open-overlay [data-action="close"]'))`);
  if (!hasOverlay) return false;
  await evaluate(client, `(() => {
    document.querySelector('.first-open-overlay [data-action="close"]')?.click();
    return true;
  })()`);
  await waitFor(client, "first-open overlay to close", async () => {
    const exists = await evaluate(client, `Boolean(document.querySelector('.first-open-overlay'))`);
    return exists ? null : true;
  }, { timeout: 8000, interval: 150 });
  return true;
}

async function reloadPage(client) {
  await client.send("Page.reload", { ignoreCache: true });
  await sleep(500);
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
}

async function queryStatus(client) {
  return evaluate(client, `(() => {
    const el = document.getElementById("status");
    return {
      text: el?.textContent?.trim() || "",
      className: el?.className || ""
    };
  })()`);
}

async function setFileInputFiles(client, selector, files) {
  const handle = await client.send("Runtime.evaluate", {
    expression: `document.querySelector(${valueLiteral(selector)})`,
    returnByValue: false
  });
  const objectId = handle.result?.objectId;
  if (!objectId) {
    throw new Error(`Could not find file input ${selector}; handle=${JSON.stringify(handle)}`);
  }
  await client.send("DOM.setFileInputFiles", { objectId, files });
}

async function submitAnalyzeForm(client) {
  const before = await queryStatus(client);
  const ok = await evaluate(client, `(() => {
    const form = document.getElementById("analyze-form");
    const button = document.querySelector('#analyze-form button[type="submit"]');
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit(button || undefined);
      return true;
    }
    if (button) {
      button.click();
      return true;
    }
    if (!form) return false;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  if (!ok) {
    throw new Error("Could not submit analyze form");
  }

  const changed = await waitFor(client, "status to change after submit", async () => {
    const status = await queryStatus(client);
    return status.text !== before.text || status.className !== before.className ? status : null;
  }, { timeout: 2000, interval: 150 }).catch(() => null);

  if (!changed) {
    await evaluate(client, `(() => {
      const button = document.querySelector('#analyze-form button[type="submit"]');
      const form = document.getElementById("analyze-form");
      if (button) {
        button.click();
      }
      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return true;
    })()`);
  }
}

async function waitForAnalysisComplete(client) {
  return waitFor(client, "analysis to complete", async () => {
    const status = await queryStatus(client);
    if (!status?.text) return null;
    if (status.className.includes("success") || status.className.includes("error")) {
      return status;
    }
    return null;
  }, { timeout: 60000, interval: 250 });
}

async function click(client, selector) {
  const ok = await evaluate(client, `(() => {
    const el = document.querySelector(${valueLiteral(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`Could not click ${selector}`);
  }
}

async function setInputValue(client, selector, value, eventType = "input") {
  const ok = await evaluate(client, `(() => {
    const el = document.querySelector(${valueLiteral(selector)});
    if (!el) return false;
    el.value = ${valueLiteral(value)};
    el.dispatchEvent(new Event(${valueLiteral(eventType)}, { bubbles: true }));
    return true;
  })()`);
  if (!ok) {
    throw new Error(`Could not set ${selector}`);
  }
}

async function clickRoutineHour(client, hour) {
  const normalized = String(hour).padStart(2, "0");
  await click(client, `#routine-hour-grid [data-hour="${Number(hour)}"]`);
  return normalized;
}

async function selectRoutineHours(client, hours) {
  await click(client, "#routine-filter-reset");
  for (const hour of hours) {
    await clickRoutineHour(client, hour);
  }
}

async function getText(client, selector) {
  return evaluate(client, `(() => document.querySelector(${valueLiteral(selector)})?.textContent?.trim() || "")()`);
}

async function getRowCount(client, tableSelector) {
  return evaluate(client, `(() => document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr`)}).length)()`);
}

async function getTableRowCells(client, tableSelector, rowIndex) {
  return evaluate(client, `(() => {
    const rows = Array.from(document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr`)}));
    const row = rows[${rowIndex}];
    if (!row) return null;
    return Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() || "");
  })()`);
}

async function clickTableRow(client, tableSelector, rowIndex) {
  const ok = await evaluate(client, `(() => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (async () => {
      const rows = Array.from(document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr`)}));
      const row = rows[${rowIndex}];
      if (!row) return false;
      const target = row.querySelector("td, th") || row;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      await nextFrame();
      target.click();
      target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      return true;
    })();
  })()`);
  if (!ok) {
    throw new Error(`Could not click row ${rowIndex} in ${tableSelector}`);
  }
}

async function invokeTableRowHandler(client, tableSelector, rowIndex) {
  const ok = await evaluate(client, `(() => {
    const container = document.querySelector(${valueLiteral(tableSelector)});
    const rows = Array.from(document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr`)}));
    const row = rows[${rowIndex}];
    if (!container || !row || typeof container.__tableRowClickHandler !== "function") {
      return false;
    }
    const target = row.querySelector("td, th") || row;
    container.__tableRowClickHandler({ target });
    return true;
  })()`);
  if (!ok) {
    throw new Error(`Could not invoke row handler ${rowIndex} in ${tableSelector}`);
  }
}

async function waitForActiveTableRow(client, tableSelector, rowIndex) {
  return waitFor(client, `${tableSelector} row ${rowIndex} to become active`, async () => {
    const isActive = await evaluate(client, `(() => {
      const rows = Array.from(document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr`)}));
      const row = rows[${rowIndex}];
      return Boolean(row && row.classList.contains("is-active"));
    })()`);
    return isActive ? true : null;
  }, { timeout: 10000, interval: 150 });
}

async function waitForAnyActiveTableRow(client, tableSelector) {
  return waitFor(client, `${tableSelector} to have an active row`, async () => {
    const info = await evaluate(client, `(() => {
      const rows = Array.from(document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr`)}));
      const activeIndexes = rows
        .map((row, index) => row.classList.contains("is-active") ? index : -1)
        .filter((index) => index >= 0);
      return activeIndexes.length ? activeIndexes : null;
    })()`);
    return info;
  }, { timeout: 10000, interval: 150 });
}

async function assertNoActiveTableRows(client, tableSelector) {
  const activeCount = await evaluate(client, `(() => {
    return document.querySelectorAll(${valueLiteral(`${tableSelector} tbody tr.is-active`)}).length;
  })()`);
  assertCondition(activeCount === 0, `Expected ${tableSelector} to have no active rows, got ${activeCount}`);
}

async function getPopupText(client, mapSelector) {
  return evaluate(client, `(() => {
    const popup = document.querySelector(${valueLiteral(`${mapSelector} .leaflet-popup-content`)});
    return popup?.textContent?.trim() || "";
  })()`);
}

async function waitForPopupContains(client, mapSelector, text) {
  return waitFor(client, `${mapSelector} popup to contain ${text}`, async () => {
    const popupText = await getPopupText(client, mapSelector);
    return popupText.includes(text) ? popupText : null;
  }, { timeout: 12000, interval: 150 });
}

async function getMapRuntimeState(client, stateKey) {
  return evaluate(client, `import('./static/app/shared/state.js?v=${MODULE_VERSION}').then(({ state }) => {
    const map = state[${valueLiteral(stateKey)}];
    if (!map) return null;
    const center = map.getCenter();
    const popup = map._popup || null;
    const popupLatLng = popup?.getLatLng?.();
    return {
      center: center ? { lat: center.lat, lon: center.lng } : null,
      popupOpen: Boolean(popup && map.hasLayer(popup)),
      popupLatLng: popupLatLng ? { lat: popupLatLng.lat, lon: popupLatLng.lng } : null
    };
  })`);
}

async function getMapState(client, selector) {
  return evaluate(client, `(() => {
    const root = document.querySelector(${valueLiteral(selector)});
    if (!root) return { exists: false, mode: "missing" };
    if (root.querySelector('.empty-map')) return { exists: true, mode: 'empty' };
    const hasLeaflet = Boolean(root.querySelector('.leaflet-pane, .leaflet-container, svg, .leaflet-marker-icon'));
    return { exists: true, mode: hasLeaflet ? 'leaflet' : 'other' };
  })()`);
}

async function waitForMapMode(client, selector, expectedMode) {
  return waitFor(client, `${selector} => ${expectedMode}`, async () => {
    const state = await getMapState(client, selector);
    return state?.mode === expectedMode ? state : null;
  }, { timeout: 20000, interval: 250 });
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack, needle, message) {
  if (!String(haystack || "").includes(needle)) {
    throw new Error(`${message} | actual=${JSON.stringify(haystack)}`);
  }
}

async function assertStatusSuccess(client, expectedNeedle) {
  const status = await waitForAnalysisComplete(client);
  if (status.className.includes("error")) {
    throw new Error(`Analysis failed: ${status.text}`);
  }
  assertIncludes(status.text, expectedNeedle, `Status should include ${expectedNeedle}`);
  assertCondition(status.className.includes("success"), `Status should be success, got ${status.className}`);
  return status;
}

async function getAnalysisSnapshot(client) {
  return evaluate(client, `import('./static/app/shared/state.js?v=${MODULE_VERSION}').then(({ state }) => {
    const summary = state.analysis?.summary || {};
    const track = Array.isArray(state.analysis?.map?.track) ? state.analysis.map.track : [];
    return {
      hasAnalysis: Boolean(state.analysis),
      rawRecords: Number(summary.raw_records) || 0,
      cleanRecords: Number(summary.clean_records) || 0,
      trackLength: track.length,
      finiteTrackCoordinates: track.every((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon))),
      coordinateSwappedFixed: Boolean(summary.coordinate_swapped_fixed),
      cleaningSkipped: Boolean(summary.cleaning_skipped)
    };
  })`);
}

async function assertAnalysisState(client, options = {}) {
  const {
    minRaw = 2,
    minClean = 1,
    minTrack = 1,
    coordinateSwappedFixed,
    cleaningSkipped
  } = options;
  const snapshot = await getAnalysisSnapshot(client);
  assertCondition(Boolean(snapshot?.hasAnalysis), "Analysis state missing");
  assertCondition(snapshot.rawRecords >= minRaw, `Expected raw records >= ${minRaw}, got ${snapshot.rawRecords}`);
  assertCondition(snapshot.cleanRecords >= minClean, `Expected clean records >= ${minClean}, got ${snapshot.cleanRecords}`);
  assertCondition(snapshot.trackLength >= minTrack, `Expected track length >= ${minTrack}, got ${snapshot.trackLength}`);
  assertCondition(Boolean(snapshot.finiteTrackCoordinates), "Analysis produced invalid coordinates");
  if (typeof coordinateSwappedFixed === "boolean") {
    assertCondition(
      snapshot.coordinateSwappedFixed === coordinateSwappedFixed,
      `Expected coordinateSwappedFixed=${coordinateSwappedFixed}, got ${snapshot.coordinateSwappedFixed}`
    );
  }
  if (typeof cleaningSkipped === "boolean") {
    assertCondition(
      snapshot.cleaningSkipped === cleaningSkipped,
      `Expected cleaningSkipped=${cleaningSkipped}, got ${snapshot.cleaningSkipped}`
    );
  }
  return snapshot;
}

async function assertSensitiveAnalysisSuccess(client) {
  const status = await waitForAnalysisComplete(client);
  if (status.className.includes("error")) {
    throw new Error("Sensitive workbook analysis failed; status text redacted.");
  }
  assertCondition(status.className.includes("success"), `Sensitive workbook status should be success, got ${status.className}`);
  return status;
}

async function assertCountText(client, selector, expectedText) {
  const deadline = Date.now() + 15000;
  let actual = "";
  while (Date.now() < deadline) {
    actual = await getText(client, selector);
    if (actual === expectedText) {
      return actual;
    }
    await sleep(200);
  }
  throw new Error(`Expected ${selector} to equal ${JSON.stringify(expectedText)}, got ${JSON.stringify(actual)}`);
}

async function assertRowCount(client, selector, expectedCount) {
  const deadline = Date.now() + 15000;
  let actual = -1;
  while (Date.now() < deadline) {
    actual = await getRowCount(client, selector);
    if (actual === expectedCount) {
      return actual;
    }
    await sleep(250);
  }
  throw new Error(`Expected ${selector} row count ${expectedCount}, got ${actual}`);
}

async function assertRowCountAtLeast(client, selector, minimumCount) {
  const deadline = Date.now() + 15000;
  let actual = -1;
  while (Date.now() < deadline) {
    actual = await getRowCount(client, selector);
    if (actual >= minimumCount) {
      return actual;
    }
    await sleep(250);
  }
  throw new Error(`Expected ${selector} row count >= ${minimumCount}, got ${actual}`);
}

async function assertSummaryContains(client, text) {
  const deadline = Date.now() + 15000;
  let actual = "";
  while (Date.now() < deadline) {
    actual = await getText(client, "#routine-filter-summary");
    if (actual.includes(text)) {
      return actual;
    }
    await sleep(200);
  }
  throw new Error(`Expected #routine-filter-summary to contain ${JSON.stringify(text)}, got ${JSON.stringify(actual)}`);
}

async function getRoutineExpectedMatchCount(client, selectedHours) {
  return evaluate(client, `Promise.all([
    import('./static/app/shared/state.js?v=${MODULE_VERSION}'),
    import('./static/app/analysis/timeFilters.js?v=${MODULE_VERSION}')
  ]).then(([{ state }, { filterTrackByTimeRange }]) => {
    const filtered = filterTrackByTimeRange(state.analysis?.map?.track || [], {
      selectedHours: ${JSON.stringify(selectedHours)}
    });
    return filtered.length;
  })`);
}

async function assertMapCenteredNear(client, stateKey, lat, lon, tolerance = 0.0035) {
  const expectedLat = Number(lat);
  const expectedLon = Number(lon);
  if (!Number.isFinite(expectedLat) || !Number.isFinite(expectedLon)) {
    throw new Error(`Invalid target coordinates for ${stateKey}: ${lat}, ${lon}`);
  }
  return waitFor(client, `${stateKey} center near ${expectedLat},${expectedLon}`, async () => {
    const snapshot = await getMapRuntimeState(client, stateKey);
    if (!snapshot?.center) return null;
    const latOk = Math.abs(snapshot.center.lat - expectedLat) <= tolerance;
    const lonOk = Math.abs(snapshot.center.lon - expectedLon) <= tolerance;
    return latOk && lonOk ? snapshot : null;
  }, { timeout: 12000, interval: 150 });
}

async function getParkingRowTarget(client, rowIndex) {
  return evaluate(client, `import('./static/app/shared/state.js?v=${MODULE_VERSION}').then(({ state }) => {
    const settings = state.parkingSettings || {};
    const category = String(settings.durationCategory || "10-60");
    let min = 10;
    let max = 59;
    if (category === "4-6") {
      min = 4;
      max = 6;
    } else if (category === "60+") {
      min = 60;
      max = Number.POSITIVE_INFINITY;
    } else if (category === "custom") {
      const rawMin = Math.max(0, Number(settings.customMin) || 0);
      const rawMax = Math.max(0, Number(settings.customMax) || 0);
      min = Math.min(rawMin, rawMax);
      max = Math.max(rawMin, rawMax);
    }
    const rows = Array.isArray(state.analysis?.stays)
      ? state.analysis.stays.filter((row) => {
          const duration = Number(row?.duration_min);
          return Number.isFinite(duration) && duration >= min && duration <= max;
        })
      : [];
    const row = rows[${rowIndex}] || null;
    if (!row) return null;
    return {
      lat: Number(row.lat),
      lon: Number(row.lon),
      arriveTime: String(row.arrive_time || ""),
      address: String(row.closest_address || row.area || "")
    };
  })`);
}

async function getOvernightRowTarget(client, rowIndex) {
  return evaluate(client, `Promise.all([
    import('./static/app/shared/state.js?v=${MODULE_VERSION}'),
    import('./static/app/analysis/selectors.js?v=${MODULE_VERSION}')
  ]).then(([{ state }, { getOvernightRowsByMode }]) => {
    const rows = getOvernightRowsByMode(state.analysis?.stays || [], state.overnightMode);
    const row = rows[${rowIndex}] || null;
    if (!row) return null;
    return {
      lat: Number(row.lat),
      lon: Number(row.lon),
      arriveTime: String(row.arrive_time || ""),
      address: String(row.closest_address || row.area || "")
    };
  })`);
}

async function uploadAndAnalyze(client, files) {
  await setFileInputFiles(client, "#file-input", files);
  await waitFor(client, "file input to receive files", async () => {
    const info = await evaluate(client, `(() => {
      const input = document.querySelector("#file-input");
      return {
        exists: Boolean(input),
        count: input?.files?.length || 0,
        names: Array.from(input?.files || []).map((file) => file.name)
      };
    })()`);
    return info?.count === files.length ? info : null;
  }, { timeout: 10000, interval: 200 });
  await evaluate(client, `(() => {
    const input = document.querySelector("#file-input");
    if (!input) return false;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await submitAnalyzeForm(client);
}

async function ensureView(client, key) {
  await click(client, `.menu-item[data-view="${key}"]`);
  await sleep(250);
}

async function assertLightMapNumbers(client) {
  const colorInfo = await waitFor(client, "light map point number color", async () => {
    const info = await evaluate(client, `(() => {
      const label = document.querySelector('.map-point-number-icon span');
      if (!label) return null;
      return {
        color: getComputedStyle(label).color,
        text: label.textContent.trim()
      };
    })()`);
    return info?.color ? info : null;
  }, { timeout: 12000, interval: 250 });
  assertCondition(
    colorInfo.color === "rgb(17, 17, 17)" || colorInfo.color === "rgb(0, 0, 0)",
    `Expected light mode map number to be black, got ${colorInfo.color}`
  );
}

async function testStartup(client) {
  await waitForPageReady(client);
  await evaluate(client, `(() => {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-first-open-notice-")) {
        localStorage.removeItem(key);
      }
    }
    document.cookie = "caridentify-theme=; max-age=0; path=/; SameSite=Lax";
    return true;
  })()`);
  await client.send("Page.reload", { ignoreCache: true });
  await sleep(500);
  await waitForPageReady(client);
  const noticeInfo = await waitFor(client, "daily notice content", async () => {
    const info = await evaluate(client, `(() => {
      const overlay = document.querySelector('.first-open-overlay');
      return {
        exists: Boolean(overlay),
        text: overlay?.textContent || "",
        telegramHref: overlay?.querySelector('.first-open-community-card')?.href || "",
        imageSrc: overlay?.querySelector('.first-open-community-image')?.src || ""
      };
    })()`);
    return info?.exists ? info : null;
  }, { timeout: 8000, interval: 150 });
  assertCondition(noticeInfo.text.includes("今日重點（2026-06-25）"), "Daily notice missing 2026-06-25 heading");
  assertCondition(noticeInfo.text.includes("新增淺色模式") && noticeInfo.text.includes("新增留言板"), "Daily notice missing 2026-06-25 bullets");
  assertCondition(noticeInfo.text.includes("任何問題歡迎於") && noticeInfo.telegramHref === "https://t.me/secbeater", `Unexpected notice Telegram link ${noticeInfo.telegramHref}`);
  assertCondition(noticeInfo.imageSrc === "https://cdn.rafled.com/anime-icons/images/6nuiK8b9XPLt.jpg", `Unexpected notice image ${noticeInfo.imageSrc}`);
  await closeFirstOpenOverlayIfPresent(client);
  const selectors = [
    "#overnight-map",
    "#hotspots-map",
    "#routine-map",
    "#routine-hour-grid",
    "#routine-filter-select-all",
    "#routine-filter-status",
    "#routine-filter-summary",
    "#table-routine",
    "#file-input",
    "#theme-toggle",
    "#view-comments",
    "#disqus_thread"
  ];
  for (const selector of selectors) {
    const exists = await evaluate(client, `Boolean(document.querySelector(${valueLiteral(selector)}))`);
    assertCondition(exists, `Missing selector ${selector}`);
  }
  const menuCount = await evaluate(client, `document.querySelectorAll('.menu-item').length`);
  assertCondition(menuCount === 8, `Expected 8 menu items, got ${menuCount}`);

  const initialTheme = await evaluate(client, `document.documentElement.dataset.theme`);
  assertCondition(initialTheme === "light", `Expected default light theme, got ${initialTheme}`);

  await click(client, "#theme-toggle");
  await sleep(300);
  const darkInfo = await evaluate(client, `(() => ({
      theme: document.documentElement.dataset.theme,
      cookie: document.cookie,
      label: document.querySelector("#theme-toggle-label")?.textContent || "",
      aria: document.querySelector("#theme-toggle")?.getAttribute("aria-label") || ""
  }))()`);
  assertCondition(darkInfo.theme === "dark", `Expected dark theme after toggle, got ${JSON.stringify(darkInfo)}`);
  assertCondition(String(darkInfo.cookie || "").includes("caridentify-theme=dark"), `Expected dark theme cookie, got ${JSON.stringify(darkInfo)}`);
  await reloadPage(client);
  const persistedTheme = await evaluate(client, `document.documentElement.dataset.theme`);
  assertCondition(persistedTheme === "dark", `Expected persisted dark theme, got ${persistedTheme}`);
  await click(client, "#theme-toggle");
  await sleep(300);
  const lightInfo = await evaluate(client, `(() => ({
      theme: document.documentElement.dataset.theme,
      cookie: document.cookie,
      label: document.querySelector("#theme-toggle-label")?.textContent || "",
      aria: document.querySelector("#theme-toggle")?.getAttribute("aria-label") || ""
  }))()`);
  assertCondition(lightInfo.theme === "light", `Expected light theme after toggle, got ${JSON.stringify(lightInfo)}`);
  assertCondition(String(lightInfo.cookie || "").includes("caridentify-theme=light"), `Expected light theme cookie, got ${JSON.stringify(lightInfo)}`);

  await ensureView(client, "comments");
  const commentsInfo = await waitFor(client, "comments view and Disqus script", async () => {
    const info = await evaluate(client, `(() => ({
      active: document.querySelector("#view-comments")?.classList.contains("active") || false,
      script: document.querySelector("#dsq-embed-scr")?.src || "",
      telegramHref: document.querySelector(".comments-community-link")?.href || ""
    }))()`);
    return info?.active && info.script.includes(".disqus.com/embed.js") ? info : null;
  }, { timeout: 8000, interval: 250 });
  assertCondition(commentsInfo.script.includes("secbeater.disqus.com/embed.js"), `Unexpected Disqus script ${commentsInfo.script}`);
  assertCondition(commentsInfo.telegramHref === "https://t.me/secbeater", `Unexpected comments Telegram link ${commentsInfo.telegramHref}`);
  await ensureView(client, "map");
}

async function testXlsxSingle(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [xlsxPath]);
  await assertStatusSuccess(client, "BTQ1234");
  await assertAnalysisState(client, { minRaw: 2, minClean: 2, minTrack: 2, coordinateSwappedFixed: true });
  await assertLightMapNumbers(client);

  await ensureView(client, "overnight");
  await assertRowCountAtLeast(client, "#table-overnight", 1);
  await waitForMapMode(client, "#overnight-map", "leaflet");

  await click(client, "#overnight-mode-day");
  await assertRowCountAtLeast(client, "#table-overnight", 1);
  await waitForMapMode(client, "#overnight-map", "leaflet");
  await assertNoActiveTableRows(client, "#table-overnight");

  await ensureView(client, "hotspots");
  await assertRowCountAtLeast(client, "#table-hotspots", 1);
  await waitForMapMode(client, "#hotspots-map", "leaflet");

  await ensureView(client, "parking");
  await assertRowCountAtLeast(client, "#table-parking", 1);
  await waitForMapMode(client, "#parking-map", "leaflet");

  await ensureView(client, "routine");
  await assertSummaryContains(client, "全天");
  await assertRowCountAtLeast(client, "#table-routine", 1);
  await waitForMapMode(client, "#routine-map", "leaflet");

  await click(client, "#routine-filter-select-all");
  await click(client, "#routine-filter-apply");
  await assertSummaryContains(client, "全天");
}

async function testCsvSingle(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [csvPath]);
  await assertStatusSuccess(client, "BQM1362");
  await assertAnalysisState(client, { minRaw: 2, minClean: 2, minTrack: 2, cleaningSkipped: true });

  await ensureView(client, "overnight");
  await assertCountText(client, "#overnight-count", "筆數：2");
  await waitForMapMode(client, "#overnight-map", "leaflet");
  await click(client, "#overnight-mode-day");
  await assertCountText(client, "#overnight-count", "筆數：2");
  await waitForMapMode(client, "#overnight-map", "leaflet");

  await ensureView(client, "hotspots");
  await assertRowCount(client, "#table-hotspots", 2);
  await waitForMapMode(client, "#hotspots-map", "leaflet");
}

async function testMergedUpload(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [xlsxPath, csvPath]);
  await assertStatusSuccess(client, "BTQ1234");
  await assertAnalysisState(client, { minRaw: 2, minClean: 2, minTrack: 2, coordinateSwappedFixed: true, cleaningSkipped: true });

  await ensureView(client, "overnight");
  await assertRowCountAtLeast(client, "#table-overnight", 1);
  await waitForMapMode(client, "#overnight-map", "leaflet");
  await click(client, "#overnight-mode-day");
  await assertRowCountAtLeast(client, "#table-overnight", 1);

  await ensureView(client, "hotspots");
  await assertRowCountAtLeast(client, "#table-hotspots", 1);
  await waitForMapMode(client, "#hotspots-map", "leaflet");
}

async function testIdkcitySingle(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [idkcityPath]);
  await assertStatusSuccess(client, "ABC1234");
  await assertAnalysisState(client, { minRaw: 2, minClean: 2, minTrack: 2 });

  await ensureView(client, "parking");
  await assertRowCountAtLeast(client, "#table-parking", 1);
  await waitForMapMode(client, "#parking-map", "leaflet");

  await ensureView(client, "hotspots");
  await assertRowCountAtLeast(client, "#table-hotspots", 1);
  await waitForMapMode(client, "#hotspots-map", "leaflet");

  await ensureView(client, "routine");
  await assertSummaryContains(client, "全天");
  await assertRowCountAtLeast(client, "#table-routine", 1);
  await waitForMapMode(client, "#routine-map", "leaflet");
}

async function testCombinedCoordinateSensitive(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [combinedCoordPath]);
  await assertSensitiveAnalysisSuccess(client);
  await assertAnalysisState(client, { minRaw: 2, minClean: 2, minTrack: 2, cleaningSkipped: false });
}

async function main() {
  const results = [];
  const pageWsUrl = await getPageWebSocketUrl();
  const client = new CdpClient(pageWsUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("DOM.enable");
  await navigateToBaseUrl(client);

  const tests = [
    ["startup-dom", testStartup],
    ["xlsx-single", testXlsxSingle],
    ["csv-single", testCsvSingle],
    ["merged-upload", testMergedUpload],
    ["idkcity-single", testIdkcitySingle],
    ["combined-coordinate-sensitive", testCombinedCoordinateSensitive]
  ];
  const availableTests = combinedCoordPath
    ? tests
    : tests.filter(([name]) => name !== "combined-coordinate-sensitive");
  const selectedTests = requestedCase
    ? availableTests.filter(([name]) => name === requestedCase)
    : availableTests;

  if (requestedCase && selectedTests.length === 0) {
    throw new Error(`Unknown test case: ${requestedCase}`);
  }

  try {
    for (const [name, fn] of selectedTests) {
      try {
        await fn(client);
        results.push({ name, ok: true });
        console.log(`PASS ${name}`);
      } catch (error) {
        const status = await queryStatus(client).catch(() => ({ text: "<unavailable>", className: "<unavailable>" }));
        const isSensitiveCase = name.includes("sensitive");
        const safeError = isSensitiveCase ? "Sensitive test failed; details redacted" : error.message;
        const safeStatus = isSensitiveCase ? { text: "<redacted>", className: status.className } : status;
        results.push({ name, ok: false, error: safeError, status: safeStatus });
        console.log(`FAIL ${name} | ${safeError} | status=${JSON.stringify(safeStatus)}`);
      }
    }
  } finally {
    await client.close();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`SUMMARY ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`FATAL ${error.stack || error.message}`);
  process.exit(1);
});


