#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# wait-for-cluster.sh
# Polls the K8s API until all nodes are Ready, then saves kubeconfig
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CONTROL_PLANE_VIP="${1:-$CONTROL_PLANE_VIP}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
KUBECONFIG_PATH="${OUTPUT_DIR}/kubeconfig"
POLL_INTERVAL=15
TIMEOUT=1800  # 30 minutes max

log() { echo "[wait] $*"; }

[[ -z "$CONTROL_PLANE_VIP" ]] && {
  echo "Usage: wait-for-cluster.sh <CONTROL_PLANE_VIP>"
  exit 1
}

API_ENDPOINT="https://${CONTROL_PLANE_VIP}:6443"
START_TIME=$(date +%s)

log "Polling API server: $API_ENDPOINT"
log "Timeout: ${TIMEOUT}s | Poll interval: ${POLL_INTERVAL}s"
log ""

# ─── Phase 1: Wait for API server to respond ─────────────────────
log "Phase 1: Waiting for API server to come up..."
until curl -sk --max-time 5 "${API_ENDPOINT}/healthz" | grep -q "ok"; do
  ELAPSED=$(( $(date +%s) - START_TIME ))
  if [[ $ELAPSED -gt $TIMEOUT ]]; then
    log "ERROR: Timed out waiting for API server after ${ELAPSED}s"
    exit 1
  fi
  log "  API server not ready yet... (${ELAPSED}s elapsed)"
  sleep $POLL_INTERVAL
done
log "✓ API server is up"

# ─── Phase 2: Copy kubeconfig from control plane ─────────────────
log ""
log "Phase 2: Fetching kubeconfig from controller-1..."

CONTROLLER_1_IP=$(jq -r '.controllers[0].ip' <(yq eval -o json "${CLUSTER_CONFIG:-/config/cluster.yaml}") 2>/dev/null || echo "")

if [[ -n "$CONTROLLER_1_IP" ]]; then
  mkdir -p "$OUTPUT_DIR"
  # Try to copy kubeconfig via SSH (key must be available)
  for attempt in $(seq 1 10); do
    if ssh -o StrictHostKeyChecking=no \
           -o ConnectTimeout=10 \
           core@${CONTROLLER_1_IP} \
           "sudo cat /etc/kubernetes/admin.conf" \
           > "$KUBECONFIG_PATH" 2>/dev/null; then

      # Replace internal IP with VIP for external access
      sed -i "s|server: https://.*:6443|server: ${API_ENDPOINT}|" "$KUBECONFIG_PATH"
      log "✓ Kubeconfig saved to: $KUBECONFIG_PATH"
      break
    fi
    log "  Attempt $attempt: kubeconfig not ready yet..."
    sleep $POLL_INTERVAL
  done
else
  log "⚠ Could not determine controller-1 IP. Copy kubeconfig manually."
fi

export KUBECONFIG="$KUBECONFIG_PATH"

# ─── Phase 2.5: Install Flannel CNI ──────────────────────────────
# Flannel must be running before kubelet can mark nodes as Ready.
if [[ "${ADDON_FLANNEL_ENABLED:-true}" == "true" && -f "$KUBECONFIG_PATH" ]]; then
  log ""
  log "Phase 2.5: Installing Flannel CNI..."
  FLANNEL_MANIFEST="/usr/local/share/addons/flannel.yaml"
  if [[ -f "$FLANNEL_MANIFEST" ]]; then
    # Patch the default 10.244.0.0/16 with the configured pod CIDR
    sed "s|10.244.0.0/16|${POD_SUBNET:-10.244.0.0/16}|g" "$FLANNEL_MANIFEST" | \
      kubectl apply -f -
    log "✓ Flannel CNI installed (pod CIDR: ${POD_SUBNET:-10.244.0.0/16})"
  else
    log "⚠ Flannel manifest not found at $FLANNEL_MANIFEST — skipping CNI install"
  fi
fi

# ─── Phase 3: Wait for all nodes to be Ready ─────────────────────
log ""
log "Phase 3: Waiting for all nodes to be Ready..."

EXPECTED_NODES=$((
  $(yq eval '.controllers | length' "${CLUSTER_CONFIG:-/config/cluster.yaml}" 2>/dev/null || echo 1) +
  $(yq eval '.workers | length'     "${CLUSTER_CONFIG:-/config/cluster.yaml}" 2>/dev/null || echo 0)
))

log "Expecting $EXPECTED_NODES nodes total"

until [[ "$(kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready")" -ge "$EXPECTED_NODES" ]]; do
  ELAPSED=$(( $(date +%s) - START_TIME ))
  if [[ $ELAPSED -gt $TIMEOUT ]]; then
    log "ERROR: Timed out waiting for nodes. Current state:"
    kubectl get nodes 2>/dev/null || true
    exit 1
  fi
  READY=$(kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready" || echo 0)
  log "  $READY/$EXPECTED_NODES nodes Ready... (${ELAPSED}s elapsed)"
  sleep $POLL_INTERVAL
done

log ""
log "✓ All $EXPECTED_NODES nodes are Ready!"
kubectl get nodes -o wide
