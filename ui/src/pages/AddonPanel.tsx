import { useCluster } from '../context/ClusterContext'

export default function AddonPanel() {
  const { config, updateAddons } = useCluster()
  const { addons } = config

  const summary = [
    { name: 'flannel',      enabled: addons.flannel.enabled },
    { name: 'metallb',      enabled: addons.metallb.enabled },
    { name: 'cert-manager', enabled: addons.cert_manager.enabled },
    { name: 'rook-ceph',    enabled: addons.rook_ceph.enabled },
    { name: 'nebraska',     enabled: addons.nebraska.enabled },
  ]

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-base font-bold text-gray-100">Add-ons</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Installed automatically after the cluster is ready. Changes sync with the Config Wizard.
        </p>
      </div>

      <div className="space-y-3">
        <AddonCard
          title="Flannel CNI"
          description="Pod networking — required for nodes to reach Ready state"
          badge="required"
          enabled={addons.flannel.enabled}
          onToggle={v => updateAddons({ flannel: { ...addons.flannel, enabled: v } })}
        >
          <Field
            label="Version"
            value={addons.flannel.version}
            onChange={v => updateAddons({ flannel: { ...addons.flannel, version: v } })}
          />
        </AddonCard>

        <AddonCard
          title="MetalLB"
          description="Bare metal LoadBalancer — assigns external IPs to LoadBalancer Services"
          enabled={addons.metallb.enabled}
          onToggle={v => updateAddons({ metallb: { ...addons.metallb, enabled: v } })}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Version"
              value={addons.metallb.version}
              onChange={v => updateAddons({ metallb: { ...addons.metallb, version: v } })}
            />
            <Field
              label="IP Pool"
              value={addons.metallb.ip_pool}
              onChange={v => updateAddons({ metallb: { ...addons.metallb, ip_pool: v } })}
              placeholder="10.0.0.200-10.0.0.250"
            />
          </div>
        </AddonCard>

        <AddonCard
          title="cert-manager"
          description="Automated TLS certificate management — creates a self-signed ClusterIssuer"
          enabled={addons.cert_manager.enabled}
          onToggle={v => updateAddons({ cert_manager: { ...addons.cert_manager, enabled: v } })}
        >
          <Field
            label="Version"
            value={addons.cert_manager.version}
            onChange={v => updateAddons({ cert_manager: { ...addons.cert_manager, version: v } })}
          />
        </AddonCard>

        <AddonCard
          title="Rook-Ceph"
          description="Distributed block & file storage — each worker needs at least one raw block device"
          enabled={addons.rook_ceph.enabled}
          onToggle={v => updateAddons({ rook_ceph: { ...addons.rook_ceph, enabled: v } })}
        >
          <div className="space-y-3">
            <Field
              label="Version"
              value={addons.rook_ceph.version}
              onChange={v => updateAddons({ rook_ceph: { ...addons.rook_ceph, version: v } })}
            />
            <Field
              label="OSD Device Filter (regex)"
              value={addons.rook_ceph.osd_device_filter}
              onChange={v =>
                updateAddons({ rook_ceph: { ...addons.rook_ceph, osd_device_filter: v } })
              }
              hint='e.g. "^sd[b-z]" to restrict to specific disks'
            />
            <div>
              <label className="block text-xs text-gray-500 mb-1">Replica Count</label>
              <input
                type="number"
                min={1}
                max={5}
                value={addons.rook_ceph.replica_count}
                onChange={e =>
                  updateAddons({
                    rook_ceph: {
                      ...addons.rook_ceph,
                      replica_count: parseInt(e.target.value) || 1,
                    },
                  })
                }
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-20"
              />
              <span className="text-xs text-gray-600 ml-2">use 1 only for single-node testing</span>
            </div>
          </div>
        </AddonCard>

        <AddonCard
          title="Nebraska"
          description="Self-hosted Flatcar update server — requires MetalLB for the LoadBalancer IP"
          enabled={addons.nebraska.enabled}
          onToggle={v => updateAddons({ nebraska: { ...addons.nebraska, enabled: v } })}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Version"
              value={addons.nebraska.version}
              onChange={v => updateAddons({ nebraska: { ...addons.nebraska, version: v } })}
            />
            <Field
              label="Fixed IP (from MetalLB pool)"
              value={addons.nebraska.ip}
              onChange={v => updateAddons({ nebraska: { ...addons.nebraska, ip: v } })}
              placeholder="10.0.0.200"
              hint="Access UI at http://<ip>:8000 after bootstrap"
            />
          </div>
        </AddonCard>
      </div>

      {/* Status summary */}
      <div className="mt-6 flex flex-wrap gap-2">
        {summary.map(a => (
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
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

function AddonCard({
  title,
  description,
  badge,
  enabled,
  onToggle,
  children,
}: {
  title: string
  description: string
  badge?: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div
      className={`bg-gray-900 border rounded-lg p-5 transition-colors ${
        enabled ? 'border-gray-700' : 'border-gray-800'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 pr-4">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-xs font-semibold text-gray-200">{title}</h3>
            {badge && (
              <span className="text-xs bg-blue-900/40 text-blue-400 px-1.5 py-0.5 rounded">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600">{description}</p>
        </div>
        {/* Toggle */}
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
            enabled ? 'bg-blue-600' : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-[18px]' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {enabled && children && (
        <div className="mt-4 pt-4 border-t border-gray-800">{children}</div>
      )}
    </div>
  )
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
