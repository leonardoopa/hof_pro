import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'

// Dia local em AAAA-MM-DD; toISOString daria o dia seguinte depois das 21h no Brasil.
const iso = (d) => d.toLocaleDateString('sv-SE')
const fmtDay = (value) => new Date(value).toLocaleDateString('pt-BR')
const fmtNum = (value) => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

// Exporta no cliente: BOM para o Excel reconhecer UTF-8; aspas escapadas.
export function downloadCsv(filename, header, rows) {
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const text = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Section({ title, sub, onExport, disabled, children }) {
  return (
    <section className="card report-card">
      <div className="report-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub && <span className="report-sub">{sub}</span>}
        </div>
        <button className="btn" onClick={onExport} disabled={disabled}>
          <Download size={16} /> Exportar CSV
        </button>
      </div>
      {children}
    </section>
  )
}

const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function MonthlySection({ setError }) {
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!month) return
    setLoading(true)
    api.reports
      .monthly(month)
      .then((r) => { setData(r); setError(null) })
      .catch((e) => { setData(null); setError(e) })
      .finally(() => setLoading(false))
  }, [month, setError])

  const exportCsv = () => {
    const rows = [
      ...data.patients.map((p) => ['Paciente', p.full_name, fmtDay(p.last_applied_at), p.applications, '', '']),
      ...data.by_lot.map((r) => ['Lote', r.product_label, r.lot_number, `${fmtNum(r.total)} ${r.unit}`, r.applications, r.balance == null ? '' : `${fmtNum(r.balance)} ${r.unit}`]),
    ]
    downloadCsv(`mensal-${month}.csv`, ['Tipo', 'Nome/Produto', 'Última aplicação/Lote', 'Aplicações/Total', 'Aplicações', 'Saldo'], rows)
  }

  return (
    <Section
      title="Relatório mensal"
      sub="Pacientes atendidos e produtos/lotes usados no mês. Pacientes com dados ocultos não aparecem."
      disabled={!data || (!data.patients.length && !data.by_lot.length)}
      onExport={exportCsv}
    >
      <div className="report-filters">
        <label className="field">
          <span>Mês</span>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>
      {loading && !data && <p className="report-empty">Carregando…</p>}
      {data && (
        <>
          <div className="report-stats" aria-label={`Resumo de ${monthLabel(data.month)}`}>
            <div><strong>{data.patients_count}</strong><span>pacientes atendidos</span></div>
            <div><strong>{data.new_patients_count}</strong><span>novos cadastros</span></div>
            <div><strong>{data.applications_count}</strong><span>aplicações</span></div>
          </div>
          <h3 className="report-h3">Pacientes do mês</h3>
          {data.patients.length === 0 ? (
            <p className="report-empty">Nenhum paciente atendido neste mês.</p>
          ) : (
            <table className="report-table">
              <thead><tr><th>Paciente</th><th>Última aplicação</th><th className="num">Aplicações</th></tr></thead>
              <tbody>
                {data.patients.map((p) => (
                  <tr key={p.patient_id}>
                    <td>{p.full_name}</td>
                    <td>{fmtDay(p.last_applied_at)}</td>
                    <td className="num">{p.applications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="report-h3">Produtos usados</h3>
          {data.by_product.length === 0 ? (
            <p className="report-empty">Nenhum produto usado neste mês.</p>
          ) : (
            <table className="report-table">
              <thead><tr><th>Produto</th><th className="num">Total</th><th className="num">Aplicações</th></tr></thead>
              <tbody>
                {data.by_product.map((r) => (
                  <tr key={`${r.product_id}-${r.unit}`}>
                    <td>{r.product_label}</td>
                    <td className="num">{fmtNum(r.total)} {r.unit}</td>
                    <td className="num">{r.applications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.by_lot.length > 0 && (
            <>
              <h3 className="report-h3">Lotes usados</h3>
              <table className="report-table">
                <thead><tr><th>Produto</th><th>Lote</th><th>Validade</th><th className="num">Usado</th><th className="num">Saldo</th></tr></thead>
                <tbody>
                  {data.by_lot.map((r) => (
                    <tr key={`${r.lot_id}-${r.unit}`}>
                      <td>{r.product_label}</td>
                      <td>{r.lot_number}</td>
                      <td>{r.expires_on ? new Date(`${r.expires_on}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="num">{fmtNum(r.total)} {r.unit}</td>
                      <td className="num">{r.balance == null ? '—' : `${fmtNum(r.balance)} ${r.unit}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Section>
  )
}

export default function ReportsPage() {
  const today = new Date()
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 30 * 86_400_000)))
  const [to, setTo] = useState(iso(today))
  const [days, setDays] = useState(90)
  const [usage, setUsage] = useState(null)
  const [returns, setReturns] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!from || !to) return
    api.reports.usage(from, to).then((r) => { setUsage(r); setError(null) }).catch(setError)
  }, [from, to])

  useEffect(() => {
    if (!days || days < 1) return
    api.reports.returns(days).then((r) => { setReturns(r); setError(null) }).catch(setError)
  }, [days])

  return (
    <div className="reports">
      <div className="page-head">
        <div>
          <h1>Relatórios</h1>
          <p>Consumo de produtos e pacientes que podem voltar para um retorno.</p>
        </div>
      </div>
      <ErrorList error={error} />

      <MonthlySection setError={setError} />

      <Section
        title="Uso por lote e produto"
        sub="Baseado nas aplicações registradas no período."
        disabled={!usage?.by_lot.length}
        onExport={() =>
          downloadCsv(
            `uso-${from}-a-${to}.csv`,
            ['Produto', 'Lote', 'Unidade', 'Total', 'Aplicações'],
            usage.by_lot.map((r) => [r.product_label, r.lot_number, r.unit, fmtNum(r.total), r.applications]),
          )
        }
      >
        <div className="report-filters">
          <label className="field">
            <span>De</span>
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>Até</span>
            <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {usage && usage.by_lot.length === 0 && <p className="report-empty">Nenhuma aplicação no período.</p>}
        {usage && usage.by_lot.length > 0 && (
          <>
            <h3 className="report-h3">Por produto</h3>
            <table className="report-table">
              <thead>
                <tr><th>Produto</th><th className="num">Total</th><th className="num">Aplicações</th></tr>
              </thead>
              <tbody>
                {usage.by_product.map((r) => (
                  <tr key={`${r.product_id}-${r.unit}`}>
                    <td>{r.product_label}</td>
                    <td className="num">{fmtNum(r.total)} {r.unit}</td>
                    <td className="num">{r.applications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="report-h3">Por lote</h3>
            <table className="report-table">
              <thead>
                <tr><th>Produto</th><th>Lote</th><th className="num">Total</th><th className="num">Aplicações</th></tr>
              </thead>
              <tbody>
                {usage.by_lot.map((r) => (
                  <tr key={`${r.lot_id}-${r.unit}`}>
                    <td>{r.product_label}</td>
                    <td>{r.lot_number}</td>
                    <td className="num">{fmtNum(r.total)} {r.unit}</td>
                    <td className="num">{r.applications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section
        title="Retorno de pacientes"
        sub="Última aplicação há mais dias do que o informado. Pacientes arquivados ou com dados ocultos não aparecem."
        disabled={!returns?.patients.length}
        onExport={() =>
          downloadCsv(
            `retorno-${days}-dias.csv`,
            ['Paciente', 'Telefone', 'Última aplicação', 'Dias desde a última', 'Tratamentos'],
            returns.patients.map((r) => [r.full_name, r.phone, fmtDay(r.last_applied_at), r.days_since, r.treatments.join(', ')]),
          )
        }
      >
        <div className="report-filters">
          <label className="field">
            <span>Mais de (dias)</span>
            <input className="input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
        </div>
        {returns && returns.patients.length === 0 && <p className="report-empty">Nenhum paciente a retornar.</p>}
        {returns && returns.patients.length > 0 && (
          <table className="report-table">
            <thead>
              <tr><th>Paciente</th><th>Telefone</th><th>Última aplicação</th><th className="num">Dias</th><th>Tratamentos</th></tr>
            </thead>
            <tbody>
              {returns.patients.map((r) => (
                <tr key={r.patient_id}>
                  <td>{r.full_name}</td>
                  <td>{r.phone || '—'}</td>
                  <td>{fmtDay(r.last_applied_at)}</td>
                  <td className="num">{r.days_since}</td>
                  <td>{r.treatments.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}
