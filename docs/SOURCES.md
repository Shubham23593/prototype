# Data attribution and access paths

No external application's implementation code was copied. The supplied slides informed the product and stack. The following actual data sources are used or implemented as explicit adapters.

1. **NASA FIRMS / LANCE / VIIRS** — near-real-time thermal detections and source-product documentation. Regional CSVs are normally published hourly and satellite observations have latency. [1](https://www.earthdata.nasa.gov/data/tools/firms/faq)
2. **NASA FIRMS Archive Download / Country-Year Summaries** — preferred source of standard-processing history; authenticate using your own Earthdata/email flow when required. [2](https://firms.modaps.eosdis.nasa.gov/download/)
3. **NASA Collection-2 source-type notice** — the monthly type-field bug and May 2025 reprocessing caveat are important for labels. [3](https://firms.modaps.eosdis.nasa.gov/active_fire/)
4. **Explicit historical mirror** — raw India Q1 2025 NASA-format data, attributed to `UjjwalKumar7209/sih-2026`, pinned at commit `30ae6eb05c400b1d40aac7daa4c4a9bbceec667f`. Only source observations are reused; authenticity/equivalence to a freshly reprocessed NASA country archive is not independently verified. [4](https://github.com/UjjwalKumar7209/sih-2026/blob/30ae6eb05c400b1d40aac7daa4c4a9bbceec667f/SIH_Industrial_Fire_AI/firms_historical_india.csv)
5. **Copernicus Sentinel-2 L2A via Earth Search / public COGs** — real optical imagery catalog and data access. Sentinel data are subject to the Sentinel legal notice; Element 84's public catalog is an access path, not a different sensor. [5](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
6. **OpenStreetMap contributors** — Overpass infrastructure/land-use context and optional OSM-derived CARTO basemap. Respect ODbL attribution and public service usage policies. [6](https://www.openstreetmap.org/copyright)
7. **Natural Earth** — bundled, public-domain low-resolution country geometries and populated-place locations, pinned to `ca96624a56bd078437bca8184e78163e5039ad19`. Properties are reduced; coordinates are not fabricated. Boundaries are illustrative, not authoritative. [7](https://www.naturalearthdata.com/about/terms-of-use/)
8. **WorldPop** — optional user-configured, year-specific population-count raster. No raster or estimate is bundled, and source licensing depends on the selected product. [8](https://hub.worldpop.org/)

Full download URLs, hashes, actual row counts, selection rules and timestamps are recorded in `data/provenance.json`, `data/replay/manifest.json` and `ml/artifacts/model-card.json`. A recorded checksum establishes reproducibility, not validation of an incident label.

Natural Earth geometry source: `https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19/geojson`. See `public/geo/NOTICE.txt`.

Live-provider failures and the absence of independent industrial-incident labels are intentionally visible in the dashboard and documentation.
