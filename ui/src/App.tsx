import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ClusterProvider } from './context/ClusterContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ConfigWizard from './pages/ConfigWizard'
import NodeInventory from './pages/NodeInventory'
import AddonPanel from './pages/AddonPanel'
import Registry from './pages/Registry'

export default function App() {
  return (
    <ClusterProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="wizard" element={<ConfigWizard />} />
            <Route path="nodes" element={<NodeInventory />} />
            <Route path="addons" element={<AddonPanel />} />
            <Route path="registry" element={<Registry />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ClusterProvider>
  )
}
