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

# Status helper — writes /output/status.json for the management portal
_status() { write-status.sh "$@" 2>/dev/null || true; }

# On unexpected error, mark status as failed
trap '_status phase "error" "Bootstrap failed unexpectedly. Check container logs."' ERR

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
  addons        Install platform add-ons (requires a running cluster + kubeconfig)
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
    init|generate|serve|wait|addons|validate|teardown)
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

  local _cfg
  _cfg=$(yq eval -o json "$CLUSTER_CONFIG")

  export BOOTSTRAP_IP=$(echo "$_cfg"         | jq -r '.bootstrap.ip')
  export BOOTSTRAP_IFACE=$(echo "$_cfg"      | jq -r '.bootstrap.iface // ""')
  export CLUSTER_NAME=$(echo "$_cfg"         | jq -r '.cluster.name')
  export CONTROL_PLANE_VIP=$(echo "$_cfg"    | jq -r '.cluster.control_plane_vip')
  export POD_SUBNET=$(echo "$_cfg"           | jq -r '.cluster.pod_subnet // "10.244.0.0/16"')
  export SERVICE_SUBNET=$(echo "$_cfg"       | jq -r '.cluster.service_subnet // "10.96.0.0/12"')
  export K8S_VERSION=$(echo "$_cfg"          | jq -r '.cluster.k8s_version // "v1.31.0"')
  export FLATCAR_VERSION=$(echo "$_cfg"      | jq -r '.cluster.flatcar_version // env.FLATCAR_VERSION')
  # Support both list and singular SSH key forms
  export SSH_AUTHORIZED_KEYS=$(echo "$_cfg" | jq -r '
    if (.cluster.ssh_authorized_keys | type) == "array" then
      .cluster.ssh_authorized_keys | join(", ")
    else
      (.cluster.ssh_authorized_key // "")
    end')
  export KUBEADM_TOKEN=$(echo "$_cfg"        | jq -r '.cluster.kubeadm_token // ""')

  # Generate a token if not provided
  if [[ -z "$KUBEADM_TOKEN" ]]; then
    KUBEADM_TOKEN=$(generate-token.sh)
    log "Generated kubeadm token: $KUBEADM_TOKEN"
  fi
  export KUBEADM_TOKEN

  # ── Add-on configuration ─────────────────────────────────────────
  local cfg
  cfg=$(yq eval -o json "$CLUSTER_CONFIG")

  export ADDON_FLANNEL_ENABLED=$(echo "$cfg"      | jq -r '.addons.flannel.enabled      // "true"')
  export ADDON_FLANNEL_VERSION=$(echo "$cfg"       | jq -r '.addons.flannel.version      // "v0.25.7"')
  export ADDON_METALLB_ENABLED=$(echo "$cfg"       | jq -r '.addons.metallb.enabled      // "false"')
  export ADDON_METALLB_VERSION=$(echo "$cfg"       | jq -r '.addons.metallb.version      // "v0.14.9"')
  export ADDON_METALLB_IP_POOL=$(echo "$cfg"       | jq -r '.addons.metallb.ip_pool      // ""')
  export ADDON_CERT_MANAGER_ENABLED=$(echo "$cfg"  | jq -r '.addons.cert_manager.enabled // "false"')
  export ADDON_CERT_MANAGER_VERSION=$(echo "$cfg"  | jq -r '.addons.cert_manager.version // "v1.16.2"')
  export ADDON_ROOK_CEPH_ENABLED=$(echo "$cfg"        | jq -r '.addons.rook_ceph.enabled         // "false"')
  export ADDON_ROOK_CEPH_VERSION=$(echo "$cfg"        | jq -r '.addons.rook_ceph.version         // "v1.15.6"')
  export ADDON_ROOK_CEPH_REPLICA=$(echo "$cfg"        | jq -r '.addons.rook_ceph.replica_count   // "3"')
  export ADDON_ROOK_CEPH_OSD_FILTER=$(echo "$cfg"     | jq -r '.addons.rook_ceph.osd_device_filter // "^sd[b-z]|^vd[b-z]|^nvme[0-9]n[0-9]"')
  export ADDON_NEBRASKA_ENABLED=$(echo "$cfg"      | jq -r '.addons.nebraska.enabled     // "false"')
  export ADDON_NEBRASKA_VERSION=$(echo "$cfg"      | jq -r '.addons.nebraska.version     // "v2.8.14"')
  export ADDON_NEBRASKA_IP=$(echo "$cfg"           | jq -r '.addons.nebraska.ip          // ""')

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

  trap "log 'Shutting down...'; kill $MATCHBOX_PID $DNSMASQ_PID 2>/dev/null; exit 0" SIGTERM SIGINT

  wait $MATCHBOX_PID $DNSMASQ_PID
}

cmd_wait() {
  load_config
  wait-for-cluster.sh "$CONTROL_PLANE_VIP"
}

cmd_addons() {
  load_config
  log "Installing platform add-ons..."
  install-addons.sh
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

  # Initialize status file with node list + addon list
  _status init "generating" "Validating and generating cluster configs..."

  cmd_validate
  cmd_generate

  _status phase "serving" "PXE boot services running. Power on your nodes."

  log ""
  log "Starting PXE boot services..."
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

  _status phase "waiting" "Waiting for nodes to PXE boot and join the cluster..."
  log "Waiting for cluster to become healthy..."

  wait-for-cluster.sh "$CONTROL_PLANE_VIP"

  install-addons.sh

  _status phase "complete" "✓ Cluster is healthy! kubeconfig saved to /output/kubeconfig"

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
  addons)   cmd_addons ;;
  validate) cmd_validate ;;
  teardown) cmd_teardown ;;
esac
