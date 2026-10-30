#!/usr/bin/env bash
# First-boot setup of the app server (Amazon Linux 2023). Safe to run again.
#   - installs Docker, the Docker Compose plugin, jq and the CloudWatch agent
#   - creates a swap file (micro instances only have 1 GiB of RAM)
#   - formats and mounts the MongoDB data volume (database_mode = "local")
#   - applies host configuration (configure-host.sh)
set -Eeuo pipefail
source /opt/app/bin/lib.sh

# Leaves a marker so deploy-app.sh fails fast instead of waiting for a bootstrap that died.
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    touch "$STATE_DIR/bootstrap-failed"
    log "Bootstrap FAILED (exit code $rc) - see $LOG_DIR/bootstrap.log"
  fi
}

install_packages() {
  log "Installing packages"
  dnf install -y --setopt=install_weak_deps=False docker jq amazon-cloudwatch-agent
}

configure_docker() {
  mkdir -p /etc/docker
  # json-file is only the default for containers without their own log driver; ours use awslogs.
  # live-restore keeps containers running while the Docker daemon itself restarts or upgrades.
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
  systemctl enable --now docker
  docker version --format 'Docker {{.Server.Version}}'
}

install_compose() {
  local arch target url tmp
  arch=$(uname -m) # x86_64 or aarch64
  target=/usr/local/lib/docker/cli-plugins/docker-compose

  if [ -x "$target" ] && [ "$("$target" version --short 2>/dev/null)" = "${COMPOSE_VERSION#v}" ]; then
    log "Docker Compose $COMPOSE_VERSION already installed"
    return
  fi

  log "Installing Docker Compose $COMPOSE_VERSION"
  url="https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${arch}"
  tmp=$(mktemp -d)
  curl -fsSL --retry 5 --retry-delay 3 -o "$tmp/docker-compose-linux-${arch}" "$url"
  if curl -fsSL --retry 5 --retry-delay 3 -o "$tmp/docker-compose-linux-${arch}.sha256" "$url.sha256"; then
    (cd "$tmp" && sha256sum --check --status "docker-compose-linux-${arch}.sha256") || die "Docker Compose checksum mismatch"
  else
    log "WARNING: no checksum file published for $COMPOSE_VERSION - skipping verification"
  fi
  install -D -m 0755 "$tmp/docker-compose-linux-${arch}" "$target"
  rm -rf "$tmp"
  docker compose version
}

create_swap() {
  if [ "${SWAP_SIZE_MB:-0}" -le 0 ] || swapon --show=NAME --noheadings | grep -qx /swapfile; then
    return
  fi
  log "Creating ${SWAP_SIZE_MB} MiB swap file"
  [ -f /swapfile ] || dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_SIZE_MB" status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
}

tune_kernel() {
  cat > /etc/sysctl.d/90-app.conf <<'EOF'
# Prefer RAM, swap only under pressure.
vm.swappiness = 10
# Recommended by MongoDB.
vm.max_map_count = 262144
EOF
  sysctl --system >/dev/null
}

# The EBS volume is attached by Terraform right after the instance starts, so wait for it.
# Device naming differs: NVMe (t3, t4g...) vs Xen (t2), hence the candidate list.
mount_data_volume() {
  [ "$DB_MODE" = "local" ] || return 0
  local device="" volume="${DATA_VOLUME_ID//-/}" candidate uuid

  log "Waiting for data volume $DATA_VOLUME_ID"
  for _ in $(seq 1 90); do
    for candidate in "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${volume}" /dev/sdf /dev/xvdf; do
      if [ -b "$candidate" ]; then
        device=$(readlink -f "$candidate")
        break 2
      fi
    done
    sleep 5
  done
  [ -n "$device" ] || die "data volume $DATA_VOLUME_ID was never attached"

  if [ -z "$(blkid -o value -s TYPE "$device" || true)" ]; then
    log "Formatting new data volume $device"
    mkfs.xfs -q -L appdata "$device"
  fi

  uuid=$(blkid -o value -s UUID "$device")
  mkdir -p /data
  grep -q "UUID=$uuid" /etc/fstab || echo "UUID=$uuid /data xfs defaults,nofail,noatime 0 2" >> /etc/fstab
  systemctl daemon-reload
  mountpoint -q /data || mount /data
  mkdir -p /data/mongo
  log "Data volume mounted on /data ($device)"
}

main() {
  load_settings
  trap on_exit EXIT
  rm -f "$STATE_DIR/bootstrap-failed"
  log "Bootstrapping $(hostname) ($(uname -m)), environment $APP_NAME"

  install_packages
  configure_docker
  install_compose
  create_swap
  tune_kernel
  mount_data_volume
  "$APP_DIR/bin/configure-host.sh"

  touch "$STATE_DIR/bootstrapped"
  log "Bootstrap complete"
}

main "$@"; exit $?
