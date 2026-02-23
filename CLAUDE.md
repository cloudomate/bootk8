# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`bootstrap-hci` is a Docker container image that bootstraps a Kubernetes cluster on bare metal using Flatcar Container Linux. It implements an OpenShift-style bootstrap node pattern: a temporary PXE boot server provisions and deploys an entire cluster, then tears itself down.

## Build Commands

The project uses GNU Make + Docker multi-stage builds. There is no Node/Python/Cargo package manager — everything is shell + Docker.

```bash
# Build everything: binaries → sysext → bootstrap container
make build

# Build steps individually
make build-binaries   # Requires K8S_SRC_DIR env var pointing to a K8s fork
make build-sysext     # Package binaries as Flatcar sysext OCI image
make build-bootstrap  # Build the final bootstrap container

# Push images to registry
make push

# Lint: validate Ignition templates with butane --strict
make lint-ignition

# Run bootstrap in a local KVM test environment
make test-local       # Requires libvirt, KVM, qemu-img, virt-install

make clean            # Remove bin/, sysext/, output/
```

Key Makefile variables:
- `REGISTRY` (default: `ghcr.io/your-org/bootstrap-hci`)
- `DISTRO_VERSION` (default: `hci-v1.31.0-1`)
- `FLATCAR_VERSION` (default: `3975.2.2`)
- `K8S_SRC_DIR` — path to Kubernetes source fork, required for `build-binaries`

## Architecture

### Data Flow

```
cluster.yaml (user config)
    ↓
entrypoint.sh (dispatcher)
    ├── validate-config  → validate-config.sh
    ├── generate         → generate-configs.sh
    │     ├── renders templates/profiles/{bootstrap,controller,worker}.json.tmpl
    │     ├── renders templates/groups/node.json.tmpl (one per node)
    │     ├── transpiles templates/ignition/*.yaml.tmpl → JSON (via butane)
    │     └── renders templates/dnsmasq.conf.tmpl
    ├── serve            → starts Matchbox HTTP (:8080) + dnsmasq (DHCP proxy + TFTP)
    ├── wait             → wait-for-cluster.sh (polls API, fetches kubeconfig, waits for Ready nodes)
    └── teardown         → stops Matchbox + dnsmasq
```

### Key Components

- **[scripts/entrypoint.sh](scripts/entrypoint.sh)** — Main dispatcher; parses CLI commands and loads `cluster.yaml` into env vars
- **[scripts/generate-configs.sh](scripts/generate-configs.sh)** — Renders all templates via `envsubst` and transpiles Ignition YAML via `butane`
- **[scripts/wait-for-cluster.sh](scripts/wait-for-cluster.sh)** — Polls API server `/healthz`, fetches kubeconfig via SSH, waits for all nodes Ready
- **[scripts/generate-token.sh](scripts/generate-token.sh)** — Generates kubeadm bootstrap token format
- **Matchbox** — External PXE/iPXE boot server; serves profiles and Ignition configs over HTTP
- **dnsmasq** — External DHCP proxy + TFTP server; directs nodes to Matchbox

### Templates

All configs are generated from templates in `templates/` using environment variables:

| Directory | Purpose |
|-----------|---------|
| `templates/profiles/` | PXE boot configs per node role (bootstrap, controller, worker) |
| `templates/groups/` | Maps MAC addresses to profiles (one file per node) |
| `templates/ignition/` | Ignition YAML templates (butane-transpiled to JSON); describe full node OS state |
| `templates/dnsmasq.conf.tmpl` | DHCP proxy + TFTP configuration |

### Node Roles

- **bootstrap** — Temporary; runs Matchbox + dnsmasq; exits after cluster is healthy
- **controller** — Control plane; runs kubeadm init/join, etcd, API server, scheduler
- **worker** — Data plane; joins cluster via kubeadm

### Network Requirements

The container must run with `--net=host --privileged` so dnsmasq can bind to DHCP (UDP 67), TFTP (UDP 69), and Matchbox HTTP (8080). All nodes must be on the same L2 network as the bootstrap node.

### Template Variable Scoping

- **Global** (all templates): `BOOTSTRAP_IP`, `CLUSTER_NAME`, `CONTROL_PLANE_VIP`, `K8S_VERSION`, `FLATCAR_VERSION`, `POD_SUBNET`, `SERVICE_SUBNET`, `SSH_KEY`, `KUBEADM_TOKEN`
- **Per-node** (groups template only): `NODE_NAME`, `NODE_IP`, `NODE_MAC`, `NODE_ROLE`

## Running the Bootstrap Container

```bash
# Validate cluster.yaml
docker run --rm -v $(pwd)/cluster.yaml:/config/cluster.yaml:ro <image> validate

# Generate configs only
docker run --rm -v $(pwd)/cluster.yaml:/config/cluster.yaml:ro -v $(pwd)/output:/output <image> generate

# Full bootstrap (generate + serve + wait + teardown)
docker run --rm --net=host --privileged \
  -v $(pwd)/cluster.yaml:/config/cluster.yaml:ro \
  -v $(pwd)/output:/output \
  <image> init
```

See `cluster.yaml.example` for the full configuration schema.
