# ZKOracle Deployment Guide

This document stitches together the exact steps required to take the contracts + indexer from source to a running deployment on the Fhenix Nitrogen testnet.

## 1. Prerequisites

- Node 18+, pnpm, Foundry toolchain (`foundryup`).
- Access to a Nitrogen RPC URL (`FHENIX_RPC_URL`) and funded deployer/indexer keys.
- Docker Desktop (for the Zcash stack + Prometheus).

## 2. Configure the Contracts

```bash
cd contracts
pnpm install

cat <<'EOF' > .env
PRIVATE_KEY=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
FHENIX_RPC_URL=https://api.nitrogen.fhenix.zone
ORACLE_ADMIN=0x000000000000000000000000000000000000dead
ORACLE_INDEXER=0x000000000000000000000000000000000000c0de
ORACLE_PERIOD=3600
ORACLE_MAX_SAMPLES=256
ORACLE_SUBMISSION_SCALE=10000
EOF

forge build && forge test
```

## 3. Deploy & Verify

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $FHENIX_RPC_URL \
  --broadcast \
  --verify \
  --slow \
  --sig "run()" \
  --etherscan-api-key $FHENIX_EXPLORER_KEY
```

- Capture the resulting `ZKOracle` address (`STDOUT` + `broadcast/` folder).
- Store it in `deployments/nitrogen.json` for future reference, e.g.

```json
{
  "network": "fhenix-nitrogen",
  "oracle": "0xABCD...1234",
  "admin": "0x0000...dead",
  "indexer": "0x0000...c0de",
  "timestamp": "2025-01-01T00:00:00Z"
}
```

## 4. Wire the Indexer

```bash
cd ../indexer
pnpm install

cat <<'EOF' > .env
FHENIX_RPC_URL=https://api.nitrogen.fhenix.zone
ORACLE_ADDRESS=0xABCD...1234              # from step 3
INDEXER_PRIVATE_KEY=0xfeed...
SUBMISSION_SCALE=10000
MAX_BATCH_SIZE=32
POLL_INTERVAL_MS=15000
LIGHTWALLETD_ENDPOINT=http://localhost:9067
LIGHTWALLETD_USE_TLS=false
STATE_DB_PATH=./data/state.db
METRICS_PORT=9464
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/.../...
CUTOVER_SHARED_SECRET=super-secret-token
BACKLOG_ALERT_MS=600000
EOF
```

- Start the supporting Zcash stack: `docker compose up -d` (from `indexer/`).
- Run the indexer: `pnpm start`.

## 5. Validate End-to-End

1. Tail the logs: `docker compose logs indexer --tail=100`.
2. Inspect health: `curl http://localhost:9464/healthz | jq`.
3. Run the smoke script: `./scripts/smoke-test.sh`.
4. Trigger a cutover from your laptop:
   ```bash
   pnpm cli cutover-api indexer-green https://indexer.prod.zkoracle.com/cutover
   ```
5. After a collection window, finalize & read from `OracleConsumer`:
   ```bash
   forge script script/ReadConsumer.s.sol --rpc-url $FHENIX_RPC_URL
   ```

## 6. Monitoring Checklist

- Import `indexer/monitoring/grafana-dashboard.json`.
- Point Prometheus at `http://<indexer>:9464/metrics`.
- Verify Slack alerts by temporarily setting `BACKLOG_ALERT_MS=60000` and pausing the indexer.

> Once all steps are complete, the README “Production Checklist” items can be checked off. Keep the `deployments/nitrogen.json` file updated whenever you redeploy.


