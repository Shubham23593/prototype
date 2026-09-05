"""ThermoScan: real satellite observations, explicit provenance, no synthetic training data."""

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
