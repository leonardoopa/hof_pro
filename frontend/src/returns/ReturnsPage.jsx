import { CheckCircle2, Copy, MessageCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { useToast } from '../components/Toast'
import { dueLabel, waLink } from './message'

const WITHIN_DAYS = 30
const KIND_LABEL = { toxina: 'Toxina', bioestimulador: 'Bioestimulador', preenchedor: 'Preenchedor', skinbooster: 'Skinbooster', outro: 'Outro' }
const FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'vencido', label: 'Vencidos' },
  { key: 'proximo', label: 'Próximos' },
]

const fmtDate = (value) => new Date(value).toLocaleDateString('pt-BR')
const fmtDay = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') // AAAA-MM-DD sem virar o dia por fuso
const days = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function ReturnRow({ item, onCopy }) {
  const link = waLink(item.phone, item.message)
  const hidden = item.patient_name === 'Dados ocultos'
  return (
    <tr>
      <td>
        <Link className={`ret-name ${hidden ? 'hidden-data' : ''}`} to={`/pacientes/${item.patient_id}`}>
          {item.patient_name}
        </Link>
        <small className="ret-phone">{item.phone || 'Sem telefone'}</small>
      </td>
      <td>{KIND_LABEL[item.kind] ?? item.kind}</td>
      <td>{fmtDate(item.last_applied_at)}</td>
      <td>
        <span className={`ret-status ${item.status}`}>{dueLabel(item.days_overdue)}</span>
        <small className="ret-phone">em {fmtDay(item.due_on)}</small>
      </td>
      <td>
        {days(item.interval_days)}
        <small className="ret-phone">{item.interval_source === 'produto' ? 'ajustado no produto' : 'padrão do tipo'}</small>
      </td>
      <td>
        <div className="ret-actions">
          {link ? (
            <a className="btn small" href={link} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp com ${item.patient_name}`}>
              <MessageCircle size={15} /> WhatsApp
            </a>
          ) : (
            <button type="button" className="btn small" disabled title="Paciente sem telefone utilizável">
              <MessageCircle size={15} /> WhatsApp
            </button>
          )}
          <button type="button" className="btn small" onClick={() => onCopy(item)} aria-label={`Copiar mensagem para ${item.patient_name}`}>
            <Copy size={15} /> Copiar mensagem
          </button>
        </div>
      </td>
    </tr>
  )
}

function ProductIntervals({ defaults }) {
  const [products, setProducts] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stale = false
    api.inventory
      .products()
      .then((r) => { if (!stale) setProducts(r) })
      .catch(() => { if (!stale) setFailed(true) })
    return () => { stale = true }
  }, [])

  return (
    <details className="card ret-products">
      <summary>Intervalos por produto</summary>
      <p className="ret-note">
        Quando o produto tem intervalo próprio, ele vale mais que o padrão do tipo. O ajuste por produto ainda não está disponível nesta tela.
      </p>
      {failed && <p className="ret-note">Não foi possível carregar os produtos.</p>}
      {!failed && !products && <p className="ret-note">Carregando…</p>}
      {products && products.length === 0 && <p className="ret-note">Nenhum produto cadastrado no estoque.</p>}
      {products && products.length > 0 && (
        <ul className="ret-product-list">
          {products.map((p) => {
            const own = p.return_interval_days
            const fallback = defaults?.[p.kind]
            return (
              <li key={p.id} className={p.active ? '' : 'inactive'}>
                <span>
                  {p.brand} {p.name}
                  <small className="ret-phone">{KIND_LABEL[p.kind] ?? p.kind}{p.active ? '' : ' · inativo'}</small>
                </span>
                <span className="ret-interval">
                  {own != null ? `${days(own)} (do produto)` : fallback != null ? `${days(fallback)} (padrão do tipo)` : 'Sem lembrete'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}

export default function ReturnsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('todos')
  const [toast, toastNode] = useToast()

  const load = useCallback(() => {
    setLoading(true)
    return api.returns.list(WITHIN_DAYS)
      .then((r) => { setData(r); setError(null) })
      .catch((e) => setError(e))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const items = data?.items ?? []
  const counts = useMemo(
    () => ({ todos: items.length, vencido: items.filter((i) => i.status === 'vencido').length, proximo: items.filter((i) => i.status === 'proximo').length }),
    [items],
  )
  const shown = filter === 'todos' ? items : items.filter((i) => i.status === filter)

  const copy = async (item) => {
    toast((await copyText(item.message)) ? 'Mensagem copiada' : 'Não foi possível copiar. Use o botão do WhatsApp.')
  }

  const defaults = data?.defaults
  const defaultsText = defaults
    ? Object.entries(defaults).map(([k, v]) => `${(KIND_LABEL[k] ?? k).toLowerCase()} ${v}`).join(', ')
    : ''

  return (
    <div className="returns">
      <div className="page-head">
        <div>
          <h1>Retornos</h1>
          <p>Pacientes que já podem voltar para a próxima aplicação.</p>
        </div>
        <button type="button" className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <div className="alert info ret-disclaimer" role="note">
        Os prazos são lembretes de atendimento, não recomendação clínica: usam um intervalo padrão por tipo de produto
        {defaultsText ? ` (em dias: ${defaultsText})` : ''}, que pode ser ajustado por produto. A decisão do retorno é do profissional.
      </div>

      <ErrorList error={error} />

      {loading && !data && <p className="ret-note">Carregando…</p>}

      {data && (
        <>
          <section className="card ret-card">
            <div className="ret-bar">
              <div className="ret-filters" role="group" aria-label="Filtrar retornos">
                {FILTERS.map((f) => (
                  <button key={f.key} type="button" className={`btn small ${filter === f.key ? 'primary' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                    {f.label} ({counts[f.key]})
                  </button>
                ))}
              </div>
              <span className="ret-note">Vencidos e os que vencem em até {WITHIN_DAYS} dias.</span>
            </div>

            {items.length === 0 ? (
              <div className="empty">
                <CheckCircle2 size={26} />
                <h2>Nenhum retorno pendente</h2>
                <p>
                  Ninguém está vencido nem vence nos próximos {WITHIN_DAYS} dias. Pacientes arquivados, com agendamento futuro ou
                  sem aplicação registrada não entram na lista.
                </p>
              </div>
            ) : shown.length === 0 ? (
              <p className="ret-note">Nenhum paciente neste filtro.</p>
            ) : (
              <div className="ret-table-wrap">
                <table className="ret-table">
                  <thead>
                    <tr><th>Paciente</th><th>Tratamento</th><th>Última aplicação</th><th>Retorno</th><th>Intervalo</th><th><span className="ret-sr">Ações</span></th></tr>
                  </thead>
                  <tbody>
                    {shown.map((item) => <ReturnRow key={`${item.patient_id}-${item.kind}`} item={item} onCopy={copy} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <ProductIntervals defaults={defaults} />
        </>
      )}
      {toastNode}
    </div>
  )
}
