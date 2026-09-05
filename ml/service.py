"""Internal Python service behind the Express API. Model artifacts are JSON, never pickle."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import JSONResponse
import os
import hmac
from pydantic import BaseModel, Field
import pandas as pd
import httpx
import ssl
from xgboost import XGBClassifier
from ml.features import normalize, feature_matrix, add_history, CONTEXT_FEATURES
from ml.connectors import get_context, STAC_URL, HEADERS
from ml.train import ROOT, ARTIFACTS, DEFAULT_DATA, train

app = FastAPI(title="ThermoScan ML", version="0.1.0", description="NASA source-type research baseline; not a verified incident classifier.")
lock = threading.RLock()
current_model: XGBClassifier | None = None
current_card: dict[str, Any] | None = None
current_mtime = 0.0
jobs: dict[str, dict] = {}

@app.middleware("http")
async def internal_authorization(request: Request, call_next):
    key = os.getenv("INTERNAL_SERVICE_KEY") or os.getenv("ADMIN_API_KEY")
    if key and request.url.path not in ["/", "/health"] and not hmac.compare_digest(request.headers.get("x-service-key", ""), key):
        return JSONResponse({"detail": "Internal service authentication required"}, status_code=401)
    return await call_next(request)


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def load_model():
    global current_model, current_card, current_mtime
    card_file, model_file = ARTIFACTS / "model-card.json", ARTIFACTS / "model.json"
    if not card_file.exists() or not model_file.exists():
        raise HTTPException(503, "No trained model artifact. Download historical data and run ml.train; no fallback predictions will be invented.")
    with lock:
        mtime = card_file.stat().st_mtime
        if current_model is None or mtime != current_mtime:
            card = json.loads(card_file.read_text())
            actual_sha = hashlib.sha256(model_file.read_bytes()).hexdigest()
            if actual_sha != card.get("artifact_sha256"):
                raise HTTPException(503, "Model artifact checksum mismatch or model publication in progress. Retry after training completes.")
            model = XGBClassifier()
            model.load_model(model_file)
            if list(model.get_booster().feature_names or []) != card["feature_names"]:
                raise HTTPException(503, "Model feature schema does not match its card")
            current_model, current_card, current_mtime = model, card, mtime
        return current_model, current_card


@app.get("/")
def root():
    return {"service": "ThermoScan ML", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    try:
        _, card = load_model()
        return {"status": "ready", "model_id": card["model_id"], "feature_mode": card["feature_mode"], "trained_at": card["trained_at"]}
    except HTTPException as exc:
        return {"status": "unavailable", "message": exc.detail}


@app.get("/model")
def model_card():
    _, card = load_model()
    return card


class PredictionRequest(BaseModel):
    observations: list[dict[str, Any]] = Field(min_length=1, max_length=80000)
    use_precomputed_history: bool = False


@app.post("/predict")
def predict(request: PredictionRequest):
    model, card = load_model()
    try:
        df, quality = normalize(pd.DataFrame(request.observations))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if df.empty:
        return {"predictions": [], "quality": quality, "model_id": card["model_id"]}
    if not request.use_precomputed_history or not all(c in df for c in ["prior_detections_30d", "prior_active_days_30d", "history_coverage_days"]):
        df = add_history(df)
    for column in ["prior_detections_30d", "prior_active_days_30d", "history_coverage_days"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
        if df[column].isna().any() or (df[column] < 0).any():
            raise HTTPException(422, "Precomputed history contains invalid values; recompute from genuine past observations.")
    x = feature_matrix(df, card["feature_names"])
    with lock:
        probabilities = model.predict_proba(x)
    results = []
    threshold = card["abstention_threshold"]
    report = card["metrics"]["spatial_temporal"]["per_class"]
    for i, (_, row) in enumerate(df.iterrows()):
        context_required = [c for c in card["feature_names"] if c in CONTEXT_FEATURES]
        if context_required and x.iloc[i][context_required].isna().any():
            results.append({"id": str(row.get("id", row.name)), "classKey": "unclassified", "label": "Context required for fused model",
                            "score": None, "modelId": card["model_id"], "featureMode": card["feature_mode"], "probabilities": [],
                            "abstentionReason": "Required measured Sentinel/OSM context is missing. Fetch evidence before scoring this fused model.",
                            "history": {"detections": int(row["prior_detections_30d"]), "activeDays": int(row["prior_active_days_30d"]), "coverageDays": round(float(row["history_coverage_days"]), 2)}})
            continue
        values = probabilities[i]
        best = int(values.argmax())
        definition = card["classes"][best]
        score = float(values[best])
        class_result = report.get(definition["label"], {})
        poorly_validated = class_result.get("recall", 0) < 0.5 or class_result.get("support", 0) < 30
        abstain = score < threshold or poorly_validated
        key = "uncertain" if abstain else definition["key"]
        label = "Needs investigation" if abstain else {"vegetation": "Vegetation fire candidate", "static": "Static source candidate", "offshore": "Offshore source candidate"}[key]
        results.append({"id": str(row.get("id", row.name)), "classKey": key, "rawClassKey": definition["key"], "label": label,
                        "score": round(score, 6), "modelId": card["model_id"], "featureMode": card["feature_mode"],
                        "abstentionReason": "Insufficient held-out evidence for this class" if poorly_validated else "Model score below 0.65" if score < threshold else None,
                        "probabilities": [{"key": item["key"], "label": item["label"], "score": round(float(values[j]), 6)} for j, item in enumerate(card["classes"])],
                        "history": {"detections": int(row["prior_detections_30d"]), "activeDays": int(row["prior_active_days_30d"]), "coverageDays": round(float(row["history_coverage_days"]), 2)}})
    return {"predictions": results, "quality": quality, "model_id": card["model_id"]}


class ContextRequest(BaseModel):
    latitude: float = Field(ge=-80, le=84)
    longitude: float = Field(ge=-180, le=180)
    acquired_at: datetime


@app.post("/context")
def context(request: ContextRequest):
    return get_context(request.latitude, request.longitude, request.acquired_at.isoformat())


class TrainRequest(BaseModel):
    dataset_id: str = "default"
    with_context: bool = False


def dataset_path(dataset_id: str) -> Path:
    if dataset_id == "default":
        return DEFAULT_DATA
    if not __import__('re').fullmatch(r"[a-f0-9-]{36}", dataset_id):
        raise HTTPException(422, "Invalid dataset identifier")
    return ROOT / "data/uploads" / f"{dataset_id}.csv"


def train_job(job_id: str, request: TrainRequest):
    def update(message: str):
        with lock:
            jobs[job_id].update(message=message, updated_at=timestamp())
    try:
        path = dataset_path(request.dataset_id)
        if request.dataset_id == "default" and not path.exists():
            update("Downloading the pinned historical FIRMS mirror and verifying its checksum")
            from ml.download import download
            download()
        with lock:
            jobs[job_id]["status"] = "running"
        card = train(path, with_context=request.with_context, progress=update, publish_replay=False)
        load_model()
        with lock:
            jobs[job_id].update(status="completed", completed_at=timestamp(), model_id=card["model_id"], message="Model published with measured holdout metrics")
    except Exception as exc:
        with lock:
            jobs[job_id].update(status="failed", completed_at=timestamp(), message=str(exc)[:700])


@app.post("/train", status_code=202)
def start_training(request: TrainRequest, background: BackgroundTasks):
    dataset_path(request.dataset_id)
    with lock:
        if any(job["status"] in ["queued", "running"] for job in jobs.values()):
            raise HTTPException(409, "A training job is already running")
        job_id = str(uuid4())
        jobs[job_id] = {"id": job_id, "status": "queued", "message": "Queued for validation", "created_at": timestamp(), "dataset_id": request.dataset_id}
    background.add_task(train_job, job_id, request)
    return jobs[job_id]


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Training job not found; jobs are process-local")
    return jobs[job_id]


@app.get("/datasets/{dataset_id}/validate")
def validate_dataset(dataset_id: str):
    path = dataset_path(dataset_id)
    if not path.exists():
        raise HTTPException(404, "Dataset not found")
    try:
        frame, quality = normalize(pd.read_csv(path, low_memory=False), require_labels=True)
        return {"dataset_id": dataset_id, "quality": quality, "rows": len(frame), "classes": {str(k): int(v) for k, v in frame["type"].value_counts().items()},
                "date_start": frame["acquired_at"].min().isoformat() if len(frame) else None,
                "date_end": frame["acquired_at"].max().isoformat() if len(frame) else None,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "columns": list(frame.columns)}
    except Exception as exc:
        raise HTTPException(422, f"Invalid archive: {exc}") from exc


@app.get("/sources/probe")
def probe():
    from concurrent.futures import ThreadPoolExecutor
    import os
    def check(source_id: str, url: str):
        attempted = timestamp()
        try:
            with httpx.Client(verify=ssl.create_default_context(), timeout=httpx.Timeout(12, connect=6), headers=HEADERS) as client:
                response = client.get(url)
                response.raise_for_status()
            return {"id": source_id, "status": "connected", "lastAttempt": attempted, "lastSuccess": timestamp(), "detail": "Endpoint reachable. Evidence is fetched on demand per observation."}
        except Exception as exc:
            return {"id": source_id, "status": "unreachable", "lastAttempt": attempted, "detail": f"Connection failed ({type(exc).__name__}). No substitute values."}
    with ThreadPoolExecutor(max_workers=2) as executor:
        sentinel = executor.submit(check, "sentinel", f"{STAC_URL}/collections/sentinel-2-l2a")
        osm = executor.submit(check, "osm", "https://overpass-api.de/api/status")
        return {"sources": [sentinel.result(), osm.result(), {"id": "worldpop", "status": "idle" if os.getenv("WORLDPOP_RASTER_URL") else "not_configured",
                        "detail": "Population raster configured; sampled on demand" if os.getenv("WORLDPOP_RASTER_URL") else "Optional population-count raster has not been configured. Exposure is unknown."}]}
