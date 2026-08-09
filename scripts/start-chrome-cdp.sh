#!/usr/bin/env bash
set -euo pipefail

PORT="${MAP_TRANSFER_CDP_PORT:-9222}"
PROFILE="${MAP_TRANSFER_CHROME_PROFILE:-$HOME/.map-transfer-chrome}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ENDPOINT="http://127.0.0.1:${PORT}"

if curl -fsS "${ENDPOINT}/json/version" >/dev/null 2>&1; then
  echo "[chrome:cdp] Google Chrome CDP is already running: ${ENDPOINT}"
  echo "[chrome:cdp] profile: ${PROFILE}"
  exit 0
fi

if [ ! -x "${CHROME}" ]; then
  echo "[chrome:cdp] Google Chrome 실행 파일을 찾지 못했습니다: ${CHROME}" >&2
  echo "[chrome:cdp] Chrome을 설치하거나 CHROME_BIN으로 경로를 지정해 주세요." >&2
  exit 1
fi

mkdir -p "${PROFILE}"

echo "[chrome:cdp] Starting Google Chrome..."
echo "[chrome:cdp] endpoint: ${ENDPOINT}"
echo "[chrome:cdp] profile: ${PROFILE}"

nohup "${CHROME}" \
  --remote-debugging-port="${PORT}" \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="${PROFILE}" \
  --no-first-run \
  --no-default-browser-check \
  --new-window \
  "about:blank" \
  >/tmp/k-map-transfer-chrome-cdp.log 2>&1 &

for _ in $(seq 1 40); do
  if curl -fsS "${ENDPOINT}/json/version" >/dev/null 2>&1; then
    echo "[chrome:cdp] CDP Chrome이 준비되었습니다. 지도 탭은 npm run interactive 실행 시 열립니다."
    exit 0
  fi
  sleep 0.5
done

echo "[chrome:cdp] CDP endpoint가 열리지 않았습니다: ${ENDPOINT}" >&2
echo "[chrome:cdp] 로그: /tmp/k-map-transfer-chrome-cdp.log" >&2
tail -20 /tmp/k-map-transfer-chrome-cdp.log >&2 || true
exit 1
