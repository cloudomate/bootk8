#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# tests/create-vms.sh
# Creates KVM VMs from cluster.yaml for local bare metal testing
# Usage: bash tests/create-vms.sh [cluster.yaml]
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_CONFIG="${1:-cluster.yaml}"
NETWORK="pxe-net"
DISK_DIR="/var/lib/libvirt/images"
OS_VARIANT="generic"   # use 'osinfo-query os' to find a closer match

log() { echo "[kvm] $*"; }
die() { echo "[kvm] ERROR: $*" >&2; exit 1; }

command -v virt-install >/dev/null || die "virt-install not found. Install libvirt-clients."
command -v yq           >/dev/null || die "yq not found. Install with: pip3 install yq"
command -v jq           >/dev/null || die "jq not found."

[[ -f "$CLUSTER_CONFIG" ]] || die "cluster.yaml not found at: $CLUSTER_CONFIG"

CLUSTER_JSON=$(yq eval -o json "$CLUSTER_CONFIG")

# ─── Create a single VM ───────────────────────────────────────────
create_vm() {
  local name=$1
  local mac=$2
  local ram_mb=$3
  local vcpus=$4
  local disk_gb=$5

  # Skip if already exists
  if virsh dominfo "$name" &>/dev/null; then
    log "VM $name already exists — skipping"
    return
  fi

  log "Creating VM: $name"
  log "  MAC: $mac | RAM: ${ram_mb}MB | CPUs: $vcpus | Disk: ${disk_gb}GB"

  # Create blank qcow2 disk
  qemu-img create -f qcow2 "${DISK_DIR}/${name}.qcow2" "${disk_gb}G" >/dev/null

  virt-install \
    --name          "$name" \
    --memory        "$ram_mb" \
    --vcpus         "$vcpus" \
    --os-variant    "$OS_VARIANT" \
    --disk          "path=${DISK_DIR}/${name}.qcow2,format=qcow2,bus=virtio" \
    --network       "network=${NETWORK},mac=${mac},model=virtio" \
    --boot          "network,hd,menu=on" \
    --pxe \
    --graphics      "vnc,listen=127.0.0.1" \
    --noautoconsole \
    --noreboot \
    --print-xml > /tmp/${name}.xml

  virsh define /tmp/${name}.xml
  log "  ✓ $name defined"
}

# ─── Controllers ─────────────────────────────────────────────────
CTRL_COUNT=$(echo "$CLUSTER_JSON" | jq '.controllers | length')
log "Creating $CTRL_COUNT controller VM(s)..."

for i in $(seq 0 $((CTRL_COUNT - 1))); do
  NODE=$(echo "$CLUSTER_JSON" | jq -r ".controllers[$i]")
  create_vm \
    "$(echo "$NODE" | jq -r '.name')" \
    "$(echo "$NODE" | jq -r '.mac')" \
    4096 2 40
done

# ─── Workers ─────────────────────────────────────────────────────
WORKER_COUNT=$(echo "$CLUSTER_JSON" | jq '.workers | length')
log "Creating $WORKER_COUNT worker VM(s)..."

for i in $(seq 0 $((WORKER_COUNT - 1))); do
  NODE=$(echo "$CLUSTER_JSON" | jq -r ".workers[$i]")
  create_vm \
    "$(echo "$NODE" | jq -r '.name')" \
    "$(echo "$NODE" | jq -r '.mac')" \
    8192 4 80
done

# ─── Summary ─────────────────────────────────────────────────────
log ""
log "VMs created. Starting them now..."
virsh list --all | grep -E "controller|worker" | awk '{print $2}' | \
  xargs -I{} virsh start {} 2>/dev/null || true

log ""
log "✓ All VMs booting. They will PXE boot from the bootstrap container."
log ""
log "  Watch consoles: virt-manager"
log "  Or per-VM:      virsh console <name>"
log ""
log "  To destroy all test VMs:"
log "    bash tests/destroy-vms.sh $CLUSTER_CONFIG"
