# CarIdentify

純前端的車輛辨識分析站點，可直接部署到 GitHub Pages，沒有後端服務。現行入口為 `static/app/main.js`，自訂網域為 `car.secbeater.com`。

## 2026-04-08 現況

- 舊的 `static/app.js` 已移除，站點已改成原生 ES Modules。
- 時間分布圖已改為 `00` 到 `23` 的 24 時段單排方塊，可多選、全選、重設，按套用後才更新圖表、地圖與列表。
- 停車分析、停駐時段分析、熱區分析、時間分布圖的下方列表都可直接點擊定位地圖。
- 時間分布圖已有獨立點位列表，會跟目前已套用的時段同步。
- 新增 `Pegion_IDKCity_Car_Identfy.xlsx` 這類 `idkcity_camera` 標頭格式支援。
- 新增 `scripts/start-local.ps1`，可一鍵啟動本機靜態站。
- 已提供 Edge CDP 真實瀏覽器回歸測試，現行基準為 `5/5 passed`。
- 軌跡異常偵測空資料時，會顯示正常中文 `目前無資料`。

## 目錄結構

```text
CarIdentify/
├─ index.html
├─ README.md
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
- 資料格式辨識：`generic`、`vehicle_recognition`、`idkcity_camera`
- 時間解析、車牌正規化、經緯度自動交換修正
- 傳送門清洗、停留判定、過夜 / 日間分析、熱區聚類
- 地圖 payload 與 CSV 匯出內容建構

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
- 範例：`H:\CarIdentify\Pegion_Freeway_ETC_Record.csv`

### `idkcity_camera`

- 以 `Pegion_IDKCity_Car_Identfy.xlsx` 的標頭為辨識基準
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

## 功能摘要

- 多檔上傳 `.xlsx` / `.xls` / `.csv`
- 每個檔案只取第一個非空工作表
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

- 必要欄位：`plate`、`timestamp`、`lon`、`lat`
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
powershell -NoProfile -ExecutionPolicy Bypass -File H:\CarIdentify\CarIdentify\scripts\start-local.ps1
```

可選參數：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File H:\CarIdentify\CarIdentify\scripts\start-local.ps1 -Port 8010
powershell -NoProfile -ExecutionPolicy Bypass -File H:\CarIdentify\CarIdentify\scripts\start-local.ps1 -NoBrowser
```

如果只想用最簡單的方式，也可以：

```powershell
cd H:\CarIdentify\CarIdentify
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
powershell -NoProfile -ExecutionPolicy Bypass -File H:\CarIdentify\CarIdentify\scripts\run-browser-tests.ps1
```

目前自動化回歸案例：

- `startup-dom`
- `xlsx-single`
- `csv-single`
- `merged-upload`
- `idkcity-single`

現行基準：`5/5 passed`

## GitHub Pages

1. 將 `H:\CarIdentify\CarIdentify` 推到 GitHub repo 根目錄
2. 在 repo `Settings -> Pages` 啟用 `Deploy from a branch`
3. 選擇 `main` 與 `/(root)`
4. 等待部署完成

## 安全注意事項

- Gemini API Key 會在瀏覽器端使用
- 建議限制 HTTP referrer 與配額
- 不要把真實敏感資料直接提交到 repo
- OSM / OSRM / Gemini 都需要網路，離線時部分功能會退化
