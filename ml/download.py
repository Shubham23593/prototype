"""Download genuine historical FIRMS data; never generate substitute observations."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import httpx
import ssl

import os

ROOT = Path(__file__).resolve().parents[1]
MIRROR_COMMIT = "30ae6eb05c400b1d40aac7daa4c4a9bbceec667f"
MIRROR_REPO = "UjjwalKumar7209/sih-2026"
MIRROR_PATH = "SIH_Industrial_Fire_AI/firms_historical_india.csv"
MIRROR_RAW_URL = f"https://raw.githubusercontent.com/{MIRROR_REPO}/{MIRROR_COMMIT}/{MIRROR_PATH}"
MIRROR_API_URL = f"https://api.github.com/repos/{MIRROR_REPO}/contents/{MIRROR_PATH}?ref={MIRROR_COMMIT}"
MIRROR_URL = MIRROR_RAW_URL
EXPECTED_SHA256 = "62b397c086bf1934010fd86987506e8aca45d74a9fc0270cd434128a9a9a3db6"


def download(source="mirror", country="India", year=2025, output: Path | None = None) -> Path:
    if not re.fullmatch(r"[A-Za-z_]+", country) or year < 2012 or year > datetime.now(timezone.utc).year:
        raise ValueError("Invalid country or year")
    if source == "mirror" and (country != "India" or year != 2025):
        raise ValueError("The pinned mirror contains India, January–March 2025 only. Use --source nasa for other country/years.")
    official = f"https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{year}/viirs-snpp_{year}_{country}.csv"
    candidate_urls = [MIRROR_RAW_URL, MIRROR_API_URL] if source == "mirror" else [official]
    destination = output or ROOT / "data/raw/india-viirs-2025.csv"
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    content = bytearray()
    last_error = None

    for url in candidate_urls:
        content.clear()
        headers = {"User-Agent": "ThermoScan-research-prototype/0.1"}
        if "api.github.com" in url:
            headers["Accept"] = "application/vnd.github.raw+json"
            if token:
                headers["Authorization"] = f"Bearer {token}"
        elif source != "mirror":
            headers["Accept"] = "text/csv"
        try:
            print(f"Downloading real historical observations from {source}: {url}", flush=True)
            with httpx.Client(verify=ssl.create_default_context(), timeout=httpx.Timeout(120, connect=15), follow_redirects=True) as client:
                with client.stream("GET", url, headers=headers) as response:
                    response.raise_for_status()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > 250_000_000:
                            raise ValueError("Download exceeds the 250 MB safety limit. Request a smaller archive from NASA.")
            if bytes(content[:200]).lower().startswith(b"latitude,longitude,"):
                last_error = None
                break
        except Exception as exc:
            last_error = exc
            print(f"Mirror candidate failed ({url}): {exc}", flush=True)
            continue

    if last_error:
        raise last_error
    if not bytes(content[:200]).lower().startswith(b"latitude,longitude,"):
        raise ValueError("The source did not return a FIRMS CSV. An HTML error/login page or Git LFS pointer is not training data.")
    digest = hashlib.sha256(content).hexdigest()
    if source == "mirror" and digest != EXPECTED_SHA256:
        raise ValueError("Pinned historical archive checksum mismatch. Refusing to train on an unverified replacement.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    meta = {"name": f"{country} VIIRS S-NPP {'January–March ' if source == 'mirror' else ''}{year}",
            "primary_source": "NASA FIRMS / VIIRS S-NPP standard processing", "primary_url": official,
            "archive_portal": "https://firms.modaps.eosdis.nasa.gov/download/", "download_url": url,
            "mirror_url": f"https://github.com/{MIRROR_REPO}/blob/{MIRROR_COMMIT}/{MIRROR_PATH}" if source == "mirror" else None,
            "mirror_commit": MIRROR_COMMIT if source == "mirror" else None,
            "sha256": digest, "bytes": len(content), "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "notes": ["NASA type is an algorithmic source-type label, not an independently verified incident label.",
                      "Collection-2 type-field reprocessing status is unverified for the mirror. Request freshly reprocessed standard data before scientific use."]}
    if source == "mirror":
        meta["notes"].append("Explicit pinned public mirror. Bit-for-bit equivalence to the complete NASA country archive has not been verified; this is a quarterly subset.")
    metadata_path = ROOT / "data/provenance.json" if destination.resolve() == (ROOT / "data/raw/india-viirs-2025.csv").resolve() else destination.with_suffix(".provenance.json")
    metadata_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Saved {len(content):,} bytes. SHA-256 {digest}", flush=True)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=["mirror", "nasa"], default="mirror", help="mirror is pinned, explicitly attributed India Q1 2025 data; nasa is the official country/year endpoint")
    parser.add_argument("--country", default="India")
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    download(args.source, args.country, args.year, args.output)
