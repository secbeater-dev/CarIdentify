import { OVERNIGHT_MODE_DAY, OVERNIGHT_MODE_NIGHT } from "../shared/constants.js?v=20260729d";
import { buildHourlyCountsFromTrack, filterTrackByTimeRange, getRoutineFilterSummary } from "./timeFilters.js?v=20260729d";

export function getOvernightRowsByMode(stays, mode) {
  const source = Array.isArray(stays) ? stays : [];
  if (mode === OVERNIGHT_MODE_DAY) {
    return source.filter((item) => Number(item.duration_min) >= 360 && Number(item.day_overlap_h) >= 1);
  }
  return source.filter((item) => Number(item.duration_min) >= 360 && Number(item.night_overlap_h) >= 1);
}

export function getHotspotRows(hotspots) {
  return Array.isArray(hotspots) ? hotspots.slice() : [];
}

export function buildRoutineViewModel(result, filter) {
  const track = Array.isArray(result?.map?.track) ? result.map.track : [];
  const filteredTrack = filterTrackByTimeRange(track, filter);
  return {
    filteredTrack,
    hourlyCounts: buildHourlyCountsFromTrack(filteredTrack),
    summary: getRoutineFilterSummary(track, filter)
  };
}

export { OVERNIGHT_MODE_NIGHT, OVERNIGHT_MODE_DAY };



