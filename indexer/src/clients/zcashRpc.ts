import axios, { AxiosInstance } from "axios";

export interface ZcashShieldedTx {
  txid: string;
  amount?: number;
  confirmations?: number;
  blocktime?: number;
  address?: string;
  memo?: string;
}

export class ZcashRpcClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly endpoint: string,
    username?: string,
    password?: string,
  ) {
    this.http = axios.create({
      baseURL: endpoint,
      auth: username && password ? { username, password } : undefined,
    });
  }

  async listReceivedByAddress(address: string, minConfirmations = 1): Promise<ZcashShieldedTx[]> {
    const payload = {
      jsonrpc: "1.0",
      id: "zkoracle",
      method: "z_listreceivedbyaddress",
      params: [address, minConfirmations],
    };
    const { data } = await this.http.post("", payload);
    return data.result ?? [];
  }
}

