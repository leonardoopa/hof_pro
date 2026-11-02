import { LogOut, Package, Users, Wallet } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')

export default function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          HOF
          <small>PLANEJAMENTO ESTÉTICO</small>
        </div>

        <nav className="nav" aria-label="Principal">
          <NavLink to="/pacientes">
            <Users size={19} />
            <span>Pacientes</span>
          </NavLink>
          <NavLink to="/estoque">
            <Package size={19} />
            <span>Estoque</span>
            <em className="soon">Em breve</em>
          </NavLink>
          <NavLink to="/financeiro">
            <Wallet size={19} />
            <span>Financeiro</span>
            <em className="soon">Em breve</em>
          </NavLink>
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{initials(user.full_name)}</div>
          <div className="who">
            <strong>{user.full_name}</strong>
            <span>{user.professional_title || user.email}</span>
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sair" title="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
