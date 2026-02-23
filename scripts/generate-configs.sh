#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# generate-configs.sh
# Reads cluster.yaml and renders all Matchbox + Ignition configs
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_CONFIG="${1:-/config/cluster.yaml}"
MATCHBOX_DIR="/var/lib/matchbox"
TEMPLATES_DIR="/templates"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"

log() { echo "[generate] $*"; }

# ─── Parse cluster.yaml ───────────────────────────────────────────
log "Parsing cluster config..."

CLUSTER_JSON=$(yq eval -o json "$CLUSTER_CONFIG")

BOOTSTRAP_IP=$(echo "$CLUSTER_JSON"        | jq -r '.bootstrap.ip')
CLUSTER_NAME=$(echo "$CLUSTER_JSON"        | jq -r '.cluster.name')
CONTROL_PLANE_VIP=$(echo "$CLUSTER_JSON"   | jq -r '.cluster.control_plane_vip')
POD_SUBNET=$(echo "$CLUSTER_JSON"          | jq -r '.cluster.pod_subnet // "10.244.0.0/16"')
SERVICE_SUBNET=$(echo "$CLUSTER_JSON"      | jq -r '.cluster.service_subnet // "10.96.0.0/12"')
K8S_VERSION=$(echo "$CLUSTER_JSON"         | jq -r '.cluster.k8s_version // "v1.31.0"')
FLATCAR_VERSION=$(echo "$CLUSTER_JSON"     | jq -r '.cluster.flatcar_version // env.FLATCAR_VERSION')
SSH_KEY=$(echo "$CLUSTER_JSON"             | jq -r '.cluster.ssh_authorized_key')
KUBEADM_TOKEN="${KUBEADM_TOKEN:-$(generate-token.sh)}"

export BOOTSTRAP_IP CLUSTER_NAME CONTROL_PLANE_VIP POD_SUBNET \
       SERVICE_SUBNET K8S_VERSION FLATCAR_VERSION SSH_KEY KUBEADM_TOKEN

# ─── Matchbox profiles ────────────────────────────────────────────
log "Generating Matchbox profiles..."

for role in bootstrap controller worker; do
  envsubst < "${TEMPLATES_DIR}/profiles/${role}.json.tmpl" \
    > "${MATCHBOX_DIR}/profiles/${role}.json"
  log "  ✓ profiles/${role}.json"
done

# ─── Matchbox groups (one per node) ──────────────────────────────
log "Generating Matchbox groups..."

# Bootstrap node group
BOOTSTRAP_MAC=$(echo "$CLUSTER_JSON" | jq -r '.bootstrap.mac')
export NODE_ROLE=bootstrap NODE_NAME=bootstrap NODE_MAC="$BOOTSTRAP_MAC" NODE_IP="$BOOTSTRAP_IP"
envsubst < "${TEMPLATES_DIR}/groups/node.json.tmpl" \
  > "${MATCHBOX_DIR}/groups/bootstrap.json"
log "  ✓ groups/bootstrap.json (mac: $BOOTSTRAP_MAC)"

# Controller groups
CONTROLLER_COUNT=$(echo "$CLUSTER_JSON" | jq '.controllers | length')
for i in $(seq 0 $((CONTROLLER_COUNT - 1))); do
  NODE=$(echo "$CLUSTER_JSON" | jq -r ".controllers[$i]")
  export NODE_ROLE=controller
  export NODE_NAME=$(echo "$NODE" | jq -r '.name')
  export NODE_MAC=$(echo "$NODE"  | jq -r '.mac')
  export NODE_IP=$(echo "$NODE"   | jq -r '.ip')

  envsubst < "${TEMPLATES_DIR}/groups/node.json.tmpl" \
    > "${MATCHBOX_DIR}/groups/${NODE_NAME}.json"
  log "  ✓ groups/${NODE_NAME}.json (mac: $NODE_MAC)"
done

# Worker groups
WORKER_COUNT=$(echo "$CLUSTER_JSON" | jq '.workers | length')
for i in $(seq 0 $((WORKER_COUNT - 1))); do
  NODE=$(echo "$CLUSTER_JSON" | jq -r ".workers[$i]")
  export NODE_ROLE=worker
  export NODE_NAME=$(echo "$NODE" | jq -r '.name')
  export NODE_MAC=$(echo "$NODE"  | jq -r '.mac')
  export NODE_IP=$(echo "$NODE"   | jq -r '.ip')

  envsubst < "${TEMPLATES_DIR}/groups/node.json.tmpl" \
    > "${MATCHBOX_DIR}/groups/${NODE_NAME}.json"
  log "  ✓ groups/${NODE_NAME}.json (mac: $NODE_MAC)"
done

# ─── Ignition configs ─────────────────────────────────────────────
log "Generating Ignition configs via Butane..."

for role in bootstrap controller worker; do
  envsubst < "${TEMPLATES_DIR}/ignition/${role}.yaml.tmpl" \
    > /tmp/${role}.bu

  butane --strict /tmp/${role}.bu \
    -o "${MATCHBOX_DIR}/ignition/${role}.json"
  log "  ✓ ignition/${role}.json"
done

# ─── dnsmasq config ───────────────────────────────────────────────
log "Generating dnsmasq config..."
envsubst < "${TEMPLATES_DIR}/dnsmasq.conf.tmpl" \
  > "${MATCHBOX_DIR}/dnsmasq.conf"
log "  ✓ dnsmasq.conf"

# ─── Output summary ───────────────────────────────────────────────
mkdir -p "$OUTPUT_DIR"

# Save the token so the operator can use it for kubeadm join
cat > "${OUTPUT_DIR}/bootstrap-info.env" <<EOF
KUBEADM_TOKEN=${KUBEADM_TOKEN}
CONTROL_PLANE_VIP=${CONTROL_PLANE_VIP}
K8S_VERSION=${K8S_VERSION}
FLATCAR_VERSION=${FLATCAR_VERSION}
CLUSTER_NAME=${CLUSTER_NAME}
EOF

log ""
log "✓ All configs generated. Summary:"
log "  Profiles : $(ls ${MATCHBOX_DIR}/profiles/ | wc -l)"
log "  Groups   : $(ls ${MATCHBOX_DIR}/groups/   | wc -l)"
log "  Ignition : $(ls ${MATCHBOX_DIR}/ignition/ | wc -l)"
log "  Token    : ${KUBEADM_TOKEN}"
log ""
log "  Bootstrap info saved to: ${OUTPUT_DIR}/bootstrap-info.env"
