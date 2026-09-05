"""Request actual Sentinel-2 and OSM context for a bounded historical subset.

This performs real network requests and can take a long time. No zero-valued
spectral placeholders are generated. Failures are saved as missing values with
explicit statuses. Use the original complete archive as --history-source when
training a subsampled enrichment file.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
import pandas as pd
from ml.features import normalize
from ml.connectors import osm_context, sentinel_context


def enrich(input_path: Path, output: Path, limit: int = 900, interval: float = 2) -> dict:
    if limit < 1 or limit > 10000 or interval < 1:
        raise ValueError("Use a bounded limit of 1–10,000 and at least one second between records. Respect public API quotas.")
    data, _ = normalize(pd.read_csv(input_path, low_memory=False), require_labels=True)
    groups = [group.sample(min(len(group), math.ceil(limit / data['type'].nunique())), random_state=42) for _, group in data.groupby('type')]
    selected = pd.concat(groups).sort_values('acquired_at').head(limit).reset_index(drop=True)
    for col in ["ndvi", "ndbi", "industrial_distance_capped_m", "industrial_within_1000m"]:
        selected[col] = np.nan
    for col in ["osm_status", "sentinel_status", "sentinel_scene_id", "sentinel_acquired_at"]:
        selected[col] = pd.Series(["not_requested"] * len(selected), dtype=object)
    output.parent.mkdir(parents=True, exist_ok=True)
    failures = 0
    requested = 0
    for i, row in selected.iterrows():
        print(f"Context {i + 1}/{len(selected)}: actual observation {row['latitude']}, {row['longitude']}, {row['acquired_at']}", flush=True)
        with ThreadPoolExecutor(max_workers=2) as executor:
            osm_future = executor.submit(osm_context, float(row['latitude']), float(row['longitude']))
            sentinel_future = executor.submit(sentinel_context, float(row['latitude']), float(row['longitude']), row['acquired_at'].isoformat())
            osm, sentinel = osm_future.result(), sentinel_future.result()
        requested += 1
        selected.loc[i, 'osm_status'] = osm['status']
        selected.loc[i, 'sentinel_status'] = sentinel['status']
        if osm['status'] == 'ready':
            # A *successful*, complete query can report no mapped infrastructure.
            # 1500 here is explicitly a capped/censored feature, NOT an invented
            # exact distance. The raw context endpoint retains None for no match.
            selected.loc[i, 'industrial_distance_capped_m'] = min(float(osm['industrial_distance_m']), 1500) if osm.get('industrial_distance_m') is not None else 1500
            selected.loc[i, 'industrial_within_1000m'] = osm['industrial_within_1000m']
        if sentinel['status'] == 'ready':
            selected.loc[i, 'ndvi'] = sentinel['ndvi']
            selected.loc[i, 'ndbi'] = sentinel['ndbi']
            selected.loc[i, 'sentinel_scene_id'] = sentinel['scene_id']
            selected.loc[i, 'sentinel_acquired_at'] = sentinel['acquired_at']
        failures = failures + 1 if osm['status'] == 'unavailable' and sentinel['status'] == 'unavailable' else 0
        if (i + 1) % 10 == 0 or failures >= 5:
            selected.drop(columns=['acquired_at']).to_csv(output, index=False)
        if failures >= 5:
            print('Stopping after five consecutive upstream failures. Missing context stays missing.', flush=True)
            break
        time.sleep(interval)
    selected.drop(columns=['acquired_at']).to_csv(output, index=False)
    metadata = {"name": output.name, "primary_source": "User-supplied FIRMS observations enriched with real OSM / Sentinel queries",
                "primary_url": "https://firms.modaps.eosdis.nasa.gov/download/", "download_url": "https://earth-search.aws.element84.com/v1",
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "parent_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
                "retrieved_at": datetime.now(timezone.utc).isoformat(), "bytes": output.stat().st_size,
                "selection": f"Seed-42 stratified source rows; no resampling with replacement; limit {limit}",
                "requested": requested, "rows": len(selected), "coverage": selected[["ndvi", "ndbi", "industrial_distance_capped_m", "industrial_within_1000m"]].notna().mean().to_dict(),
                "notes": ["OSM is current, not a historical map snapshot. No independent industrial incident labels have been added.",
                          "industrial_distance_capped_m is censored at 1500 m after successful OSM queries. Missing queries are NaN.",
                          "Pass the original complete FIRMS CSV as --history-source for causal recurrence when training this spatial subset."]}
    output.with_suffix('.provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))
    if failures >= 5:
        raise RuntimeError("Enrichment incomplete due to unavailable real sources. Partial CSV and provenance are saved, not a fabricated complete dataset.")
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=900)
    parser.add_argument('--interval', type=float, default=2)
    args = parser.parse_args()
    enrich(args.input, args.output, args.limit, args.interval)
