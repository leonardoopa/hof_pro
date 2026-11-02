import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import ErrorList from '../components/ErrorList'

const EMPTY = { full_name: '', professional_title: '', license_number: '', email: '', password: '' }

export default function AuthPage({ mode }) {
  const { login, register } = useAuth()
  const isRegister = mode === 'register'
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isRegister) await register(form)
      else await login({ email: form.email, password: form.password })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="logo">
          HOF
          <small>PLANEJAMENTO ESTÉTICO FACIAL</small>
        </div>
        <h1>{isRegister ? 'Criar conta' : 'Entrar'}</h1>
        <p className="lead">
          {isRegister ? 'Cadastre-se para guardar os prontuários dos seus pacientes.' : 'Acesse o painel com seu e-mail e senha.'}
        </p>

        <ErrorList error={error} />

        {isRegister && (
          <>
            <label className="field">
              <span>Nome completo</span>
              <input className="input" value={form.full_name} onChange={set('full_name')} required minLength={2} autoComplete="name" />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Título</span>
                <input className="input" placeholder="Cirurgiã-Dentista" value={form.professional_title} onChange={set('professional_title')} />
              </label>
              <label className="field">
                <span>Registro (CRO/CRM)</span>
                <input className="input" value={form.license_number} onChange={set('license_number')} />
              </label>
            </div>
          </>
        )}

        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={isRegister ? 8 : undefined}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />
        </label>

        <button className="btn primary wide" disabled={busy}>
          {busy ? 'Aguarde…' : isRegister ? 'Criar conta' : 'Entrar'}
        </button>

        <p className="auth-switch">
          {isRegister ? (
            <>
              Já tem conta? <Link to="/entrar">Entrar</Link>
            </>
          ) : (
            <>
              Primeiro acesso? <Link to="/cadastro">Criar conta</Link>
            </>
          )}
        </p>
      </form>
    </div>
  )
}
