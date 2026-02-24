import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import yaml from 'js-yaml'
import { BootstrapStatus, BootstrapPhase, ClusterConfig, NodeEntry, defaultConfig } from '../types/cluster'
import StatusBadge from '../components/StatusBadge'
import { useCluster } from '../context/ClusterContext'

// Parse raw YAML into ClusterConfig (handles legacy ssh_authorized_key singular form)
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

const POLL_MS      = 4000
const LOGS_POLL_MS = 2000

interface PortalStatus extends BootstrapStatus {
  container_running?: boolean
}

const phaseLabel: Record<string, { color: string; dot: string }> = {
  idle:       { color: 'text-gray-500',   dot: '○' },
  generating: { color: 'text-blue-400',   dot: '◌' },
  serving:    { color: 'text-blue-400',   dot: '◉' },
  waiting:    { color: 'text-yellow-400', dot: '◎' },
  complete:   { color: 'text-green-400',  dot: '●' },
  error:      { color: 'text-red-400',    dot: '✕' },
}

type Tab = 'config' | 'bootstrap' | 'configcmp' | 'installcmp'

// Derive which tab is "done" based on bootstrap phase
function tabState(tab: Tab, phase: string, running: boolean): 'done' | 'active' | 'pending' | 'error' {
  if (tab === 'config')     return (phase !== 'idle' || running) ? 'done' : 'active'
  if (tab === 'bootstrap') {
    if (phase === 'complete') return 'done'
    if (phase === 'error')    return 'error'
    if (running || ['generating','serving','waiting'].includes(phase)) return 'active'
    return 'pending'
  }
  if (tab === 'configcmp')  return phase === 'complete' ? 'active' : 'pending'
  if (tab === 'installcmp') return phase === 'complete' ? 'active' : 'pending'
  return 'pending'
}

const tabStateStyle = {
  done:    { circle: 'bg-blue-600 text-white border-blue-600',    line: 'bg-blue-600',  label: 'text-blue-400'  },
  active:  { circle: 'bg-blue-500 text-white border-blue-500 ring-2 ring-blue-500/30', line: 'bg-gray-700', label: 'text-gray-200' },
  pending: { circle: 'bg-gray-800 text-gray-600 border-gray-700', line: 'bg-gray-800',  label: 'text-gray-600'  },
  error:   { circle: 'bg-red-900 text-red-300 border-red-700',    line: 'bg-red-900',   label: 'text-red-400'   },
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { setConfig } = useCluster()
  const [tab,       setTab]       = useState<Tab>('config')
  const [cmpFiles,  setCmpFiles]  = useState<string[]>([])
  const [status,    setStatus]    = useState<PortalStatus | null>(null)
  const [logs,      setLogs]      = useState('')
  const [configYaml, setConfigYaml] = useState('')
  const [configEdited, setConfigEdited] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [stopping,  setStopping]  = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployOut, setDeployOut] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const logsRef = useRef<HTMLPreElement>(null)

  // Registry pull secret state
  const [regStatus,   setRegStatus]   = useState<{ configured: boolean; registries: string[] } | null>(null)
  const [regInput,    setRegInput]    = useState('')
  const [regExpanded, setRegExpanded] = useState(false)
  const [regSaving,   setRegSaving]   = useState(false)
  const [regMsg,      setRegMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  // Auto-scroll console
  useEffect(() => {
    if (autoScroll && logsRef.current)
      logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs, autoScroll])

  const onConsoleScroll = () => {
    const el = logsRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  // Poll status
  useEffect(() => {
    const poll = async () => {
      try { const r = await fetch('/api/status'); if (r.ok) setStatus(await r.json()) } catch {}
    }
    poll(); const t = setInterval(poll, POLL_MS); return () => clearInterval(t)
  }, [])

  // Poll logs always
  useEffect(() => {
    const poll = async () => {
      try { const r = await fetch('/api/logs'); if (r.ok) setLogs(await r.text()) } catch {}
    }
    poll(); const t = setInterval(poll, LOGS_POLL_MS); return () => clearInterval(t)
  }, [])

  // Load cluster.yaml and sync ClusterContext so wizard stays in sync
  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch('/api/config')
      if (r.ok) {
        const text = await r.text()
        setConfigYaml(text)
        setConfigEdited(false)
        const parsed = yamlToConfig(text)
        if (parsed) setConfig(parsed)
      }
    } catch {}
  }, [setConfig])

  useEffect(() => { loadConfig() }, [loadConfig])

  // Fetch registry pull-secret status when on config tab
  const fetchRegStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/registry/pullsecret')
      if (r.ok) setRegStatus(await r.json())
    } catch {}
  }, [])

  useEffect(() => {
    if (tab === 'config') fetchRegStatus()
  }, [tab, fetchRegStatus])

  // Load CMP manifest list when on configcmp tab
  useEffect(() => {
    if (tab !== 'configcmp') return
    fetch('/api/cmp/manifests').then(r => r.json()).then(d => setCmpFiles(d.files ?? [])).catch(() => {})
  }, [tab])

  const [launchError, setLaunchError] = useState<string | null>(null)

  const saveReg = async () => {
    setRegMsg(null)
    let parsed: unknown
    try { parsed = JSON.parse(regInput.trim()) }
    catch { setRegMsg({ ok: false, text: 'Invalid JSON' }); return }
    setRegSaving(true)
    try {
      const r = await fetch('/api/registry/pullsecret', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed),
      })
      const d = await r.json()
      if (!r.ok) { setRegMsg({ ok: false, text: d.error }); return }
      setRegMsg({ ok: true, text: `Saved for: ${d.registries.join(', ')}` })
      setRegInput(''); setRegExpanded(false); await fetchRegStatus()
    } catch (e: unknown) {
      setRegMsg({ ok: false, text: e instanceof Error ? e.message : 'Network error' })
    } finally { setRegSaving(false) }
  }

  const removeReg = async () => {
    if (!confirm('Remove pull secret?')) return
    await fetch('/api/registry/pullsecret', { method: 'DELETE' })
    setRegMsg({ ok: true, text: 'Pull secret removed.' }); await fetchRegStatus()
  }

  const saveConfig = async (): Promise<boolean> => {
    // Validate YAML client-side before sending
    try {
      yaml.load(configYaml)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setLaunchError(`YAML parse error: ${msg}`)
      return false
    }
    setConfigSaving(true)
    try {
      const r = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: configYaml,
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setLaunchError(d.error ?? 'Save failed'); return false }
      setConfigEdited(false)
      return true
    } catch (e: unknown) {
      setLaunchError(e instanceof Error ? e.message : String(e)); return false
    } finally { setConfigSaving(false) }
  }

  const launch = async () => {
    setLaunching(true); setLaunchError(null)
    try {
      const r = await fetch('/api/bootstrap/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const d = await r.json()
      if (!r.ok) { setLaunchError(d.error) }
    } catch (e: unknown) {
      setLaunchError(e instanceof Error ? e.message : String(e))
    } finally { setLaunching(false) }
  }

  const saveAndLaunch = async () => {
    const saved = await saveConfig()
    if (!saved) return
    // Switch to Bootstrap tab immediately so user can watch the console
    // while the image is being pulled and the container starts
    setTab('bootstrap')
    await launch()
  }

  const stop = async () => {
    if (!confirm('Stop the bootstrap container?')) return
    setStopping(true)
    try { await fetch('/api/bootstrap', { method: 'DELETE' }) }
    finally { setStopping(false) }
  }

  const deployCmp = async () => {
    setDeploying(true); setDeployOut(null)
    try {
      const r = await fetch('/api/cmp/deploy', { method: 'POST' })
      const d = await r.json()
      setDeployOut(r.ok ? `✓ ${d.output || 'Deployed'}` : `✗ ${d.error}`)
    } catch (e: unknown) {
      setDeployOut(`✗ ${e instanceof Error ? e.message : String(e)}`)
    } finally { setDeploying(false) }
  }

  const phase      = status?.phase ?? 'idle'
  const running    = status?.container_running ?? false
  const isComplete = phase === 'complete'
  const { color: phaseColor, dot: phaseDot } = phaseLabel[phase] ?? phaseLabel.idle

  const displayLogs = logs

  // ── Timeline tabs definition ─────────────────────────────────────
  const tabs: { id: Tab; label: string; num: string }[] = [
    { id: 'config',     label: 'Config Cluster',    num: '1' },
    { id: 'bootstrap',  label: 'Bootstrap Cluster', num: '2' },
    { id: 'configcmp',  label: 'Config CMP',        num: '3' },
    { id: 'installcmp', label: 'Install CMP',       num: '4' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Timeline tab bar ────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-gray-800 px-6 pt-5 pb-0">

        {/* Phase badge */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold text-gray-500 tracking-widest uppercase">Dashboard</h2>
          <span className={`text-xs font-mono font-bold tracking-widest uppercase ${phaseColor}`}>
            {phaseDot} {phase}
            {running && <span className="text-blue-400 animate-pulse ml-2">● live</span>}
          </span>
        </div>

        {/* Timeline */}
        <div className="flex items-center">
          {tabs.map((t, i) => {
            const state = tabState(t.id, phase, running)
            const s     = tabStateStyle[state]
            const isCurrent = tab === t.id
            return (
              <div key={t.id} className="flex items-center flex-1 last:flex-none">
                {/* Step */}
                <button
                  onClick={() => setTab(t.id)}
                  className="flex flex-col items-center group relative pb-3"
                >
                  <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center
                                   text-xs font-bold transition-all ${s.circle}
                                   ${isCurrent ? 'scale-110' : 'group-hover:scale-105'}`}>
                    {state === 'done' ? '✓' : t.num}
                  </div>
                  <span className={`mt-1.5 text-xs whitespace-nowrap transition-colors ${
                    isCurrent ? 'text-gray-100 font-semibold' : s.label
                  }`}>
                    {t.label}
                  </span>
                  {/* Active underline */}
                  {isCurrent && (
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-0.5 bg-blue-500 rounded" />
                  )}
                </button>

                {/* Connector line */}
                {i < tabs.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-3 mb-5 rounded ${s.line} transition-colors`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}

      {/* CONFIG TAB */}
      {tab === 'config' && (
        <div className="flex-1 flex flex-col min-h-0 px-6 py-4">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <span className="text-xs text-gray-500 uppercase tracking-widest font-semibold">cluster.yaml</span>
            <div className="flex items-center gap-2">
              {configEdited && (
                <span className="text-xs text-yellow-500">● unsaved</span>
              )}
              <button
                onClick={saveConfig}
                disabled={!configEdited || configSaving}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                           text-white rounded transition-colors"
              >
                {configSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => navigate('/wizard')}
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
              >
                ⚙ Open Wizard
              </button>
              <button
                onClick={loadConfig}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                title="Reload from server"
              >
                ↺
              </button>
            </div>
          </div>
          <textarea
            value={configYaml}
            onChange={e => { setConfigYaml(e.target.value); setConfigEdited(true) }}
            spellCheck={false}
            placeholder="No cluster.yaml found. Use the wizard or paste your config here."
            className="flex-1 min-h-0 bg-gray-900 border border-gray-700 rounded-lg
                       px-4 py-3 text-xs text-gray-200 font-mono leading-5
                       focus:outline-none focus:border-blue-600 resize-none"
          />
          {/* Registry pull secret panel */}
          <div className="mt-3 flex-shrink-0 border border-gray-800 rounded-lg bg-gray-900/60">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 uppercase tracking-widest">Registry</span>
                {regStatus === null
                  ? <span className="text-xs text-gray-700">…</span>
                  : regStatus.configured
                  ? <>
                      <span className="text-xs text-green-400 font-semibold">● Configured</span>
                      {regStatus.registries.map(r => (
                        <span key={r} className="text-xs bg-gray-800 text-blue-300 px-1.5 py-0.5 rounded font-mono">{r}</span>
                      ))}
                    </>
                  : <span className="text-xs text-yellow-600">○ No pull secret</span>
                }
              </div>
              <div className="flex items-center gap-2">
                {regStatus?.configured && (
                  <button onClick={removeReg} className="text-xs text-red-500 hover:text-red-400">Remove</button>
                )}
                <button
                  onClick={() => { setRegExpanded(e => !e); setRegMsg(null) }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded bg-gray-800"
                >
                  {regExpanded ? '▲ hide' : '▼ configure'}
                </button>
              </div>
            </div>
            {regExpanded && (
              <div className="border-t border-gray-800 px-3 py-3 space-y-2">
                <textarea
                  value={regInput}
                  onChange={e => setRegInput(e.target.value)}
                  rows={4}
                  placeholder={'{"auths":{"cr.imys.in":{"auth":"<base64(user:token)>"}}}'}
                  spellCheck={false}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500 resize-y"
                />
                {regMsg && (
                  <p className={`text-xs ${regMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{regMsg.text}</p>
                )}
                <button
                  onClick={saveReg}
                  disabled={regSaving || !regInput.trim()}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded"
                >
                  {regSaving ? 'Saving…' : 'Save Pull Secret'}
                </button>
              </div>
            )}
          </div>

          {launchError && (
            <div className="mt-2 flex-shrink-0 bg-red-950/60 border border-red-800/60 rounded px-3 py-2 text-xs text-red-300">
              {launchError}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={saveAndLaunch}
              disabled={launching || configSaving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                         text-white text-xs font-semibold rounded transition-colors"
            >
              {configSaving ? 'Saving…' : launching ? 'Pulling & launching…' : '▶  Save & Launch Bootstrap'}
            </button>
            <span className="text-xs text-gray-700">or go to Bootstrap tab to launch manually</span>
          </div>
        </div>
      )}

      {/* BOOTSTRAP TAB */}
      {tab === 'bootstrap' && (
        <div className="flex-1 flex flex-col min-h-0">

          {/* Controls + node status */}
          <div className="flex-shrink-0 px-6 py-3 border-b border-gray-800 space-y-3">

            {/* Message */}
            {status?.message && (
              <div className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-300">
                {status.message}
              </div>
            )}

            {/* Nodes */}
            {(status?.nodes?.length ?? 0) > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {status!.nodes.map(node => (
                  <div key={node.name} className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-200 truncate">{node.name}</span>
                      <span className="text-xs text-gray-600 ml-1 shrink-0">{node.role[0]}</span>
                    </div>
                    <p className="text-xs text-gray-600 font-mono mb-1.5 truncate">{node.ip}</p>
                    <StatusBadge status={node.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Completion banner */}
            {isComplete && (
              <div className="bg-green-950/40 border border-green-800/40 rounded px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-green-300">
                  Cluster Ready — bootstrap container has torn down
                </span>
                <button
                  onClick={() => setTab('configcmp')}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Config CMP →
                </button>
              </div>
            )}

            {/* Launch error */}
            {launchError && (
              <div className="bg-red-950/60 border border-red-800/60 rounded px-3 py-2 text-xs text-red-300">
                {launchError}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {!running ? (
                <button
                  onClick={launch}
                  disabled={launching}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                             text-white text-xs font-semibold rounded transition-colors"
                >
                  {launching ? 'Pulling & launching…' : '▶  Launch Bootstrap'}
                </button>
              ) : (
                <button
                  onClick={stop}
                  disabled={stopping}
                  className="px-5 py-2 bg-red-900/60 hover:bg-red-800/60 disabled:opacity-40
                             text-red-300 text-xs font-semibold rounded transition-colors"
                >
                  {stopping ? 'Stopping…' : '■  Stop'}
                </button>
              )}
              <button
                onClick={() => setTab('config')}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
              >
                ← Edit Config
              </button>
              {!autoScroll && (
                <button
                  onClick={() => { setAutoScroll(true); logsRef.current?.scrollTo(0, logsRef.current.scrollHeight) }}
                  className="ml-auto px-3 py-1.5 bg-yellow-900/40 border border-yellow-700/40 text-yellow-400 text-xs rounded"
                >
                  ↓ bottom
                </button>
              )}
              {status?.started_at && (
                <span className="ml-auto text-xs text-gray-700">
                  {isComplete ? 'Done' : 'Running'}: {new Date(status.started_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {/* Console */}
          <div className="flex-1 flex flex-col min-h-0 px-6 py-3">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">Console</span>
              {running
                ? <span className="text-xs text-blue-400 animate-pulse font-mono">● live</span>
                : displayLogs
                  ? <span className="text-xs text-gray-600 font-mono">— last output</span>
                  : <span className="text-xs text-gray-700 font-mono">— idle</span>
              }
            </div>
            <pre
              ref={logsRef}
              onScroll={onConsoleScroll}
              className="flex-1 min-h-0 bg-black border border-gray-800 rounded-lg
                         px-5 py-4 text-xs text-green-400 font-mono leading-5
                         overflow-auto whitespace-pre-wrap break-all"
            >
              {displayLogs || (
                <span className="text-gray-700">
                  {`bootstrap-hci $ _\n\nNo output yet.\nClick ▶ Launch Bootstrap or go to Config tab to save and launch.`}
                </span>
              )}
            </pre>
          </div>
        </div>
      )}

      {/* CONFIG CMP TAB */}
      {tab === 'configcmp' && (
        <div className="flex-1 overflow-auto px-6 py-5">
          <div className="max-w-xl space-y-4">

            {/* Readiness gate */}
            <div className={`border rounded px-4 py-3 ${isComplete ? 'bg-green-950/40 border-green-800/40' : 'bg-gray-900 border-gray-800'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${isComplete ? 'text-green-300' : 'text-gray-500'}`}>
                  {isComplete ? '● Cluster Ready' : '○ Cluster Not Ready — complete Bootstrap first'}
                </span>
                {!isComplete && (
                  <button onClick={() => setTab('bootstrap')} className="text-xs text-blue-500 hover:text-blue-400">
                    ← Bootstrap Cluster
                  </button>
                )}
              </div>
            </div>

            {/* Manifest list */}
            <div className="bg-gray-900 border border-gray-800 rounded px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-gray-400 uppercase tracking-widest">Manifests in ./cmp/</h3>
                <button
                  onClick={() => fetch('/api/cmp/manifests').then(r => r.json()).then(d => setCmpFiles(d.files ?? []))}
                  className="text-xs text-gray-600 hover:text-gray-400"
                >↺ refresh</button>
              </div>
              {cmpFiles.length === 0 ? (
                <p className="text-xs text-gray-600">
                  No manifests found. Mount your YAML files into the <code className="text-gray-500">./cmp/</code> directory
                  (mapped via docker-compose).
                </p>
              ) : (
                <ul className="space-y-1">
                  {cmpFiles.map(f => (
                    <li key={f} className="flex items-center gap-2 text-xs text-gray-300 font-mono">
                      <span className="text-gray-600">•</span> {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add-on status */}
            {(status?.addons?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-xs text-gray-600 uppercase tracking-widest mb-2">Add-ons</h3>
                <div className="bg-gray-900 border border-gray-800 rounded divide-y divide-gray-800">
                  {status!.addons.map(a => (
                    <div key={a.name} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-xs text-gray-300">{a.name}</span>
                      <div className="flex items-center gap-2">
                        {a.message && <span className="text-xs text-gray-600">{a.message}</span>}
                        <StatusBadge status={a.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setTab('installcmp')}
                disabled={!isComplete}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white text-xs font-semibold rounded transition-colors"
              >
                Install CMP →
              </button>
            </div>

          </div>
        </div>
      )}

      {/* INSTALL CMP TAB */}
      {tab === 'installcmp' && (
        <div className="flex-1 overflow-auto px-6 py-5">
          <div className="max-w-xl space-y-4">

            {/* Readiness gate */}
            <div className={`border rounded px-4 py-3 ${isComplete ? 'bg-green-950/40 border-green-800/40' : 'bg-gray-900 border-gray-800'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${isComplete ? 'text-green-300' : 'text-gray-500'}`}>
                  {isComplete ? '● Cluster Ready' : '○ Cluster Not Ready'}
                </span>
                {!isComplete && (
                  <button onClick={() => setTab('bootstrap')} className="text-xs text-blue-500 hover:text-blue-400">
                    Go to Bootstrap →
                  </button>
                )}
              </div>
              {isComplete && (
                <p className="text-xs text-green-800 mt-1">kubeconfig available in shared volume</p>
              )}
            </div>

            {/* Deploy */}
            <div className="bg-gray-900 border border-gray-800 rounded px-4 py-4">
              <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-1">Deploy CMP</h3>
              <p className="text-xs text-gray-600 mb-3">
                Applies all manifests from <code className="text-gray-500">./cmp/</code> against the cluster.
              </p>
              <button
                onClick={deployCmp}
                disabled={!isComplete || deploying}
                className="px-5 py-2 bg-green-800/60 hover:bg-green-700/60 disabled:opacity-30
                           text-green-300 text-xs font-semibold rounded transition-colors"
              >
                {deploying ? 'Deploying…' : '⊕  Deploy CMP'}
              </button>
              {deployOut && (
                <pre className={`mt-3 text-xs font-mono whitespace-pre-wrap ${deployOut.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                  {deployOut}
                </pre>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
