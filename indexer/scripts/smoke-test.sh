#!/usr/bin/env bash
set -euo pipefail

echo "[*] Building stack..."
docker compose up -d --build

echo "[*] Waiting for services..."
sleep 20

echo "[*] Checking Prometheus metrics..."
curl --fail http://localhost:9464/metrics | head -n 20

echo "[*] Checking lightwalletd port..."
curl --fail http://localhost:9067 || true

echo "[*] Tail indexer logs..."
docker compose logs indexer --tail=50

echo "[*] Smoke test complete."

