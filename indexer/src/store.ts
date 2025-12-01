import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

export interface IndexerState {
  cursor: number;
  processedTxIds: string[];
}

const DEFAULT_STATE: IndexerState = {
  cursor: Math.floor(Date.now() / 1000),
  processedTxIds: [],
};

export async function loadState(path: string): Promise<IndexerState> {
  try {
    const data = await readFile(path, "utf8");
    const parsed = JSON.parse(data) as IndexerState;
    return {
      cursor: parsed.cursor ?? DEFAULT_STATE.cursor,
      processedTxIds: parsed.processedTxIds ?? [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveState(path: string, state: IndexerState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}

export function appendTx(state: IndexerState, txid: string, maxEntries = 1024): IndexerState {
  const next = { ...state };
  if (!next.processedTxIds.includes(txid)) {
    next.processedTxIds.push(txid);
    if (next.processedTxIds.length > maxEntries) {
      next.processedTxIds.splice(0, next.processedTxIds.length - maxEntries);
    }
  }
  return next;
}

