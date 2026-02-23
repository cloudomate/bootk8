#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Bootstrap Node Entrypoint
# Orchestrates Matchbox + dnsmasq to PXE boot a Flatcar K8s cluster
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_CONFIG="${CLUSTER_CONFIG:-/config/cluster.yaml}"
LOG_PREFIX="[bootstrap]"

log()  { echo "${LOG_PREFIX} $*"; }
err()  { echo "${LOG_PREFIX} ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<EOF

K8s Distro Bootstrap Node

USAGE:
  docker run --net=host \\
    -v ./cluster.yaml:/config/cluster.yaml \\
    your-distro/bootstrap:latest <command>

COMMANDS:
  init          Bootstrap a new cluster (full flow)
  generate      Generate Ignition + Matchbox configs only (no servers)
  serve         Start Matchbox + dnsmasq (configs must already exist)
  wait          Wait for cluster to be ready (configs + kubeconfig must exist)
  validate      Validate cluster.yaml config
  teardown      Stop all bootstrap services

OPTIONS:
  --config PATH   Path to cluster.yaml (default: /config/cluster.yaml)
  --help          Show this help

EXAMPLE:
  docker run --net=host --privileged \\
    -v \$(pwd)/cluster.yaml:/config/cluster.yaml \\
    -v \$(pwd)/output:/output \\
    your-distro/bootstrap:latest init

EOF
  exit 0
}

# ─── Parse args ───────────────────────────────────────────────────
COMMAND=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    init|generate|serve|wait|validate|teardown)
      COMMAND="$1"; shift ;;
    --config)
      CLUSTER_CONFIG="$2"; shift 2 ;;
    --help|-h)
      usage ;;
    *)
      die "Unknown argument: $1. Run with --help for usage." ;;
  esac
done

[[ -z "$COMMAND" ]] && usage

# ─── Load cluster config ──────────────────────────────────────────
load_config() {
  [[ -f "$CLUSTER_CONFIG" ]] || die "Cluster config not found: $CLUSTER_CONFIG"
  log "Loading config: $CLUSTER_CONFIG"

  export BOOTSTRAP_IP=$(jq -r '.bootstrap.ip' <(yq eval -o json "$CLUSTER_CONFIG"))
  export CLUSTER_NAME=$(jq -r '.cluster.name' <(yq eval -o json "$CLUSTER_CONFIG"))
  export CONTROL_PLANE_VIP=$(jq -r '.cluster.control_plane_vip' <(yq eval -o json "$CLUSTER_CONFIG"))
  export POD_SUBNET=$(jq -r '.cluster.pod_subnet // "10.244.0.0/16"' <(yq eval -o json "$CLUSTER_CONFIG"))
  export SERVICE_SUBNET=$(jq -r '.cluster.service_subnet // "10.96.0.0/12"' <(yq eval -o json "$CLUSTER_CONFIG"))
  export K8S_VERSION=$(jq -r '.cluster.k8s_version // "v1.31.0"' <(yq eval -o json "$CLUSTER_CONFIG"))
  export FLATCAR_VERSION=$(jq -r '.cluster.flatcar_version // env.FLATCAR_VERSION' <(yq eval -o json "$CLUSTER_CONFIG"))
  export SSH_AUTHORIZED_KEY=$(jq -r '.cluster.ssh_authorized_key' <(yq eval -o json "$CLUSTER_CONFIG"))
  export KUBEADM_TOKEN=$(jq -r '.cluster.kubeadm_token // ""' <(yq eval -o json "$CLUSTER_CONFIG"))

  # Generate a token if not provided
  if [[ -z "$KUBEADM_TOKEN" ]]; then
    KUBEADM_TOKEN=$(generate-token.sh)
    log "Generated kubeadm token: $KUBEADM_TOKEN"
  fi
  export KUBEADM_TOKEN

  log "Cluster: $CLUSTER_NAME | VIP: $CONTROL_PLANE_VIP | K8s: $K8S_VERSION | Flatcar: $FLATCAR_VERSION"
}

# ─── Commands ─────────────────────────────────────────────────────

cmd_validate() {
  load_config
  validate-config.sh "$CLUSTER_CONFIG"
  log "✓ Config is valid"
}

cmd_generate() {
  load_config
  log "Generating Matchbox profiles, groups, and Ignition configs..."
  generate-configs.sh "$CLUSTER_CONFIG"
  log "✓ Configs generated in /var/lib/matchbox/"
}

cmd_serve() {
  log "Starting Matchbox on :8080..."
  matchbox \
    -address=0.0.0.0:8080 \
    -assets-path=/var/lib/matchbox/assets \
    -data-path=/var/lib/matchbox \
    -log-level=info &
  MATCHBOX_PID=$!

  log "Starting dnsmasq (DHCP proxy + TFTP + PXE)..."
  dnsmasq --conf-file=/var/lib/matchbox/dnsmasq.conf --no-daemon &
  DNSMASQ_PID=$!

  log "✓ Bootstrap services running"
  log "  Matchbox: http://${BOOTSTRAP_IP:-0.0.0.0}:8080"
  log "  dnsmasq PID: $DNSMASQ_PID"

  # Trap shutdown
  trap "log 'Shutting down...'; kill $MATCHBOX_PID $DNSMASQ_PID 2>/dev/null; exit 0" SIGTERM SIGINT

  wait $MATCHBOX_PID $DNSMASQ_PID
}

cmd_wait() {
  load_config
  wait-for-cluster.sh "$CONTROL_PLANE_VIP"
}

cmd_teardown() {
  log "Stopping bootstrap services..."
  pkill matchbox  2>/dev/null || true
  pkill dnsmasq   2>/dev/null || true
  log "✓ Bootstrap node torn down. Cluster is self-sufficient."
}

cmd_init() {
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log " Initializing cluster: $CLUSTER_NAME"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  cmd_validate
  cmd_generate

  log ""
  log "Starting PXE boot services..."
  # Start matchbox + dnsmasq in background for this run
  matchbox \
    -address=0.0.0.0:8080 \
    -assets-path=/var/lib/matchbox/assets \
    -data-path=/var/lib/matchbox \
    -log-level=info &

  dnsmasq --conf-file=/var/lib/matchbox/dnsmasq.conf --no-daemon &

  log "✓ Matchbox running at http://${BOOTSTRAP_IP}:8080"
  log ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log " ACTION REQUIRED: Power on your nodes now"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""
  log " 1. Power on control plane nodes (they will PXE boot automatically)"
  log " 2. SSH into controller-1 and run:"
  log "      sudo /opt/bin/kubeadm init --config /home/core/kubeadm-init.yaml"
  log " 3. Copy the join commands from kubeadm output"
  log " 4. Power on worker nodes"
  log ""
  log "Waiting for cluster to become healthy..."

  # Wait for cluster (polls API server)
  wait-for-cluster.sh "$CONTROL_PLANE_VIP"

  log ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log " ✓ Cluster is healthy! Bootstrap complete."
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log ""
  log " Kubeconfig saved to: /output/kubeconfig"
  log " Run: export KUBECONFIG=/output/kubeconfig"
  log "      kubectl get nodes"
  log ""

  cmd_teardown
}

# ─── Dispatch ─────────────────────────────────────────────────────
case "$COMMAND" in
  init)     load_config; cmd_init ;;
  generate) cmd_generate ;;
  serve)    load_config; cmd_serve ;;
  wait)     cmd_wait ;;
  validate) cmd_validate ;;
  teardown) cmd_teardown ;;
esac
