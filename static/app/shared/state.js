import {
  DEFAULT_MAP_SETTINGS,
  DEFAULT_PARKING_SETTINGS,
  DEFAULT_ROUTINE_FILTER,
  OVERNIGHT_MODE_NIGHT
} from "./constants.js?v=20260408e";

export const state = {
  analysis: null,
  map: null,
  parkingMap: null,
  overnightMap: null,
  hotspotsMap: null,
  routineMap: null,
  layers: {},
  parkingLayers: {},
  overnightLayers: {},
  hotspotsLayers: {},
  routineLayers: {},
  currentMarker: null,
  track: [],
  currentTrackIndex: 0,
  teleportVisible: false,
  isPlaying: false,
  playbackToken: 0,
  routeRequestToken: 0,
  hourChart: null,
  modelsLoading: false,
  modelRefreshToken: 0,
  overnightMode: OVERNIGHT_MODE_NIGHT,
  mapSettings: { ...DEFAULT_MAP_SETTINGS },
  parkingSettings: { ...DEFAULT_PARKING_SETTINGS },
  routineFilter: { selectedHours: DEFAULT_ROUTINE_FILTER.selectedHours.slice() },
  routineFilterDraft: { selectedHours: DEFAULT_ROUTINE_FILTER.selectedHours.slice() },
  parkingMapAutoFitKeys: new Set(),
  parkingMapProgrammaticMove: false,
  parkingMapUserAdjusted: false,
  parkingPlaybackRunning: false,
  parkingPlaybackToken: 0,
  parkingPlaybackIndex: 0,
  parkingPlaybackRangeKey: "",
  parkingPlaybackSequence: [],
  parkingPlaybackMarkerByCluster: new Map(),
  parkingPlaybackActiveMarker: null,
  parkingClusterByIndex: new Map(),
  routineFilteredTrack: [],
  csvExports: {
    stay: "",
    hotspot: "",
    validation: ""
  }
};



