#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# validate-config.sh  <cluster.yaml>
# Validates cluster.yaml for required fields and basic format checks.
# Exits 0 on success, 1 on any validation failure.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_CONFIG="${1:-/config/cluster.yaml}"
ERRORS=0

log()  { echo "[validate] $*"; }
fail() { echo "[validate] ERROR: $*" >&2; ERRORS=$((ERRORS + 1)); }

# ── Parse ─────────────────────────────────────────────────────────
[[ -f "$CLUSTER_CONFIG" ]] || { echo "[validate] ERROR: File not found: $CLUSTER_CONFIG" >&2; exit 1; }

cfg=$(yq eval -o json "$CLUSTER_CONFIG") || { echo "[validate] ERROR: Cannot parse YAML: $CLUSTER_CONFIG" >&2; exit 1; }

# Helper: get field value (returns "null" when missing)
field() { echo "$cfg" | jq -r "$1"; }

# ── Required scalar fields ─────────────────────────────────────────
check_required() {
  local label="$1" path="$2"
  local val
  val=$(field "$path")
  if [[ -z "$val" || "$val" == "null" ]]; then
    fail "Missing required field: $label ($path)"
  fi
}

check_required "cluster.name"            '.cluster.name'
check_required "cluster.control_plane_vip" '.cluster.control_plane_vip'

# ssh_authorized_keys (list) or ssh_authorized_key (singular) — at least one required
_keys_count=$(field '
  if (.cluster.ssh_authorized_keys | type) == "array" then
    .cluster.ssh_authorized_keys | length
  elif (.cluster.ssh_authorized_key // "") != "" then 1
  else 0 end')
if [[ "$_keys_count" -lt 1 ]]; then
  fail "Missing required field: cluster.ssh_authorized_keys (or cluster.ssh_authorized_key)"
fi
check_required "bootstrap.ip"            '.bootstrap.ip'
check_required "bootstrap.mac"           '.bootstrap.mac'

# ── SSH key basic sanity (all keys) ───────────────────────────────
_all_keys=$(field '
  if (.cluster.ssh_authorized_keys | type) == "array" then
    .cluster.ssh_authorized_keys[]
  elif (.cluster.ssh_authorized_key // "") != "" then
    .cluster.ssh_authorized_key
  else empty end')
while IFS= read -r _k; do
  [[ -z "$_k" ]] && continue
  case "$_k" in
    ssh-rsa\ *|ssh-ed25519\ *|ecdsa-sha2-*|sk-ssh-*) ;;
    *)
      fail "Not a valid SSH public key: ${_k:0:40}..."
      ;;
  esac
done <<< "$_all_keys"

# ── MAC address format helper ──────────────────────────────────────
is_mac() { [[ "$1" =~ ^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$ ]]; }

BOOTSTRAP_MAC=$(field '.bootstrap.mac')
if [[ "$BOOTSTRAP_MAC" != "null" && -n "$BOOTSTRAP_MAC" ]]; then
  is_mac "$BOOTSTRAP_MAC" || fail "bootstrap.mac is not a valid MAC address: $BOOTSTRAP_MAC"
fi

# ── Controllers ────────────────────────────────────────────────────
CTRL_COUNT=$(field '.controllers | length')
if [[ -z "$CTRL_COUNT" || "$CTRL_COUNT" == "null" || "$CTRL_COUNT" -lt 1 ]]; then
  fail "At least one controller node is required under 'controllers'"
else
  for i in $(seq 0 $((CTRL_COUNT - 1))); do
    name=$(field ".controllers[$i].name")
    ip=$(field   ".controllers[$i].ip")
    mac=$(field  ".controllers[$i].mac")

    [[ -z "$name" || "$name" == "null" ]] && fail "controllers[$i].name is required"
    [[ -z "$ip"   || "$ip"   == "null" ]] && fail "controllers[$i].ip is required (node: $name)"
    [[ -z "$mac"  || "$mac"  == "null" ]] && fail "controllers[$i].mac is required (node: $name)"
    if [[ "$mac" != "null" && -n "$mac" ]]; then
      is_mac "$mac" || fail "controllers[$i].mac is not a valid MAC address: $mac"
    fi
  done
  log "Controllers : $CTRL_COUNT node(s) — OK"
fi

# ── Workers (optional but entries must be complete) ────────────────
WORKER_COUNT=$(field '.workers | length')
if [[ -n "$WORKER_COUNT" && "$WORKER_COUNT" != "null" && "$WORKER_COUNT" -gt 0 ]]; then
  for i in $(seq 0 $((WORKER_COUNT - 1))); do
    name=$(field ".workers[$i].name")
    ip=$(field   ".workers[$i].ip")
    mac=$(field  ".workers[$i].mac")

    [[ -z "$name" || "$name" == "null" ]] && fail "workers[$i].name is required"
    [[ -z "$ip"   || "$ip"   == "null" ]] && fail "workers[$i].ip is required (node: $name)"
    [[ -z "$mac"  || "$mac"  == "null" ]] && fail "workers[$i].mac is required (node: $name)"
    if [[ "$mac" != "null" && -n "$mac" ]]; then
      is_mac "$mac" || fail "workers[$i].mac is not a valid MAC address: $mac"
    fi
  done
  log "Workers     : $WORKER_COUNT node(s) — OK"
else
  log "Workers     : 0 (control-plane-only cluster)"
fi

# ── Controller count warning ───────────────────────────────────────
if [[ "$CTRL_COUNT" -eq 2 ]]; then
  log "WARNING: 2 controllers has no quorum advantage over 1. Use 1 or 3."
fi

# ── MetalLB ip_pool required when Nebraska is enabled ─────────────
NEBRASKA_ENABLED=$(field '.addons.nebraska.enabled // "false"')
METALLB_ENABLED=$(field  '.addons.metallb.enabled // "false"')
if [[ "$NEBRASKA_ENABLED" == "true" && "$METALLB_ENABLED" != "true" ]]; then
  fail "addons.nebraska requires addons.metallb.enabled: true (Nebraska needs a LoadBalancer IP)"
fi

METALLB_POOL=$(field '.addons.metallb.ip_pool // ""')
if [[ "$METALLB_ENABLED" == "true" && ( -z "$METALLB_POOL" || "$METALLB_POOL" == "null" ) ]]; then
  fail "addons.metallb.ip_pool is required when MetalLB is enabled"
fi

# ── Result ─────────────────────────────────────────────────────────
if [[ "$ERRORS" -gt 0 ]]; then
  echo "[validate] $ERRORS error(s) found — fix cluster.yaml before continuing" >&2
  exit 1
fi

log "✓ Config valid — cluster=$(field '.cluster.name') vip=$(field '.cluster.control_plane_vip') controllers=$CTRL_COUNT workers=${WORKER_COUNT:-0}"
