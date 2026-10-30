#!/usr/bin/env bash
# Streams a compressed mongodump of the local MongoDB container straight to S3
# (no temporary file on disk). Runs from app-backup.timer (default: daily 03:00 UTC)
# or on demand: npm run ops -- backup
set -Eeuo pipefail
source /opt/app/bin/lib.sh
load_settings
exec > >(tee -a "$LOG_DIR/backup.log") 2>&1

if [ "$DB_MODE" != "local" ]; then
  log "database_mode=$DB_MODE: backups are handled by your MongoDB provider"
  exit 0
fi
[ -f "$RUNTIME_DIR/compose.env" ] || die "the application has not been deployed yet"

key="$BACKUP_PREFIX/$(date -u +%Y/%m)/mongo-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
log "Backing up MongoDB to s3://$ARTIFACTS_BUCKET/$key"

# The credentials are expanded inside the container (single quotes), never on the host.
compose exec -T mongo sh -c 'exec mongodump --quiet --archive --gzip \
    --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin' \
  | aws s3 cp - "s3://$ARTIFACTS_BUCKET/$key" --only-show-errors

size=$(aws s3api head-object --bucket "$ARTIFACTS_BUCKET" --key "$key" --query ContentLength --output text)
log "Backup complete: $key ($size bytes)"
