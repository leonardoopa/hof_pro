import { BarChart3, CalendarDays, LogOut, Moon, Package, Sun, Users, Wallet } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../theme'

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')

export default function AppLayout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()

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
          <NavLink to="/agenda">
            <CalendarDays size={19} />
            <span>Agenda</span>
          </NavLink>
          <NavLink to="/estoque">
            <Package size={19} />
            <span>Estoque</span>
          </NavLink>
          <NavLink to="/relatorios">
            <BarChart3 size={19} />
            <span>Relatórios</span>
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
          <button
            className="icon-btn theme-toggle"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
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
