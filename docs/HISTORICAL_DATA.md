# ThermoScan: real data & training guide

**Stack Titans · SIH26162 · AI-based detection and classification of industrial fires and persistent thermal sources.**

ThermoScan is a runnable research prototype, not an operational emergency-warning system. It contains a real trained XGBoost source-type baseline and real API adapters. It does **not** invent incidents, source measurements, population exposure, labels, model scores, or evaluation metrics.

## 1. What is working here?

- Next.js + Tailwind dashboard, Leaflet map, region/time/class filters, searchable paginated catalog, CSV/GeoJSON exports, and persistent analyst reviews.
- Express API for ingestion, validation, inference orchestration, exports, imports, and training jobs.
- Python/XGBoost inference from the checked-in JSON model artifact, trained on an externally obtained historical VIIRS archive.
- A historical map window containing **all 67,359 valid records from 25–31 March 2025** in the source file. The map draws the highest-FRP 3,500 matching points for performance; the counters, catalog and exports use all matching records.
- Genuine NASA, OSM and Sentinel connectors. A failed request returns an unavailable state, not a substitute measurement.

### Important environment limitations

During implementation, this sandbox's direct HTTPS connections to NASA FIRMS, Overpass, Earth Search, Sentinel COG storage, and MongoDB download hosts failed. Therefore the preview starts in **Historical** mode, with real archived observations. The live tab explicitly reports the connection failure. A working dashboard does not mean those external sources are currently reachable.

No real MongoDB instance is configured here. Reviews use the explicitly named local JSON journal. The included Docker Compose deployment provisions actual MongoDB with geospatial indexes.

The active model uses **thermal and causal temporal features only**. Sentinel/OSM enrichment code is implemented, but actual successful raster/context retrieval and a fused-model training run have **not** been demonstrated in this network environment. Population exposure stays unknown until a genuine count raster is configured.

## 2. Obtain historical training observations

### Preferred: the official NASA archive

1. Open the [NASA FIRMS Archive Download](https://firms.modaps.eosdis.nasa.gov/download/).
2. Authenticate through your own Earthdata account or the archive's email-code flow. Do not share account credentials in chat or commit them.
3. Select **VIIRS S-NPP 375 m** or **VIIRS NOAA-20 375 m**, an actual geographic region, and a date range. For a defensible India model, collect several complete years and multiple industrial/vegetation regions rather than only one quarter.
4. Select **standard science-quality processing**, not just NRT, where available. NASA replaces NRT data with standard data after a processing delay.
5. Export CSV, preserve the original file, and record the product, dates, retrieval time and SHA-256.
6. Keep the original **type** field for this source-type baseline. A live CSV without type is not supervised training data.

[Country/year CSVs](https://firms.modaps.eosdis.nasa.gov/country/) offer another official route. The downloader implements the country/year URL convention:

```bash
# An official country/year download, if the source is reachable.
.venv/bin/python -m ml.download \
  --source nasa --country India --year 2024 \
  --output data/raw/india-2024.csv

.venv/bin/python -m ml.train --input data/raw/india-2024.csv --no-replay
```

Official example endpoint:

```text
https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_India.csv
```

Availability varies by product/year. A 404, login page, rate-limit response, or Git LFS pointer is **not** converted to observations. The downloader fails rather than making a dataset up.

### Reproduce the bundled baseline using its explicitly disclosed mirror

The implementation obtained a NASA-format India S-NPP VIIRS archive from a public GitHub mirror. The pinned file contains January–March 2025, **not** the complete 2025 country archive.

- Repository: [UjjwalKumar7209/sih-2026](https://github.com/UjjwalKumar7209/sih-2026)
- Original file: [firms_historical_india.csv at the pinned commit](https://github.com/UjjwalKumar7209/sih-2026/blob/30ae6eb05c400b1d40aac7daa4c4a9bbceec667f/SIH_Industrial_Fire_AI/firms_historical_india.csv)
- Commit: `30ae6eb05c400b1d40aac7daa4c4a9bbceec667f`
- Source bytes: `24547074`
- SHA-256: `62b397c086bf1934010fd86987506e8aca45d74a9fc0270cd434128a9a9a3db6`
- Input rows: **316,036**; exact duplicates removed: **1**; valid rows: **316,035**.

Only the source data is reused and attributed. ThermoScan's application and pipeline are independently implemented. The mirror's bit-for-bit equivalence to a newly obtained official NASA archive has **not** been verified. The checksum establishes reproducibility of the chosen file, not independent proof of label correctness.

```bash
npm run data:download   # Explicit pinned mirror, no synthetic fallback.
npm run model:train    # Actual feature computation, XGBoost fit and holdouts.
```

Raw downloads are Git-ignored. A small gzip replay subset, fitted model and provenance reports are included so a fresh checkout can run the historical UI without a large dataset download.

## 3. What do the labels actually mean?

NASA's VIIRS inferred source-type field uses:

| NASA type | Meaning | ThermoScan treatment |
| --- | --- | --- |
| 0 | Presumed vegetation fire | `vegetation` source-type candidate |
| 1 | Active volcano | Unsupported by this India baseline; excluded explicitly |
| 2 | Other static land source | `static` source-type candidate, not a confirmed industrial fire |
| 3 | Offshore detection | `offshore` class evaluated, but serving abstains when validation is inadequate |

**Do not rename type 2 to “industrial fire confirmed”.** Static heat can be normal plant operation, a flare, or another persistent source. Type 0 does not distinguish forest fire from crop-residue burning. OSM proximity is not a verified label either.

NASA reported a Collection-2 monthly-location **type-field bug**, corrected in May 2025, and reprocessed the affected products. The mirror's reprocessing status is unverified. A simple `version=2` column identifies the collection and does not prove the monthly file's reprocessing revision. Use freshly reprocessed standard data and record the product provenance before scientific or operational use.

For an actual industrial-incident classifier, obtain independently verified incident records with event time/location, link them to satellite observations with documented uncertainty, review labels with domain experts, include normal-operation hard negatives, and keep incidents/facilities separated between train and test. Analyst notes in this prototype are **not** automatically promoted to ground-truth labels.

## 4. What the current model learns

The real baseline uses 17 thermal/temporal inputs:

- VIIRS I4 and I5 brightness temperatures and their difference.
- Log FRP, FRP per scan/track footprint, scan and track dimensions.
- Day/night flag, NASA confidence category, cyclical UTC overpass hour and day of year.
- Strictly prior detections and distinct prior active UTC dates within **750 m / 30 days**.
- Available history duration and a bounded recurrence fraction.

The NASA type target, exact latitude/longitude and any future observation are excluded from feature columns. Same-timestamp pixels do not count as past recurrence. Missing values stay missing. The same feature code runs at training and inference.

The NRT public feed supplies only seven days of history, so live recurrence coverage is shorter than the full archive. This domain difference is visible through coverage fields and is a model limitation. Satellite/cloud sampling is not a denominator for actual source uptime.

### Actual held-out results from the bundled model

The checked-in model card is the source of truth; retraining may update it.

| Measure | Bundled result |
| --- | --- |
| Training observations | 83,356 |
| Strict unseen-date + unseen-block holdout | 44,237 |
| Holdout macro-F1 | 0.6274 |
| Static-source F1 | 0.8862 |
| Overall accuracy | 0.9923 |
| Majority-class baseline accuracy | 0.9691 |
| Offshore recall in strict holdout | 0 / 8; not reliable |

Do **not** pitch the 99.2% accuracy as deployment readiness: the data is heavily imbalanced. The Model lab shows macro-F1, per-class precision/recall/F1/support, a real confusion matrix, and a majority-class comparison. Offshore/other classes with recall below 0.5 or fewer than 30 holdout examples trigger serving abstention. Any maximum model score below 0.65 also abstains. Scores have not been calibrated as incident probabilities.

Splitting uses a chronological cutoff plus 0.1-degree spatial groups. Held-out labels are not used for tuning. Unlabelled observations from before the prediction time may inform recurrence at a held-out location; this is disclosed in the model card. This is not a substitute for an external, incident-level benchmark.

## 5. Real near-real-time ingestion

The Express adapter fetches actual **NOAA-20, NOAA-21 and S-NPP** regional FIRMS CSVs. The source region is South Asia; dashboard regions are explicitly bounding-box areas, not authoritative state/country boundary filters.

Example public feed, without a key:

```text
https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_7d.csv
```

- Default source checks: every **15 minutes**; regional CSV publication: approximately hourly.
- Browser live-view polling: every minute, through the same-origin Express proxy.
- Original UTC acquisition times and fetch attempts/successes remain visible.
- A server restart can restore a previously fetched real cache, explicitly marked unverified/stale until checked.
- Live time windows anchor to the current clock. Historical time windows anchor to the source acquisition dates. Archived March 2025 pixels never become September 2026 detections.
- A failure of one satellite is shown as partial/degraded. Failure of all feeds does not replace live records with the historical dataset.

For NASA's area/date API, request your own free [MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/) and put it in `.env` as `FIRMS_MAP_KEY`. The server uses the key-based API when configured and may use only the real public NASA feed as its no-key alternative. The key is never sent to the browser.

## 6. Sentinel-2, OSM and population evidence

Inspect a map point and select **Fetch source evidence**.

### Sentinel-2

The implementation uses the public [Earth Search STAC API](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a), a catalog of Copernicus Sentinel-2 L2A imagery, and [public Sentinel cloud-optimized GeoTIFFs](https://registry.opendata.aws/sentinel-2-l2a-cogs/). This is a public access path to the Sentinel-2 data in the supplied slides, not synthetic imagery.

- Search on or before the detection, up to 60 days back.
- Check up to three recent candidate scenes with scene-level cloud fraction below 50%.
- Read real B04 (red), B08 (NIR), B11 (SWIR) and SCL raster windows.
- Respect the scene's radiometric scale and offset; do not guess absent calibration metadata.
- Reproject to a common 20 m grid across a 500 m supporting-context window.
- Mask clouds, shadow, snow, defective/nodata and unclassified pixels; require at least 30% usable coverage.
- Compute median per-pixel **NDVI = (NIR − Red)/(NIR + Red)** and **NDBI = (SWIR − NIR)/(SWIR + NIR)**.
- Return real scene ID, acquisition time, delay, source link and valid-pixel fraction.

Sentinel-2 has no thermal-infrared band. Its indices are optical context, not a live flame temperature. A catalog search success without readable COG pixels is not reported as a measured NDVI.

### OpenStreetMap

The [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) is queried for industrial land use, industrial tags, works/chimneys and power plants/generators within 1.5 km, plus selected nearby land-use tags. The connector computes projected distances to mapped geometries or explicitly identified point/center approximations. Relation-member geometries are simplified; these are investigation distances, not survey measurements. Successful queries with no industrial features are distinguished from failed queries. Current OSM is not historical ground truth.

### Optional WorldPop

Find a genuine **population count** raster at [WorldPop](https://hub.worldpop.org/), note its reference year, and configure:

```text
WORLDPOP_RASTER_URL=/absolute/path/to/your/population-count.tif
WORLDPOP_YEAR=2020
```

The year above is an example of configuration syntax, not a claim that such a raster has been loaded. The adapter sums valid cell counts whose centers lie inside 1 km and returns the year, radius and coverage. Do not point it at a population-density raster without converting units. Without configuration or valid raster data, exposure is **unknown**, not zero.

### Training an actually enriched model

When the source endpoints are reachable, the included CLI can request real contextual features for a stratified subset. This can be slow and subject to source quotas; it is not run silently when opening the dashboard.

```bash
.venv/bin/python -m ml.enrich \
  --input data/raw/india-viirs-2025.csv \
  --output data/raw/india-enriched.csv --limit 900 --interval 2

.venv/bin/python -m ml.train \
  --input data/raw/india-enriched.csv \
  --history-source data/raw/india-viirs-2025.csv \
  --with-context --no-replay
```

Missing context is stored as missing. An OSM distance feature is explicitly capped/censored at the search radius after a successful complete query, not an invented exact distance. Fusion training requires at least 60% measured/derived coverage for every context feature, 500 valid rows, 30 calendar days and usable independent-location holdouts. It fails clearly if those conditions are not met. Full history must be supplied when fitting a spatially subsampled enrichment archive, so recurrence does not get reset to the sample.

## 7. Run the application

Linux / Python 3.11+ / Node.js 22:

```bash
npm run setup
cp .env.example .env
npm run dev
```

Open port **3000** in the Arena live preview, or the locally served frontend in your own development environment. `npm run dev` starts Next.js, Express (4000), and Python inference (8000). The browser uses relative `/api/...` URLs. Backend service hostnames never appear in browser API calls.

For actual MongoDB, use the included Compose stack:

```bash
docker compose up --build
```

Only the frontend port is published. MongoDB, API and ML communicate on the private Compose network. Model artifacts, raw archives, imported files, review journals and database data have appropriate persistent volumes. Configure `ADMIN_API_KEY` and proper production identity/access controls before exposing mutations publicly.

## 8. What is not claimed

- No independently validated industrial-fire or forest-vs-crop classifier yet.
- No successful live NASA/OSM/Sentinel verification in this restricted network session.
- No fused-model metrics until an actual measured-context training run succeeds.
- No real MongoDB verification in this sandbox without an instance; local journal mode is explicit.
- No live population census, calibrated risk/exposure engine, SMS/email dispatcher, operational SLA, or emergency integration.
- No invented API keys, randomly placed hotspots, fabricated historical rows, or made-up model performance.

For implementation details, source links, deployment and tests, see the repository README and architecture notes.

### Evaluation versus serving policy

Reported holdout metrics are for the ungated classifier. Holdout recall/support are also used for a conservative class-abstention policy in the interface; that policy itself has not been independently tested on a third incident-level dataset. No model hyperparameters were selected on the reported holdout scores.
