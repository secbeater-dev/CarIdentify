# CarIdentify Full View

> 最後檢視日期：2026-07-29
>
> 架構版本：2026-07-29 GPS record list support
>
> 本文件是專案的架構與維護基準。進行任何程式修改前必須先完整閱讀；修改完成後必須同步更新受影響的章節、測試案例與版本資訊。

## 1. 專案定位

CarIdentify 是純前端車輛軌跡分析網站，沒有自有後端。使用者在瀏覽器選取 Excel 或 CSV 後，資料由瀏覽器本機解析、正規化、分析並渲染，不會透過應用程式上傳到 CarIdentify 伺服器。

主要能力：

- 多檔 Excel、CSV 匯入與合併分析
- 車牌、時間、座標與來源欄位正規化
- 異常軌跡清洗、停留判定、過夜與日間分析
- 熱區、停車、每小時分布與互動地圖
- CSV 分析結果匯出
- 選用的 Gemini 分析、OSRM 道路路線與第三方地圖服務

部署方式是 GitHub Pages，根目錄的 `CNAME` 指向自訂網域。

## 2. 維護規則

每次修改必須依序執行：

1. 讀取本文件，確認入口、資料流、模組責任與既有測試。
2. 確認 `git status --short`，保留不屬於本次工作的既有變更。
3. 先新增或調整測試，確認測試會因缺少目標行為而失敗。
4. 實作最小變更並跑回歸測試。
5. 更新本文件中受影響的架構、格式、測試或部署說明。
6. commit 前檢查 staged 檔案與 diff，不得包含私有資料或測試輸出。

若實際程式與本文件不一致，以程式現況為調查起點，但必須在同一個變更中修正本文件。

## 3. 執行架構

```mermaid
flowchart LR
    U["使用者選取本機檔案"] --> P["SheetJS 解析工作表"]
    P --> F["格式偵測與欄位正規化"]
    F --> M["多檔合併"]
    M --> A["軌跡清洗與分析"]
    A --> S["全域 state"]
    S --> V["地圖、表格、時間分布與 AI 視圖"]
    A --> E["瀏覽器端 CSV 匯出"]
```

執行特性：

- `index.html` 是唯一頁面與 DOM 容器。
- `static/app/main.js` 是正式站點入口。
- 使用原生 ES Modules，沒有 npm build、bundler 或編譯步驟。
- 第三方 SheetJS 與 Leaflet 由 `index.html` 的 CDN script 載入。
- JS 與 CSS URL 使用查詢參數作為 GitHub Pages 快取版本。

## 4. 目錄與責任

```text
CarIdentify/
├─ index.html
├─ README.md
├─ fullview.md
├─ CNAME
├─ .nojekyll
├─ .gitignore
├─ static/
│  ├─ style.css
│  ├─ Beater_icon.png
│  ├─ first-open-20260607-bg.png
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
│     │  ├─ selectors.js
│     │  └─ timeFilters.js
│     └─ views/
│        ├─ tableView.js
│        ├─ mainMapView.js
│        ├─ parkingView.js
│        ├─ overnightView.js
│        ├─ hotspotsView.js
│        ├─ routineView.js
│        └─ aiView.js
└─ scripts/
   ├─ start-local.ps1
   ├─ run-browser-tests.ps1
   ├─ core-unit-tests.mjs
   └─ browser-cdp-tests.mjs
```

### 根目錄

- `index.html`：整體頁面、側欄、工具列、各 view 容器、外部 script 與正式入口。
- `README.md`：使用方式、支援格式、分析規則與測試命令。
- `fullview.md`：架構、資料流、維護及隱私基準。
- `static/style.css`：全站 light/dark theme、響應式版面、地圖、表格與視圖樣式。
- `CNAME`、`.nojekyll`：GitHub Pages 部署設定。

### shared

- `constants.js`：住處圍欄、地圖預設值、設定 key、分析門檻、時間篩選預設值與 AI 預設提示詞。
- `state.js`：分析結果、各 Leaflet map/layer、播放狀態、使用者設定與時間篩選狀態。
- `dom.js`：集中取得 `index.html` 的 DOM 元素。
- `utils.js`：日期、車牌、數值、距離、CSV、設定儲存及 UI 共用工具。
- `leaflet.js`：建立基礎地圖、fit bounds、空地圖與容器檢查。

### analysis

- `core.js`：可由 Node 測試匯入的格式偵測、正規化與核心分析實作。
- `workbookFormats.js`：處理需要先定位真正表頭的工作表格式，回傳最小化的標準欄位物件列。
- `timeFilters.js`：24 小時選取、摘要、軌跡篩選與每小時計數。
- `selectors.js`：把完整分析結果轉為各視圖需要的 view model。

### views

- `tableView.js`：通用表格 renderer、列點擊與 active row。
- `mainMapView.js`：主軌跡、時間軸、播放、異常點與選用 OSRM 路線。
- `parkingView.js`：停車區間、100 公尺聚類、地圖與案件播放。
- `overnightView.js`：過夜／日間模式、地圖與列表。
- `hotspotsView.js`：停留點 300 公尺聚類 Top 50。
- `routineView.js`：24 小時選取、長條圖、地圖與點位列表。
- `aiView.js`：Gemini endpoint、模型清單、請求與結果顯示。

### scripts

- `start-local.ps1`：從 repo root 啟動本機 HTTP server。
- `run-browser-tests.ps1`：啟動 server 與獨立 Edge CDP profile，逐案執行 browser tests。
- `core-unit-tests.mjs`：直接測試 `analysis/core.js` 的格式、正規化與分析。
- `browser-cdp-tests.mjs`：不依賴 Playwright/Selenium 的 Edge CDP 端到端測試。

## 5. 啟動與初始化

`index.html` 載入完成後，`main.js`：

1. 匯入 constants、DOM、state、分析 selector 與各 view factory。
2. 從 localStorage 載入地圖及停車設定。
3. 建立主地圖、停車與 AI view。
4. 綁定側欄、主題、檔案分析、時間篩選、播放、設定與匯出事件。
5. 顯示首次開啟通知，並維持預設的互動地圖 view。

正式執行仍在 `main.js` 內保留一份核心格式與分析函式；`analysis/core.js` 提供模組化版本給 Node 測試。修改核心邏輯時，兩者必須保持一致，除非另行完成入口模組化。

## 6. 檔案匯入資料流

1. `<input type="file" multiple>` 接受 `.xlsx`、`.xls`、`.csv`。
2. 每個檔案以 `File.arrayBuffer()` 讀入瀏覽器記憶體。
3. `parseWorkbookArrayBuffer()` 使用全域 `XLSX`：
   - 修復不完整的 worksheet `!ref` 範圍。
   - 依工作表順序尋找第一個有資料的工作表。
   - 先以二維矩陣呼叫格式轉接器。
   - GPS 記錄格式會定位真正表頭、擷取前置車牌並只保留必要欄位。
   - 不符合轉接格式時，使用原本的 `sheet_to_json` 物件列 fallback。
4. `detectDatasetFormat()` 判斷來源格式。
5. `normalizeRows()` 轉為標準軌跡列。
6. 多檔的標準列合併後交給 `analyzeRecords()`。
7. 只有任一檔案為 `vehicle_recognition` 時，合併分析才略過第一階段清洗。

單一檔案失敗時，UI 錯誤目前會包含該檔名與解析錯誤；敏感測試不可輸出這段 status。

## 7. 標準資料模型

正規化後每列包含：

| 欄位 | 型別 | 用途 |
|---|---|---|
| `id` | number | 排序、表格及相鄰點關聯 |
| `plate` | string | UI 顯示 |
| `plate_norm` | string | 去除連字號與空白後的分組 |
| `timestamp_raw` | unknown | 原始時間值 |
| `timestamp` | Date | 排序、篩選與時間分析 |
| `lon` | number | 經度 |
| `lat` | number | 緯度 |
| `source` | string | 行政區、門架、單位等來源 |
| `note` | string | 地址、攝影機或地點說明 |

必要邏輯欄位是車牌、時間，以及拆分的經緯度或合併座標。`id`、`source`、`note` 可由預設值補足。

## 8. 支援格式

### generic

靠欄位別名尋找車牌、時間、經緯度、來源與備註，走完整清洗流程。

### vehicle_recognition

以偵測日期、門架名稱及 eTag／國道／車牌欄位辨識。這類門架資料略過第一階段時間倒退與傳送門清洗，但後續停留判定仍套用正常行駛速度門檻。

### idkcity_camera

必要欄位：

- `軌跡編號`
- `攝影機名稱`
- `車牌`
- `單位`
- `日期`
- `時間`
- `攝影機`
- `經度`
- `緯度`

日期與時間會合併，攝影機作為 id、單位作為 source、攝影機名稱作為 note。

### combined_coordinate

必要欄位：

- `編號`
- `車號`
- `時間`
- `來源`
- `備註`
- `經緯度`

合併座標支援經度／緯度兩種順序，依台灣常見範圍及全球座標範圍判斷。

### irent

必要欄位：

- `車號`
- `GPS時間`
- `經度`
- `緯度`

若整體經緯度欄位順序顛倒，`smartSwapCoordinates()` 會依中位數自動交換。

### gps_record_list

工作表特徵：

- 表頭前可有標題、空白列與車牌／日期說明。
- 前 20 列內必須出現 `定位時間`、`定位位置`、`地標名稱`、`經度`、`緯度`。
- `定位時間` 可有包含筆數的半形或全形括號後綴，轉接時正規化為 `定位時間`。
- 車牌由表頭前置資訊擷取；找不到時以不含原始內容的通用錯誤停止。

轉接器只回傳：

- `車號`
- `定位時間`
- `定位位置`
- `地標名稱`
- `經度`
- `緯度`

其他原始欄位不進入正規化資料列。格式 key 是 `gps_record_list`，使用一般清洗流程。

## 9. 核心分析流程

`analyzeRecords()` 依序執行：

1. 正規化並依時間、id 排序。
2. 統計 `plate_norm`，只分析出現次數最多的車牌。
3. 依台灣範圍判斷整體經緯度是否需要交換。
4. 排除無效或非正座標。
5. 一般清洗模式排除：
   - 非遞增時間
   - 速度大於 150 km/h
   - 距離大於 10 km 且符合嚴格模式或一小時內跳點
6. 建立相鄰點 transitions。
7. 以時間大於 4 分鐘、距離至少 5 公尺、速度低於 UI 門檻判斷 stays。
8. 計算日間／夜間重疊、過夜、長停車、熱區與每小時分布。
9. 產生 summary、map payload、anomalies 及三類 CSV 字串。

主要回傳結構：

- `summary`
- `stays`
- `parking_60`
- `overnight`
- `hotspots`
- `hourly_distribution`
- `anomalies`
- `transitions`
- `map`
- `exports`

## 10. State 與渲染

`shared/state.js` 是各 view 的共同狀態來源，包含：

- 完整分析結果與主軌跡
- 主地圖及四個分析地圖的 Leaflet 實例與 layers
- 主地圖時間軸、播放 index、速度與 request token
- 停車案件、聚類、播放及自動縮放狀態
- 過夜／日間模式
- 時間分布已套用與草稿時段
- 地圖、停車使用者設定
- CSV 匯出字串

`main.js` 完成分析後將結果寫入 state，再協調各 view renderer。部分 view 以 factory 接收依賴，部分 view 直接匯入共享 state 與 DOM。

## 11. 主要視圖

- 互動地圖：軌跡點、線、時間軸、播放、傳送門切換及設定。
- 停車分析：依停留分鐘分類、100 公尺聚類與案件播放。
- 停駐時段分析：過夜與日間長停留切換。
- 熱區分析：停留點 300 公尺聚類與 Top 50。
- 時間分布圖：00–23 時段草稿選取，套用後同步更新長條圖、地圖及列表。
- 軌跡異常偵測：顯示傳送門與相關描述。
- AI 分析：使用者主動輸入 API Key、模型與提示詞後才呼叫 Gemini。
- 留言板：開啟頁面後載入 Disqus。

## 12. 設定與本機儲存

localStorage 保存：

- 地圖點、線、透明度、字級與道路路線設定
- 停車時間分類、自訂區間與 popup 透明度
- 首次開啟通知已讀狀態

清除設定功能只移除 `caridentify-` 與 `sb-first-open-notice-` 開頭的 localStorage／sessionStorage key。

## 13. 外部服務與網路

- SheetJS CDN：Excel、CSV 解析。
- Leaflet CDN：地圖引擎。
- OpenStreetMap tiles：所有 Leaflet 基礎地圖。
- OSRM：使用者啟用沿道路路線時呼叫。
- Gemini API：使用者主動執行 AI 分析時呼叫。
- YouTube：側欄推薦影片。
- Disqus：留言板。

本機檔案解析與核心分析不需要自有後端；Gemini、OSRM、地圖圖磚、影片與留言板需要網路。

## 14. 測試架構

### Node 單元測試

`scripts/core-unit-tests.mjs` 使用 `node:assert/strict` 測試：

- GPS 記錄轉接器的表頭定位、動態欄名、車牌擷取與通用錯誤
- `parseWorkbookArrayBuffer()` 的 GPS 路徑、前 20 列限制、多工作表與舊格式 fallback
- 合併座標格式
- 拆分座標與自動交換
- ETC／門架格式的 skip cleaning
- 使用合成資料的 iRent 格式
- `normalizeRows()` 與 `analyzeRecords()`

### Edge CDP browser tests

`run-browser-tests.ps1`：

1. 啟動 Python HTTP server。
2. 以獨立暫存 profile 啟動 headless Edge。
3. 呼叫 `browser-cdp-tests.mjs`。
4. 每個案例完成後關閉 Edge 並移除 profile。

既有案例包含：

- `startup-dom`
- `xlsx-single`
- `csv-single`
- `merged-upload`
- `idkcity-single`
- `combined-coordinate-sensitive`
- `irent-single`
- `routine-filter-table`
- `gps-record-list-sensitive`

案例所需外部 fixture 不存在時，wrapper 只執行可用案例。名稱含 `sensitive` 的案例與 `irent-single` 都會在分析期間關閉網路，並遮蔽失敗訊息與 status text。

`gps-record-list-sensitive` 接受 repo 外的資料夾：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-browser-tests.ps1 -GpsRecordDir <private-data-directory>
```

這個案例會逐一測試每份 `.xlsx`，再測試全部檔案合併。分析期間透過 CDP 關閉網路，避免地圖圖磚或其他第三方請求衍生出位置資訊；測試只回傳布林驗證結果與案例 PASS／FAIL。

## 15. 本機與部署

本機啟動：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

測試：

```powershell
node scripts/core-unit-tests.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-browser-tests.ps1
```

正式站由 GitHub Pages 直接提供 repo 根目錄內容，不需要 build artifact。發布流程必須使用 fast-forward 更新 `main`，並確認本機 `main`、`origin/main` 與預期 commit 相同。

## 16. 隱私與提交規則

- 真實 Excel、CSV、衍生 fixture、截圖與匯出結果不得加入 repo。
- `.gitignore` 全域忽略 `*.xlsx`、`*.xls`、`*.csv`。
- 敏感資料只能由本機測試參數傳入，且不得輸出檔名、路徑、車牌、時間、座標、筆數或表格內容。
- 自動化測試資料必須完全合成，不可摘錄真實資料列。
- 私有檔案不得交給外部服務、子代理或遠端測試。
- commit 前執行：

```powershell
git status --short
git diff --cached --name-only
git diff --cached --check
git ls-files
```

- staged 與 tracked 清單不得包含 `.xlsx`、`.xls`、`.csv` 或本機私有資料路徑。

## 17. 已知架構限制

- 正式入口 `main.js` 與 `analysis/core.js` 存在核心邏輯重複；目前需同步修改並以測試避免偏差。
- 站點依賴多個 CDN 與第三方服務，離線時地圖或外部功能可能退化。
- 多檔分析只保留出現次數最多的標準化車牌；GPS 記錄格式會由各工作表前置資訊擷取車牌以維持正確分組。
- browser regression 的部分舊 fixture 位於 repo 外，執行環境沒有檔案時不會跑對應案例。
