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
const irentPath = args.irent ? path.resolve(String(args.irent)) : "";
const routineFilterPath = args["routine-filter"] ? path.resolve(String(args["routine-filter"])) : "";
const timeoutMs = Number(args.timeout || 30000);
const requestedCase = args.case ? String(args.case) : "";
const MODULE_VERSION = "20260729c";

const requiredFilesByCase = {
  "xlsx-single": [xlsxPath],
  "csv-single": [csvPath],
  "merged-upload": [xlsxPath, csvPath],
  "idkcity-single": [idkcityPath],
  "combined-coordinate-sensitive": [combinedCoordPath],
  "irent-single": [irentPath],
  "routine-filter-table": [routineFilterPath]
};
const requiredFiles = requestedCase
  ? requiredFilesByCase[requestedCase] || []
  : [xlsxPath, csvPath, idkcityPath].concat(
      combinedCoordPath ? [combinedCoordPath] : [],
      irentPath ? [irentPath] : [],
      routineFilterPath ? [routineFilterPath] : []
    );

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

function parseCssColor(value) {
  const text = String(value || "").trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => `${char}${char}`).join("")
      : hex[1];
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16)
    };
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (!rgb) return null;
  const parts = rgb[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function assertMonochromeColor(value, label) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    const color = parseCssColor(item);
    assertCondition(Boolean(color), `${label} is not a parseable CSS color: ${JSON.stringify(item)}`);
    assertCondition(color.r === color.g && color.g === color.b, `${label} is not monochrome: ${JSON.stringify(item)}`);
  }
}

function assertMonochromeCssTokens(value, label) {
  const tokens = String(value || "").match(/#[0-9a-f]{3,6}|rgba?\([^)]+\)/gi) || [];
  assertCondition(tokens.length > 0, `${label} has no CSS color tokens: ${JSON.stringify(value)}`);
  assertMonochromeColor(tokens, label);
}

function assertCssColorEquals(actual, expected, label) {
  const actualColor = parseCssColor(actual);
  const expectedColor = parseCssColor(expected);
  assertCondition(Boolean(actualColor && expectedColor), `${label} is not parseable: ${JSON.stringify({ actual, expected })}`);
  assertCondition(
    actualColor.r === expectedColor.r && actualColor.g === expectedColor.g && actualColor.b === expectedColor.b,
    `${label} mismatch: ${JSON.stringify({ actual, expected })}`
  );
}

function formatExpectedRoutinePercent(value) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 10) return `${Math.round(value)}%`;
  return `${value.toFixed(1)}%`;
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

async function assertReadableRoutineChart(client, expectedTheme) {
  const snapshot = await waitFor(client, `readable routine chart ${expectedTheme}`, async () => {
    const info = await evaluate(client, `import('./static/app/shared/state.js?v=${MODULE_VERSION}').then(({ state }) => {
      const chartRoot = document.querySelector("#routine-hour-chart");
      const title = document.querySelector(".routine-chart-title");
      const wrap = document.querySelector(".chart-wrap");
      const summary = document.querySelector("#routine-filter-summary");
      const status = document.querySelector("#routine-filter-status");
      const selectedChip = document.querySelector(".routine-hour-chip.is-selected");
      const applyButton = document.querySelector("#routine-filter-apply");
      const table = document.querySelector("#table-routine");
      const tableHeader = table?.querySelector("th");
      const mapTile = document.querySelector("#routine-map .leaflet-tile");
      const mapMarker = state.routineLayers?.points?.getLayers?.()[0] || null;
      if (!chartRoot) return null;
      const titleStyle = title ? getComputedStyle(title) : null;
      const wrapStyle = wrap ? getComputedStyle(wrap) : null;
      const summaryStyle = summary ? getComputedStyle(summary) : null;
      const statusStyle = status ? getComputedStyle(status) : null;
      const selectedChipStyle = selectedChip ? getComputedStyle(selectedChip) : null;
      const applyButtonStyle = applyButton ? getComputedStyle(applyButton) : null;
      const tableHeaderStyle = tableHeader ? getComputedStyle(tableHeader) : null;
      const mapTileStyle = mapTile ? getComputedStyle(mapTile) : null;
      const tiles = Array.from(document.querySelectorAll("#routine-hour-grid .routine-hour-chip"));
      const columns = Array.from(chartRoot.querySelectorAll(".hour-column"));
      const chartRootStyle = getComputedStyle(chartRoot);
      return {
        theme: document.documentElement.dataset.theme,
        chartClassName: chartRoot.className || "",
        chartDisplay: chartRootStyle.display || "",
        chartColumns: chartRootStyle.gridTemplateColumns || "",
        chartColumnCount: columns.length,
        hasCanvas: Boolean(chartRoot.querySelector("canvas")),
        tiles: tiles.map((tile) => ({
          hour: Number(tile.dataset.hour),
          text: tile.textContent.trim(),
          className: tile.className,
          ariaPressed: tile.getAttribute("aria-pressed"),
          color: getComputedStyle(tile).color,
          backgroundColor: getComputedStyle(tile).backgroundColor,
          borderColor: getComputedStyle(tile).borderTopColor,
          boxShadow: getComputedStyle(tile).boxShadow
        })),
        columns: columns.map((column) => {
          const frame = column.querySelector(".hour-bar-frame");
          const fill = column.querySelector(".hour-bar-fill");
          const percent = column.querySelector(".hour-bar-percent");
          const count = column.querySelector(".hour-bar-count");
          const label = column.querySelector(".hour-label-full");
          const frameStyle = frame ? getComputedStyle(frame) : null;
          const fillStyle = fill ? getComputedStyle(fill) : null;
          const percentStyle = percent ? getComputedStyle(percent) : null;
          const labelStyle = label ? getComputedStyle(label) : null;
          return {
            hour: Number(column.dataset.hour),
            label: label?.textContent?.trim() || "",
            count: count?.textContent?.trim() || "",
            percent: percent?.textContent?.trim() || "",
            barHeight: column.style.getPropertyValue("--bar-height") || "",
            frameHeight: frameStyle?.height || "",
            frameBackground: frameStyle?.backgroundColor || "",
            frameBorderColor: frameStyle?.borderTopColor || "",
            fillHeight: fill?.style?.height || "",
            fillBackground: fillStyle?.backgroundColor || "",
            percentColor: percentStyle?.color || "",
            percentBackground: percentStyle?.backgroundColor || "",
            labelColor: labelStyle?.color || ""
          };
        }),
        titleColor: titleStyle?.color || "",
        wrapBorderColor: wrapStyle?.borderTopColor || "",
        summaryColor: summaryStyle?.color || "",
        summaryBg: summaryStyle?.backgroundColor || "",
        summaryBorderColor: summaryStyle?.borderTopColor || "",
        statusColor: statusStyle?.color || "",
        statusBg: statusStyle?.backgroundColor || "",
        statusBorderColor: statusStyle?.borderTopColor || "",
        selectedChipColor: selectedChipStyle?.color || "",
        selectedChipBorderColor: selectedChipStyle?.borderTopColor || "",
        selectedChipBgImage: selectedChipStyle?.backgroundImage || "",
        applyButtonColor: applyButtonStyle?.color || "",
        applyButtonBorderColor: applyButtonStyle?.borderTopColor || "",
        applyButtonBgImage: applyButtonStyle?.backgroundImage || "",
        tableHeaderColor: tableHeaderStyle?.color || "",
        tableHeaderBg: tableHeaderStyle?.backgroundColor || "",
        mapTileFilter: mapTileStyle?.filter || "",
        mapMarkerStroke: mapMarker?.options?.color || "",
        mapMarkerFill: mapMarker?.options?.fillColor || "",
        expectedPointColor: state.mapSettings?.pointColor || "",
        hourlyCounts: Array.isArray(state.routineFilteredTrack) ? state.routineFilteredTrack.reduce((counts, point) => {
          const match = String(point.time || "").match(/\\b(\\d{1,2}):(\\d{2})(?::\\d{2})?\\b/);
          const hour = match ? Number(match[1]) : NaN;
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) counts[hour] += 1;
          return counts;
        }, Array.from({ length: 24 }, () => 0)) : [],
        wrapHeight: wrap ? Number.parseFloat(wrapStyle.height) : 0
      };
    })`);
    return info?.theme === expectedTheme ? info : null;
  }, { timeout: 10000, interval: 200 });

  const expectLight = expectedTheme === "light";
  const expectedTileLabels = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
  const expectedColumnLabels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}-${String(hour + 1).padStart(2, "0")}`);
  const counts = Array.isArray(snapshot.hourlyCounts) && snapshot.hourlyCounts.length === 24
    ? snapshot.hourlyCounts.map((value) => Number(value) || 0)
    : Array.from({ length: 24 }, () => 0);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((sum, count) => sum + count, 0);

  assertCondition(snapshot.wrapHeight >= 300, `Routine chart container too short ${JSON.stringify(snapshot)}`);
  assertCondition(snapshot.hasCanvas === false, `Phone-style routine chart should render HTML, not canvas ${JSON.stringify(snapshot)}`);
  assertIncludes(snapshot.chartClassName, "hour-chart", `Routine chart should use phone hour-chart class`);
  assertIncludes(snapshot.chartClassName, "hour-chart-vertical", `Routine chart should use phone hour-chart-vertical class`);
  assertCondition(snapshot.chartDisplay === "grid", `Routine chart should use CSS grid ${JSON.stringify(snapshot)}`);
  assertCondition(snapshot.chartColumnCount === 24, `Routine chart should render 24 columns ${JSON.stringify(snapshot)}`);
  assertCondition(snapshot.tiles.length === 24, `Routine hour selector should render 24 phone-style tiles ${JSON.stringify(snapshot)}`);
  assertCondition(JSON.stringify(snapshot.tiles.map((tile) => tile.text)) === JSON.stringify(expectedTileLabels), `Routine hour tile labels mismatch ${JSON.stringify(snapshot)}`);
  assertCondition(JSON.stringify(snapshot.columns.map((column) => column.label)) === JSON.stringify(expectedColumnLabels), `Routine chart labels mismatch ${JSON.stringify(snapshot)}`);

  for (const tile of snapshot.tiles) {
    assertIncludes(tile.className, "hour-tile", `Routine hour tile should include phone hour-tile class`);
    assertIncludes(tile.className, tile.hour < 6 || tile.hour >= 18 ? "night-hour" : "day-hour", `Routine hour tile tone mismatch`);
    if (tile.ariaPressed === "true") {
      assertIncludes(tile.className, "active", `Selected routine hour tile should use active class`);
    } else {
      assertIncludes(tile.className, "inactive", `Unselected routine hour tile should use inactive class`);
    }
  }

  for (const column of snapshot.columns) {
    const count = counts[column.hour] || 0;
    const percent = total ? (count / total) * 100 : 0;
    const height = count ? (count / max) * 100 : 0;
    assertCondition(column.count === String(count), `Routine chart count mismatch ${JSON.stringify({ column, counts, snapshot })}`);
    assertCondition(column.percent === formatExpectedRoutinePercent(percent), `Routine chart percent mismatch ${JSON.stringify({ column, counts, snapshot })}`);
    assertCondition(column.fillHeight === `${height}%`, `Routine chart fill height mismatch ${JSON.stringify({ column, counts, snapshot })}`);
    assertCondition(column.barHeight === `${height}%`, `Routine chart CSS height variable mismatch ${JSON.stringify({ column, counts, snapshot })}`);
  }

  assertCssColorEquals(snapshot.columns[0]?.fillBackground || "", expectLight ? "#111111" : "#f5f5f4", "Routine phone-style bar fill");
  assertCondition(String(snapshot.selectedChipBgImage).includes("none") || snapshot.selectedChipBgImage === "", `Phone-style selected tile should not use gradient ${JSON.stringify(snapshot)}`);
  assertCondition(!String(snapshot.mapTileFilter).includes("grayscale"), `Routine map tiles should stay colorful ${JSON.stringify(snapshot)}`);
  assertCssColorEquals(snapshot.mapMarkerStroke, snapshot.expectedPointColor, "Routine marker stroke should use map point color");
  assertCssColorEquals(snapshot.mapMarkerFill, snapshot.expectedPointColor, "Routine marker fill should use map point color");
  return snapshot;
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

async function assertRoutineTableOnlyContainsHours(client, expectedHours, expectedCount) {
  const allowed = expectedHours.map((hour) => Number(hour));
  return waitFor(client, `routine table filtered to ${allowed.join(",")}`, async () => {
    const snapshot = await evaluate(client, `(() => {
      const rows = Array.from(document.querySelectorAll("#table-routine tbody tr"));
      const hours = rows.map((row) => {
        const text = row.querySelector("td")?.textContent?.trim() || "";
        const match = text.match(/\\b(\\d{1,2}):(\\d{2})(?::\\d{2})?\\b/);
        return match ? Number(match[1]) : NaN;
      });
      return {
        count: rows.length,
        hours,
        allAllowed: hours.length > 0 && hours.every((hour) => ${JSON.stringify(allowed)}.includes(hour))
      };
    })()`);
    if (snapshot?.count === expectedCount && snapshot.allAllowed) {
      return snapshot;
    }
    return null;
  }, { timeout: 12000, interval: 200 });
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
        inlineTelegramText: overlay?.querySelector('.first-open-copy a[href="https://t.me/secbeater"]')?.textContent?.trim() || "",
        imageSrc: overlay?.querySelector('.first-open-community-image')?.src || "",
        imageLabel: overlay?.querySelector('.first-open-community-card span')?.textContent?.trim() || "",
        titleColor: overlay ? getComputedStyle(overlay.querySelector('.first-open-modal h3')).color : "",
        cardTransform: overlay ? getComputedStyle(overlay.querySelector('.first-open-community-card')).transform : ""
      };
    })()`);
    return info?.exists ? info : null;
  }, { timeout: 8000, interval: 150 });
  assertCondition(noticeInfo.text.includes("今日重點（2026-06-25）"), "Daily notice missing 2026-06-25 heading");
  assertCondition(noticeInfo.text.includes("新增淺色模式") && noticeInfo.text.includes("新增留言板"), "Daily notice missing 2026-06-25 bullets");
  assertCondition(noticeInfo.text.includes("任何問題歡迎於") && noticeInfo.inlineTelegramText === "Telegram" && noticeInfo.telegramHref === "https://t.me/secbeater", `Unexpected notice Telegram link/text ${JSON.stringify(noticeInfo)}`);
  assertCondition(noticeInfo.imageSrc === "https://cdn.rafled.com/anime-icons/images/6nuiK8b9XPLt.jpg", `Unexpected notice image ${noticeInfo.imageSrc}`);
  assertCondition(noticeInfo.imageLabel.includes("Gemini Pro") && noticeInfo.imageLabel.includes("NT$1,500") && noticeInfo.imageLabel.includes("NT$8,280"), `Unexpected notice image label ${noticeInfo.imageLabel}`);
  assertCondition(noticeInfo.titleColor === "rgb(255, 216, 91)", `Unexpected notice title color ${noticeInfo.titleColor}`);
  assertCondition(noticeInfo.cardTransform && noticeInfo.cardTransform !== "none", `Expected desktop notice card to be shifted up, got ${noticeInfo.cardTransform}`);
  await click(client, "[data-action='support-types']");
  const wrongSupportInfo = await evaluate(client, `(() => {
    const input = document.querySelector(".first-open-support-password");
    input.value = "wrong-password";
    document.querySelector("[data-action='unlock-support']")?.click();
    return {
      panelHidden: document.querySelector(".first-open-support-panel")?.hidden ?? true,
      listHidden: document.querySelector(".first-open-support-list")?.hidden ?? true,
      status: document.querySelector(".first-open-support-status")?.textContent?.trim() || "",
      statusClass: document.querySelector(".first-open-support-status")?.className || ""
    };
  })()`);
  assertCondition(wrongSupportInfo.panelHidden === false, `Support panel should be visible ${JSON.stringify(wrongSupportInfo)}`);
  assertCondition(wrongSupportInfo.listHidden === true, `Support list should stay hidden on wrong password ${JSON.stringify(wrongSupportInfo)}`);
  assertCondition(wrongSupportInfo.status.includes("密碼錯誤") && wrongSupportInfo.statusClass.includes("is-error"), `Wrong password status mismatch ${JSON.stringify(wrongSupportInfo)}`);
  const unlockedSupportInfo = await evaluate(client, `(() => {
    const input = document.querySelector(".first-open-support-password");
    input.value = "@EClLl*j2hLylZ2I@k3&";
    document.querySelector("[data-action='unlock-support']")?.click();
    return {
      listHidden: document.querySelector(".first-open-support-list")?.hidden ?? true,
      text: document.querySelector(".first-open-support-list")?.textContent || "",
      status: document.querySelector(".first-open-support-status")?.textContent?.trim() || "",
      statusClass: document.querySelector(".first-open-support-status")?.className || ""
    };
  })()`);
  assertCondition(unlockedSupportInfo.listHidden === false, `Support list should be visible ${JSON.stringify(unlockedSupportInfo)}`);
  assertCondition(
    unlockedSupportInfo.text.includes("警政署智慧分析-車牌辨識系統") &&
      unlockedSupportInfo.text.includes("警政署智慧分析-高速公路ETC紀錄") &&
      unlockedSupportInfo.text.includes("irent資料") &&
      unlockedSupportInfo.text.includes("需要支援其他類型"),
    `Support list text mismatch ${JSON.stringify(unlockedSupportInfo)}`
  );
  assertCondition(unlockedSupportInfo.statusClass.includes("is-success"), `Support success status mismatch ${JSON.stringify(unlockedSupportInfo)}`);
  await closeFirstOpenOverlayIfPresent(client);
  await client.send("Page.reload", { ignoreCache: true });
  await sleep(500);
  await waitForPageReady(client);
  const noticeAfterReload = await waitFor(client, "daily notice after reload", async () => {
    const exists = await evaluate(client, `Boolean(document.querySelector('.first-open-overlay'))`);
    return exists ? true : null;
  }, { timeout: 8000, interval: 150 });
  assertCondition(Boolean(noticeAfterReload), "Expected first-open notice to show after every reload");
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
  const lightSidebarInfo = await evaluate(client, `(() => {
    const weightValue = (selector) => Number.parseInt(getComputedStyle(document.querySelector(selector)).fontWeight, 10);
    return {
      sidebarBg: getComputedStyle(document.querySelector(".sidebar")).backgroundImage,
      sidebarColor: getComputedStyle(document.querySelector(".sidebar")).color,
      brandWeight: weightValue(".brand h1 a"),
      menuWeight: weightValue(".menu-label"),
      actionWeight: weightValue("#theme-toggle-label"),
      musicWeight: weightValue(".music-header-label"),
      menuColor: getComputedStyle(document.querySelector(".menu-item")).color,
      musicTitle: document.querySelector(".music-title")?.textContent?.trim() || "",
      musicHeader: document.querySelector(".music-header-label")?.textContent?.trim() || "",
      musicHref: document.querySelector(".music-link")?.href || "",
      youtubeSrc: document.querySelector("#sidebar-youtube")?.src || ""
    };
  })()`);
  assertCondition(lightSidebarInfo.sidebarBg.includes("255, 255, 255") || lightSidebarInfo.sidebarBg.includes("238, 245, 240"), `Expected light sidebar background, got ${lightSidebarInfo.sidebarBg}`);
  assertCondition(lightSidebarInfo.sidebarColor === "rgb(23, 32, 25)", `Expected dark text in light sidebar, got ${lightSidebarInfo.sidebarColor}`);
  assertCondition(lightSidebarInfo.brandWeight >= 700 && lightSidebarInfo.menuWeight >= 700 && lightSidebarInfo.actionWeight >= 700 && lightSidebarInfo.musicWeight >= 700, `Expected bold sidebar text, got ${JSON.stringify(lightSidebarInfo)}`);
  assertCondition(lightSidebarInfo.musicHeader === "經典推薦" && lightSidebarInfo.musicTitle === "YouTube 經典推薦", `Unexpected music labels ${JSON.stringify(lightSidebarInfo)}`);
  assertCondition(lightSidebarInfo.musicHref === "https://www.youtube.com/watch?v=DsLqD3MINT8" && lightSidebarInfo.youtubeSrc.includes("/embed/DsLqD3MINT8"), `Unexpected YouTube config ${JSON.stringify(lightSidebarInfo)}`);

  await click(client, "#theme-toggle");
  await sleep(300);
  const darkInfo = await evaluate(client, `(() => ({
      theme: document.documentElement.dataset.theme,
      cookie: document.cookie,
      label: document.querySelector("#theme-toggle-label")?.textContent || "",
      aria: document.querySelector("#theme-toggle")?.getAttribute("aria-label") || "",
      sidebarBg: getComputedStyle(document.querySelector(".sidebar")).backgroundImage,
      sidebarColor: getComputedStyle(document.querySelector(".sidebar")).color
  }))()`);
  assertCondition(darkInfo.theme === "dark", `Expected dark theme after toggle, got ${JSON.stringify(darkInfo)}`);
  assertCondition(String(darkInfo.cookie || "").includes("caridentify-theme=dark"), `Expected dark theme cookie, got ${JSON.stringify(darkInfo)}`);
  assertCondition(darkInfo.sidebarBg.includes("20, 20, 20") || darkInfo.sidebarBg.includes("13, 13, 13"), `Expected dark sidebar background, got ${JSON.stringify(darkInfo)}`);
  assertCondition(darkInfo.sidebarColor === "rgb(242, 242, 242)", `Expected light text in dark sidebar, got ${JSON.stringify(darkInfo)}`);
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
      telegramHref: document.querySelector(".comments-community-link")?.href || "",
      disqusPage: (() => {
        if (typeof window.disqus_config !== "function") return null;
        const ctx = { page: {} };
        window.disqus_config.call(ctx);
        return ctx.page;
      })()
    }))()`);
    return info?.active && info.script.includes(".disqus.com/embed.js") ? info : null;
  }, { timeout: 8000, interval: 250 });
  assertCondition(commentsInfo.script.includes("secbeatercom.disqus.com/embed.js"), `Unexpected Disqus script ${commentsInfo.script}`);
  assertCondition(commentsInfo.telegramHref === "https://t.me/secbeater", `Unexpected comments Telegram link ${commentsInfo.telegramHref}`);
  assertCondition(commentsInfo.disqusPage?.url === "https://car.secbeater.com/?view=comments", `Unexpected Disqus page URL ${JSON.stringify(commentsInfo.disqusPage)}`);
  assertCondition(commentsInfo.disqusPage?.identifier === "caridentify-comments", `Unexpected Disqus identifier ${JSON.stringify(commentsInfo.disqusPage)}`);
  await ensureView(client, "ai");
  const aiCardInfo = await evaluate(client, `(() => {
    const card = document.querySelector(".ai-service-card");
    return {
      text: card?.textContent || "",
      hrefs: Array.from(card?.querySelectorAll("a") || []).map((link) => link.href)
    };
  })()`);
  assertCondition(!aiCardInfo.text.includes("SecBeater 群組") && !aiCardInfo.text.includes("歡迎聯繫"), `AI service card still contains group copy: ${JSON.stringify(aiCardInfo)}`);
  assertCondition(!aiCardInfo.hrefs.some((href) => href.includes("line.me/ti/g2")), `AI service card still contains LINE link: ${JSON.stringify(aiCardInfo)}`);
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
  await assertReadableRoutineChart(client, "light");

  await click(client, "#theme-toggle");
  await sleep(300);
  await assertReadableRoutineChart(client, "dark");
  await click(client, "#theme-toggle");
  await sleep(300);
  await assertReadableRoutineChart(client, "light");

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

async function testIrentSingle(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [irentPath]);
  await assertStatusSuccess(client, "RFX5112");
  await assertAnalysisState(client, { minRaw: 1000, minClean: 1000, minTrack: 1000, coordinateSwappedFixed: true });

  const snapshot = await evaluate(client, `import('./static/app/shared/state.js?v=${MODULE_VERSION}').then(({ state }) => {
    const track = Array.isArray(state.analysis?.map?.track) ? state.analysis.map.track : [];
    const lat = track.map((row) => Number(row.lat)).filter(Number.isFinite);
    const lon = track.map((row) => Number(row.lon)).filter(Number.isFinite);
    return {
      trackLength: track.length,
      latMin: Math.min(...lat),
      latMax: Math.max(...lat),
      lonMin: Math.min(...lon),
      lonMax: Math.max(...lon),
      first: track[0] || null
    };
  })`);
  assertCondition(snapshot.trackLength >= 1000, `Expected iRent track >= 1000, got ${JSON.stringify(snapshot)}`);
  assertCondition(snapshot.latMin >= 20 && snapshot.latMax <= 30, `iRent latitude should be in Taiwan range ${JSON.stringify(snapshot)}`);
  assertCondition(snapshot.lonMin >= 110 && snapshot.lonMax <= 130, `iRent longitude should be in Taiwan range ${JSON.stringify(snapshot)}`);
  assertCondition(Math.abs(Number(snapshot.first?.lat) - 25.18671) < 0.00001, `Unexpected first iRent latitude ${JSON.stringify(snapshot.first)}`);
  assertCondition(Math.abs(Number(snapshot.first?.lon) - 121.42366) < 0.00001, `Unexpected first iRent longitude ${JSON.stringify(snapshot.first)}`);
}

async function testRoutineFilterTable(client) {
  await waitForPageReady(client);
  await closeFirstOpenOverlayIfPresent(client);
  await uploadAndAnalyze(client, [routineFilterPath]);
  await assertStatusSuccess(client, "RTN1234");

  await ensureView(client, "routine");
  await assertSummaryContains(client, "全天");
  await assertRowCount(client, "#table-routine", 4);
  await waitForMapMode(client, "#routine-map", "leaflet");
  await assertReadableRoutineChart(client, "light");

  await selectRoutineHours(client, [4]);
  await click(client, "#routine-filter-apply");
  await assertSummaryContains(client, "04");
  await assertSummaryContains(client, "命中 2 筆");
  await assertRowCount(client, "#table-routine", 2);
  await assertRoutineTableOnlyContainsHours(client, [4], 2);
}

async function main() {
  const results = [];
  const pageWsUrl = await getPageWebSocketUrl();
  const client = new CdpClient(pageWsUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("DOM.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await navigateToBaseUrl(client);

  const tests = [
    ["startup-dom", testStartup],
    ["xlsx-single", testXlsxSingle],
    ["csv-single", testCsvSingle],
    ["merged-upload", testMergedUpload],
    ["idkcity-single", testIdkcitySingle],
    ["combined-coordinate-sensitive", testCombinedCoordinateSensitive],
    ["irent-single", testIrentSingle],
    ["routine-filter-table", testRoutineFilterTable]
  ];
  const availableTests = tests.filter(([name]) => {
    if (name === "combined-coordinate-sensitive") return Boolean(combinedCoordPath);
    if (name === "irent-single") return Boolean(irentPath);
    if (name === "routine-filter-table") return Boolean(routineFilterPath);
    return true;
  });
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


