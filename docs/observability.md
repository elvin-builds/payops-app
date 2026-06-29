# PayOps Observability

## Overview

PayOps uses Prometheus and Grafana for observability.

The monitoring stack is installed with kube-prometheus-stack in the `monitoring` namespace.

## Monitoring Stack

Components:

- Prometheus
- Grafana
- Alertmanager
- kube-state-metrics
- node-exporter
- Prometheus Operator

## Application Metrics

The `api-gateway` service exposes Prometheus metrics at:

```text
/metrics

Metrics are implemented with the Node.js prom-client library.

ServiceMonitor

Prometheus scrapes the api-gateway service through a Kubernetes ServiceMonitor.

The service exposes port 8080 with the name http.

The ServiceMonitor selects:

selector:
  matchLabels:
    app: api-gateway

and scrapes:

path: /metrics
port: http
interval: 30s
Grafana Dashboard

Dashboard name:

PayOps API Gateway Overview

Panels:

API Request Rate
API 5xx Error Rate
API P95 Latency
API Gateway Restarts
PromQL Queries
API Request Rate
sum(rate(payops_api_gateway_http_requests_total[5m])) by (path, method)
API 5xx Error Rate
sum(rate(payops_api_gateway_http_requests_total{status_code=~"5.."}[5m])) or vector(0)
API P95 Latency
histogram_quantile(
  0.95,
  sum(rate(payops_api_gateway_http_request_duration_seconds_bucket[5m])) by (le, path)
)
API Gateway Restarts
sum(kube_pod_container_status_restarts_total{namespace="payops-dev", container="api-gateway"})
Verification

Custom metrics were verified in Prometheus with:

payops_api_gateway_http_requests_total

Example observed labels:

namespace="payops-dev"
service="api-gateway"
path="/api/auth"
method="POST"
status_code="401"
Notes

Public ingress traffic may include bot or scanner requests. These requests are visible in the request rate dashboard and can later be used for security monitoring.
