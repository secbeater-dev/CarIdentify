# Car Recognition System (Frontend Only, GitHub Pages Ready)

This project is a pure frontend web app. It can be deployed directly to GitHub Pages without Flask or any backend service.

## Current File Structure

```text
.
├─ index.html
├─ .nojekyll
└─ static/
   ├─ app.js
   ├─ style.css
   └─ Beater_icon.png
```

## What Each File Does

## `index.html`

- Main page layout and all UI sections
- Sidebar with:
  - Navigation tabs
  - Export controls
  - Embedded music area
- Data input controls:
  - File upload (`.xlsx`, `.xls`, `.csv`)
  - Strict teleport filter toggle
- Analysis views:
  - Interactive map
  - Parking analysis (`>10 min`)
  - Parking analysis (`>60 min`)
  - Overnight analysis
  - Hotspot analysis (Top 50)
  - Hourly distribution chart
  - Trajectory anomaly table
  - Gemini AI analysis panel
- External frontend libraries:
  - SheetJS (Excel parser)
  - Chart.js (bar chart)
  - Leaflet (map)

## `static/app.js`

Core logic for parsing, analysis, map interaction, export, and AI:

- Data parsing and normalization
  - Column alias matching
  - ROC/Gregorian time parsing
  - Plate normalization
  - Coordinate auto-swap detection/fix
- Trajectory cleaning and analysis
  - Teleport anomaly filtering (distance/speed)
  - Stay-point detection
  - Parking segmentation (`>10 min`, `>60 min`)
  - Overnight detection
  - Hotspot clustering and ranking
  - Hourly recognition distribution
- Interactive map
  - Track polyline, stay markers, hotspot markers, home geofence
  - Teleport anomaly layer toggle
  - Time slider, select, datetime picker
  - Playback with speed control and auto-focus
- Chart rendering
  - Hourly recognition bar chart with stable sizing
- CSV export
  - Stay records
  - Hotspot records
  - Validation pairs
- Gemini integration
  - Custom endpoint URL
  - API key input
  - Live model list loading (`listModels`)
  - Custom model override
  - Prompt-based `generateContent` request

## `static/style.css`

- Overall black/white visual theme
- Sidebar and responsive layout behavior
- Table styling (including centered table content for target views)
- Map/timeline controls
- Playback button state colors:
  - Play: bright green
  - Stop (while playing): bright red

## `static/Beater_icon.png`

- Brand icon for header and favicon.

## `.nojekyll`

- Ensures GitHub Pages serves files directly as a static site.

## Feature Summary

- Upload and analyze vehicle recognition data (Excel/CSV)
- Parking analysis (`>10 min`, `>60 min`)
- Overnight analysis
- Top 50 hotspot table
- Teleport anomaly detection
- Hourly distribution bar chart
- Interactive map with timeline playback
- Gemini AI analysis with dynamic model loading
- CSV export by category

## Local Run

```bash
python -m http.server 8000
```

Open:

- [http://127.0.0.1:8000/](http://127.0.0.1:8000/)

## GitHub Pages Deployment

1. Push this folder to the `main` branch.
2. Open repo settings: `Settings -> Pages`.
3. Set Source to `Deploy from a branch`.
4. Select Branch `main` and Folder `/(root)`.
5. Wait for deployment and open:
   - `https://<owner>.github.io/<repo>/`

## Security Notes

- Gemini API key is used in browser-side requests.
- Use a restricted API key (HTTP referrer + quota limits).
- Do not commit sensitive files or real private datasets.
