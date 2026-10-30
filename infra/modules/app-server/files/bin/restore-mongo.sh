#!/usr/bin/env bash
# Restores a backup made by backup-mongo.sh into the local MongoDB container.
# DESTRUCTIVE: every collection contained in the backup replaces the current one (--drop).
# Users and roles (admin database) are left untouched.
#
#   /opt/app/bin/restore-mongo.sh backups/mongo/2026/10/mongo-20261030T030000Z.archive.gz
#   (or from your machine: npm run ops -- restore <key>)
set -Eeuo pipefail
source /opt/app/bin/lib.sh
load_settings
exec > >(tee -a "$LOG_DIR/backup.log") 2>&1

key=${1:?usage: restore-mongo.sh <s3-key-of-backup>}
[ "$DB_MODE" = "local" ] || die "restore only applies to database_mode=local"
[ -f "$RUNTIME_DIR/compose.env" ] || die "the application has not been deployed yet"

log "Restoring s3://$ARTIFACTS_BUCKET/$key"
aws s3 cp "s3://$ARTIFACTS_BUCKET/$key" - --only-show-errors \
  | compose exec -T mongo sh -c 'exec mongorestore --quiet --archive --gzip --drop \
      --nsExclude "admin.*" --nsExclude "config.*" \
      --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin'
log "Restore complete"
