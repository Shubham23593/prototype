"""Real OSM Overpass, Sentinel-2 STAC/COG and optional WorldPop connectors.

A network failure produces an explicit unavailable result, never plausible-looking
context, a made-up NDVI, or a zero population count.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
from typing import Any
import httpx
import ssl
import numpy as np

STAC_URL = "https://earth-search.aws.element84.com/v1"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "ThermoScan-research-prototype/0.1 (satellite-context; non-operational)"}
CACHE = Path(__file__).resolve().parents[1] / ".runtime/context"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def unavailable(source: str, exc: Exception) -> dict:
    return {"status": "unavailable", "source": source, "attempted_at": now(),
            "message": f"{type(exc).__name__}: the upstream source could not be queried. Check network access and source availability. No replacement data was generated."}


def _project(x, y, epsg):
    from rasterio.warp import transform
    return transform("EPSG:4326", f"EPSG:{epsg}", x, y)


def _utm(longitude: float, latitude: float) -> int:
    return (32600 if latitude >= 0 else 32700) + min(60, max(1, int((longitude + 180) // 6) + 1))


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def osm_context(latitude: float, longitude: float) -> dict:
    from shapely.geometry import Point, LineString, Polygon
    from shapely.ops import transform as shape_transform, unary_union
    source = "OpenStreetMap / Overpass API"
    query = f'''[out:json][timeout:20];(
      nwr(around:1500,{latitude},{longitude})["landuse"="industrial"];
      nwr(around:1500,{latitude},{longitude})["industrial"];
      nwr(around:1500,{latitude},{longitude})["man_made"~"^(works|chimney)$"];
      nwr(around:1500,{latitude},{longitude})["power"~"^(plant|generator)$"];
      way(around:750,{latitude},{longitude})["landuse"~"^(forest|farmland|orchard)$"];
    );out tags center geom;'''
    try:
        payload = None
        last_exc = None
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                with httpx.Client(verify=ssl.create_default_context(), timeout=httpx.Timeout(20, connect=6), headers=HEADERS) as client:
                    response = client.post(endpoint, data={"data": query})
                    response.raise_for_status()
                    payload = response.json()
                if payload.get("remark"):
                    raise ValueError("Overpass returned a partial query: " + str(payload["remark"])[:120])
                break
            except Exception as exc:
                last_exc = exc
                continue
        if payload is None:
            return unavailable(source, last_exc or Exception("All Overpass endpoints failed"))
        epsg = _utm(longitude, latitude)
        x, y = _project([longitude], [latitude], epsg)
        point = Point(x[0], y[0])
        features = []
        for element in payload.get("elements", []):
            tags = element.get("tags", {})
            pieces = []
            geometry_sets = [element.get("geometry", [])] + [member.get("geometry", []) for member in element.get("members", [])]
            for coordinates in geometry_sets:
                coords = [(p["lon"], p["lat"]) for p in coordinates if "lon" in p and "lat" in p]
                if len(coords) >= 4 and coords[0] == coords[-1]:
                    pieces.append(Polygon(coords).buffer(0))
                elif len(coords) >= 2:
                    pieces.append(LineString(coords))
            basis = "mapped geometry"
            if not pieces:
                center = element.get("center", element)
                if "lat" not in center or "lon" not in center:
                    continue
                pieces = [Point(center["lon"], center["lat"])]
                basis = "mapped point / center"
            geom = unary_union(pieces)
            projected = shape_transform(lambda a, b, z=None: _project(a, b, epsg), geom)
            distance = float(point.distance(projected))
            industrial = tags.get("landuse") == "industrial" or "industrial" in tags or tags.get("man_made") in ["works", "chimney"] or tags.get("power") in ["plant", "generator"]
            center = geom.centroid
            features.append({"id": f"{element['type']}/{element['id']}", "name": tags.get("name", "Unnamed mapped feature"),
                             "tags": tags, "industrial": industrial, "distance_m": round(distance, 1), "distance_basis": basis,
                             "contains_detection": bool(projected.covers(point)), "latitude": center.y, "longitude": center.x,
                             "url": f"https://www.openstreetmap.org/{element['type']}/{element['id']}"})
        features.sort(key=lambda feature: feature["distance_m"])
        industrial_features = [feature for feature in features if feature["industrial"]]
        power_plant = any(f["tags"].get("power") in ["plant", "generator"] for f in features)
        mine_or_quarry = any(f["tags"].get("landuse") in ["quarry", "mining"] or f["tags"].get("industrial") in ["mine", "quarry"] for f in features)
        industrial_landuse = any(f["tags"].get("landuse") == "industrial" for f in features)
        nearest_dist = industrial_features[0]["distance_m"] if industrial_features else None
        return {"status": "ready", "source": source, "fetched_at": now(), "snapshot_at": payload.get("osm3s", {}).get("timestamp_osm_base"),
                "radius_m": 1500, "features": features[:100], "total_features": len(features),
                "nearest_industrial": industrial_features[0] if industrial_features else None,
                "industrial_distance_m": nearest_dist,
                "industrial_within_1000m": sum(feature["distance_m"] <= 1000 for feature in industrial_features),
                "power_plant_nearby": power_plant,
                "mine_or_quarry_nearby": mine_or_quarry,
                "industrial_landuse_nearby": industrial_landuse,
                "note": "Current OSM snapshot, not historical ground truth. Proximity is context, not proof of an industrial fire. Mapping coverage varies."}
    except Exception as exc:
        return unavailable(source, exc)


def _sample_scene(item: dict, latitude: float, longitude: float) -> dict:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT
    epsg = _utm(longitude, latitude)
    x, y = _project([longitude], [latitude], epsg)
    width = 25
    transform = from_origin(x[0] - 250, y[0] + 250, 20, 20)
    arrays: dict[str, np.ndarray] = {}
    bands = {"red": "red", "nir": "nir", "swir": "swir16", "scl": "scl"}
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="15", GDAL_HTTP_CONNECTTIMEOUT="8", GDAL_HTTP_MAX_RETRY="1", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        for name, key in bands.items():
            asset = item["assets"][key]
            href = asset["href"]
            # COG URLs come from a fixed trusted STAC endpoint, not client input.
            if not href.startswith("https://sentinel-cogs.s3."):
                raise ValueError("Unexpected Sentinel asset host")
            with rasterio.open(href) as src:
                with WarpedVRT(src, crs=f"EPSG:{epsg}", transform=transform, width=width, height=width,
                               resampling=Resampling.nearest if name == "scl" else Resampling.bilinear) as vrt:
                    values = vrt.read(1, masked=True).astype(np.float64).filled(np.nan)
            if name != "scl":
                raster_band = asset.get("raster:bands", [{}])[0]
                if "scale" not in raster_band:
                    raise ValueError("Scene lacks radiometric scale metadata; refusing to guess reflectance")
                values = values * raster_band["scale"] + raster_band.get("offset", 0)
            arrays[name] = values
    # Conservative SCL mask: vegetation, bare soil and water only. Cloud, snow,
    # shadow, defective, nodata and unclassified pixels are excluded.
    valid = np.isin(arrays["scl"], [4, 5, 6])
    for key in ["red", "nir", "swir"]:
        valid &= np.isfinite(arrays[key]) & (arrays[key] >= 0)
    ndvi_denom = arrays["nir"] + arrays["red"]
    ndbi_denom = arrays["swir"] + arrays["nir"]
    valid &= (ndvi_denom > 0) & (ndbi_denom > 0)
    coverage = float(valid.mean())
    if coverage < 0.3:
        return {"status": "cloudy", "valid_pixel_fraction": coverage, "message": "Fewer than 30% clear, valid pixels in the 500 m context window."}
    ndvi = (arrays["nir"][valid] - arrays["red"][valid]) / ndvi_denom[valid]
    ndbi = (arrays["swir"][valid] - arrays["nir"][valid]) / ndbi_denom[valid]
    return {"status": "ready", "ndvi": float(np.median(ndvi)), "ndbi": float(np.median(ndbi)), "valid_pixel_fraction": coverage,
            "pixels_used": int(valid.sum()), "window_m": 500, "resolution_m": 20,
            "method": "Median per-pixel indices; STAC radiometric scale/offset; 20 m alignment; SCL 4/5/6 mask."}


def sentinel_context(latitude: float, longitude: float, acquired_at: str) -> dict:
    source = "Copernicus Sentinel-2 L2A / Earth Search"
    try:
        end = datetime.fromisoformat(acquired_at.replace("Z", "+00:00"))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        begin = end - timedelta(days=60)
        payload = {"collections": ["sentinel-2-l2a"], "intersects": {"type": "Point", "coordinates": [longitude, latitude]},
                   "datetime": f"{begin.isoformat()}/{end.isoformat()}", "limit": 6,
                   "query": {"eo:cloud_cover": {"lt": 50}}, "sortby": [{"field": "properties.datetime", "direction": "desc"}]}
        with httpx.Client(verify=ssl.create_default_context(), timeout=httpx.Timeout(20, connect=8), headers=HEADERS) as client:
            response = client.post(f"{STAC_URL}/search", json=payload)
            response.raise_for_status()
            scenes = response.json().get("features", [])
        if not scenes:
            msg = (
                f"Historical observation ({end.year}) precedes the Sentinel-2 mission (launched June 2015). No optical scenes exist for this timeframe."
                if end.year < 2015
                else "No qualifying scene in the 60 days before this detection. No spectral values were substituted."
            )
            return {"status": "no_scene", "source": source, "fetched_at": now(), "message": msg}
        failures = []
        for scene in scenes[:3]:
            meta = {"scene_id": scene["id"], "acquired_at": scene["properties"]["datetime"], "scene_cloud_percent": scene["properties"].get("eo:cloud_cover"),
                    "catalog_url": f"{STAC_URL}/collections/sentinel-2-l2a/items/{scene['id']}",
                    "thumbnail_url": scene.get("assets", {}).get("thumbnail", {}).get("href"),
                    "day_offset": round((end - datetime.fromisoformat(scene["properties"]["datetime"].replace("Z", "+00:00"))).total_seconds() / 86400, 1)}
            try:
                values = _sample_scene(scene, latitude, longitude)
                if values["status"] == "ready":
                    return {**meta, **values, "sentinel_available": True, "scene_day_offset": meta["day_offset"], "source": source, "fetched_at": now(), "note": "Optical context acquired on or before the hotspot. Sentinel-2 has no thermal-infrared band and is not a live temperature measurement."}
                failures.append({**meta, **values, "sentinel_available": False})
            except Exception as exc:
                failures.append({**meta, "status": "unavailable", "sentinel_available": False, "message": f"COG pixels could not be read ({type(exc).__name__}). Catalog metadata alone is not a spectral measurement."})
        return {"status": "unavailable" if any(item["status"] == "unavailable" for item in failures) else "cloudy", "sentinel_available": False, "source": source,
                "fetched_at": now(), "scenes_checked": failures, "message": "No readable, sufficiently clear scene among the three most recent candidates. NDVI and NDBI remain missing."}
    except Exception as exc:
        res = unavailable(source, exc)
        res["sentinel_available"] = False
        return res


def population_context(latitude: float, longitude: float) -> dict:
    url = os.getenv("WORLDPOP_RASTER_URL", "")
    if not url:
        return {"status": "not_configured", "source": "WorldPop", "message": "Configure a genuine population-count raster and reference year. No exposure estimate is shown without data."}
    try:
        import rasterio
        from rasterio.windows import from_bounds
        from rasterio.warp import transform_bounds
        from rasterio.transform import xy
        radius = 1000
        lat_delta = radius / 111320
        lon_delta = lat_delta / max(0.05, math.cos(math.radians(latitude)))
        with rasterio.Env(GDAL_HTTP_TIMEOUT="15", GDAL_HTTP_CONNECTTIMEOUT="8", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(url) as src:
                bounds = transform_bounds("EPSG:4326", src.crs, longitude - lon_delta, latitude - lat_delta, longitude + lon_delta, latitude + lat_delta)
                window = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
                if window.width * window.height > 250000:
                    raise ValueError("Population window too large")
                values = src.read(1, window=window, boundless=True, masked=True)
                rows, cols = np.indices(values.shape)
                xs, ys = xy(src.window_transform(window), rows.ravel(), cols.ravel())
                from rasterio.warp import transform
                lons, lats = transform(src.crs, "EPSG:4326", xs, ys)
        lat1 = np.radians(latitude)
        dlats = np.radians(np.asarray(lats) - latitude)
        dlons = np.radians(np.asarray(lons) - longitude)
        dist = 2 * 6371008.8 * np.arcsin(np.sqrt(np.sin(dlats / 2)**2 + np.cos(lat1) * np.cos(np.radians(lats)) * np.sin(dlons / 2)**2))
        inside = (dist <= radius).reshape(values.shape)
        valid = inside & ~np.ma.getmaskarray(values) & (values.filled(-1) >= 0)
        if not valid.any():
            raise ValueError("No valid population cells in this area")
        return {"status": "ready", "source": "WorldPop", "fetched_at": now(), "estimated_people": round(float(values[valid].sum())),
                "radius_m": radius, "reference_year": os.getenv("WORLDPOP_YEAR") or "unspecified", "valid_fraction": float(valid.sum() / max(inside.sum(), 1)),
                "note": "Sum of population-count cells with centers inside 1 km; modeled, year-specific exposure, not a live population or casualty count."}
    except Exception as exc:
        return unavailable("WorldPop", exc)


def get_context(latitude: float, longitude: float, acquired_at: str) -> dict[str, Any]:
    CACHE.mkdir(parents=True, exist_ok=True)
    import hashlib
    key = hashlib.sha256(f"{latitude:.5f},{longitude:.5f},{acquired_at},v1".encode()).hexdigest()
    cache_file = CACHE / f"{key}.json"
    if cache_file.exists() and datetime.now().timestamp() - cache_file.stat().st_mtime < 86400:
        return {**json.loads(cache_file.read_text()), "cached": True}
    with ThreadPoolExecutor(max_workers=3) as executor:
        osm = executor.submit(osm_context, latitude, longitude)
        sentinel = executor.submit(sentinel_context, latitude, longitude, acquired_at)
        population = executor.submit(population_context, latitude, longitude)
        result = {"osm": osm.result(), "sentinel": sentinel.result(), "population": population.result(), "cached": False}
    if result["osm"]["status"] == "ready" or result["sentinel"]["status"] == "ready":
        cache_file.write_text(json.dumps(result, allow_nan=False))
    return result
