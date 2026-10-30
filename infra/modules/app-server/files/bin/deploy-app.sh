#!/usr/bin/env bash
# Deploys a backend image on this server. Called by scripts/deploy.mjs through SSM Run
# Command, and by user-data on first boot. Without an argument it redeploys the last
# known-good tag stored in SSM (<prefix>/deploy/image_tag).
#
#   /opt/app/bin/deploy-app.sh [image-tag]
#
# 1. sync the latest config files from S3       4. pull images
# 2. re-apply host configuration                5. docker compose up --wait (health checks)
# 3. render env files from SSM Parameter Store  6. roll back automatically if unhealthy
set -Eeuo pipefail
source /opt/app/bin/lib.sh

# jq program turning get-parameters-by-path output into NAME='value' lines ($q is a single
# quote, passed with --arg). Single-quoted values are used literally by docker compose
# (no ${...} interpolation), so they must not contain a single quote or a line break.
JQ_TO_ENV='.Parameters[]
  | (.Name | split("/") | last) as $name
  | if ($name | test("^[A-Za-z_][A-Za-z0-9_]*$") | not) then error("invalid variable name: \($name)")
    elif (.Value | contains($q) or contains("\n")) then error("value of \($name) contains a single quote or a newline - not supported")
    else "\($name)=\($q)\(.Value)\($q)" end'

# New T3/T4g instances start with zero CPU credits (standard mode), so the first boot can be slow.
wait_for_bootstrap() {
  local i
  for i in $(seq 1 180); do
    [ -f "$STATE_DIR/bootstrapped" ] && return 0
    [ -f "$STATE_DIR/bootstrap-failed" ] && die "instance bootstrap failed - see $LOG_DIR/bootstrap.log"
    [ "$i" -eq 1 ] && log "Waiting for first-boot bootstrap to finish..."
    sleep 10
  done
  die "bootstrap did not finish within 30 minutes - see $LOG_DIR/bootstrap.log"
}

sync_assets() {
  log "Syncing deployment files from s3://$ARTIFACTS_BUCKET/deploy/"
  aws s3 cp "s3://$ARTIFACTS_BUCKET/deploy/" "$APP_DIR/" --recursive --only-show-errors
  chmod 0755 "$APP_DIR"/bin/*.sh
}

parameters_as_env() {
  aws ssm get-parameters-by-path --path "$1" --recursive --with-decryption --output json | jq -r --arg q "'" "$JQ_TO_ENV"
}

render_env_files() {
  local tag=$1
  umask 077
  # Backend container environment: every parameter under <prefix>/app/
  parameters_as_env "$SSM_PREFIX/app" > "$RUNTIME_DIR/app.env.tmp"
  mv "$RUNTIME_DIR/app.env.tmp" "$RUNTIME_DIR/app.env"
  # Values interpolated into docker-compose.yml: image + server secrets under <prefix>/internal/
  {
    echo "BACKEND_IMAGE='$ECR_REPOSITORY_URL:$tag'"
    echo "APP_VERSION='$tag'"
    parameters_as_env "$SSM_PREFIX/internal"
  } > "$RUNTIME_DIR/compose.env.tmp"
  mv "$RUNTIME_DIR/compose.env.tmp" "$RUNTIME_DIR/compose.env"
  umask 022
}

ecr_login() {
  aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null
}

start_stack() {
  compose up --detach --remove-orphans --wait --wait-timeout 300
}

record_success() {
  local tag=$1 current
  current=$(cat "$STATE_DIR/current_tag" 2>/dev/null || true)
  if [ -n "$current" ] && [ "$current" != "$tag" ]; then
    echo "$current" > "$STATE_DIR/previous_tag"
  fi
  echo "$tag" > "$STATE_DIR/current_tag"
  # Free disk space: remove images not used by a container for a week (ECR keeps the history).
  docker image prune --all --force --filter "until=168h" >/dev/null || true
  log "Deployed $tag successfully"
}

rollback() {
  local failed=$1 previous
  previous=$(cat "$STATE_DIR/current_tag" 2>/dev/null || true)
  if [ -z "$previous" ] || [ "$previous" = "$failed" ]; then
    log "No previous version to roll back to"
    return 0
  fi
  log "Rolling back to $previous"
  render_env_files "$previous"
  if start_stack; then
    log "Rollback to $previous succeeded - the site is running the previous version"
  else
    log "Rollback to $previous FAILED - manual intervention needed (npm run ops -- status)"
  fi
}

main() {
  load_settings
  exec > >(tee -a "$LOG_DIR/deploy.log") 2>&1

  # One deployment at a time (user-data and SSM can overlap on a fresh instance).
  exec 9>"$STATE_DIR/deploy.lock"
  flock --wait 900 9 || die "another deployment is still running"

  wait_for_bootstrap
  sync_assets
  load_settings # settings.env may have changed
  "$APP_DIR/bin/configure-host.sh"

  local tag="${1:-}"
  if [ -z "$tag" ]; then
    tag=$(aws ssm get-parameter --name "$SSM_PREFIX/deploy/image_tag" --query Parameter.Value --output text)
  fi
  if [ -z "$tag" ] || [ "$tag" = "none" ]; then
    log "No backend image deployed yet - nothing to start."
    return 0
  fi

  log "Deploying backend image $ECR_REPOSITORY_URL:$tag (database: $DB_MODE)"
  ecr_login
  log "Pulling images"
  # Pull the new image before touching anything, so a wrong tag fails with the old version untouched.
  docker pull --quiet "$ECR_REPOSITORY_URL:$tag" >/dev/null
  render_env_files "$tag"
  compose pull --quiet

  log "Starting containers and waiting for health checks"
  if start_stack; then
    record_success "$tag"
    compose ps
    return 0
  fi

  log "Version $tag did not become healthy"
  compose ps || true
  compose logs --no-color --tail 100 backend || true
  rollback "$tag"
  die "deployment of $tag failed"
}

# Single line on purpose: bash has read it completely before main() starts, so syncing a
# new version of this very file from S3 during the run is harmless.
main "$@"; exit $?
