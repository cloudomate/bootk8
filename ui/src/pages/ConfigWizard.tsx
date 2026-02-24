import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import yaml from 'js-yaml'
import { useCluster } from '../context/ClusterContext'
import NodeTable from '../components/NodeTable'
import { AddonsConfig, ClusterConfig, NodeEntry, defaultConfig } from '../types/cluster'

// Parse server YAML into ClusterConfig (mirrors Dashboard helper)
function yamlToConfig(raw: string): ClusterConfig | null {
  try {
    const p = yaml.load(raw) as Record<string, unknown>
    if (!p || typeof p !== 'object') return null
    const cl = ((p.cluster ?? {}) as Record<string, unknown>)
    const bs = ((p.bootstrap ?? {}) as Record<string, unknown>)
    const ar = ((p.addons   ?? {}) as Record<string, unknown>)
    let sshKeys: string[] = []
    if (Array.isArray(cl.ssh_authorized_keys))          sshKeys = cl.ssh_authorized_keys as string[]
    else if (typeof cl.ssh_authorized_key === 'string') sshKeys = [cl.ssh_authorized_key]
    return {
      cluster:     { ...defaultConfig.cluster,     ...(cl as object), ssh_authorized_keys: sshKeys, kubeadm_token: (cl.kubeadm_token as string) ?? '' },
      bootstrap:   { ...defaultConfig.bootstrap,   ...(bs as object) },
      controllers: Array.isArray(p.controllers) ? (p.controllers as NodeEntry[]) : [],
      workers:     Array.isArray(p.workers)     ? (p.workers     as NodeEntry[]) : [],
      addons: {
        flannel:      { ...defaultConfig.addons.flannel,      ...((ar.flannel      as object) ?? {}) },
        metallb:      { ...defaultConfig.addons.metallb,      ...((ar.metallb      as object) ?? {}) },
        cert_manager: { ...defaultConfig.addons.cert_manager, ...((ar.cert_manager as object) ?? {}) },
        rook_ceph:    { ...defaultConfig.addons.rook_ceph,    ...((ar.rook_ceph    as object) ?? {}) },
        nebraska:     { ...defaultConfig.addons.nebraska,     ...((ar.nebraska     as object) ?? {}) },
      },
    }
  } catch { return null }
}

const STEPS = ['Cluster', 'Bootstrap', 'Controllers', 'Workers', 'Add-ons', 'Review']

export default function ConfigWizard() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [copied, setCopied] = useState(false)
  const [launching, setLaunching] = useState(false)
  const { config, setConfig, updateCluster, updateBootstrap, setControllers, setWorkers, updateAddons } =
    useCluster()

  // Pre-populate wizard from the currently saved cluster.yaml on every mount
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(text => { const parsed = yamlToConfig(text); if (parsed) setConfig(parsed) })
      .catch(() => {/* no saved config yet — keep defaults */})
  }, [setConfig])

  const yamlOutput = yaml.dump(config, { lineWidth: -1, quotingType: '"', forceQuotes: false })

  const download = () => {
    const blob = new Blob([yamlOutput], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cluster.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(yamlOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const saveAndLaunch = async () => {
    setLaunching(true)
    try {
      const saveRes = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'text/yaml' },
        body: yamlOutput,
      })
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}))
        alert(`Failed to save config: ${d.error ?? saveRes.statusText}`)
        return
      }
      const startRes = await fetch('/api/bootstrap/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await startRes.json()
      if (!startRes.ok) {
        alert(`Failed to start bootstrap: ${data.error}`)
        return
      }
      navigate('/')
    } catch (e: unknown) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6 max-w-3xl">
      <h2 className="text-base font-bold text-gray-100 mb-6">Config Wizard</h2>

      {/* Step indicator */}
      <div className="flex items-center mb-6 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center flex-shrink-0">
            <button
              onClick={() => setStep(i)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                i === step
                  ? 'text-blue-300 font-semibold'
                  : i < step
                  ? 'text-blue-500 hover:text-blue-300'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                  i < step
                    ? 'bg-blue-700 text-blue-200'
                    : i === step
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-600'
                }`}
              >
                {i < step ? '✓' : i + 1}
              </span>
              {s}
            </button>
            {i < STEPS.length - 1 && (
              <span className="text-gray-700 mx-1 text-xs">›</span>
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
        {/* Step 0: Cluster */}
        {step === 0 && (
          <div className="space-y-4">
            <SectionTitle>Cluster Settings</SectionTitle>
            <Field
              label="Cluster Name"
              value={config.cluster.name}
              onChange={v => updateCluster({ name: v })}
            />
            <Field
              label="Control Plane VIP"
              value={config.cluster.control_plane_vip}
              onChange={v => updateCluster({ control_plane_vip: v })}
              placeholder="10.0.0.10"
              hint="If single control plane, use the controller-1 IP directly"
            />
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Kubernetes Version"
                value={config.cluster.k8s_version}
                onChange={v => updateCluster({ k8s_version: v })}
                placeholder="v1.31.0"
              />
              <Field
                label="Flatcar Version"
                value={config.cluster.flatcar_version}
                onChange={v => updateCluster({ flatcar_version: v })}
                placeholder="3975.2.2"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Pod Subnet"
                value={config.cluster.pod_subnet}
                onChange={v => updateCluster({ pod_subnet: v })}
                placeholder="10.244.0.0/16"
              />
              <Field
                label="Service Subnet"
                value={config.cluster.service_subnet}
                onChange={v => updateCluster({ service_subnet: v })}
                placeholder="10.96.0.0/12"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-widest mb-1.5">
                SSH Authorized Keys
                <span className="ml-2 text-gray-600 normal-case tracking-normal">one key per line</span>
              </label>
              <textarea
                value={(config.cluster.ssh_authorized_keys ?? []).join('\n')}
                onChange={e => updateCluster({
                  ssh_authorized_keys: e.target.value.split('\n').map(k => k.trim()).filter(Boolean)
                })}
                rows={4}
                placeholder={'ssh-ed25519 AAAA... user@host\nssh-rsa AAAA... user2@host'}
                spellCheck={false}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs
                           text-gray-200 font-mono focus:outline-none focus:border-blue-500 resize-y"
              />
            </div>
            <Field
              label="kubeadm Token"
              value={config.cluster.kubeadm_token}
              onChange={v => updateCluster({ kubeadm_token: v })}
              placeholder="Leave empty to auto-generate"
              hint="Format: [a-z0-9]{6}.[a-z0-9]{16}"
            />
          </div>
        )}

        {/* Step 1: Bootstrap */}
        {step === 1 && (
          <div className="space-y-4">
            <SectionTitle>Bootstrap Node</SectionTitle>
            <p className="text-xs text-gray-500 -mt-2">
              The machine running this bootstrap container image.
            </p>
            <Field
              label="IP Address"
              value={config.bootstrap.ip}
              onChange={v => updateBootstrap({ ip: v })}
              placeholder="10.0.0.5"
            />
            <Field
              label="MAC Address"
              value={config.bootstrap.mac}
              onChange={v => updateBootstrap({ mac: v })}
              placeholder="52:54:00:aa:bb:00"
            />
          </div>
        )}

        {/* Step 2: Controllers */}
        {step === 2 && (
          <div>
            <SectionTitle>Control Plane Nodes</SectionTitle>
            <p className="text-xs text-gray-500 mb-4">
              1 node = single control plane · 3 nodes = HA (recommended for production)
            </p>
            <NodeTable
              nodes={config.controllers}
              onChange={setControllers}
              rolePrefix="controller"
            />
          </div>
        )}

        {/* Step 3: Workers */}
        {step === 3 && (
          <div>
            <SectionTitle>Worker Nodes</SectionTitle>
            <p className="text-xs text-gray-500 mb-4">
              Data plane nodes that run your workloads.
            </p>
            <NodeTable nodes={config.workers} onChange={setWorkers} rolePrefix="worker" />
          </div>
        )}

        {/* Step 4: Add-ons */}
        {step === 4 && (
          <div className="space-y-3">
            <SectionTitle>Add-ons</SectionTitle>
            <AddonRow
              title="Flannel CNI"
              description="Pod networking — required for nodes to reach Ready"
              enabled={config.addons.flannel.enabled}
              onToggle={v => updateAddons({ flannel: { ...config.addons.flannel, enabled: v } })}
            >
              <Field
                label="Version"
                value={config.addons.flannel.version}
                onChange={v => updateAddons({ flannel: { ...config.addons.flannel, version: v } })}
              />
            </AddonRow>

            <AddonRow
              title="MetalLB"
              description="Bare metal LoadBalancer for Kubernetes Services"
              enabled={config.addons.metallb.enabled}
              onToggle={v => updateAddons({ metallb: { ...config.addons.metallb, enabled: v } })}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Version"
                  value={config.addons.metallb.version}
                  onChange={v => updateAddons({ metallb: { ...config.addons.metallb, version: v } })}
                />
                <Field
                  label="IP Pool"
                  value={config.addons.metallb.ip_pool}
                  onChange={v => updateAddons({ metallb: { ...config.addons.metallb, ip_pool: v } })}
                  placeholder="10.0.0.200-10.0.0.250"
                />
              </div>
            </AddonRow>

            <AddonRow
              title="cert-manager"
              description="Automated TLS certificate management"
              enabled={config.addons.cert_manager.enabled}
              onToggle={v =>
                updateAddons({ cert_manager: { ...config.addons.cert_manager, enabled: v } })
              }
            >
              <Field
                label="Version"
                value={config.addons.cert_manager.version}
                onChange={v =>
                  updateAddons({ cert_manager: { ...config.addons.cert_manager, version: v } })
                }
              />
            </AddonRow>

            <AddonRow
              title="Rook-Ceph"
              description="Distributed storage — requires raw block devices on workers"
              enabled={config.addons.rook_ceph.enabled}
              onToggle={v =>
                updateAddons({ rook_ceph: { ...config.addons.rook_ceph, enabled: v } })
              }
            >
              <div className="space-y-3">
                <Field
                  label="Version"
                  value={config.addons.rook_ceph.version}
                  onChange={v =>
                    updateAddons({ rook_ceph: { ...config.addons.rook_ceph, version: v } })
                  }
                />
                <Field
                  label="OSD Device Filter (regex)"
                  value={config.addons.rook_ceph.osd_device_filter}
                  onChange={v =>
                    updateAddons({
                      rook_ceph: { ...config.addons.rook_ceph, osd_device_filter: v },
                    })
                  }
                />
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Replica Count</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={config.addons.rook_ceph.replica_count}
                    onChange={e =>
                      updateAddons({
                        rook_ceph: {
                          ...config.addons.rook_ceph,
                          replica_count: parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-20"
                  />
                </div>
              </div>
            </AddonRow>

            <AddonRow
              title="Nebraska"
              description="Self-hosted Flatcar update server — requires MetalLB"
              enabled={config.addons.nebraska.enabled}
              onToggle={v =>
                updateAddons({ nebraska: { ...config.addons.nebraska, enabled: v } })
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Version"
                  value={config.addons.nebraska.version}
                  onChange={v =>
                    updateAddons({ nebraska: { ...config.addons.nebraska, version: v } })
                  }
                />
                <Field
                  label="Fixed IP (from MetalLB pool)"
                  value={config.addons.nebraska.ip}
                  onChange={v =>
                    updateAddons({ nebraska: { ...config.addons.nebraska, ip: v } })
                  }
                  placeholder="10.0.0.200"
                />
              </div>
            </AddonRow>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div>
            <SectionTitle>Review & Download</SectionTitle>
            <AddonSummary addons={config.addons} />
            <pre className="mt-4 bg-gray-950 border border-gray-800 rounded p-4 text-xs text-gray-300 overflow-auto max-h-80 font-mono whitespace-pre leading-5">
              {yamlOutput}
            </pre>
            <div className="flex gap-3 mt-4 flex-wrap">
              <button
                onClick={saveAndLaunch}
                disabled={launching}
                className="bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-xs px-4 py-2 rounded transition-colors"
              >
                {launching ? 'Launching…' : '▶  Save & Launch Bootstrap'}
              </button>
              <button
                onClick={download}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2 rounded transition-colors"
              >
                Download cluster.yaml
              </button>
              <button
                onClick={copy}
                className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-4 py-2 rounded transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy YAML'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-4">
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          className="text-xs text-gray-500 hover:text-gray-200 disabled:opacity-20 px-4 py-2 transition-colors"
        >
          ← Back
        </button>
        {step < STEPS.length - 1 && (
          <button
            onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded transition-colors"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Shared sub-components ────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-300 mb-4">{children}</h3>
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 transition-colors"
      />
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function AddonRow({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        enabled ? 'border-gray-700' : 'border-gray-800'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 pr-4">
          <p className="text-xs font-medium text-gray-200">{title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{description}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} />
      </div>
      {enabled && children && (
        <div className="mt-4 pt-4 border-t border-gray-800">{children}</div>
      )}
    </div>
  )
}

function AddonSummary({ addons }: { addons: AddonsConfig }) {
  const items = [
    { name: 'flannel', enabled: addons.flannel.enabled },
    { name: 'metallb', enabled: addons.metallb.enabled },
    { name: 'cert-manager', enabled: addons.cert_manager.enabled },
    { name: 'rook-ceph', enabled: addons.rook_ceph.enabled },
    { name: 'nebraska', enabled: addons.nebraska.enabled },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(a => (
        <span
          key={a.name}
          className={`text-xs px-2 py-0.5 rounded ${
            a.enabled ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-600'
          }`}
        >
          {a.enabled ? '✓' : '○'} {a.name}
        </span>
      ))}
    </div>
  )
}
