import { Counter, Gauge, Registry } from "prom-client";
import express from "express";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express-serve-static-core";

const register = new Registry();
const submittedCounter = new Counter({
  name: "zkoracle_submissions_total",
  help: "Number of encrypted submissions dispatched",
  registers: [register],
});
const iterationCounter = new Counter({
  name: "zkoracle_iterations_total",
  help: "Number of indexer loop iterations",
  registers: [register],
});
const leaseGauge = new Gauge({
  name: "zkoracle_lease_active",
  help: "1 when this instance holds the coordination lease",
  registers: [register],
});

export const stats = {
  incrementSubmitted() {
    submittedCounter.inc();
  },
  incrementIterations() {
    iterationCounter.inc();
  },
  setLeaseActive(active: boolean) {
    leaseGauge.set(active ? 1 : 0);
  },
};

export type HealthSupplier = () => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface MetricsHandlers {
  cutover?: (req: ExpressRequest, res: ExpressResponse) => Promise<void> | void;
}

export function startMetricsServer(port = 9464, getHealth?: HealthSupplier, handlers?: MetricsHandlers) {
  const app = express();
  if (handlers?.cutover) {
    app.use(express.json({ limit: "32kb" }));
  }

  app.get("/metrics", async (_req: ExpressRequest, res: ExpressResponse) => {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  if (getHealth) {
    app.get("/healthz", async (_req: ExpressRequest, res: ExpressResponse) => {
      try {
        const payload = await getHealth();
        res.json({ status: "ok", ...payload });
      } catch (error) {
        res.status(500).json({ status: "error", error: (error as Error).message });
      }
    });
  }

  if (handlers?.cutover) {
    const cutoverHandler = handlers.cutover;
    app.post("/cutover", async (req: ExpressRequest, res: ExpressResponse) => {
      try {
        await cutoverHandler(req, res);
      } catch (error) {
        res.status(500).json({ status: "error", error: (error as Error).message });
      }
    });
  }

  app.listen(port, () => {
    console.log(`[METRICS] listening on :${port} (metrics + healthz${handlers?.cutover ? " + cutover" : ""})`);
  });
}

