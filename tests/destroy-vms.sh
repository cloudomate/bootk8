#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# tests/destroy-vms.sh
# Tears down all KVM VMs created from cluster.yaml
# Usage: bash tests/destroy-vms.sh [cluster.yaml]
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_CONFIG="${1:-cluster.yaml}"
DISK_DIR="/var/lib/libvirt/images"

log() { echo "[kvm] $*"; }

CLUSTER_JSON=$(yq eval -o json "$CLUSTER_CONFIG")

destroy_vm() {
  local name=$1
  log "Destroying $name..."
  virsh destroy  "$name" 2>/dev/null || true
  virsh undefine "$name" --remove-all-storage 2>/dev/null || true
  rm -f "${DISK_DIR}/${name}.qcow2"
  log "  ✓ $name removed"
}

# Controllers
CTRL_COUNT=$(echo "$CLUSTER_JSON" | jq '.controllers | length')
for i in $(seq 0 $((CTRL_COUNT - 1))); do
  destroy_vm "$(echo "$CLUSTER_JSON" | jq -r ".controllers[$i].name")"
done

# Workers
WORKER_COUNT=$(echo "$CLUSTER_JSON" | jq '.workers | length')
for i in $(seq 0 $((WORKER_COUNT - 1))); do
  destroy_vm "$(echo "$CLUSTER_JSON" | jq -r ".workers[$i].name")"
done

log "✓ All VMs destroyed"
