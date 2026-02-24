import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/',          label: 'Dashboard',     icon: '◎' },
  { to: '/wizard',    label: 'Config Wizard', icon: '⚙' },
  { to: '/nodes',     label: 'Nodes',         icon: '⊞' },
  { to: '/addons',    label: 'Add-ons',       icon: '⊕' },
  { to: '/registry',  label: 'Registry',      icon: '⊛' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100" style={{ fontFamily: "'SF Mono','Fira Code',monospace" }}>
      {/* Sidebar */}
      <aside className="w-52 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-800">
          <h1 className="text-xs font-bold text-blue-400 tracking-widest uppercase">bootstrap-hci</h1>
          <p className="text-xs text-gray-600 mt-0.5">bare metal k8s</p>
        </div>

        <nav className="flex-1 py-3">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400'
                    : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
                }`
              }
            >
              <span className="text-sm w-4 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-xs text-gray-700">k8s v1.31.0 · flatcar 3975.2.2</p>
        </div>
      </aside>

      {/* Main — overflow managed per-page */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
