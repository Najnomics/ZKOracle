# ZKOracle Indexer (Outline)

This folder tracks the off-chain service that:

1. Connects to a Zcash data source (`zcashd` + `lightwalletd`, see `CONTEXT/lightwalletd/` and `CONTEXT/zcash/`).
2. Estimates shielded transaction amounts using the statistical methods described in `ZCASH_ECOSYSTEM_STUDY.md`.
3. Encrypts each estimate with the Fhenix SDK (`CONTEXT/fhenix-docs` → FhenixJS docs).
4. Submits encrypted payloads to `contracts/src/ZKOracle.sol`.

## Directory Layout

- `src/indexer.ts` – Orchestrator that polls Zcash data, encrypts values with `fhenix.js`, and calls the oracle.
- `src/clients/lightwalletd.ts` – lightweight client stub (replace with a gRPC client derived from `CONTEXT/lightwallet-protocol/walletrpc`).
- `src/clients/zcashRpc.ts` – optional fallback client that hits `zcashd` directly via JSON-RPC.
- `src/config.ts` – shared configuration loader/validation built with `zod`.
- `config/example.env` – environment variable reference (RPC URLs, keys, batching settings).

## Getting Started

```bash
cd indexer
pnpm install
cp config/example.env .env
pnpm start
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

### Notes

- Replace `lightwalletd.ts` with a generated gRPC client using the files under `CONTEXT/lightwallet-protocol/walletrpc`.
- Implement the statistical estimator in `src/indexer.ts` using the heuristics documented in `ZCASH_ECOSYSTEM_STUDY.md`.
- Add persistence (e.g., SQLite or Redis) for cursors/processed tx IDs before production usage.
- Metrics/alerting hooks should be wired into the polling loop (`log.info`) for observability.

The sample code favours clarity over completeness. It intentionally leaves TODOs where project-specific logic (estimation heuristics, retries, metrics) must be implemented. Use the Zcash docs in `CONTEXT/` to flesh out the estimation pipeline and follow the permission patterns from the Fhenix docs so only aggregate data is ever decrypted.


