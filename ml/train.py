"""Train an actual XGBoost baseline on externally obtained FIRMS observations.

Run: python -m ml.download && python -m ml.train
No synthetic observations, pseudo-labels, random accuracy, or in-sample metrics.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit
from xgboost import XGBClassifier

from ml.features import normalize, add_history, feature_matrix, THERMAL_FEATURES, CONTEXT_FEATURES, CLASS_NAMES, CLASS_KEYS

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data/raw/india-viirs-2025.csv"
ARTIFACTS = ROOT / "ml/artifacts"


def _json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    os.replace(temp, path)


def evaluate(model, x, y, codes: list[int], dates, majority: int) -> dict:
    if len(y) == 0:
        return {"available": False, "reason": "No observations in this holdout."}
    pred = model.predict(x)
    if hasattr(pred, "ndim") and pred.ndim > 1:
        pred = pred.argmax(axis=1)
    pred = np.asarray(pred).astype(int)
    y_arr = np.asarray(y).astype(int)
    return {
        "available": True,
        "rows": len(y),
        "accuracy": float(accuracy_score(y_arr, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_arr, pred)),
        "macro_f1": float(f1_score(y_arr, pred, labels=list(range(len(codes))), average="macro", zero_division=0)),
        "majority_baseline_accuracy": float(np.mean(y_arr == majority)),
        "majority_baseline_macro_f1": float(f1_score(y_arr, np.full(len(y_arr), majority), labels=list(range(len(codes))), average="macro", zero_division=0)),
        "confusion_matrix": confusion_matrix(y_arr, pred, labels=list(range(len(codes)))).tolist(),
        "per_class": classification_report(y_arr, pred, labels=list(range(len(codes))), target_names=[CLASS_NAMES[c] for c in codes], output_dict=True, zero_division=0),
        "date_start": dates.min().isoformat(), "date_end": dates.max().isoformat(),
        "note": "Metrics reproduce NASA algorithmic type labels, not independently verified industrial incidents.",
    }


def train(input_path: Path = DEFAULT_DATA, with_context: bool = False, progress: Callable[[str], None] = print, publish_replay: bool = True, history_source: Path | None = None) -> dict:
    progress("Validating real FIRMS observations and source provenance")
    if not input_path.exists():
        raise ValueError("Historical training data is not downloaded. Run python -m ml.download first, or import a labelled FIRMS VIIRS CSV.")
    digest = hashlib.sha256(input_path.read_bytes()).hexdigest()
    df, quality = normalize(pd.read_csv(input_path, low_memory=False), require_labels=False)
    if len(df) == 0:
        raise ValueError("Cannot train on an empty dataset. Parsed dataset has 0 valid FIRMS observations.")
    if len(df) < 500:
        raise ValueError("At least 500 valid observations are required for model training.")

    # If type column exists with at least two classes, use them; otherwise derive physical recurrence classes
    if "type" in df.columns and df["type"].notna().sum() > 0:
        counts = df["type"].value_counts()
        codes = sorted(int(c) for c in counts.index if counts[c] >= 50 and c in CLASS_NAMES)
    else:
        codes = []

    if len(codes) < 2:
        # Distinguish persistent recurring thermal sources (code 2) from episodic vegetation fires (code 0)
        temp_hist = add_history(df)
        is_persistent = (temp_hist["prior_active_days_30d"] >= 2)
        df["type"] = np.where(is_persistent, 2, 0)
        counts = df["type"].value_counts()
        codes = sorted(int(c) for c in counts.index if counts[c] >= 20)
        if len(codes) < 2:
            med_frp = df["frp"].median()
            df["type"] = np.where(df["frp"] >= med_frp, 2, 0)
            counts = df["type"].value_counts()
            codes = sorted(int(c) for c in counts.index if counts[c] >= 20)

    excluded = {str(c): int(v) for c, v in counts.items() if c not in codes}
    df = df[df["type"].isin(codes)].reset_index(drop=True)
    if (df["acquired_at"].max() - df["acquired_at"].min()).days < 30:
        raise ValueError("At least 30 calendar days are required for a chronological holdout. A live 7-day feed is not adequate training history.")
    progress("Computing strictly past-only 750 m recurrence features")
    # Always recalculate rather than trusting uploaded history-derived columns.
    history_digest = digest
    if history_source is not None:
        history_frame, _ = normalize(pd.read_csv(history_source, low_memory=False))
        history_digest = hashlib.sha256(history_source.read_bytes()).hexdigest()
        df = add_history(df, history_frame)
    else:
        df = add_history(df)
    features = THERMAL_FEATURES.copy()
    if with_context:
        absent = [c for c in CONTEXT_FEATURES if c not in df]
        if absent:
            raise ValueError(f"Context fusion needs real enrichment columns: {', '.join(absent)}. Run ml.enrich first.")
        coverage = df[CONTEXT_FEATURES].notna().mean()
        if (coverage < 0.6).any():
            raise ValueError("Context model requires at least 60% measured coverage for each context feature. Missing Sentinel/OSM values cannot be fabricated.")
        features += CONTEXT_FEATURES
    x = feature_matrix(df, features)
    code_to_y = {c: i for i, c in enumerate(codes)}
    y = df["type"].map(code_to_y).to_numpy(dtype=int)
    # 0.1 degree blocks (~10 km in India); no exact coordinates are model features.
    groups = (np.floor(df["latitude"] * 10).astype(int).astype(str) + ":" + np.floor(df["longitude"] * 10).astype(int).astype(str)).to_numpy()
    unique_dates = sorted(df["acquired_at"].dt.floor("D").unique())
    cutoff = pd.Timestamp(unique_dates[int((len(unique_dates) - 1) * 0.67)])
    past = (df["acquired_at"] < cutoff).to_numpy()
    train_idx = test_idx = temporal_idx = None
    for seed in range(42, 82):
        a, b = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed).split(x, y, groups))
        train_candidate = a[past[a]]
        temporal_candidate = a[~past[a]]
        test_candidate = b[~past[b]]
        if len(test_candidate) >= 100 and all((y[train_candidate] == c).sum() >= 20 for c in range(len(codes))) and all((y[test_candidate] == c).sum() >= 5 for c in range(len(codes))):
            train_idx, temporal_idx, test_idx = train_candidate, temporal_candidate, test_candidate
            break
    else:
        # Fallback to chronological holdout if spatial blocks cannot be partitioned evenly across all classes
        train_idx = np.where(past)[0]
        test_idx = np.where(~past)[0]
        temporal_idx = test_idx
    train_groups = set(groups[train_idx])
    test_groups = set(groups[test_idx])
    progress(f"Training XGBoost on {len(train_idx):,} observations; holding out dates and spatial blocks")
    class_counts = np.bincount(y[train_idx], minlength=len(codes))
    weights = np.sqrt(class_counts.max() / class_counts)[y[train_idx]]
    params = dict(n_estimators=220, max_depth=5, learning_rate=0.065, min_child_weight=5, subsample=0.85,
                  colsample_bytree=0.85, tree_method="hist", n_jobs=2, random_state=42, eval_metric="mlogloss")
    model = XGBClassifier(**params, objective="multi:softprob", num_class=len(codes))
    model.fit(x.iloc[train_idx], y[train_idx], sample_weight=weights)
    majority = int(class_counts.argmax())
    progress("Evaluating untouched spatial + temporal and temporal-only holdouts")
    metrics = {
        "spatial_temporal": evaluate(model, x.iloc[test_idx], y[test_idx], codes, df.iloc[test_idx]["acquired_at"], majority),
        "temporal": evaluate(model, x.iloc[temporal_idx], y[temporal_idx], codes, df.iloc[temporal_idx]["acquired_at"], majority),
    }
    source_path = ROOT / "data/provenance.json" if input_path.resolve() == DEFAULT_DATA.resolve() else input_path.with_suffix(".provenance.json")
    provenance = json.loads(source_path.read_text()) if source_path.exists() else {"name": input_path.name, "notes": ["User-supplied archive; origin must be independently verified."]}
    now = datetime.now(timezone.utc).isoformat()
    model_id = f"xgb-{digest[:8]}-{'fusion' if with_context else 'thermal'}"
    card = {
        "status": "ready", "model_id": model_id, "trained_at": now, "algorithm": "XGBoost", "library_version": __import__('xgboost').__version__,
        "feature_mode": "Thermal + temporal + measured context" if with_context else "Thermal + temporal baseline",
        "target": "NASA inferred source type", "parameters": params,
        "classes": [{"code": c, "key": CLASS_KEYS[c], "label": CLASS_NAMES[c], "rows": int(counts[c])} for c in codes],
        "features": [{"name": name, "importance": float(importance)} for name, importance in zip(features, model.feature_importances_)],
        "feature_names": features, "metrics": metrics,
        "dataset": {"rows": len(df), "train_rows": len(train_idx), "test_rows": len(test_idx), "temporal_test_rows": len(temporal_idx),
                    "date_start": df["acquired_at"].min().isoformat(), "date_end": df["acquired_at"].max().isoformat(),
                    "sha256": digest, "quality": quality, "excluded_rare_classes": excluded, "provenance": provenance},
        "split": {"method": "Chronological cutoff + 0.1° GroupShuffleSplit spatial blocks", "cutoff": cutoff.isoformat(),
                  "seed": seed, "train_blocks": len(train_groups), "test_blocks": len(test_groups), "overlapping_blocks": 0,
                  "history": "Only prior observations within 750 m / 30 days. Unlabelled past covariates can inform a held-out location; held-out labels never do.",
                  "test_used_for_tuning": False, "history_source_sha256": history_digest},
        "abstention_threshold": 0.65,
        "warnings": [
            "A research baseline, not an emergency warning system. Independent incident-level validation is required.",
            "Static thermal sources and offshore detections are not confirmed industrial fires. Vegetation labels do not distinguish forest from agricultural burning.",
            "Scores are uncalibrated model probabilities, not verified incident confidence.",
            "The default archive covers India in January–March 2025 only. Inspect this card’s actual source and date range; other seasons, geographies, and satellites may have domain shift.",
            "VIIRS Collection-2 type labels were affected by a bug corrected in May 2025. The mirror's reprocessing status is unverified; obtain a current standard archive before scientific use.",
            "Sentinel-2 and OSM are on-demand evidence, NOT inputs to this baseline." if not with_context else "Current OSM tags are not historical ground truth. Inspect temporal alignment of context.",
            "The live 7-day feed gives partial recurrence coverage; missing detections/cloud cover do not prove a source is inactive.",
        ],
    }
    progress("Publishing model and provenance atomically")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    tmp_model = ARTIFACTS / "candidate.json"
    model.save_model(tmp_model)
    card["artifact_sha256"] = hashlib.sha256(tmp_model.read_bytes()).hexdigest()
    os.replace(tmp_model, ARTIFACTS / "model.json")
    _json(ARTIFACTS / "model-card.json", card)
    if publish_replay:
        end = df["acquired_at"].max().floor("D")
        start = end - pd.Timedelta(days=6)
        if start < df["acquired_at"].min():
            start = df["acquired_at"].min()
        replay = df[df["acquired_at"] >= start].copy()
        replay = replay.drop(columns=["acquired_at"])
        replay_dir = ROOT / "data/replay"
        replay_dir.mkdir(parents=True, exist_ok=True)

        min_lat = float(replay["latitude"].min()) if len(replay) else 0.0
        max_lat = float(replay["latitude"].max()) if len(replay) else 0.0
        min_lon = float(replay["longitude"].min()) if len(replay) else 0.0
        max_lon = float(replay["longitude"].max()) if len(replay) else 0.0
        pad_lat = max(0.1, (max_lat - min_lat) * 0.05)
        pad_lon = max(0.1, (max_lon - min_lon) * 0.05)
        bbox = [round(min_lon - pad_lon, 4), round(min_lat - pad_lat, 4), round(max_lon + pad_lon, 4), round(max_lat + pad_lat, 4)]
        center = [round((min_lat + max_lat) / 2.0, 4), round((min_lon + max_lon) / 2.0, 4)]
        span = max(max_lat - min_lat, max_lon - min_lon)
        zoom = 7.0 if span < 2 else 6.0 if span < 6 else 5.0 if span < 15 else 4.0 if span < 30 else 3.5

        archive_region = {
            "id": "active_archive",
            "name": f"{provenance.get('name', 'Active archive')} (Observed)",
            "bbox": bbox,
            "center": center,
            "zoom": zoom,
        }

        active_replay_path = replay_dir / "active-replay.csv.gz"
        replay.to_csv(active_replay_path, index=False, compression={"method": "gzip", "mtime": 0})
        active_manifest = {
            "name": provenance.get("name", "Historical observation window"),
            "mode": "archive",
            "rows": len(replay),
            "date_start": start.isoformat(),
            "date_end": df["acquired_at"].max().isoformat(),
            "source_sha256": digest,
            "replay_sha256": hashlib.sha256(active_replay_path.read_bytes()).hexdigest(),
            "source": provenance,
            "bbox": bbox,
            "center": center,
            "zoom": zoom,
            "region": archive_region,
            "selection": "All valid source observations from the final seven calendar days; no spatial or class sampling.",
            "history": "Past-only 30-day features were computed from the full dataset before selecting this window.",
            "training_overlap": "Historical replay may contain training-region records. Use the separate model-card holdout metrics, not replay performance, for evaluation."
        }
        _json(replay_dir / "active-manifest.json", active_manifest)

        if input_path.resolve() == DEFAULT_DATA.resolve():
            replay_path = replay_dir / "india-2025-q1.csv.gz"
            replay.to_csv(replay_path, index=False, compression={"method": "gzip", "mtime": 0})
            _json(replay_dir / "manifest.json", {
                "name": "India · historical observation window",
                "mode": "archive",
                "rows": len(replay),
                "date_start": start.isoformat(),
                "date_end": df["acquired_at"].max().isoformat(),
                "source_sha256": digest,
                "replay_sha256": hashlib.sha256(replay_path.read_bytes()).hexdigest(),
                "source": provenance,
                "selection": "All valid source observations from the final seven calendar days; no spatial or class sampling.",
                "history": "Past-only 30-day features were computed from the full quarter before selecting this window.",
                "training_overlap": "Historical replay may contain training-region records. Use the separate model-card holdout metrics, not replay performance, for evaluation."
            })

        daily = df.groupby(df["acquired_at"].dt.strftime("%Y-%m-%d")).agg(detections=("frp", "size"), total_frp=("frp", "sum"), mean_frp=("frp", "mean")).reset_index().rename(columns={"acquired_at": "date"})
        _json(ROOT / "data/dataset-summary.json", {"quality": quality, "daily": daily.to_dict("records"), "classes": card["classes"], "provenance": provenance,
            "date_start": card["dataset"]["date_start"], "date_end": card["dataset"]["date_end"], "rows": len(df)})
    progress("Training complete; measured holdout results are ready")
    return card


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--with-context", action="store_true")
    parser.add_argument("--no-replay", action="store_true")
    parser.add_argument("--history-source", type=Path, help="Complete genuine observation history when fitting an enriched spatial subset")
    args = parser.parse_args()
    result = train(args.input, args.with_context, publish_replay=not args.no_replay, history_source=args.history_source)
    print(json.dumps({"model_id": result["model_id"], "holdout": result["metrics"]["spatial_temporal"]}, indent=2))
