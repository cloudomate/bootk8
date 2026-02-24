import { useState, useEffect } from 'react'

interface PullSecretStatus {
  configured: boolean
  registries: string[]
}

const PLACEHOLDER = `{
  "auths": {
    "cr.imys.in": {
      "auth": "<base64(username:token)>"
    }
  }
}`

const EXAMPLE_NOTE = `Generate the auth value with:
  echo -n "username:token" | base64`

export default function Registry() {
  const [status, setStatus]   = useState<PullSecretStatus | null>(null)
  const [input, setInput]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const fetchStatus = async () => {
    try {
      const r = await fetch('/api/registry/pullsecret')
      setStatus(await r.json())
    } catch {
      setStatus({ configured: false, registries: [] })
    }
  }

  useEffect(() => { fetchStatus() }, [])

  const save = async () => {
    setFeedback(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(input.trim())
    } catch {
      setFeedback({ ok: false, msg: 'Invalid JSON — check your pull secret format.' })
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/registry/pullsecret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const data = await r.json()
      if (!r.ok) {
        setFeedback({ ok: false, msg: data.error })
      } else {
        setFeedback({ ok: true, msg: `Pull secret saved for: ${data.registries.join(', ')}` })
        setInput('')
        await fetchStatus()
      }
    } catch (e: unknown) {
      setFeedback({ ok: false, msg: e instanceof Error ? e.message : 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm('Remove pull secret? The portal will not be able to pull images from private registries.')) return
    await fetch('/api/registry/pullsecret', { method: 'DELETE' })
    setFeedback({ ok: true, msg: 'Pull secret removed.' })
    await fetchStatus()
  }

  return (
    <div className="flex-1 overflow-auto p-8 max-w-2xl">
      <h2 className="text-sm font-bold text-gray-200 tracking-widest uppercase mb-1">Registry</h2>
      <p className="text-xs text-gray-500 mb-6">
        Pull secret used to authenticate with private container registries when launching the bootstrap image.
        Stored in the config volume — never leaves the host.
      </p>

      {/* Current status */}
      <div className="bg-gray-900 border border-gray-800 rounded p-4 mb-6">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 uppercase tracking-widest">Pull Secret</span>
          {status === null ? (
            <span className="text-xs text-gray-600">loading…</span>
          ) : status.configured ? (
            <span className="text-xs text-green-400 font-semibold">● Configured</span>
          ) : (
            <span className="text-xs text-yellow-500 font-semibold">○ Not configured</span>
          )}
        </div>
        {status?.configured && status.registries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {status.registries.map(r => (
              <span key={r} className="text-xs bg-gray-800 text-blue-300 px-2 py-0.5 rounded font-mono">{r}</span>
            ))}
          </div>
        )}
        {status?.configured && (
          <button
            onClick={remove}
            className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove pull secret
          </button>
        )}
      </div>

      {/* Input */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2">
          Paste Pull Secret JSON
        </label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={10}
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 font-mono
                     focus:outline-none focus:border-blue-500 resize-y"
          spellCheck={false}
        />
        <pre className="mt-2 text-xs text-gray-600">{EXAMPLE_NOTE}</pre>
      </div>

      {feedback && (
        <div className={`text-xs px-3 py-2 rounded mb-4 ${
          feedback.ok
            ? 'bg-green-900/40 border border-green-700 text-green-300'
            : 'bg-red-900/40 border border-red-700 text-red-300'
        }`}>
          {feedback.msg}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || !input.trim()}
        className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                   disabled:cursor-not-allowed text-white rounded transition-colors"
      >
        {saving ? 'Saving…' : 'Save Pull Secret'}
      </button>
    </div>
  )
}
