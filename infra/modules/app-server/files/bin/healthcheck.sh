#!/usr/bin/env bash
# Publishes the CloudWatch metric AppHealthy (1 = healthy, 0 = not) by calling the health
# endpoint through nginx, the same path CloudFront uses. Runs every minute from
# app-healthcheck.timer; an alarm in the monitoring module watches the metric.
set -uo pipefail
source /opt/app/bin/lib.sh
load_settings

# Nothing to report before the first successful deployment.
[ -f "$STATE_DIR/current_tag" ] || exit 0

secret=$(sed -n "s/^ORIGIN_VERIFY_SECRET='\(.*\)'$/\1/p" "$RUNTIME_DIR/compose.env" 2>/dev/null)
value=0
if curl -fsS -o /dev/null --max-time 5 -H "X-Origin-Verify: ${secret}" "http://127.0.0.1${HEALTH_CHECK_PATH}"; then
  value=1
fi

aws cloudwatch put-metric-data \
  --namespace "$METRIC_NAMESPACE" \
  --metric-name AppHealthy \
  --value "$value" \
  --unit Count
