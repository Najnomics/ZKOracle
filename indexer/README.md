# ZKOracle Indexer (Outline)

This folder tracks the off-chain service that:

1. Connects to a Zcash data source (`zcashd` + `lightwalletd`, see `CONTEXT/lightwalletd/` and `CONTEXT/zcash/`).
2. Estimates shielded transaction amounts using the statistical methods described in `ZCASH_ECOSYSTEM_STUDY.md`.
3. Encrypts each estimate with the Fhenix SDK (`CONTEXT/fhenix-docs` → FhenixJS docs).
4. Submits encrypted payloads to `contracts/src/ZKOracle.sol`.

## Directory Layout

- `src/indexer.ts` – Orchestrator that polls Zcash data, encrypts values with `fhenix.js`, and calls the oracle.
- `src/clients/lightwalletd.ts` – gRPC client streaming shielded txs via CompactTxStreamer.
- `src/clients/zcashRpc.ts` – optional fallback client that hits `zcashd` directly via JSON-RPC.
- `src/config.ts` – shared configuration loader/validation built with `zod`.
- `src/store.ts` – file-based persistence for cursors and processed tx IDs (defaults to `./data/state.json`).
- `src/estimator.ts` – placeholder statistical estimator; replace with the heuristics from `ZCASH_ECOSYSTEM_STUDY.md`.
- `monitoring/` – Prometheus/Grafana assets for alerting & dashboards (see `monitoring/README.md`).
- `docker-compose.yml` + `Dockerfile` – optional deployment stack (zcashd + lightwalletd + indexer).

## Getting Started

```bash
cd indexer
pnpm install
cp config/example.env .env
pnpm start

# dockerized stack (zcashd + lightwalletd + indexer)
docker compose up -d
open http://localhost:9090 (Prometheus) and http://localhost:3000 (Grafana)

# run unit tests
pnpm test

# use CLI helpers
pnpm cli cursor
```

### Environment Variables

| Variable               | Description                                                    |
|------------------------|----------------------------------------------------------------|
| `FHENIX_RPC_URL`       | RPC endpoint for Fhenix Nitrogen                               |
| `ORACLE_ADDRESS`       | Deployed `ZKOracle` contract address                           |
| `INDEXER_PRIVATE_KEY`  | Signer that owns the oracle `indexer` role                     |
| `SUBMISSION_SCALE`     | Multiplier applied before encryption (e.g., 10,000 for 4 dp)   |
| `MAX_BATCH_SIZE`       | Max encrypted submissions per poll cycle                      |
| `POLL_INTERVAL_MS`     | Delay between Lightwalletd polls                               |
| `LIGHTWALLETD_ENDPOINT`| URL to a Lightwalletd instance                                 |
| `ZCASHD_RPC_URL`       | Optional fallback `zcashd` RPC endpoint                        |
| `ZCASHD_RPC_USER/PASSWORD` | Credentials for the optional fallback RPC                 |
| `STATE_DB_PATH`        | Path to the SQLite database storing cursor and processed txs  |
| `METRICS_PORT`         | Port for the Prometheus metrics server                        |
| `INDEXER_INSTANCE_ID`  | Unique identifier for this replica (used for lease ownership) |
| `LEASE_TTL_SECONDS`    | Coordination lease lifetime before another replica may take over |
| `LEASE_RENEW_GRACE_SECONDS` | Renew the lease when this many seconds remain           |
| `LEASE_RETRY_MS`       | Delay between lease acquisition attempts                      |
| `PROCESSED_RETENTION_SECONDS` | How long to retain processed tx ids for dedupe       |
| `ALERT_WEBHOOK_URL`    | Slack/Mattermost webhook for errors + lease contention alerts |
| `CUTOVER_SHARED_SECRET`| Shared token required to call the `/cutover` webhook endpoint |
| `BACKLOG_ALERT_MS`     | Raise an alert if no submissions have succeeded for this long |

### Notes

- Regenerate the gRPC client from `CONTEXT/lightwallet-protocol/walletrpc` if the proto definitions change.
- Implement the statistical estimator in `src/estimator.ts` using the heuristics documented in `ZCASH_ECOSYSTEM_STUDY.md`.
- SQLite ships a coordination lease; if you deploy multiple replicas make sure each has a distinct `INDEXER_INSTANCE_ID`.
- Scrape `/metrics` from `METRICS_PORT` with Prometheus (see `monitoring/README.md` for sample config + dashboards).
- Configure `ALERT_WEBHOOK_URL` to forward critical errors to Slack/Mattermost.
- Use `pnpm watch:zcash` alongside the main indexer to surface upstream `zcashd` issues quickly.
- Run `scripts/smoke-test.sh` to validate the docker stack before deploying new versions.
- Extend the Vitest test suite (`pnpm test`) as new modules are introduced to keep coverage high.
- Keep the alerting hooks in `logger.ts` wired into the polling loop (`log.info`) for runtime observability.
- Every process exposes `GET /healthz` (served by the same Express app as `/metrics`) so you can plug the indexer into Kubernetes-style readiness checks or simple curl-based monitoring.
- A privileged `POST /cutover` endpoint (requires `CUTOVER_SHARED_SECRET` via `x-cutover-token` or `Authorization` header) can release/claim the lease for a new `instanceId`, making Slack slash commands or runbook-driven failovers trivial.
- If no submissions succeed for `BACKLOG_ALERT_MS` the indexer sends a Slack alert (`Indexer idle threshold exceeded`) so an operator knows the feed has gone dry.

### Remote Cutovers (Slash Command Ready)

`/cutover` is designed to be triggered from a Slack slash command or incident runbook:

```bash
curl -X POST http://localhost:9464/cutover \
  -H "Content-Type: application/json" \
  -H "x-cutover-token: $CUTOVER_SHARED_SECRET" \
  -d '{"instanceId":"indexer-green","requestedBy":"slack/ops"}'
```

- If `instanceId` is omitted it simply releases the lease so another replica can grab it.
- Responses include whether the old lease was released, the new holder, and the expiry timestamp.
- Every successful/blocked cutover also emits a Slack alert so there is an audit trail.

The sample code favours clarity over completeness. It intentionally leaves TODOs where project-specific logic (estimation heuristics, retries, metrics) must be implemented. Use the Zcash docs in `CONTEXT/` to flesh out the estimation pipeline and follow the permission patterns from the Fhenix docs so only aggregate data is ever decrypted.


