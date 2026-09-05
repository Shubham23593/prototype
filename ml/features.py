"""The *same* causal feature definitions are used in training and serving.

NASA type is a target, never a feature. No label, location ID, future observation,
or model-generated label is included in the feature vector.
"""
from __future__ import annotations

import math
from typing import Any
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

EARTH_KM = 6371.0088
HISTORY_RADIUS_KM = 0.75
HISTORY_WINDOW_DAYS = 30
THERMAL_FEATURES = [
    "bright_ti4", "bright_ti5", "temperature_delta", "log_frp", "frp_density",
    "scan", "track", "is_day", "confidence_score", "hour_sin", "hour_cos",
    "season_sin", "season_cos", "prior_detections_30d", "prior_active_days_30d",
    "history_coverage_days", "recurrence_fraction",
]
CONTEXT_FEATURES = [
    "ndvi", "ndbi", "valid_pixel_fraction", "scene_day_offset", "sentinel_available",
    "industrial_distance_m", "industrial_within_1000m", "power_plant_nearby",
    "mine_or_quarry_nearby", "industrial_landuse_nearby"
]
SIH_CLASSES = {
    "industrial": "Potential Industrial Fire",
    "forest": "Forest / Natural Fire",
    "agriculture": "Agricultural or Waste Burning",
    "persistent": "Persistent Thermal Source",
    "uncertain": "Other / Uncertain",
}
CLASS_NAMES = {0: "Presumed vegetation fire", 2: "Static thermal source", 3: "Offshore thermal source"}
CLASS_KEYS = {0: "vegetation", 2: "static", 3: "offshore"}


def normalize(frame: pd.DataFrame, require_labels: bool = False) -> tuple[pd.DataFrame, dict[str, Any]]:
    df = frame.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]
    # FIRMS's web archive sometimes uses MODIS-style column names for VIIRS data.
    for old, new in [("brightness", "bright_ti4"), ("bright_t31", "bright_ti5")]:
        if new not in df.columns and old in df.columns:
            df = df.rename(columns={old: new})
    required = ["latitude", "longitude", "bright_ti4", "bright_ti5", "frp", "scan", "track", "acq_date", "acq_time", "daynight", "confidence"]
    if require_labels:
        required += ["type"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing FIRMS columns: {', '.join(missing)}. Import a VIIRS CSV, not MODIS data.")
    original = len(df)
    for c in ["latitude", "longitude", "bright_ti4", "bright_ti5", "frp", "scan", "track"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    # acq_time is HHMM, not a decimal hour; leading zeroes are significant.
    times = df["acq_time"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
    valid_times = times.str.fullmatch(r"[0-2][0-9][0-5][0-9]") & (pd.to_numeric(times.str[:2], errors="coerce") < 24)
    df["acq_time"] = times
    df["acquired_at"] = pd.to_datetime(df["acq_date"].astype(str) + " " + times, format="%Y-%m-%d %H%M", utc=True, errors="coerce")
    df["daynight"] = df["daynight"].astype(str).str.upper()
    valid = (valid_times & df["acquired_at"].notna() & df["latitude"].between(-90, 90)
             & df["longitude"].between(-180, 180) & df["bright_ti4"].between(150, 600)
             & df["bright_ti5"].between(150, 600) & df["frp"].between(0, 100000)
             & df["scan"].between(0.1, 2) & df["track"].between(0.1, 2)
             & df["daynight"].isin(["D", "N"]))
    if "instrument" in df.columns:
        valid &= df["instrument"].astype(str).str.upper().eq("VIIRS")
    if require_labels:
        df["type"] = pd.to_numeric(df["type"], errors="coerce")
        valid &= df["type"].isin(CLASS_NAMES)
    if "satellite" not in df:
        df["satellite"] = "unknown"
    df = df[valid].copy()
    invalid = original - len(df)
    df = df.drop_duplicates(["latitude", "longitude", "acquired_at", "satellite"])
    duplicates = original - invalid - len(df)
    df = df.sort_values("acquired_at", kind="stable").reset_index(drop=True)
    if require_labels:
        df["type"] = df["type"].astype(int)
    return df, {"input_rows": original, "valid_rows": len(df), "invalid_or_unsupported_rows": invalid, "duplicates_removed": duplicates}


def add_history(query: pd.DataFrame, history: pd.DataFrame | None = None) -> pd.DataFrame:
    """Radius-neighbour recurrence, using observations strictly BEFORE each query.

    Observations from the same satellite overpass/timestamp do not count as past
    history. Coverage is elapsed *dataset* time, not an estimate of cloud-free
    satellite opportunities. Zero recurrence is never interpreted as no fire.
    """
    out = query.copy()
    source = query if history is None else history
    if source.empty or query.empty:
        for c in ["prior_detections_30d", "prior_active_days_30d", "history_coverage_days"]:
            out[c] = 0.0
        return out
    coords = np.radians(source[["latitude", "longitude"]].to_numpy(dtype=float))
    tree = BallTree(coords, metric="haversine")
    hist_seconds = source["acquired_at"].astype("int64").to_numpy() // 10**9
    query_seconds = query["acquired_at"].astype("int64").to_numpy() // 10**9
    day_numbers = hist_seconds // 86400
    counts = np.zeros(len(query), dtype=np.float32)
    days = np.zeros(len(query), dtype=np.float32)
    for start in range(0, len(query), 3000):
        points = np.radians(query.iloc[start:start + 3000][["latitude", "longitude"]].to_numpy(dtype=float))
        neighbours = tree.query_radius(points, r=HISTORY_RADIUS_KM / EARTH_KM)
        for offset, nearby in enumerate(neighbours):
            i = start + offset
            t = query_seconds[i]
            eligible = nearby[(hist_seconds[nearby] < t) & (hist_seconds[nearby] >= t - HISTORY_WINDOW_DAYS * 86400)]
            counts[i] = len(eligible)
            days[i] = len(np.unique(day_numbers[eligible]))
    out["prior_detections_30d"] = counts
    out["prior_active_days_30d"] = days
    out["history_coverage_days"] = np.clip((query_seconds - hist_seconds.min()) / 86400, 0, HISTORY_WINDOW_DAYS)
    return out


def feature_matrix(frame: pd.DataFrame, features: list[str] | None = None) -> pd.DataFrame:
    df = frame.copy()
    dt = df["acquired_at"]
    hours = dt.dt.hour + dt.dt.minute / 60
    df["temperature_delta"] = df["bright_ti4"] - df["bright_ti5"]
    df["log_frp"] = np.log1p(df["frp"].clip(lower=0))
    df["frp_density"] = df["frp"] / (df["scan"] * df["track"]).clip(lower=0.01)
    df["is_day"] = (df["daynight"] == "D").astype(float)
    # VIIRS confidence categories, not calibrated probabilities.
    df["confidence_score"] = df["confidence"].astype(str).str.lower().map({"l": 0, "low": 0, "n": 1, "nominal": 1, "h": 2, "high": 2})
    df["hour_sin"] = np.sin(2 * math.pi * hours / 24)
    df["hour_cos"] = np.cos(2 * math.pi * hours / 24)
    df["season_sin"] = np.sin(2 * math.pi * dt.dt.dayofyear / 365.25)
    df["season_cos"] = np.cos(2 * math.pi * dt.dt.dayofyear / 365.25)
    coverage = pd.to_numeric(df.get("history_coverage_days", pd.Series(0, index=df.index)), errors="coerce")
    days = pd.to_numeric(df.get("prior_active_days_30d", pd.Series(0, index=df.index)), errors="coerce")
    # Calendar date transitions can exceed elapsed fractional days; cap at one.
    df["recurrence_fraction"] = (days / coverage.clip(lower=1)).clip(0, 1)
    selected = features or THERMAL_FEATURES
    for c in selected:
        if c not in df:
            df[c] = np.nan  # Missing context stays missing, never fabricated.
    return df[selected].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).astype(np.float32)


def calculate_risk(frp: float, brightness: float, confidence: str, category: str,
                   dist_m: float | None = None, power_nearby: bool = False,
                   people: float | None = None, model_score: float | None = None) -> dict[str, Any]:
    """Calculate transparent risk: Hazard x Exposure x Confidence."""
    # 1. Hazard (0.1 to 1.0)
    cat_hazard = {
        "industrial": 0.85,
        "forest": 0.65,
        "agriculture": 0.40,
        "persistent": 0.35,  # Fixed, controlled furnace/flare is lower hazard than wild fire
        "uncertain": 0.25,
    }.get(category, 0.30)
    frp_factor = min(max(0.0, float(frp or 0)) / 60.0, 1.0) * 0.15
    temp_factor = min(max(0.0, float(brightness or 300) - 315) / 50.0, 1.0) * 0.10
    hazard = round(min(1.0, max(0.1, cat_hazard + frp_factor + temp_factor)), 3)

    # 2. Exposure (0.1 to 1.0)
    dist = float(dist_m) if dist_m is not None and not np.isnan(dist_m) else 1500.0
    if dist <= 500:
        base_exp = 0.90
    elif dist <= 1000:
        base_exp = 0.75
    elif dist <= 1500:
        base_exp = 0.50
    else:
        base_exp = 0.25
    if power_nearby:
        base_exp = min(1.0, base_exp + 0.15)
    if people is not None and not np.isnan(people) and people > 500:
        base_exp = min(1.0, base_exp + 0.15)
    exposure = round(min(1.0, max(0.1, base_exp)), 3)

    # 3. Confidence (0.3 to 1.0)
    conf_str = str(confidence).lower()
    conf_base = 0.95 if conf_str in ["h", "high"] else 0.75 if conf_str in ["n", "nominal"] else 0.50
    if model_score is not None and not np.isnan(model_score):
        conf_val = 0.5 * conf_base + 0.5 * float(model_score)
    else:
        conf_val = conf_base
    conf = round(min(1.0, max(0.3, conf_val)), 3)

    score = round(hazard * exposure * conf, 4)
    if score >= 0.70:
        level = "critical"
    elif score >= 0.45:
        level = "high"
    elif score >= 0.25:
        level = "medium"
    else:
        level = "low"

    factors = []
    if category == "industrial":
        factors.append("Proximity to mapped industrial facilities")
    if dist <= 1000:
        factors.append(f"Within {int(dist)} m of infrastructure")
    if power_nearby:
        factors.append("Critical power infrastructure nearby")
    if frp and frp > 25:
        factors.append(f"High thermal output ({frp:.1f} MW FRP)")
    if category == "persistent":
        factors.append("Known recurring thermal source")
    if not factors:
        factors.append("Standard baseline regional thermal activity")

    return {
        "score": score,
        "level": level,
        "hazard": hazard,
        "exposure": exposure,
        "confidence": conf,
        "factors": factors,
    }


def derive_sih_classification(raw_class: str, proba_dict: dict[str, float],
                              frp: float, brightness: float, active_days: float,
                              dist_m: float | None = None, ndvi: float | None = None,
                              ndbi: float | None = None, power_nearby: bool = False,
                              landuse_ind: bool = False, model_score: float | None = None) -> tuple[str, str, str]:
    """Derive one of the 5 SIH categories based on multi-source evidence.

    Returns (classKey, label, explanation).
    Categories:
    - industrial: Potential Industrial Fire
    - forest: Forest / Natural Fire
    - agriculture: Agricultural or Waste Burning
    - persistent: Persistent Thermal Source
    - uncertain: Other / Uncertain
    """
    dist = float(dist_m) if dist_m is not None and not np.isnan(dist_m) else 1500.0
    has_ind_context = dist <= 1000 or power_nearby or landuse_ind
    has_high_frp = (frp or 0) >= 12.0 or (brightness or 0) >= 335.0
    is_persistent = (active_days or 0) >= 8 or raw_class in ["static", "persistent"]
    ndvi_val = float(ndvi) if ndvi is not None and not np.isnan(ndvi) else None
    ndbi_val = float(ndbi) if ndbi is not None and not np.isnan(ndbi) else None

    # Condition 1: Persistent Thermal Source
    if is_persistent and (active_days or 0) >= 6:
        label = "Persistent Thermal Source"
        exp = f"Observed active across {int(active_days)} calendar dates in 30 days. Consistent with a furnace, flare stack, kiln, or fixed facility heat signature."
        return "persistent", label, exp

    # Condition 2: Potential Industrial Fire
    # Near industrial infrastructure with sudden acute thermal spike and low-to-moderate recurrence
    if has_ind_context and (has_high_frp or (ndbi_val is not None and ndbi_val > 0.05)) and (active_days or 0) <= 6:
        label = "Potential Industrial Fire"
        exp = f"Detected {int(dist)} m from mapped infrastructure with high thermal intensity ({frp:.1f} MW FRP, {brightness:.1f} K). Provisional industrial fire candidate requiring verification."
        return "industrial", label, exp

    # Condition 3: Forest / Natural Fire
    # Rural vegetation with high NDVI or natural fire signature, away from industrial centers
    if not has_ind_context and ((ndvi_val is not None and ndvi_val >= 0.35) or raw_class in ["vegetation", "forest"]):
        if (frp or 0) >= 15.0 or (ndvi_val is not None and ndvi_val >= 0.45):
            label = "Forest / Natural Fire"
            ndvi_detail = f"NDVI {ndvi_val:.2f}" if ndvi_val is not None else "vegetation cover"
            exp = f"Located in natural vegetation ({ndvi_detail}) without nearby industrial facilities. Profile matches forest or wildland burning."
            return "forest", label, exp

    # Condition 4: Agricultural or Waste Burning
    # Moderate/low FRP, agricultural / open land, low recurrence
    if not has_ind_context and (active_days or 0) <= 3 and (frp or 0) < 25.0:
        label = "Agricultural or Waste Burning"
        exp = f"Short-duration thermal detection ({frp:.1f} MW FRP) with low recurrence in open rural terrain. Characteristic of seasonal crop-residue or waste burning."
        return "agriculture", label, exp

    # Fallback to model probability if available
    if model_score is not None and model_score < 0.60:
        return "uncertain", "Other / Uncertain", "Model score below confidence threshold; insufficient contextual evidence to confirm classification."

    if raw_class in ["static", "persistent"]:
        return "persistent", "Persistent Thermal Source", "Recurring thermal activity consistent with fixed infrastructure heat output."
    elif raw_class in ["vegetation", "forest"]:
        return "forest", "Forest / Natural Fire", "Thermal anomaly in open terrain consistent with vegetation fire."

    return "uncertain", "Other / Uncertain", "Provisional classification; independent ground verification required."

