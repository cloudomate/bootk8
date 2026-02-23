# Bootstrap Node Container

A self-contained container image that bootstraps a Kubernetes cluster on bare metal
Flatcar Container Linux — OpenShift-style bootstrap node pattern.

## How it works

```
docker run your-distro/bootstrap init
       │
       ├── Reads cluster.yaml
       ├── Generates all Ignition + Matchbox configs from templates
       ├── Starts Matchbox HTTP server  (serves PXE + Ignition configs)
       ├── Starts dnsmasq              (DHCP proxy + TFTP + PXE)
       ├── Prompts: "Power on your nodes now"
       ├── Waits for API server to come up
       ├── Waits for all nodes to be Ready
       ├── Saves kubeconfig to /output/kubeconfig
       └── Tears itself down
```

---

## Quick Start

### 1. Clone and configure

```bash
cp cluster.yaml.example cluster.yaml
# Edit cluster.yaml with your node IPs and MAC addresses
vim cluster.yaml
```

### 2. Build the image

```bash
docker build -t your-distro/bootstrap:latest .

# Or with specific versions
docker build \
  --build-arg FLATCAR_VERSION=3975.2.2 \
  --build-arg K8S_VERSION=1.31.0 \
  -t your-distro/bootstrap:v1.0.0 .
```

### 3. Validate your config

```bash
docker run --rm \
  -v $(pwd)/cluster.yaml:/config/cluster.yaml:ro \
  your-distro/bootstrap:latest validate
```

### 4. Run the bootstrap

```bash
mkdir -p output

docker run --rm \
  --net=host \
  --privileged \
  -v $(pwd)/cluster.yaml:/config/cluster.yaml:ro \
  -v $(pwd)/output:/output \
  your-distro/bootstrap:latest init
```

The container will:
1. Generate all configs
2. Start PXE boot services
3. Prompt you to power on your nodes
4. Wait for the cluster to become healthy
5. Save `output/kubeconfig` and shut down

### 5. Use your cluster

```bash
export KUBECONFIG=$(pwd)/output/kubeconfig
kubectl get nodes
```

---

## Commands

| Command    | Description                                            |
|------------|--------------------------------------------------------|
| `init`     | Full bootstrap flow (recommended)                      |
| `generate` | Generate configs only, do not start servers            |
| `serve`    | Start Matchbox + dnsmasq (configs must already exist)  |
| `wait`     | Poll until cluster is healthy, save kubeconfig         |
| `validate` | Validate cluster.yaml without generating anything      |
| `teardown` | Stop all bootstrap services                            |

---

## Directory Structure

```
bootstrap-node/
├── Dockerfile                      # Multi-stage build
├── docker-compose.yaml             # For development
├── cluster.yaml.example            # Config template
├── scripts/
│   ├── entrypoint.sh               # Main dispatcher
│   ├── generate-configs.sh         # Config generator
│   ├── wait-for-cluster.sh         # Health poller + kubeconfig fetcher
│   └── generate-token.sh           # kubeadm token generator
└── templates/
    ├── ignition/
    │   ├── bootstrap.yaml.tmpl     # Bootstrap node Ignition config
    │   ├── controller.yaml.tmpl    # Control plane Ignition config
    │   └── worker.yaml.tmpl        # Worker Ignition config
    ├── profiles/
    │   ├── bootstrap.json.tmpl     # Matchbox PXE profile
    │   ├── controller.json.tmpl
    │   └── worker.json.tmpl
    ├── groups/
    │   └── node.json.tmpl          # Node → profile mapping (by MAC)
    └── dnsmasq.conf.tmpl           # DHCP proxy + PXE config
```

---

## Network Requirements

| Requirement | Detail |
|---|---|
| `--net=host` | Required — container must bind to host network for PXE/DHCP |
| `--privileged` | Required — dnsmasq needs `NET_ADMIN` for DHCP proxy mode |
| Port 8080 | Matchbox HTTP (serves PXE scripts + Ignition configs) |
| Port 69/UDP | TFTP (serves iPXE bootloader) |
| Port 67/UDP | DHCP proxy |

The bootstrap node machine must be on the same L2 network as all bare metal nodes.

---

## Publishing to a Registry

```bash
# Tag and push
docker tag your-distro/bootstrap:latest ghcr.io/your-org/bootstrap:v1.0.0
docker push ghcr.io/your-org/bootstrap:v1.0.0

# Users can then run directly
docker run --net=host --privileged \
  -v $(pwd)/cluster.yaml:/config/cluster.yaml \
  -v $(pwd)/output:/output \
  ghcr.io/your-org/bootstrap:v1.0.0 init
```

---

## Customizing Templates

All Ignition and Matchbox configs are driven by templates in `/templates/`.
To add custom behaviour (GPU drivers, system extensions, custom units):

```bash
# Override templates at runtime
docker run --net=host --privileged \
  -v $(pwd)/cluster.yaml:/config/cluster.yaml \
  -v $(pwd)/my-templates:/templates \       # <-- your custom templates
  -v $(pwd)/output:/output \
  your-distro/bootstrap:latest init
```

Template variables available in all templates:

| Variable            | Source                         |
|---------------------|--------------------------------|
| `BOOTSTRAP_IP`      | cluster.yaml → bootstrap.ip    |
| `CLUSTER_NAME`      | cluster.yaml → cluster.name    |
| `CONTROL_PLANE_VIP` | cluster.yaml → control_plane_vip |
| `K8S_VERSION`       | cluster.yaml → cluster.k8s_version |
| `FLATCAR_VERSION`   | cluster.yaml → cluster.flatcar_version |
| `POD_SUBNET`        | cluster.yaml → cluster.pod_subnet |
| `SERVICE_SUBNET`    | cluster.yaml → cluster.service_subnet |
| `SSH_KEY`           | cluster.yaml → cluster.ssh_authorized_key |
| `KUBEADM_TOKEN`     | Auto-generated or cluster.yaml |
| `NODE_NAME`         | Per-node (groups only)         |
| `NODE_IP`           | Per-node (groups only)         |
| `NODE_MAC`          | Per-node (groups only)         |
| `NODE_ROLE`         | Per-node (groups only)         |

---

## Next Steps

After your cluster is up, consider adding:

- **Nebraska** — self-hosted Flatcar update server for controlling OS upgrades
- **Cert-Manager** — automated TLS certificate management
- **NVIDIA GPU Operator** — if worker nodes have GPUs
- **MetalLB** — bare metal load balancer for `LoadBalancer` services
- **Longhorn or Rook-Ceph** — persistent storage on bare metal
