import { DEFAULT_ROUTINE_FILTER, ROUTINE_HOUR_OPTIONS } from "../shared/constants.js?v=20260827b";
import { pad2, parseRocDateTime } from "../shared/utils.js?v=20260827b";

function sanitizeSelectedHours(hours) {
  const source = Array.isArray(hours) ? hours : DEFAULT_ROUTINE_FILTER.selectedHours;
  return Array.from(
    new Set(
      source
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23)
    )
  ).sort((a, b) => a - b);
}

function findHourRuns(selectedHours) {
  const hours = sanitizeSelectedHours(selectedHours);
  const runs = [];
  let start = null;
  let previous = null;

  for (const hour of hours) {
    if (start === null) {
      start = hour;
      previous = hour;
      continue;
    }
    if (hour === previous + 1) {
      previous = hour;
      continue;
    }
    runs.push([start, previous]);
    start = hour;
    previous = hour;
  }

  if (start !== null) {
    runs.push([start, previous]);
  }
  return runs;
}

export function normalizeRoutineFilter(input = {}) {
  return {
    selectedHours: sanitizeSelectedHours(input.selectedHours)
  };
}

export function areRoutineFiltersEqual(a, b) {
  const left = normalizeRoutineFilter(a).selectedHours;
  const right = normalizeRoutineFilter(b).selectedHours;
  if (left.length !== right.length) return false;
  return left.every((hour, index) => hour === right[index]);
}

export function formatRoutineSelectedHours(selectedHours) {
  const hours = sanitizeSelectedHours(selectedHours);
  if (!hours.length) return "未選時段";
  if (hours.length === ROUTINE_HOUR_OPTIONS.length) return "全天";

  return findHourRuns(hours)
    .map(([start, end]) => (start === end ? pad2(start) : `${pad2(start)}-${pad2(end)}`))
    .join("、");
}

export function getRoutineFilterLabel(filter) {
  const normalized = normalizeRoutineFilter(filter);
  const count = normalized.selectedHours.length;
  return `${formatRoutineSelectedHours(normalized.selectedHours)}（${count}/24）`;
}

export function filterTrackByTimeRange(track, filter) {
  const source = Array.isArray(track) ? track : [];
  const normalized = normalizeRoutineFilter(filter);
  if (!normalized.selectedHours.length) return [];
  if (normalized.selectedHours.length === ROUTINE_HOUR_OPTIONS.length) {
    return source.slice();
  }

  const allowed = new Set(normalized.selectedHours);
  return source.filter((point) => {
    const dt = Number.isFinite(point?.timestamp_ms) ? new Date(point.timestamp_ms) : parseRocDateTime(point?.time);
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return false;
    return allowed.has(dt.getHours());
  });
}

export function buildHourlyCountsFromTrack(track) {
  const counts = Array(24).fill(0);
  for (const point of Array.isArray(track) ? track : []) {
    const dt = Number.isFinite(point?.timestamp_ms) ? new Date(point.timestamp_ms) : parseRocDateTime(point?.time);
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) continue;
    counts[dt.getHours()] += 1;
  }
  return counts;
}

export function getRoutineFilterSummary(track, filter) {
  const normalized = normalizeRoutineFilter(filter);
  const filtered = filterTrackByTimeRange(track, normalized);
  return `目前顯示：${getRoutineFilterLabel(normalized)}｜命中 ${filtered.length} 筆`;
}


