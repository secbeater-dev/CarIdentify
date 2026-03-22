# 車輛辨識系統（純前端版，可上 GitHub Pages）

此版本已改為純前端靜態網站，不需要 Flask 後端即可分析與使用。

## 主要功能

- 上傳 Excel/CSV（`.xlsx/.xls/.csv`）
- 民國時間轉西元、排序、座標清洗、傳送門異常剔除
- 停車分析（`>10 分鐘`）
- 停車分析（`>60 分鐘`）
- 過夜分析（停駐 `>=6h` 且夜間重疊 `>=1h`）
- 熱區分析（保留熱區統計表，前 50 名）
- 時間分布圖（每小時車輛辨識數量）
- 軌跡異常偵測（僅保留跨縣市移動斷點 / 傳送門）
- 互動地圖：
  - 時間滑桿
  - 時間下拉選單
  - 直接指定時間
  - 播放 / 停止（可調速度）
  - 自動聚焦每個時間點
  - 異常傳送門顯示開關（預設關閉）
- AI 分析（Gemini）：
  - 可自訂 API URL
  - 可填 API Key
  - 可選模型或自訂模型
  - 可自訂提示詞
- 資料匯出（側邊欄選單）：
  - 停車分析（>10 分鐘）
  - 熱區統計（Top 50）
  - 驗證配對 CSV

## 本機啟動

直接雙擊：

- `run_web.bat`

會自動：

1. 啟動本機靜態伺服器（`python -m http.server 8000`）
2. 自動開啟瀏覽器到 [http://127.0.0.1:8000/](http://127.0.0.1:8000/)

## GitHub Pages 發佈

1. 建立 GitHub repo 並把本專案推上去。
2. 確保 repo 根目錄包含：
   - `index.html`
   - `static/style.css`
   - `static/app.js`
   - `static/Beater_icon.png`
   - `sample_input.xlsx`
3. 到 GitHub `Settings -> Pages`。
4. `Build and deployment` 選：
   - `Source: Deploy from a branch`
   - Branch: `main`（或你的分支） / Folder: `/ (root)`
5. 儲存後等待發佈，使用 GitHub 提供的 Pages 網址開啟。

## 注意事項

- Gemini API Key 由瀏覽器直接呼叫，請使用受限金鑰（限制網域 / 配額）。
- `載入範例` 會讀取根目錄 `sample_input.xlsx`。
- 若你只要 GitHub Pages 版本，可不使用 `app.py` / `analyzer.py`。

## 目前前端核心檔案

- `index.html`
- `static/style.css`
- `static/app.js`
