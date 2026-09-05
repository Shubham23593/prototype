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
CONTEXT_FEATURES = ["ndvi", "ndbi", "industrial_distance_capped_m", "industrial_within_1000m"]
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
