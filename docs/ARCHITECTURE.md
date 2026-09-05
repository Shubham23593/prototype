# Architecture and operational boundaries

```text
Browser: Next.js + React + Tailwind + Leaflet
    │ same-origin /api/* (never browser-to-localhost)
    ▼
Next.js rewrite → Express API
    ├─ Genuine FIRMS downloads (3 VIIRS satellites; timeouts; validation)
    ├─ Immutable, checksum-verified historical CSV replay
    ├─ Query/filter/statistics/catalog/exports
    ├─ MongoDB with 2dsphere + unique event IDs, when configured
    │     └─ Explicit local JSON journal otherwise (not Mongo emulation)
    └─ Internal authenticated Python service
          ├─ Shared normalization & strictly causal radius features
          ├─ Actual XGBoost JSON artifact + checksum-verified model card
          ├─ Background training + held-out evaluation
          ├─ OSM query & projected geometry context
          ├─ Sentinel STAC / COG cloud-masked reflectance sampling
          └─ Optional year-specific population-count raster
```

## Data integrity

Acquisition timestamps are parsed as UTC HHMM, not decimal hours. VIIRS-only inputs, geographic bounds, temperature/FRP/footprint sanity checks and stable-ID deduplication precede inference. Archive and live modes are separate. Live time filters anchor to the wall clock; archive filters anchor to the true source period. No silent archive-to-live fallback exists.

All-matching observations drive statistics and exports. The map intentionally caps points at the highest-FRP 3,500 and displays that limit. Region presets are bounding-box areas, not authoritative political/state boundaries. Natural Earth shapes are real public-domain geometry; they are not fabricated map art or satellite imagery.

## ML integrity

The source-type labels are NASA algorithmic types, not industrial incident labels. Type, exact coordinates and future observations are not features. Recurrence is calculated with BallTree/haversine inside 750 m and strictly before each acquisition, with a 30-day lookback. Available elapsed history is reported separately from cloud-free coverage.

Training uses an early-date subset of non-held-out spatial groups. Diagnostics separately report late dates in unseen groups and late dates in seen groups. No model hyperparameter tuning uses these holdouts. **The conservative class-abstention policy does use holdout diagnostics** (low recall/small support); reported metrics are for the ungated classifier, not an independent validation of that policy. A separate external test set is still required.

Class probabilities below 0.65 and classes with poor evidence yield uncertainty. Sentinel/OSM values are not claimed as inputs to the baseline. An actually context-trained model refuses to score rows lacking its required measured context; inspecting a real observation can supply evidence and rescore it when both sources are successfully measured. Censored OSM distance is named explicitly and is not an invented exact distance.

Artifacts use XGBoost JSON, not untrusted pickle. A source/model checksum detects replacement. Model publication uses atomic file replacement; the service returns unavailable during a mismatched publication window instead of serving mismatched metadata. Training jobs are process-local and single-concurrent; use a real queue/worker and versioned registry for production.

## Persistence

MongoDB mode creates unique event IDs, acquisition indexes and a 2dsphere location index, then stores observed attributes and predictions. Analyst notes and review states also persist in MongoDB. The local mode atomically journals notes with the actual saved observation snapshot, preserving investigations when the rolling live feed no longer contains a pixel. Failed database writes are explicitly reported as degraded/local, never as MongoDB success.

## Source behavior

External HTTP requests have deadlines and bounded download size. TLS verification stays enabled and uses the operating-system trust store. Successful context is cached for 24 hours; missing measurements are not filled with made-up values. A cached OSM snapshot is current map evidence, not historical map truth. Spectral COG retrieval, not merely catalog metadata, is required before reporting NDVI/NDBI.

The source check cadence is 15 minutes by default. Browser live polling runs every minute but uses the server cache and does not invent higher-frequency satellite observations. Source timestamps and partial-feed failures stay visible.

## API surface

| Route | Behavior |
| --- | --- |
| `GET /api/health`, `/api/sources` | Actual component/configuration status |
| `POST /api/sources/check` | Bounded real upstream checks |
| `GET /api/overview` | All-matching counts/distributions/activity + capped map points |
| `GET /api/observations` | Server-side search/sort/pagination |
| `GET /api/events/:id` | Genuine observation and its prediction |
| `GET /api/events/:id/context` | Real OSM/Sentinel/optional population evidence |
| `POST /api/events/:id/review` | Save a review or watch state; no external alert |
| `GET /api/watchlist` | Persisted analyst records |
| `GET /api/export?format=csv\|geojson` | Full filtered records with provenance |
| `GET /api/history` | Source quality, true daily totals and replay manifest |
| `POST /api/history/import` | Bounded CSV upload and source/schema validation |
| `GET /api/model`, `/api/model/card` | Actual fitted-model diagnostics and artifact metadata |
| `POST /api/model/train`, `GET /api/jobs/:id` | Real training job and real stage messages |

## Security / deployment

Public prototype mode is explicitly not authenticated. Set `ADMIN_API_KEY` before public deployment; an optional `INTERNAL_SERVICE_KEY` protects Express-to-Python traffic separately. Browser keys stay in memory and are never placed in URLs or stored in local storage. CSV export text is formula-escaped. Upload paths use generated UUIDs; imported files cannot choose filesystem paths or trigger arbitrary URL fetches. Dataset and query sizes are bounded and mutations are rate-limited.

Compose publishes only the Next.js frontend. MongoDB and Python must remain private. Add user identity, roles, an audited queue, storage backups, key rotation, health monitoring and independent incident validation for a real operational rollout.

No SMS, emergency dispatch or calibrated casualty/risk prediction is implemented or implied.
