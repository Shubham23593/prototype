# Verification record

Checked in this workspace on **2026-09-05T12:35:08.560Z** (UTC).

## Executed checks

- TypeScript type check: passed.
- Express/data/storage tests: **8 passed**.
- Python/data/model tests: **14 passed** (one upstream deprecation warning).
- Full browser workflow: **15 passed**, including an actual XGBoost retraining job.
- Optimized Next.js production build: passed.
- Production dependency audit: **0 known vulnerabilities** at the time of this check.

## Browser checks

- Actual archive, model inference and date provenance.
- Desktop dashboard renders genuine counters and Leaflet geometry.
- Region and model-class filters query real records.
- Fullscreen, Escape and actual map-layer toggles.
- CSV export contains all matching real observations and provenance.
- Observation details and real source-evidence requests (including honest failures).
- Persistent analyst review, genuine saved snapshot and removal.
- Server-side catalog pagination and search.
- Actual source-row CSV import and validation.
- Actual background XGBoost retraining and artifact replacement.
- Model lab displays measured holdouts, including weak-class performance.
- Real source checks and live/historical separation without fabricated fallback.
- Full historical-data and reproducible-training documentation route.
- Responsive mobile dashboard and functional navigation.
- No client runtime errors or browser cross-origin API calls.

No API response interception or fabricated browser fixtures were used. CSV import tests used actual rows from the source archive; temporary test notes and uploads were removed afterward.

## Actual model evidence

- Model: `xgb-62b397c0-thermal`.
- Last actual training: `2026-09-05T12:34:52.840431+00:00`.
- Source SHA-256: `62b397c086bf1934010fd86987506e8aca45d74a9fc0270cd434128a9a9a3db6`.
- Model artifact SHA-256: `22edb6a3977e4a6cb7b57bfe1530609a0630fb4ca74fa893c928dff2b6604c79`.
- Strict spatial/temporal holdout macro-F1: `0.627432`.

## Not verified as successful external integrations

- Direct NASA NRT retrieval: unavailable from this sandbox; real unavailable states tested.
- OSM/Sentinel successful enrichment and fused-model training: not verified here; network failure paths tested, no fabricated values substituted.
- Actual MongoDB service and Docker Compose startup: configuration/code supplied but not run here (no Docker/MongoDB available). The local durable journal was exercised.
- Population raster/exposure: not configured, explicitly unknown.

These are research-prototype checks, not an operational public-safety certification or independent incident-level model validation.

## Additional production-runtime checks

After the optimized build, `npm start` successfully served the standalone frontend on `0.0.0.0:3000`. The 14-check non-retraining browser suite passed again against that actual production server, with no client exceptions.

- Uploaded the complete **24,547,074-byte** genuine historical CSV through the production Next.js proxy: **316,035 valid rows**, as expected. This verifies a realistic archive upload, not just a small fixture. The temporary uploaded copy was removed afterward.
- Downloaded GeoJSON for the real Maharashtra-area 24-hour historical window: **3,156 features**, matching the overview API and bounding-box coordinates.
- Requested the production frontend using a preview-style `*.e2b.app` Host header: **HTTP 200**.
