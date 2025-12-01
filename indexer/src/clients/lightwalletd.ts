import axios from "axios";

export interface ShieldedTxMetadata {
  txid: string;
  blockTime: number;
  pool: "sapling" | "orchard";
  // Additional metadata fields as needed
}

export class LightwalletdClient {
  constructor(private readonly endpoint: string) {}

  async fetchRecentTransactions(since: number): Promise<ShieldedTxMetadata[]> {
    // Placeholder: wire up to lightwalletd gRPC or REST proxy.
    const { data } = await axios.get(`${this.endpoint}/transactions`, {
      params: { since },
    });
    return data as ShieldedTxMetadata[];
  }
}

