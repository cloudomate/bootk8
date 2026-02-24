#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# write-status.sh — update /output/status.json
# Called throughout bootstrap to report live progress to the portal.
#
# Usage:
#   write-status.sh init    [phase] [message]   # initialize with node list
#   write-status.sh phase   <phase> [message]   # update top-level phase
#   write-status.sh node    <name>  <status> [message]
#   write-status.sh addon   <name>  <status> [message]
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-/output}"
STATUS_FILE="$OUTPUT_DIR/status.json"
CLUSTER_CONFIG="${CLUSTER_CONFIG:-/config/cluster.yaml}"

mkdir -p "$OUTPUT_DIR"

_now()  { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
_read() { [[ -f "$STATUS_FILE" ]] && cat "$STATUS_FILE" || \
          echo '{"phase":"idle","nodes":[],"addons":[],"kubeconfig_ready":false}'; }
_kc()   { [[ -f "$OUTPUT_DIR/kubeconfig" ]] && echo true || echo false; }

CMD="${1:-phase}"; shift || true

case "$CMD" in

  init)
    phase="${1:-generating}"
    message="${2:-}"
    NOW=$(_now)

    nodes_json='[]'
    if [[ -f "$CLUSTER_CONFIG" ]]; then
      ctrl=$(yq eval '.controllers // []' -o json "$CLUSTER_CONFIG" | \
             jq '[.[] | {name:.name, ip:.ip, role:"controller", status:"pending", message:""}]')
      work=$(yq eval '.workers // []' -o json "$CLUSTER_CONFIG" | \
             jq '[.[] | {name:.name, ip:.ip, role:"worker",     status:"pending", message:""}]')
      nodes_json=$(jq -n --argjson c "$ctrl" --argjson w "$work" '$c + $w')
    fi

    addons_json=$(jq -n \
      --arg f  "${ADDON_FLANNEL_ENABLED:-false}" \
      --arg m  "${ADDON_METALLB_ENABLED:-false}" \
      --arg cm "${ADDON_CERT_MANAGER_ENABLED:-false}" \
      --arg rc "${ADDON_ROOK_CEPH_ENABLED:-false}" \
      --arg nb "${ADDON_NEBRASKA_ENABLED:-false}" \
      '[
        {name:"flannel",      en:($f  == "true")},
        {name:"metallb",      en:($m  == "true")},
        {name:"cert-manager", en:($cm == "true")},
        {name:"rook-ceph",    en:($rc == "true")},
        {name:"nebraska",     en:($nb == "true")}
      ] | map(select(.en)) | map({name:.name, status:"pending", message:""})
    ')

    tmp=$(mktemp)
    jq -n \
      --arg phase   "$phase" \
      --arg message "$message" \
      --arg now     "$NOW" \
      --argjson nodes  "$nodes_json" \
      --argjson addons "$addons_json" \
      '{phase:$phase, message:$message, started_at:$now,
        nodes:$nodes, addons:$addons, kubeconfig_ready:false}' > "$tmp"
    mv "$tmp" "$STATUS_FILE"
    ;;

  phase)
    phase="${1:?phase required}"
    message="${2:-}"
    tmp=$(mktemp)
    _read | jq \
      --arg phase   "$phase" \
      --arg message "$message" \
      --arg now     "$(_now)" \
      --argjson kc  "$(_kc)" \
      '. + {phase:$phase, message:$message, updated_at:$now, kubeconfig_ready:$kc}
       | if ($phase == "complete" or $phase == "error")
         then . + {completed_at:$now} else . end' > "$tmp"
    mv "$tmp" "$STATUS_FILE"
    ;;

  node)
    name="${1:?name required}"
    status="${2:?status required}"
    message="${3:-}"
    tmp=$(mktemp)
    _read | jq \
      --arg name   "$name" \
      --arg status "$status" \
      --arg msg    "$message" \
      '.nodes = [.nodes[] | if .name == $name
                            then . + {status:$status, message:$msg}
                            else . end]' > "$tmp"
    mv "$tmp" "$STATUS_FILE"
    ;;

  addon)
    name="${1:?name required}"
    status="${2:?status required}"
    message="${3:-}"
    tmp=$(mktemp)
    _read | jq \
      --arg name   "$name" \
      --arg status "$status" \
      --arg msg    "$message" \
      '.addons = [.addons[] | if .name == $name
                              then . + {status:$status, message:$msg}
                              else . end]' > "$tmp"
    mv "$tmp" "$STATUS_FILE"
    ;;

esac
