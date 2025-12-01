import { randomUUID } from "crypto";
import { z } from "zod";

const schema = z.object({
  FHENIX_RPC_URL: z.string().url(),
  ORACLE_ADDRESS: z.string().refine((v) => v.startsWith("0x") && v.length === 42, {
    message: "ORACLE_ADDRESS must be a checksummed address",
  }),
  INDEXER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  SUBMISSION_SCALE: z.coerce.number().positive().default(10_000),
  MAX_BATCH_SIZE: z.coerce.number().positive().max(512).default(32),
  POLL_INTERVAL_MS: z.coerce.number().min(5_000).default(15_000),
  LIGHTWALLETD_ENDPOINT: z.string(),
  LIGHTWALLETD_USE_TLS: z.coerce.boolean().default(false),
  WALLETD_Z_ADDRS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((addr) => addr.trim())
        .filter(Boolean),
    ),
  STATE_DB_PATH: z.string().default("./data/indexer.db"),
  METRICS_PORT: z.coerce.number().default(9464),
  ALERT_WEBHOOK_URL: z.string().optional(),
  ZCASHD_RPC_URL: z.string().url().optional(),
  ZCASHD_RPC_USER: z.string().optional(),
  ZCASHD_RPC_PASSWORD: z.string().optional(),
  INDEXER_INSTANCE_ID: z.string().optional(),
  LEASE_TTL_SECONDS: z.coerce.number().min(30).default(180),
  LEASE_RENEW_GRACE_SECONDS: z.coerce.number().min(5).default(30),
  LEASE_RETRY_MS: z.coerce.number().min(1_000).default(5_000),
  PROCESSED_RETENTION_SECONDS: z.coerce.number().min(3_600).default(86_400),
});

type RawConfig = z.infer<typeof schema>;
export type AppConfig = Omit<RawConfig, "INDEXER_INSTANCE_ID"> & { INDEXER_INSTANCE_ID: string };

export function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Indexer configuration invalid");
  }

  const raw = parsed.data;
  return {
    ...raw,
    INDEXER_INSTANCE_ID: raw.INDEXER_INSTANCE_ID ?? `indexer-${process.pid}-${randomUUID()}`,
  };
}
