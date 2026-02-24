import { useCluster } from '../context/ClusterContext'
import NodeTable from '../components/NodeTable'

export default function NodeInventory() {
  const { config, setControllers, setWorkers } = useCluster()
  const totalNodes = config.controllers.length + config.workers.length

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-base font-bold text-gray-100">Node Inventory</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Manage cluster nodes. Changes are reflected in the Config Wizard.
        </p>
      </div>

      <div className="space-y-4">
        {/* Controllers */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs bg-purple-900/40 text-purple-400 px-2 py-0.5 rounded">
              control-plane
            </span>
            <span className="text-xs text-gray-600">{config.controllers.length} node{config.controllers.length !== 1 ? 's' : ''}</span>
          </div>
          <NodeTable
            nodes={config.controllers}
            onChange={setControllers}
            rolePrefix="controller"
          />
        </div>

        {/* Workers */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded">
              worker
            </span>
            <span className="text-xs text-gray-600">{config.workers.length} node{config.workers.length !== 1 ? 's' : ''}</span>
          </div>
          <NodeTable
            nodes={config.workers}
            onChange={setWorkers}
            rolePrefix="worker"
          />
        </div>

        {/* Bootstrap (read-only) */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2 py-0.5 rounded">
              bootstrap
            </span>
            <span className="text-xs text-gray-600">1 node (this container)</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-600 border-b border-gray-800">
                <th className="text-left pb-2 pr-4 font-medium">IP</th>
                <th className="text-left pb-2 font-medium">MAC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2 pr-4 text-gray-400 font-mono">{config.bootstrap.ip}</td>
                <td className="py-2 text-gray-400 font-mono">{config.bootstrap.mac}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-gray-700 mt-2">
            Edit the bootstrap node in Config Wizard → Bootstrap step.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-5 flex gap-4 text-xs text-gray-600">
        <span>{config.controllers.length} controller{config.controllers.length !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{config.workers.length} worker{config.workers.length !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{totalNodes} total</span>
        {config.controllers.length === 3 && (
          <>
            <span>·</span>
            <span className="text-green-600">HA control plane</span>
          </>
        )}
        {config.controllers.length === 1 && (
          <>
            <span>·</span>
            <span className="text-yellow-600">single control plane</span>
          </>
        )}
      </div>
    </div>
  )
}
