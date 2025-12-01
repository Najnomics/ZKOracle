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

type LightwalletdPackage = {
  walletrpc: {
    CompactTxStreamer: new (endpoint: string, creds: ReturnType<typeof credentials.createInsecure>) => {
      GetMempoolTxStream(request: { start_time: number; zaddrs: string[] }): {
        on(event: "data", handler: (tx: { txid: string; blockTime?: number }) => void): void;
        on(event: "end", handler: () => void): void;
        on(event: "error", handler: (error: Error) => void): void;
      };
    };
  };
};

const protoDescriptor = loadPackageDefinition(packageDefinition) as LightwalletdPackage;
const WalletGrpc = protoDescriptor.walletrpc.CompactTxStreamer;

export interface ShieldedTxMetadata {
  txid: string;
  blockTime: number;
  pool: "sapling" | "orchard";
}

export class LightwalletdClient {
  private readonly client: InstanceType<LightwalletdPackage["walletrpc"]["CompactTxStreamer"]>;

  constructor(endpoint: string, useTls: boolean) {
    const channelCredentials = useTls ? credentials.createSsl() : credentials.createInsecure();
    this.client = new WalletGrpc(endpoint, channelCredentials);
  }

  async fetchRecentTransactions(since: number, addresses: string[]): Promise<ShieldedTxMetadata[]> {
    const request = {
      start_time: since,
      zaddrs: addresses,
    };

    return new Promise((resolve, reject) => {
      const txs: ShieldedTxMetadata[] = [];
      const stream = this.client.GetMempoolTxStream(request);

      stream.on("data", (tx) => {
        txs.push({
          txid: tx.txid,
          blockTime: Number(tx.blockTime ?? Date.now() / 1000),
          pool: "sapling",
        });
      });

      stream.on("end", () => resolve(txs));
      stream.on("error", (err: Error) => reject(err));
    });
  }
}

