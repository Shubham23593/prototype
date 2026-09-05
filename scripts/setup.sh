#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
python3 -m venv .venv
.venv/bin/pip install -r ml/requirements.lock
printf '\nThermoScan is ready. Run npm run dev.\n'
printf 'To reproduce training: npm run data:download && npm run model:train\n'
