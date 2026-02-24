import { createContext, useContext, useState, ReactNode } from 'react'
import { ClusterConfig, defaultConfig } from '../types/cluster'

interface ClusterContextValue {
  config: ClusterConfig
  setConfig: (config: ClusterConfig) => void
  updateCluster: (patch: Partial<ClusterConfig['cluster']>) => void
  updateBootstrap: (patch: Partial<ClusterConfig['bootstrap']>) => void
  setControllers: (nodes: ClusterConfig['controllers']) => void
  setWorkers: (nodes: ClusterConfig['workers']) => void
  updateAddons: (patch: Partial<ClusterConfig['addons']>) => void
}

const ClusterContext = createContext<ClusterContextValue | null>(null)

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ClusterConfig>(defaultConfig)

  const updateCluster = (patch: Partial<ClusterConfig['cluster']>) =>
    setConfig(c => ({ ...c, cluster: { ...c.cluster, ...patch } }))

  const updateBootstrap = (patch: Partial<ClusterConfig['bootstrap']>) =>
    setConfig(c => ({ ...c, bootstrap: { ...c.bootstrap, ...patch } }))

  const setControllers = (controllers: ClusterConfig['controllers']) =>
    setConfig(c => ({ ...c, controllers }))

  const setWorkers = (workers: ClusterConfig['workers']) =>
    setConfig(c => ({ ...c, workers }))

  const updateAddons = (patch: Partial<ClusterConfig['addons']>) =>
    setConfig(c => ({ ...c, addons: { ...c.addons, ...patch } }))

  return (
    <ClusterContext.Provider
      value={{ config, setConfig, updateCluster, updateBootstrap, setControllers, setWorkers, updateAddons }}
    >
      {children}
    </ClusterContext.Provider>
  )
}

export function useCluster() {
  const ctx = useContext(ClusterContext)
  if (!ctx) throw new Error('useCluster must be used within ClusterProvider')
  return ctx
}
