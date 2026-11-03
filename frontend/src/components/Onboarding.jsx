import { Check, Circle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from './ErrorList'

// Tela de primeiros passos: aparece quando o profissional ainda não tem pacientes.
export default function Onboarding({ hasProducts, onNewPatient, onDemoLoaded }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function loadDemo() {
    setBusy(true)
    setError(null)
    try {
      await api.demo.load()
      onDemoLoaded()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const steps = [
    { done: hasProducts, label: 'Cadastrar produto e lote', action: <Link className="btn" to="/estoque">Ir ao estoque</Link> },
    { done: false, label: 'Cadastrar paciente', action: <button className="btn" onClick={onNewPatient}>Novo paciente</button> },
    { done: false, label: 'Fazer a anamnese' },
    { done: false, label: 'Planejar os pontos de aplicação' },
    { done: false, label: 'Assinar o termo de consentimento' },
  ]

  return (
    <div className="card onboarding">
      <h2>Primeiros passos</h2>
      <p>Siga a ordem abaixo ou explore o sistema com pacientes fictícios, claramente marcados como "(Demo)".</p>
      <ol className="onboarding-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            {s.done ? <Check size={18} /> : <Circle size={18} />}
            <span>{s.label}</span>
            {s.action}
          </li>
        ))}
      </ol>
      <ErrorList error={error} />
      <button className="btn primary" onClick={loadDemo} disabled={busy}>
        {busy ? 'Carregando…' : 'Carregar dados de demonstração'}
      </button>
    </div>
  )
}
