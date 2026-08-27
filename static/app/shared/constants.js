export const HOME = {
  address: "Taipei City Datong Dist Chongqing N Rd Sec 2 No.51 4F",
  lat: 25.0557,
  lon: 121.5139,
  radiusM: 600
};

export const MAP_DEFAULT_VIEW = {
  lat: 24.4278,
  lon: 118.3592,
  zoom: 13
};

export const FIRST_OPEN_NOTICE_KEY = "sb-first-open-notice-20260408-update-a";
export const MAP_SETTINGS_KEY = "caridentify-map-settings";
export const PARKING_SETTINGS_KEY = "caridentify-parking-settings";

export const OVERNIGHT_MODE_NIGHT = "night";
export const OVERNIGHT_MODE_DAY = "day";

export const DEFAULT_MAP_SETTINGS = {
  pointColor: "#ff0000",
  pointRadius: 6,
  showPointNumbers: true,
  showPointDetails: false,
  focusWindowOnly: false,
  textOpacity: 85,
  textSize: 12,
  lineColor: "#000000",
  lineStyle: "solid",
  lineWeight: 3,
  roadRouting: false
};

export const DEFAULT_PARKING_SETTINGS = {
  durationCategory: "10-60",
  customMin: 360,
  customMax: 99999,
  popupOpacity: 65
};

export const DEFAULT_NORMAL_DRIVING_SPEED_KMH = 40;
export const MIN_NORMAL_DRIVING_SPEED_KMH = 1;
export const MAX_NORMAL_DRIVING_SPEED_KMH = 150;
export const PARKING_CLUSTER_RADIUS_M = 100;
export const TIMELINE_SELECT_MAX_OPTIONS = 500;
export const LARGE_IMPORT_FILE_BYTES = 15 * 1024 * 1024;
export const ASSET_VERSION = "20260827b";

export const DEFAULT_ROUTINE_FILTER = {
  selectedHours: Array.from({ length: 24 }, (_, hour) => hour)
};
export const ROUTINE_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);

export const DEFAULT_AI_PROMPT = `角色： 專業刑事交通數據分析師（具備15年資深偵查、洗錢與毒品案背景）。
任務： 分析 LPR 汽機車路徑資料，識別停留點、識別日常作息，產出偵查報告與搜索聲請附件。

一、 資料前處理與異常清洗 (Cleaning)
時間格式化：將民國年（YYY/MM/DD HH:MM:SS）統一轉換為西元年（YYYY-MM-DD HH:MM:SS）並依時間排序。
傳送門過濾 (Teleportation Check)：
若相鄰兩筆紀錄平均移動速度 > 150 km/h，或距離相差超過 10 公里，視為車牌誤辨或異常資料，該筆必須排除，不得納入分析。

二、 停留點判定邏輯 (Stay Point Logic - 嚴格修正版)
停留定義：
起始點與結束點之經緯度座標不同，且時間差距 > 10 分鐘。
斷點處理 (關鍵規則)：
若兩筆紀錄時間差 > 6 小時，且期間該車輛在該地點（及周邊 100 公尺內）無重複辨識，必須判定為在該路口（或進入該處死角）持續停留。不得標註為追蹤斷點，應將該時段完整計入停留時間，以增強對象與地點的關聯強度。
時間格式：停留時長一律轉換為「o時o分」格式（例如：24時16分）。

三、 居住地地緣與作息分析 (Investigation Analysis)
地緣比對：輸入對象居住地為【】，若無輸入則從車輛軌跡中判斷。
專用術語：分析報告中，提及返回行為時，一律使用「返回住處」而非「歸府」或「回家」。
作息研判：出門規律：識別每日第一次離開住處周邊 600 公尺區域的時間與方向。
返回住處規律：識別每日最後一次進入住處周邊並靜止的時間。
長期停放區：識別除住處外，停留時間超過 24 小時的特定地點。

四、 輸出格式要求 (Output)
輸出 1：停留點清單 (CSV 表格)
欄位包含：抵達時間、離開時間、停留時長、行政區、經度、緯度、最接近地址。
輸出 2：熱點統計
列出停留次數最多的前 20 個地點，並統計各點總停留時長。
輸出 3：作息分析概述
條列式說明對象平均出門時間、返回住處時間、活動熱區及偵查建議。
輸出 4：驗證 CSV
依照原始資料順序，將「停留起始列」與「下一列位移點」成對保留，方便逐筆核對。`;
