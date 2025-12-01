# ZKOracle Indexer (Outline)

This folder tracks the off-chain service that:

1. Connects to a Zcash data source (`zcashd` + `lightwalletd`, see `CONTEXT/lightwalletd/` and `CONTEXT/zcash/`).
2. Estimates shielded transaction amounts using the statistical methods described in `ZCASH_ECOSYSTEM_STUDY.md`.
3. Encrypts each estimate with the Fhenix SDK (`CONTEXT/fhenix-docs` → FhenixJS docs).
4. Submits encrypted payloads to `contracts/src/ZKOracle.sol`.

## Directory Layout

- `src/indexer.ts` – TypeScript skeleton that polls Zcash data, encrypts values with `fhenix.js`, and calls the oracle.
- `src/clients/lightwalletd.ts` – placeholder for a lightweight client that wraps the gRPC definitions in `CONTEXT/lightwallet-protocol/walletrpc`.
- `config/example.env` – environment variable reference (RPC URLs, keys, batching settings).

## Getting Started

```bash
cd indexer
pnpm install
cp config/example.env .env
pnpm start
```

The sample code favours clarity over completeness. It intentionally leaves TODOs where project-specific logic (estimation heuristics, retries, metrics) must be implemented. Use the Zcash docs in `CONTEXT/` to flesh out the estimation pipeline and follow the permission patterns from the Fhenix docs so only aggregate data is ever decrypted.


