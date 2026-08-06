import { MAP_DEFAULT_VIEW } from "./constants.js?v=20260806a";

export function createBaseMap(host, options = {}) {
  if (!host || typeof L === "undefined") return null;
  const map = L.map(host, { preferCanvas: true }).setView(
    [options.lat ?? MAP_DEFAULT_VIEW.lat, options.lon ?? MAP_DEFAULT_VIEW.lon],
    options.zoom ?? MAP_DEFAULT_VIEW.zoom
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  return map;
}

export function fitMapToLatLngs(map, latLngs, fallback = MAP_DEFAULT_VIEW) {
  if (!map) return;
  if (Array.isArray(latLngs) && latLngs.length) {
    map.fitBounds(L.latLngBounds(latLngs), { padding: [36, 36], maxZoom: 17 });
  } else {
    map.setView([fallback.lat, fallback.lon], fallback.zoom);
  }
}

export function renderEmptyMapHost(host, message = "目前沒有可顯示的地圖資料") {
  if (!host) return;
  host.innerHTML = `<div class="empty-map">${message}</div>`;
}

export function ensureMapHost(host) {
  if (!host) return;
  if (host.querySelector(".empty-map")) {
    host.innerHTML = "";
  }
}


