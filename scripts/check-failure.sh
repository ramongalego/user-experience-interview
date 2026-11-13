#!/usr/bin/env bash
# A step fails, and the screen has to make that actionable.
#
# Restarts the simulator with FAIL_STEP on for each case, runs the check, and
# puts it back however the check turns out.
set -euo pipefail
cd "$(dirname "$0")/.."

SIM=http://localhost:5002

curl -sf localhost:3000 >/dev/null || { echo "web is not up -- run: cd web && pnpm dev"; exit 1; }

restore() { docker compose up -d simulator >/dev/null 2>&1 || true; }
trap restore EXIT

check() {
  echo "restarting the simulator with FAIL_STEP=$1"
  FAIL_STEP=$1 docker compose up -d simulator >/dev/null
  for _ in $(seq 1 30); do curl -sf $SIM/health >/dev/null && break; sleep 0.5; done
  (cd web && pnpm exec playwright test e2e/failure.spec.ts --grep "$1:")
}

check warm_reagent_plate
check read_plate
