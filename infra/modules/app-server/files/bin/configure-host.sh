#!/usr/bin/env bash
# Idempotent host configuration, applied at bootstrap and again on every deployment so
# changes made in Terraform reach the server without replacing it:
#   - CloudWatch agent configuration (metrics + log files)
#   - systemd timers: AppHealthy metric every minute, MongoDB backup on BACKUP_SCHEDULE
set -Eeuo pipefail
source /opt/app/bin/lib.sh
load_settings

# ----- CloudWatch agent --------------------------------------------------------
if ! cmp -s "$APP_DIR/cloudwatch-agent.json" "$STATE_DIR/cloudwatch-agent.applied.json"; then
  log "Applying CloudWatch agent configuration"
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config -m ec2 -s -c "file:$APP_DIR/cloudwatch-agent.json"
  cp "$APP_DIR/cloudwatch-agent.json" "$STATE_DIR/cloudwatch-agent.applied.json"
fi

# ----- systemd units -----------------------------------------------------------
changed=false
for unit in "$APP_DIR"/systemd/*; do
  name=$(basename "$unit")
  if ! cmp -s "$unit" "/etc/systemd/system/$name"; then
    install -m 0644 "$unit" "/etc/systemd/system/$name"
    changed=true
  fi
done

# Backup schedule comes from Terraform (backup_schedule) through a drop-in file.
dropin_dir=/etc/systemd/system/app-backup.timer.d
dropin=$(printf '[Timer]\nOnCalendar=\nOnCalendar=%s' "$BACKUP_SCHEDULE")
if [ "$dropin" != "$(cat "$dropin_dir/schedule.conf" 2>/dev/null)" ]; then
  mkdir -p "$dropin_dir"
  printf '%s\n' "$dropin" > "$dropin_dir/schedule.conf"
  changed=true
fi

if [ "$changed" = true ]; then
  log "systemd units changed - reloading"
  systemctl daemon-reload
  systemctl restart app-healthcheck.timer 2>/dev/null || true
  systemctl restart app-backup.timer 2>/dev/null || true
fi

systemctl enable --now app-healthcheck.timer
if [ "$DB_MODE" = "local" ]; then
  systemctl enable --now app-backup.timer
else
  systemctl disable --now app-backup.timer 2>/dev/null || true
fi
