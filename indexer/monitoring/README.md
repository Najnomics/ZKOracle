# Monitoring & Observability

The indexer exposes a Prometheus-compatible `/metrics` endpoint (default `http://localhost:9464/metrics`) with:

- `zkoracle_submissions_total`
- `zkoracle_iterations_total`

## Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: "zkoracle-indexer"
    static_configs:
      - targets: ["indexer:9464"]
```

## Grafana Dashboard

1. Import `monitoring/grafana-dashboard.json` into Grafana.
2. Point it at the Prometheus data source. Panels include:
   - Submissions over time
   - Loop iteration rate
   - Recent errors (derived from webhook alerts)

## Alerts

Set `ALERT_WEBHOOK_URL` to a Slack/Mattermost webhook. On critical errors, the indexer will `POST` a JSON payload.

Example template:

```yaml
groups:
  - name: zkoracle-indexer
    rules:
      - alert: NoSubmissionsIn15m
        expr: increase(zkoracle_submissions_total[15m]) == 0
        for: 15m
        labels:
          severity: critical
        annotations:
          summary: "No submissions from indexer in 15 minutes"
```

