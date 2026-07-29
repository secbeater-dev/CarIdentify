# CarIdentify

純前端的車輛辨識分析站點，可直接部署到 GitHub Pages，沒有後端服務。現行入口為 `static/app/main.js`，自訂網域為 `car.secbeater.com`。

## 2026-07-29 現況

- 舊的 `static/app.js` 已移除，站點已改成原生 ES Modules。
- 時間分布圖已改為 `00` 到 `23` 的 24 時段單排方塊，可多選、全選、重設，按套用後才更新圖表、地圖與列表。
- 停車分析、停駐時段分析、熱區分析、時間分布圖的下方列表都可直接點擊定位地圖。
- 時間分布圖已有獨立點位列表，會跟目前已套用的時段同步。
- 新增 `idkcity_camera` 標頭格式支援。
- 新增 `gps_record_list` 格式，可辨識前置說明列、第 4 列表頭與帶動態後綴的 `定位時間` 欄。
- 新增 `scripts/start-local.ps1`，可一鍵啟動本機靜態站。
- 已提供 Edge CDP 真實瀏覽器回歸測試，依本機可用 fixture 動態選擇案例。
- 軌跡異常偵測空資料時，會顯示正常中文 `目前無資料`。

## 目錄結構

```text
CarIdentify/
├─ index.html
├─ README.md
├─ fullview.md
├─ CNAME
├─ .nojekyll
├─ static/
│  ├─ style.css
│  ├─ Beater_icon.png
│  └─ app/
│     ├─ main.js
│     ├─ shared/
│     │  ├─ constants.js
│     │  ├─ state.js
│     │  ├─ dom.js
│     │  ├─ utils.js
│     │  └─ leaflet.js
│     ├─ analysis/
│     │  ├─ core.js
│     │  ├─ workbookFormats.js
│     │  ├─ timeFilters.js
│     │  └─ selectors.js
│     └─ views/
│        ├─ tableView.js
│        ├─ overnightView.js
│        ├─ hotspotsView.js
│        ├─ routineView.js
│        ├─ parkingView.js
│        ├─ mainMapView.js
│        └─ aiView.js
└─ scripts/
   ├─ start-local.ps1
   ├─ browser-cdp-tests.mjs
   ├─ core-unit-tests.mjs
   └─ run-browser-tests.ps1
```

## 模組責任

### `static/app/main.js`

- bootstrap 與初始化流程
- localStorage 設定載入 / 同步
- 首次開啟 popup
- 檔案上傳、資料合併、分析送出
- CSV 匯出
- 事件綁定
- 協調各個 `views/*` 模組

### `static/app/analysis/core.js`

- 欄位別名偵測
- 資料格式辨識：`generic`、`vehicle_recognition`、`idkcity_camera`、`combined_coordinate`、`irent`、`gps_record_list`
- 時間解析、車牌正規化、經緯度自動交換修正
- 傳送門清洗、停留判定、過夜 / 日間分析、熱區聚類
- 地圖 payload 與 CSV 匯出內容建構

### `static/app/analysis/workbookFormats.js`

- 辨識具有前置說明列的 GPS 記錄工作表
- 尋找真正表頭並正規化 `定位時間` 的動態括號後綴
- 從前置資訊擷取車牌，只保留分析所需欄位

### `static/app/analysis/timeFilters.js`

- 時間分布圖的 24 時段勾選篩選
- 套用 / 草稿狀態正規化
- 篩選摘要與每小時分布重算

### `static/app/views/*.js`

- `mainMapView.js`：主地圖、時間軸、播放、異常傳送門顯示、OSRM 路徑
- `parkingView.js`：停車分析、100m 停車統計點、案件播放、停車列表點擊定位
- `overnightView.js`：過夜 / 日間表格、地圖、列表點擊定位
- `hotspotsView.js`：Top 50 熱區表格、地圖、列表點擊定位
- `routineView.js`：24 時段單排方塊、時間分布圖、routine map、點位列表、列表點擊定位
- `aiView.js`：Gemini 模型清單、endpoint preview、AI 分析送出
- `tableView.js`：通用表格 renderer，支援 row click 與 active row

## 支援資料格式

### `generic`

- 一般 Excel / CSV 車輛辨識資料
- 靠欄位別名偵測必要欄位
- 會走完整分析流程

### `vehicle_recognition`

- 典型門架 / ETC 類格式
- 會略過第一階段傳送門 / 時間倒退清洗
- 但後續停留判定仍受正常行駛速度門檻影響

### `idkcity_camera`

- 以固定的 IDKCity 攝影機標頭為辨識基準
- 需要的核心標頭：
  - `軌跡編號`
  - `攝影機名稱`
  - `車牌`
  - `單位`
  - `日期`
  - `時間`
  - `攝影機`
  - `經度`
  - `緯度`
- 正規化對應：
  - `plate = 車牌`
  - `timestamp = 日期 + 時間`
  - `source = 單位`
  - `note = 攝影機名稱`
  - `id = 攝影機`
- 這個格式走一般分析流程，不是 `vehicle_recognition`

### `combined_coordinate`

- 支援只有合併座標欄的 Excel / CSV 車輛辨識資料
- 需要的核心標頭：
  - `編號`
  - `車號`
  - `時間`
  - `來源`
  - `備註`
  - `經緯度`
- 正規化對應：
  - `plate = 車號`
  - `timestamp = 時間`
  - `source = 來源`
  - `note = 備註`
  - `id = 編號`
  - `lon/lat = 經緯度`
- `經緯度` 可為 `經度, 緯度` 或 `緯度, 經度`，系統會依台灣常見座標範圍判斷順序
- 這個格式走一般分析流程，不是 `vehicle_recognition`

### `irent`

- 必要標頭：`車號`、`GPS時間`、`經度`、`緯度`
- 若整份資料經緯度欄位順序顛倒，系統會依台灣常見範圍自動交換
- 這個格式走一般分析流程

### `gps_record_list`

- 支援工作表前方含說明列、真正表頭不在第一列的 GPS 記錄格式
- 必要標頭：
  - `定位時間`
  - `定位位置`
  - `地標名稱`
  - `經度`
  - `緯度`
- `定位時間` 可帶有動態的括號筆數後綴，匯入時只保留標準欄名
- 車牌由表頭前置資訊在瀏覽器記憶體中擷取，不寫入任何檔案或測試輸出
- `狀態`、`時速(km/h)`、`公里數`、`方向` 不進入標準分析資料列
- 這個格式走一般清洗流程

## 功能摘要

- 多檔上傳 `.xlsx` / `.xls` / `.csv`
- 每個檔案依工作表順序尋找資料；GPS 記錄格式先定位真正表頭，其餘格式沿用第一個非空工作表
- 合併資料後，只分析標準化後出現次數最多的車牌
- 7 個主視圖：
  - 互動地圖
  - 停車分析
  - 停駐時段分析
  - 熱區分析
  - 時間分布圖
  - 軌跡異常偵測
  - AI 分析
- 主地圖時間軸與播放
- 停車案件播放
- 過夜 / 日間互動地圖
- 熱區互動地圖
- 時間分布圖的 24 時段單排方塊篩選
- 時間分布圖的地圖與點位列表
- 停車 / 停駐時段 / 熱區 / routine 列表點擊定位地圖
- 3 類 CSV 匯出
- Gemini API 分析

## 真實分析規則

- 必要欄位：`plate`、`timestamp`，以及 `lon` / `lat` 或合併座標欄 `coord`
- 可選欄位：`id`、`source`、`note`
- 停留判定：相鄰乾淨資料點 `dt > 4 分鐘`、`距離 >= 5 公尺`、`speed < normalDrivingSpeedKmh`
- 正常行駛速度門檻預設 `40 km/h`，UI 可調 `1–150 km/h`
- 傳送門清洗：`speed > 150 km/h`，或 `距離 > 10 km` 且符合嚴格模式 / `dt <= 1h`
- `vehicle_recognition` 格式會略過第一階段清洗，但後續停留判定仍照速度門檻
- 過夜分析：`duration >= 6h && night_overlap_h >= 1`
- 日間分析：`duration >= 6h && day_overlap_h >= 1`
- 熱區：對 `stays` 做 `300m` 聚類，取 Top 50
- 停車統計點：對目前停車篩選結果做 `100m` 聚類
- 住處圍欄：固定台北市大同區地址，半徑 `600m`

## 本機執行

推薦直接用一鍵腳本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

可選參數：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Port 8010
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -NoBrowser
```

如果只想用最簡單的方式，也可以：

```powershell
cd <CarIdentify-repo>
python -m http.server 8000
```

然後開啟 [http://127.0.0.1:8000/](http://127.0.0.1:8000/)

不要直接用 `file:///.../index.html` 開啟，模組與外部資源在 `file://` 環境下容易被瀏覽器限制。

## 首次開啟 Popup

- 首次開啟提醒由 `main.js` 動態建立
- localStorage key 現在為 `sb-first-open-notice-20260408-update-a`
- popup 內容已更新為 `2026-04-08`
- 內含：
  - 今日重點摘要
  - 本機運行提醒
  - SecBeater 聯絡連結
  - Telegram 群組連結：[https://t.me/tgsecbeater](https://t.me/tgsecbeater)

## 真實瀏覽器回歸測試

已提供 Edge CDP 測試腳本，不需安裝 Playwright / Selenium。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-browser-tests.ps1
```

目前自動化回歸案例：

- `startup-dom`
- `xlsx-single`
- `csv-single`
- `merged-upload`
- `idkcity-single`
- `combined-coordinate-sensitive`（需額外指定私有測試檔路徑，不會輸出資料內容）
- `irent-single`（敏感模式；分析期間離線，失敗資訊不含 fixture 內容）
- `routine-filter-table`
- `gps-record-list-sensitive`（需指定 repo 外的私有資料夾；逐檔與合併測試皆遮蔽內容）

測試案例會依實際指定的 repo 外 fixture 動態執行；沒有 legacy fixture 時仍會執行 `startup-dom`。

若要驗證合併座標欄格式，可額外指定檔案路徑：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-browser-tests.ps1 -CombinedCoordPath <path-to-private-xlsx>
```

若要驗證 GPS 記錄資料夾格式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-browser-tests.ps1 -GpsRecordDir <private-data-directory>
```

## GitHub Pages

1. 將 CarIdentify repo 推到 GitHub
2. 在 repo `Settings -> Pages` 啟用 `Deploy from a branch`
3. 選擇 `main` 與 `/(root)`
4. 等待部署完成

## 安全注意事項

- Gemini API Key 會在瀏覽器端使用
- 建議限制 HTTP referrer 與配額
- 不要把真實敏感資料直接提交到 repo
- 真實 `.xlsx`、`.xls`、`.csv`、衍生 fixture、截圖與匯出檔不得加入 Git
- 敏感 browser test 會在分析期間停用網路，避免資料衍生的位置請求送往第三方服務
- OSM / OSRM / Gemini 都需要網路，離線時部分功能會退化
