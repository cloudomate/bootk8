import { useState } from 'react'
import { NodeEntry } from '../types/cluster'

interface Props {
  nodes: NodeEntry[]
  onChange: (nodes: NodeEntry[]) => void
  rolePrefix: string
}

export default function NodeTable({ nodes, onChange, rolePrefix }: Props) {
  const [adding, setAdding] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const addNode = (node: NodeEntry) => {
    const name = node.name || `${rolePrefix}-${nodes.length + 1}`
    onChange([...nodes, { ...node, name }])
    setAdding(false)
  }

  const removeNode = (i: number) => onChange(nodes.filter((_, idx) => idx !== i))

  const saveEdit = (i: number, updated: NodeEntry) => {
    const next = [...nodes]
    next[i] = updated
    onChange(next)
    setEditIdx(null)
  }

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-600 border-b border-gray-800">
            <th className="text-left pb-2 pr-4 font-medium">Name</th>
            <th className="text-left pb-2 pr-4 font-medium">IP</th>
            <th className="text-left pb-2 pr-4 font-medium">MAC</th>
            <th className="pb-2 text-right">
              <button
                onClick={() => setAdding(true)}
                className="text-blue-500 hover:text-blue-400 font-medium"
              >
                + add
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node, i) => (
            <tr key={i} className="border-b border-gray-800/60">
              {editIdx === i ? (
                <EditRow
                  node={node}
                  onSave={n => saveEdit(i, n)}
                  onCancel={() => setEditIdx(null)}
                />
              ) : (
                <>
                  <td className="py-2 pr-4 text-gray-200">{node.name}</td>
                  <td className="py-2 pr-4 text-gray-400 font-mono">{node.ip}</td>
                  <td className="py-2 pr-4 text-gray-400 font-mono">{node.mac}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setEditIdx(i)}
                      className="text-gray-600 hover:text-blue-400 mr-3"
                    >
                      edit
                    </button>
                    <button
                      onClick={() => removeNode(i)}
                      className="text-gray-600 hover:text-red-400"
                    >
                      remove
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}

          {adding && (
            <tr className="border-b border-gray-800/60">
              <EditRow
                node={{ name: '', ip: '', mac: '' }}
                onSave={addNode}
                onCancel={() => setAdding(false)}
              />
            </tr>
          )}
        </tbody>
      </table>

      {nodes.length === 0 && !adding && (
        <p className="text-xs text-gray-700 text-center py-5">
          No nodes. Click <span className="text-blue-500">+ add</span> to get started.
        </p>
      )}
    </div>
  )
}

function EditRow({
  node,
  onSave,
  onCancel,
}: {
  node: NodeEntry
  onSave: (n: NodeEntry) => void
  onCancel: () => void
}) {
  const [local, setLocal] = useState<NodeEntry>({ ...node })
  const set = (patch: Partial<NodeEntry>) => setLocal(l => ({ ...l, ...patch }))

  return (
    <>
      <td className="py-1 pr-2">
        <input
          value={local.name}
          onChange={e => set({ name: e.target.value })}
          placeholder="name"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-1 pr-2">
        <input
          value={local.ip}
          onChange={e => set({ ip: e.target.value })}
          placeholder="10.0.0.x"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-1 pr-2">
        <input
          value={local.mac}
          onChange={e => set({ mac: e.target.value })}
          placeholder="aa:bb:cc:dd:ee:ff"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-1 text-right">
        <button onClick={() => onSave(local)} className="text-green-400 hover:text-green-300 mr-3">
          save
        </button>
        <button onClick={onCancel} className="text-gray-600 hover:text-gray-300">
          cancel
        </button>
      </td>
    </>
  )
}
