import path from "path";
import { loadSync } from "@grpc/proto-loader";
import { credentials, loadPackageDefinition } from "@grpc/grpc-js";

const PROTO_PATH = path.resolve(
  process.cwd(),
  "CONTEXT/lightwallet-protocol/walletrpc/service.proto",
);

const packageDefinition = loadSync(PROTO_PATH, {
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = loadPackageDefinition(packageDefinition) as any;
const WalletGrpc = protoDescriptor.walletrpc.CompactTxStreamer;

export interface ShieldedTxMetadata {
  txid: string;
  blockTime: number;
  pool: "sapling" | "orchard";
}

export class LightwalletdClient {
  private readonly client: any;

  constructor(endpoint: string) {
    this.client = new WalletGrpc(endpoint, credentials.createInsecure());
  }

  async fetchRecentTransactions(since: number): Promise<ShieldedTxMetadata[]> {
    const request = { start_time: since };

    return new Promise((resolve, reject) => {
      this.client.GetMempoolTx({ filter: request }, (err: Error | null, response: any) => {
        if (err) return reject(err);
        const txs =
          response?.transactions?.map((tx: any) => ({
            txid: tx.txid,
            blockTime: Number(tx.expiryHeight ?? Date.now() / 1000),
            pool: "sapling",
          })) ?? [];
        resolve(txs);
      });
    });
  }
}

