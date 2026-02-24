export interface NodeEntry {
  name: string
  ip: string
  mac: string
}

export interface FlannelConfig {
  enabled: boolean
  version: string
}

export interface MetalLBConfig {
  enabled: boolean
  version: string
  ip_pool: string
}

export interface CertManagerConfig {
  enabled: boolean
  version: string
}

export interface RookCephConfig {
  enabled: boolean
  version: string
  osd_device_filter: string
  replica_count: number
}

export interface NebraskaConfig {
  enabled: boolean
  version: string
  ip: string
}

export interface AddonsConfig {
  flannel: FlannelConfig
  metallb: MetalLBConfig
  cert_manager: CertManagerConfig
  rook_ceph: RookCephConfig
  nebraska: NebraskaConfig
}

export interface ClusterConfig {
  cluster: {
    name: string
    control_plane_vip: string
    k8s_version: string
    flatcar_version: string
    pod_subnet: string
    service_subnet: string
    ssh_authorized_keys: string[]
    kubeadm_token: string
  }
  bootstrap: {
    ip: string
    mac: string
  }
  controllers: NodeEntry[]
  workers: NodeEntry[]
  addons: AddonsConfig
}

export const defaultConfig: ClusterConfig = {
  cluster: {
    name: 'my-k8s-cluster',
    control_plane_vip: '10.0.0.10',
    k8s_version: 'v1.31.0',
    flatcar_version: '3975.2.2',
    pod_subnet: '10.244.0.0/16',
    service_subnet: '10.96.0.0/12',
    ssh_authorized_keys: [],
    kubeadm_token: '',
  },
  bootstrap: {
    ip: '10.0.0.5',
    mac: '52:54:00:aa:bb:00',
  },
  controllers: [
    { name: 'controller-1', ip: '10.0.0.11', mac: '52:54:00:aa:bb:01' },
    { name: 'controller-2', ip: '10.0.0.12', mac: '52:54:00:aa:bb:02' },
    { name: 'controller-3', ip: '10.0.0.13', mac: '52:54:00:aa:bb:03' },
  ],
  workers: [
    { name: 'worker-1', ip: '10.0.0.21', mac: '52:54:00:aa:bb:11' },
    { name: 'worker-2', ip: '10.0.0.22', mac: '52:54:00:aa:bb:12' },
    { name: 'worker-3', ip: '10.0.0.23', mac: '52:54:00:aa:bb:13' },
  ],
  addons: {
    flannel: { enabled: true, version: 'v0.25.7' },
    metallb: { enabled: true, version: 'v0.14.9', ip_pool: '10.0.0.200-10.0.0.250' },
    cert_manager: { enabled: true, version: 'v1.16.2' },
    rook_ceph: {
      enabled: true,
      version: 'v1.15.6',
      osd_device_filter: '^sd[b-z]|^vd[b-z]|^nvme[0-9]n[0-9]',
      replica_count: 3,
    },
    nebraska: { enabled: true, version: 'v2.8.14', ip: '10.0.0.200' },
  },
}

// ── Dashboard status types ─────────────────────────────────────────
export type NodeStatusType = 'pending' | 'pxe-booting' | 'installing' | 'ready' | 'error'
export type AddonStatusType = 'pending' | 'deploying' | 'ready' | 'error'
export type BootstrapPhase = 'idle' | 'generating' | 'serving' | 'waiting' | 'complete' | 'error'

export interface NodeStatus {
  name: string
  ip: string
  role: 'controller' | 'worker'
  status: NodeStatusType
  message?: string
}

export interface AddonStatus {
  name: string
  status: AddonStatusType
  message?: string
}

export interface BootstrapStatus {
  phase: BootstrapPhase
  started_at?: string
  completed_at?: string
  message?: string
  nodes: NodeStatus[]
  addons: AddonStatus[]
  kubeconfig_ready: boolean
}
