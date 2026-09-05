"""Tests use genuine source rows. Mutated rows are isolated fault-injection tests,
never application data, training examples, or displayed observations.
"""
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from ml.features import normalize, add_history, feature_matrix, THERMAL_FEATURES
from ml import service
from ml.connectors import sentinel_context, population_context

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture(scope="module")
def real_rows():
    return pd.read_csv(ROOT / "data/replay/india-2025-q1.csv.gz", nrows=80)


def test_bundled_real_archive_checksum_and_count():
    manifest = json.loads((ROOT / "data/replay/manifest.json").read_text())
    content = (ROOT / "data/replay/india-2025-q1.csv.gz").read_bytes()
    assert hashlib.sha256(content).hexdigest() == manifest["replay_sha256"]
    assert len(gzip.decompress(content).splitlines()) - 1 == manifest["rows"] == 67359
    assert manifest["source_sha256"] == "62b397c086bf1934010fd86987506e8aca45d74a9fc0270cd434128a9a9a3db6"
    assert manifest["mode"] == "archive"


def test_normalization_preserves_utc_and_zero_padded_time(real_rows):
    df, quality = normalize(real_rows, require_labels=True)
    assert quality["invalid_or_unsupported_rows"] == 0
    assert str(df["acquired_at"].dtype) == "datetime64[ns, UTC]"
    assert all(df["acq_time"].str.len() == 4)
    assert df.iloc[0]["acquired_at"].strftime("%H%M") == df.iloc[0]["acq_time"]
    assert df.iloc[0]["acquired_at"].year == 2025


def test_duplicate_and_invalid_rows_are_not_silently_counted(real_rows):
    corrupt = real_rows.head(4).copy()
    corrupt.loc[corrupt.index[0], "latitude"] = 999
    corrupt.loc[corrupt.index[1], "frp"] = -10
    corrupt.loc[corrupt.index[2], "acq_time"] = 2461
    frame, quality = normalize(pd.concat([corrupt, real_rows.head(1), real_rows.head(1)], ignore_index=True))
    assert quality["invalid_or_unsupported_rows"] == 3
    assert quality["duplicates_removed"] == 1
    assert len(frame) == 2


def test_nrt_without_labels_cannot_train(real_rows):
    with pytest.raises(ValueError, match="type"):
        normalize(real_rows.drop(columns=["type"]), require_labels=True)


def test_target_is_not_an_input(real_rows):
    df, _ = normalize(real_rows)
    x = feature_matrix(df)
    altered = df.copy()
    altered["type"] = (altered["type"] + 2) % 4
    np.testing.assert_allclose(x.values, feature_matrix(altered).values, equal_nan=True)
    assert not set(["type", "latitude", "longitude", "id", "acquired_at"]).intersection(x.columns)
    assert list(x.columns) == THERMAL_FEATURES


def test_causal_history_ignores_future_and_same_overpass(real_rows):
    # A metamorphic timing test based on a real pixel, not a fabricated dataset.
    query, _ = normalize(real_rows.head(1))
    before = query.copy()
    before["acquired_at"] = before["acquired_at"] - pd.Timedelta(days=2)
    after = query.copy()
    after["acquired_at"] = after["acquired_at"] + pd.Timedelta(days=1)
    with_future = add_history(query, pd.concat([before, query, after], ignore_index=True))
    without_future = add_history(query, before)
    assert with_future.iloc[0]["prior_detections_30d"] == 1
    assert with_future.iloc[0]["prior_active_days_30d"] == 1
    np.testing.assert_equal(with_future["prior_detections_30d"].to_numpy(), without_future["prior_detections_30d"].to_numpy())


def test_history_radius_is_geospatial_not_just_date(real_rows):
    query, _ = normalize(real_rows.head(1))
    far = query.copy()
    far["longitude"] += 2
    far["acquired_at"] -= pd.Timedelta(days=1)
    result = add_history(query, far)
    assert result.iloc[0]["prior_detections_30d"] == 0


def test_actual_artifact_and_metrics_are_consistent():
    model, card = service.load_model()
    assert card["artifact_sha256"] == hashlib.sha256((ROOT / "ml/artifacts/model.json").read_bytes()).hexdigest()
    assert list(model.get_booster().feature_names) == card["feature_names"]
    evaluation = card["metrics"]["spatial_temporal"]
    matrix = np.array(evaluation["confusion_matrix"])
    assert matrix.sum() == evaluation["rows"]
    assert matrix.trace() / matrix.sum() == pytest.approx(evaluation["accuracy"])
    assert evaluation["macro_f1"] == pytest.approx(np.mean([evaluation["per_class"][c["label"]]["f1-score"] for c in card["classes"]]))
    assert card["split"]["overlapping_blocks"] == 0
    assert card["split"]["test_used_for_tuning"] is False


def test_serving_real_csv_strings_has_real_probabilities(real_rows, monkeypatch):
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    monkeypatch.delenv("INTERNAL_SERVICE_KEY", raising=False)
    # CSV parsers send strings; this catches '1.0' recurrence conversion bugs.
    rows = real_rows.head(12).astype(str).to_dict("records")
    for i, row in enumerate(rows):
        row["id"] = f"real-observation-test-{i}"
    client = TestClient(service.app)
    response = client.post("/predict", json={"observations": rows, "use_precomputed_history": True})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result["predictions"]) == 12
    for item in result["predictions"]:
        assert 0 <= item["score"] <= 1
        assert sum(p["score"] for p in item["probabilities"]) == pytest.approx(1, abs=2e-6)
        assert item["modelId"].startswith("xgb-")
        assert item["history"]["coverageDays"] == 30


def test_population_is_unknown_without_a_raster(monkeypatch):
    monkeypatch.delenv("WORLDPOP_RASTER_URL", raising=False)
    result = population_context(19.07, 72.87)
    assert result["status"] == "not_configured"
    assert "estimated_people" not in result


def test_network_failure_does_not_become_spectral_values(monkeypatch):
    import httpx
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("Deliberate test-only network failure")
    monkeypatch.setattr(httpx.Client, "post", unavailable)
    result = sentinel_context(19.07, 72.87, "2025-03-31T08:00:00Z")
    assert result["status"] == "unavailable"
    assert "ndvi" not in result and "ndbi" not in result


def test_internal_training_auth_cannot_be_bypassed(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_KEY", "unit-test-only-service-key")
    client = TestClient(service.app)
    assert client.post("/train", json={"dataset_id": "default"}).status_code == 401
    assert client.get("/health").status_code == 200


def test_invalid_dataset_path_is_rejected():
    with pytest.raises(HTTPException) as error:
        service.dataset_path("../../.env")
    assert error.value.status_code == 422


def test_training_rejects_a_short_live_window(tmp_path, real_rows):
    from ml.train import train
    path = tmp_path / "too-short.csv"
    real_rows.to_csv(path, index=False)
    with pytest.raises(ValueError, match="500"):
        train(path, publish_replay=False)


def test_india_viirs_2025_detects_316036_rows():
    result = service.validate_dataset("default")
    assert result["rows"] == 316036
    assert result["quality"]["duplicates_removed"] == 0
    assert result["quality"]["invalid_or_unsupported_rows"] == 0


def test_firms_csv_different_country_venezuela():
    result = service.validate_dataset("eb6afba0-7bbf-4ddd-af2b-f95be7d8fa21")
    assert result["rows"] == 42963
    assert result["rows"] > 0
    assert "latitude" in result["columns"]
    assert "longitude" in result["columns"]


def test_invalid_schema_shows_clear_error(tmp_path):
    invalid_csv = tmp_path / "invalid_firms.csv"
    invalid_csv.write_text("random_col1,random_col2\n123,456\n")
    with pytest.raises(ValueError, match="Missing required FIRMS column"):
        normalize(pd.read_csv(invalid_csv), require_labels=False)


