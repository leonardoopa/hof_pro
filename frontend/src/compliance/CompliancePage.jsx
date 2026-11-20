import { AlertTriangle, ArrowRight, CheckCircle2, Info, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'

// Cada código leva à aba do paciente onde a pendência se resolve (rotas em App.jsx).
const TAB_BY_CODE = {
  sem_anamnese: { to: 'anamnese', label: 'Abrir anamnese' },
  sem_termo: { to: 'prontuario', label: 'Abrir prontuário' },
  sem_lote: { to: 'planejamento', label: 'Abrir planejamento' },
  plano_sem_aplicacao: { to: 'planejamento', label: 'Abrir planejamento' },
  intercorrencia_aberta: { to: 'intercorrencias', label: 'Abrir intercorrências' },
}

const GROUPS = [
  { key: 'alta', title: 'Alta prioridade', hint: 'Resolver antes do próximo atendimento.', Icon: ShieldAlert },
  { key: 'media', title: 'Média prioridade', hint: 'Fechar nos próximos dias.', Icon: AlertTriangle },
  { key: 'baixa', title: 'Baixa prioridade', hint: 'Revisar quando houver tempo.', Icon: Info },
]

function PatientName({ name }) {
  // O servidor manda "Dados ocultos" no lugar do nome; aqui só muda o visual.
  return name === 'Dados ocultos' ? <span className="compliance-name hidden">{name}</span> : <strong className="compliance-name">{name}</strong>
}

function Item({ item }) {
  const tab = TAB_BY_CODE[item.code]
  return (
    <li className="compliance-item">
      <div className="compliance-text">
        <PatientName name={item.patient_name} />
        <span>{item.message}</span>
      </div>
      {tab && (
        <Link className="btn small" to={`/pacientes/${item.patient_id}/${tab.to}`}>
          {tab.label} <ArrowRight size={14} />
        </Link>
      )}
    </li>
  )
}

export default function CompliancePage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stale = false // saiu da tela ou pediu de novo: ignora a resposta antiga
    setLoading(true)
    api.compliance.list()
      .then((r) => { if (!stale) { setData(r); setError(null) } })
      .catch((e) => { if (!stale) setError(e) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [tick])

  const total = data ? data.items.length : 0

  return (
    <div className="compliance">
      <div className="page-head">
        <div>
          <h1>Pendências</h1>
          <p>O que ficou em aberto no prontuário dos seus pacientes: anamnese, termos, lotes e intercorrências.</p>
        </div>
        <button className="btn" onClick={() => setTick((n) => n + 1)} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <ErrorList error={error} />

      {loading && !data && <p className="compliance-loading" role="status">Carregando…</p>}

      {data && total === 0 && (
        <div className="card empty">
          <CheckCircle2 size={28} />
          <h2>Nenhuma pendência</h2>
          <p>Anamnese, termos, lotes e intercorrências dos seus pacientes estão em dia.</p>
        </div>
      )}

      {data && total > 0 && (
        <>
          <div className="compliance-stats" aria-label="Pendências por prioridade">
            {GROUPS.map((g) => (
              <div key={g.key} className={`stat ${g.key}`}>
                <strong>{data.counts[g.key] ?? 0}</strong>
                <span>{g.title.toLowerCase()}</span>
              </div>
            ))}
          </div>

          {GROUPS.map(({ key, title, hint, Icon }) => {
            const rows = data.items.filter((i) => i.severity === key)
            if (rows.length === 0) return null
            return (
              <section key={key} className={`card compliance-group ${key}`} aria-label={title}>
                <h2 className="card-title">
                  <Icon size={18} /> {title}
                  <span className="sub">{hint}</span>
                </h2>
                <ul className="compliance-list">
                  {rows.map((item) => (
                    <Item key={`${item.code}-${item.ref.type}-${item.ref.id}`} item={item} />
                  ))}
                </ul>
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
