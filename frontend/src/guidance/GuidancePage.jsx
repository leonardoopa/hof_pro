import { FileText, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { formatAmount, regionLabel, round2, treatmentOf } from '../planning/regions'
import '../styles/guidance.css'

const dateBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

/** Soma por tratamento (dose e regiões) só dos pontos com quantidade. */
function summarize(points = []) {
  const map = new Map()
  for (const p of points) {
    const amount = Number(p.amount)
    if (!(amount > 0)) continue
    const row = map.get(p.treatment) ?? { treatment: p.treatment, amount: 0, regions: new Set() }
    row.amount += amount
    row.regions.add(p.region)
    map.set(p.treatment, row)
  }
  return [...map.values()].map((r) => ({ ...r, amount: round2(r.amount), regions: [...r.regions] }))
}

export default function GuidancePage() {
  const { patient } = useOutletContext()
  const [plans, setPlans] = useState(null)
  const [planId, setPlanId] = useState(null)
  const [guidance, setGuidance] = useState(null)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api.plans
      .list(patient.id)
      .then((list) => {
        if (!alive) return
        setPlans(list)
        setPlanId(list[0]?.id ?? null)
      })
      .catch((err) => alive && setError(err))
    return () => {
      alive = false
    }
  }, [patient.id])

  useEffect(() => {
    if (plans == null) return
    if (planId == null) {
      setGuidance(null)
      setPlan(null)
      return
    }
    let alive = true
    setGuidance(null)
    Promise.all([api.guidance.forPatient(patient.id, planId), api.plans.get(planId)])
      .then(([g, p]) => {
        if (!alive) return
        setGuidance(g)
        setPlan(p)
      })
      .catch((err) => alive && setError(err))
    return () => {
      alive = false
    }
  }, [patient.id, planId, plans])

  const summary = useMemo(() => summarize(plan?.points), [plan])

  if (error && !plans) return <ErrorList error={error} />
  if (!plans) return <div className="boot">Carregando…</div>

  if (plans.length === 0) {
    return (
      <div className="empty-state">
        <FileText size={28} />
        <h2>Resumo e orientações</h2>
        <p>Ainda não há plano de tratamento. Monte o planejamento facial para gerar o resumo e as orientações do paciente.</p>
        <Link className="btn primary" to="../planejamento">
          Ir para o planejamento
        </Link>
      </div>
    )
  }

  return (
    <div className="guidance">
      <ErrorList error={error} />

      <div className="guidance-bar no-print">
        {plans.length > 1 && (
          <label className="field">
            <span>Plano</span>
            <select className="input" value={planId ?? ''} onChange={(e) => setPlanId(Number(e.target.value))}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || 'Plano'} · {dateBR(p.created_at)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()} disabled={!guidance}>
          <Printer size={16} /> Imprimir / salvar PDF
        </button>
      </div>

      {!guidance ? (
        <div className="boot">Carregando…</div>
      ) : (
        <article className="card print-sheet">
          <header className="sheet-head">
            <div className="logo">
              HOF
              <small>PLANEJAMENTO ESTÉTICO</small>
            </div>
            <div className="sheet-meta">
              <h1>Resumo e orientações pós-procedimento</h1>
              <p>
                <strong>{guidance.patient_name}</strong>
                {guidance.plan_date && ` · Plano de ${dateBR(guidance.plan_date)}`}
                {guidance.plan_title && ` · ${guidance.plan_title}`}
              </p>
              <p>
                {guidance.professional_name}
                {guidance.professional_title && ` · ${guidance.professional_title}`}
              </p>
            </div>
          </header>

          <section className="sheet-section">
            <h2>Resumo do plano</h2>
            {summary.length === 0 ? (
              <p className="muted-text">Nenhuma aplicação com quantidade definida neste plano.</p>
            ) : (
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>Tratamento</th>
                    <th>Regiões</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.treatment}>
                      <td>{treatmentOf(r.treatment).label}</td>
                      <td>{r.regions.map(regionLabel).join(', ')}</td>
                      <td className="num">
                        {formatAmount(r.amount)} {treatmentOf(r.treatment).unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan?.notes && <p className="sheet-notes">{plan.notes}</p>}
          </section>

          {guidance.treatments_without_template.length > 0 && (
            <div className="alert warn no-print">
              Sem orientação ativa cadastrada para: {guidance.treatments_without_template.join(', ')}. Cadastre ou ative no
              admin (Orientações).
            </div>
          )}

          {guidance.sections.map((section) => (
            <section key={section.treatment} className="sheet-section">
              <h2>{section.treatment_label}</h2>
              {section.orientations.map((o) => (
                <div key={o.id} className="guide-block">
                  <h3>{o.title}</h3>
                  <ul>
                    {o.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}

          {guidance.sections.length === 0 && summary.length > 0 && guidance.treatments_without_template.length === 0 && (
            <p className="muted-text">Nenhuma orientação aplicável aos tratamentos deste plano.</p>
          )}

          <footer className="sheet-foot">
            <p>
              Estas orientações são gerais e não substituem a avaliação individual. Em caso de dúvida, dor intensa ou
              qualquer alteração que o preocupe, entre em contato com o profissional responsável. Os resultados variam de
              pessoa para pessoa e não são garantidos.
            </p>
            <div className="signatures">
              <div>
                <span />
                Paciente
              </div>
              <div>
                <span />
                {guidance.professional_name}
              </div>
            </div>
          </footer>
        </article>
      )}
    </div>
  )
}
