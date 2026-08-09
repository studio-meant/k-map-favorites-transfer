#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[setup] installing npm deps..."
npm install
echo "[setup] installing Google Chrome for Playwright..."
npx playwright install chrome
echo "[setup] done."
