import { Counter, Gauge, Registry } from "prom-client";
import express from "express";
import type { Request, Response } from "express";

type MetricsResponse = {
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

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

export function startMetricsServer(port = 9464) {
  const app = express();
  app.get("/metrics", async (_req: Request, res: Response) => {
    const response = res as unknown as MetricsResponse;
    response.setHeader("Content-Type", register.contentType);
    response.end(await register.metrics());
  });
  app.listen(port, () => {
    console.log(`[METRICS] listening on :${port}/metrics`);
  });
}

