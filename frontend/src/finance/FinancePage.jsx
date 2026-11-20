import { Plus, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { useToast } from '../components/Toast'
import BudgetModal, { METHOD_LABEL, StatusChip, fmtDate } from './BudgetModal'
import { formatBRL } from './money'
import PricesTab from './PricesTab'

const TABS = [
  { key: 'orcamentos', label: 'Orçamentos' },
  { key: 'precos', label: 'Preços' },
  { key: 'resumo', label: 'Resumo' },
]
const STATUS_FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'rascunho', label: 'Rascunho' },
  { key: 'aprovado', label: 'Aprovados' },
  { key: 'recusado', label: 'Recusados' },
  { key: 'cancelado', label: 'Cancelados' },
]
const LIST_LIMIT = 200

// ---- orçamentos ----
function BudgetsTab({ onOpen, onNew, refreshKey }) {
  const [status, setStatus] = useState('')
  const [budgets, setBudgets] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let stale = false // troca rápida de filtro: ignora a resposta antiga
    api.finance
      .budgets({ status, limit: LIST_LIMIT })
      .then((rows) => {
        if (stale) return
        setBudgets(rows)
        setError(null)
      })
      .catch((e) => {
        if (stale) return
        setBudgets(null)
        setError(e)
      })
    return () => {
      stale = true
    }
  }, [status, refreshKey, attempt])

  const filter = (key) => {
    if (key === status) return
    setBudgets(null) // a lista do filtro anterior não pode passar por resultado do novo
    setStatus(key)
  }

  return (
    <section>
      <div className="fin-bar">
        <div className="fin-filters" role="group" aria-label="Filtrar por situação">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} type="button" className="fin-filter" aria-pressed={status === f.key} onClick={() => filter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={onNew}>
          <Plus size={16} /> Novo orçamento
        </button>
      </div>
      <ErrorList error={error} />
      {error && !budgets && (
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Tentar de novo
        </button>
      )}
      {!budgets && !error && <p className="fin-hint">Carregando…</p>}

      {budgets?.length === 0 && (
        <div className="empty-state">
          <Wallet size={26} />
          <h2>{status ? 'Nenhum orçamento nesta situação' : 'Nenhum orçamento ainda'}</h2>
          <p>
            {status
              ? 'Escolha outra situação ou veja todos os orçamentos.'
              : 'Gere um orçamento pelo plano do paciente (botão "Gerar orçamento" no planejamento) ou crie um manualmente.'}
          </p>
          {!status && (
            <button className="btn primary" onClick={onNew}>
              <Plus size={16} /> Novo orçamento
            </button>
          )}
        </div>
      )}

      {budgets?.length > 0 && (
        <div className="card fin-card">
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Paciente</th>
                  <th>Criado em</th>
                  <th>Situação</th>
                  <th className="num">Total</th>
                  <th className="num">Pago</th>
                  <th className="num">Saldo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className={b.patient_hidden ? 'fin-hidden' : 'fin-patient-name'}>{b.patient_name}</span>
                      <span className="fin-meta">Nº {b.id}</span>
                    </td>
                    <td>{fmtDate(b.created_at)}</td>
                    <td>
                      <StatusChip status={b.status} />
                    </td>
                    <td className="num fin-money">{formatBRL(b.total_cents)}</td>
                    <td className="num fin-money">{formatBRL(b.paid_cents)}</td>
                    <td className={`num fin-money${b.status === 'aprovado' && b.balance_cents > 0 ? ' fin-open' : ''}`}>
                      {b.status === 'aprovado' ? formatBRL(b.balance_cents) : <span className="fin-muted">—</span>}
                    </td>
                    <td>
                      <button className="btn small" onClick={() => onOpen(b.id)} aria-label={`Abrir orçamento nº ${b.id}`}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {budgets.length >= LIST_LIMIT && <p className="fin-hint">Mostrando os {LIST_LIMIT} orçamentos mais recentes.</p>}
        </div>
      )}
    </section>
  )
}

// ---- resumo ----
const currentMonth = () => new Date().toLocaleDateString('sv-SE').slice(0, 7)
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function Bars({ rows, label }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.cents)), 1)
  return (
    <ul className="fin-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="fin-bar-label">{label(r)}</span>
          <span className="fin-bar-track" aria-hidden="true">
            <i className={r.cents < 0 ? 'neg' : undefined} style={{ width: `${(Math.abs(r.cents) / max) * 100}%` }} />
          </span>
          <span className={`fin-money num${r.cents < 0 ? ' neg' : ''}`}>{formatBRL(r.cents)}</span>
        </li>
      ))}
    </ul>
  )
}

function SummaryTab() {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!month) return // campo vazio: mantém a tela, sem pedir ao servidor
    let stale = false
    api.finance
      .summary(month)
      .then((r) => {
        if (stale) return
        setData(r)
        setError(null)
      })
      .catch((e) => {
        if (stale) return
        setData(null)
        setError(e)
      })
    return () => {
      stale = true
    }
  }, [month, attempt])

  const methods = data ? Object.entries(data.by_method).filter(([, cents]) => cents !== 0).map(([key, cents]) => ({ key, cents })) : []
  methods.sort((a, b) => b.cents - a.cents)
  const days = data ? data.by_day.map((d) => ({ key: d.date, cents: d.received_cents })) : []
  const loading = !data && !error && Boolean(month)

  return (
    <section>
      <div className="fin-bar">
        <label className="field fin-month">
          <span>Mês</span>
          <input
            className="input"
            type="month"
            value={month}
            onChange={(e) => {
              setData(null)
              setMonth(e.target.value)
            }}
          />
        </label>
      </div>
      <ErrorList error={error} />
      {error && !data && (
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Tentar de novo
        </button>
      )}
      {loading && <p className="fin-hint">Carregando…</p>}
      {!month && <p className="fin-hint">Escolha o mês para ver o resumo.</p>}

      {data && (
        <>
          <div className="fin-stats" aria-label={`Resumo de ${monthLabel(data.month)}`}>
            <div>
              <span>Faturado no mês</span>
              <strong className="fin-money">{formatBRL(data.billed_cents)}</strong>
              <small>Orçamentos aprovados em {monthLabel(data.month)}</small>
            </div>
            <div>
              <span>Recebido no mês</span>
              <strong className="fin-money">{formatBRL(data.received_cents)}</strong>
              <small>Pagamentos do mês, já descontados os estornos</small>
            </div>
            <div className="open">
              <span>Em aberto</span>
              <strong className="fin-money">{formatBRL(data.open_cents)}</strong>
              <small>Saldo atual de todos os orçamentos aprovados</small>
            </div>
          </div>

          <div className="fin-split">
            <section className="card fin-card">
              <h2 className="card-title">Por forma de pagamento</h2>
              {methods.length === 0 ? (
                <p className="fin-hint">Nenhum pagamento neste mês.</p>
              ) : (
                <Bars rows={methods} label={(r) => METHOD_LABEL[r.key] ?? r.key} />
              )}
            </section>
            <section className="card fin-card">
              <h2 className="card-title">Por dia</h2>
              {days.length === 0 ? (
                <p className="fin-hint">Nenhum pagamento neste mês.</p>
              ) : (
                <Bars rows={days} label={(r) => new Date(`${r.key}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', weekday: 'short' })} />
              )}
            </section>
          </div>
        </>
      )}
    </section>
  )
}

// ---- página ----
export default function FinancePage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const [tab, setTab] = useState('orcamentos')
  // Vindo do planejamento: /financeiro?orcamento=ID, com os avisos de itens sem preço no estado da navegação.
  const [modal, setModal] = useState(() => {
    const id = Number(params.get('orcamento'))
    return id > 0 ? { id, warnings: location.state?.warnings ?? [] } : null
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const [notify, toastNode] = useToast()
  const tabRefs = useRef({})

  const closeModal = useCallback(() => {
    setModal(null)
    if (params.has('orcamento')) setParams({}, { replace: true, state: null })
  }, [params, setParams])

  const onTabKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = TABS[(TABS.findIndex((t) => t.key === tab) + step + TABS.length) % TABS.length].key
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="finance">
      <div className="page-head">
        <div>
          <h1>Financeiro</h1>
          <p>Orçamentos, pagamentos e tabela de preços do consultório.</p>
        </div>
      </div>

      <div className="fin-tabs" role="tablist" aria-label="Seções do financeiro" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.key}
            ref={(el) => (tabRefs.current[t.key] = el)}
            type="button"
            role="tab"
            id={`fin-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`fin-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className="fin-tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`fin-panel-${tab}`} aria-labelledby={`fin-tab-${tab}`}>
        {tab === 'orcamentos' && <BudgetsTab refreshKey={refreshKey} onOpen={(id) => setModal({ id, warnings: [] })} onNew={() => setModal({ id: null, warnings: [] })} />}
        {tab === 'precos' && <PricesTab notify={notify} />}
        {tab === 'resumo' && <SummaryTab />}
      </div>

      {modal && (
        <BudgetModal
          key={modal.id ?? 'novo'}
          budgetId={modal.id}
          initialWarnings={modal.warnings}
          onClose={closeModal}
          onChanged={() => setRefreshKey((n) => n + 1)}
          notify={notify}
        />
      )}
      {toastNode}
    </div>
  )
}
