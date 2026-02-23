#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# install-addons.sh
# Installs platform add-ons onto a running cluster in dependency order:
#   1. Cert-Manager   (TLS automation — no deps)
#   2. MetalLB        (bare metal LoadBalancer — no deps)
#   3. Rook-Ceph      (distributed storage — needs nodes + raw disks)
#   4. Nebraska       (Flatcar update server — needs MetalLB + Rook-Ceph)
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-/output}"
KUBECONFIG="${OUTPUT_DIR}/kubeconfig"
MANIFESTS_DIR="/usr/local/share/addons"
TEMPLATES_DIR="/templates/addons"

export KUBECONFIG

log()  { echo "[addons] $*"; }
err()  { echo "[addons] ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

[[ -f "$KUBECONFIG" ]] || die "Kubeconfig not found: $KUBECONFIG"

kube() { kubectl --kubeconfig="$KUBECONFIG" "$@"; }

wait_rollout() {
  local ns="$1" resource="$2"
  log "  Waiting for $resource in $ns..."
  kube -n "$ns" rollout status "$resource" --timeout=300s
}

# ── 1. Cert-Manager ───────────────────────────────────────────────
install_cert_manager() {
  log "━━ Installing cert-manager ${ADDON_CERT_MANAGER_VERSION}..."

  kube apply -f "${MANIFESTS_DIR}/cert-manager.yaml"

  wait_rollout cert-manager deployment/cert-manager
  wait_rollout cert-manager deployment/cert-manager-webhook
  wait_rollout cert-manager deployment/cert-manager-cainjector

  # Webhook needs a moment to register before we can create issuers
  log "  Waiting for cert-manager webhook to be ready..."
  sleep 15
  kube wait --for=condition=Available deployment/cert-manager-webhook \
    -n cert-manager --timeout=120s

  # Self-signed ClusterIssuer
  envsubst < "${TEMPLATES_DIR}/cert-manager-issuer.yaml.tmpl" | kube apply -f -
  log "✓ cert-manager ready — ClusterIssuer 'selfsigned' created"
}

# ── 2. MetalLB ────────────────────────────────────────────────────
install_metallb() {
  log "━━ Installing MetalLB ${ADDON_METALLB_VERSION}..."

  kube apply -f "${MANIFESTS_DIR}/metallb-native.yaml"

  wait_rollout metallb-system deployment/controller

  # Wait for CRDs to be established before applying config
  kube wait --for=condition=established \
    crd/ipaddresspools.metallb.io \
    crd/l2advertisements.metallb.io \
    --timeout=60s

  # Apply IP pool + L2 advertisement
  envsubst < "${TEMPLATES_DIR}/metallb-config.yaml.tmpl" | kube apply -f -
  log "✓ MetalLB ready — IP pool: ${ADDON_METALLB_IP_POOL}"
}

# ── 3. Rook-Ceph ──────────────────────────────────────────────────
install_rook_ceph() {
  log "━━ Installing Rook-Ceph ${ADDON_ROOK_CEPH_VERSION}..."

  # Step 1: CRDs + common RBAC + operator
  kube apply -f "${MANIFESTS_DIR}/rook-ceph-crds.yaml"
  kube apply -f "${MANIFESTS_DIR}/rook-ceph-common.yaml"
  kube apply -f "${MANIFESTS_DIR}/rook-ceph-operator.yaml"

  wait_rollout rook-ceph deployment/rook-ceph-operator

  # Step 2: CephCluster (drives OSD discovery + mon/mgr/mds deployment)
  envsubst < "${TEMPLATES_DIR}/rook-ceph-cluster.yaml.tmpl" | kube apply -f -

  # Step 3: Wait for cluster health — poll ceph status via toolbox
  log "  Waiting for Ceph cluster to reach HEALTH_OK (up to 15m)..."
  local deadline=$(( $(date +%s) + 900 ))
  until kube -n rook-ceph exec deploy/rook-ceph-tools -- ceph status 2>/dev/null \
      | grep -q "HEALTH_OK"; do
    if [[ $(date +%s) -gt $deadline ]]; then
      err "Ceph cluster did not reach HEALTH_OK within 15 minutes"
      kube -n rook-ceph exec deploy/rook-ceph-tools -- ceph status || true
      exit 1
    fi
    log "  Ceph not yet healthy, retrying in 20s..."
    sleep 20
  done

  # Step 4: Apply CephBlockPool + RBD StorageClass (set as cluster default)
  envsubst < "${TEMPLATES_DIR}/rook-ceph-storageclass.yaml.tmpl" | kube apply -f -

  log "✓ Rook-Ceph ready — StorageClass 'rook-ceph-block' set as cluster default"
}

# ── 4. Nebraska ───────────────────────────────────────────────────
install_nebraska() {
  log "━━ Installing Nebraska ${ADDON_NEBRASKA_VERSION} (Flatcar update server)..."

  envsubst < "${TEMPLATES_DIR}/nebraska.yaml.tmpl" | kube apply -f -

  # Wait for PostgreSQL then Nebraska itself
  kube -n nebraska rollout status deployment/postgres  --timeout=300s
  kube -n nebraska rollout status deployment/nebraska  --timeout=300s

  log "✓ Nebraska ready"
  log "  UI: http://${ADDON_NEBRASKA_IP}:8000"
  log "  Flatcar nodes point their update engine at:"
  log "    http://${ADDON_NEBRASKA_IP}:8000/v1/update/"
}

# ── Main ──────────────────────────────────────────────────────────
log "Starting add-on installation..."
log ""

[[ "${ADDON_CERT_MANAGER_ENABLED:-false}" == "true" ]] && install_cert_manager
[[ "${ADDON_METALLB_ENABLED:-false}"      == "true" ]] && install_metallb
[[ "${ADDON_ROOK_CEPH_ENABLED:-false}"    == "true" ]] && install_rook_ceph
[[ "${ADDON_NEBRASKA_ENABLED:-false}"     == "true" ]] && install_nebraska

log ""
log "✓ All enabled add-ons installed successfully"
