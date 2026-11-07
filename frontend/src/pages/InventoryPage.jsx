import { AlertTriangle, History, Package, Plus, SlidersHorizontal } from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import LotFields, { KINDS } from '../components/LotFields'
import Modal from '../components/Modal'
import { parseAmount } from '../planning/regions'
import { fmtDate } from '../planning/technique'

const kindLabel = (key) => KINDS.find((k) => k.key === key)?.label ?? key

function ProductModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ brand: '', name: '', kind: 'preenchedor', unit: 'ml', anvisa_registration: '' })
  const [lot, setLot] = useState({ number: '', expires_on: '', quantity: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const setLotField = (field) => (e) => setLot({ ...lot, [field]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Produto e primeiro lote vão juntos: o servidor grava os dois ou nenhum.
      onSaved(await api.inventory.createProduct({ ...form, lot: { ...lot, quantity: parseAmount(lot.quantity) } }))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title="Novo produto" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorList error={error} />
        <div className="form-row">
          <label className="field">
            <span>Marca</span>
            <input className="input" value={form.brand} onChange={set('brand')} required autoFocus />
          </label>
          <label className="field">
            <span>Nome</span>
            <input className="input" value={form.name} onChange={set('name')} required />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Tipo</span>
            <select
              className="input"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value, unit: KINDS.find((k) => k.key === e.target.value).unit })}
            >
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Unidade</span>
            <select className="input" value={form.unit} onChange={set('unit')}>
              <option value="ml">ml</option>
              <option value="U">U (unidades)</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Registro Anvisa</span>
          <input className="input" value={form.anvisa_registration} onChange={set('anvisa_registration')} />
        </label>
        <LotFields lot={lot} set={setLotField} unit={form.unit} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AdjustModal({ lot, onClose, onSaved }) {
  const [balance, setBalance] = useState(String(lot.balance))
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const value = Number(balance.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) return setError(new Error('Saldo inválido.'))
    if (!reason.trim()) return setError(new Error('Informe o motivo do ajuste.'))
    setBusy(true)
    setError(null)
    try {
      await api.inventory.updateLot(lot.id, { balance: value, reason: reason.trim() })
      onSaved()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Ajustar saldo do lote ${lot.number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorList error={error} />
        <label className="field">
          <span>Novo saldo ({lot.unit})</span>
          <input className="input" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Motivo do ajuste (obrigatório)</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  )
}

function LotModal({ products, onClose, onSaved }) {
  const [form, setForm] = useState({ product_id: products[0]?.id ?? '', number: '', expires_on: '', quantity: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const unit = products.find((p) => p.id === Number(form.product_id))?.unit

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.inventory.createLot({ ...form, product_id: Number(form.product_id), quantity: parseAmount(form.quantity) }))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title="Entrada de lote" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorList error={error} />
        <label className="field">
          <span>Produto</span>
          <select className="input" value={form.product_id} onChange={set('product_id')} required>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.name}
              </option>
            ))}
          </select>
        </label>
        <LotFields lot={form} set={set} unit={unit} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            Registrar entrada
          </button>
        </div>
      </form>
    </Modal>
  )
}

const MOVE_LABEL = { entrada: 'Entrada', ajuste: 'Ajuste', baixa: 'Baixa' }

function MovementsRow({ lotId }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    api.inventory.movements(lotId).then(setRows).catch(setError)
  }, [lotId])
  return (
    <tr>
      <td colSpan={6}>
        <ErrorList error={error} />
        {!rows && !error && <span className="inv-meta">Carregando…</span>}
        {rows && !rows.length && <span className="inv-meta">Sem movimentações.</span>}
        {rows?.map((m) => (
          <span key={m.id} className="inv-meta">
            {new Date(m.created_at).toLocaleString('pt-BR')} · {MOVE_LABEL[m.kind] ?? m.kind} {m.delta > 0 ? '+' : ''}
            {m.delta} → saldo {m.balance_after}
            {m.author && ` · ${m.author}`}
            {m.reason && ` · ${m.reason}`}
          </span>
        ))}
      </td>
    </tr>
  )
}

function lotStatus(lot) {
  if (lot.expired) return { cls: 'expired', text: 'Vencido' }
  if (lot.days_to_expire <= 30) return { cls: 'soon', text: `Vence em ${lot.days_to_expire} d` }
  return { cls: 'ok', text: 'Válido' }
}

export default function InventoryPage() {
  const [products, setProducts] = useState(null)
  const [lots, setLots] = useState([])
  const [alerts, setAlerts] = useState({ expired: [], expiring: [] })
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // 'product' | 'lot'
  const [adjusting, setAdjusting] = useState(null) // lote em ajuste de saldo
  const [openHistory, setOpenHistory] = useState(null) // id do lote com histórico aberto

  const load = useCallback(async () => {
    try {
      const [p, l, a] = await Promise.all([api.inventory.products(), api.inventory.lots(), api.inventory.alerts()])
      setProducts(p)
      setLots(l)
      setAlerts(a)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action) {
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err)
    }
  }

  const done = () => {
    setModal(null)
    load()
  }

  if (!products) return error ? <ErrorList error={error} /> : <div className="boot">Carregando…</div>
  const activeProducts = products.filter((p) => p.active)

  return (
    <div className="inventory">
      <div className="page-head">
        <div>
          <h1>Estoque</h1>
          <p>Produtos, lotes e validade. A baixa acontece quando o plano é marcado como aplicado.</p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setModal('product')}>
          <Plus size={16} /> Produto
        </button>
        <button className="btn primary" onClick={() => setModal('lot')} disabled={!activeProducts.length}>
          <Plus size={16} /> Entrada de lote
        </button>
      </div>

      <ErrorList error={error} />

      {(alerts.expired.length > 0 || alerts.expiring.length > 0) && (
        <div className="inv-alerts" role="status">
          {alerts.expired.length > 0 && (
            <div className="alert error">
              <AlertTriangle size={15} /> <b>Vencidos com saldo:</b>{' '}
              {alerts.expired.map((l) => `${l.product_label} (lote ${l.number}, ${fmtDate(l.expires_on)})`).join('; ')}
            </div>
          )}
          {alerts.expiring.length > 0 && (
            <div className="alert warn">
              <AlertTriangle size={15} /> <b>Vencem em até 30 dias:</b>{' '}
              {alerts.expiring.map((l) => `${l.product_label} (lote ${l.number}, ${fmtDate(l.expires_on)})`).join('; ')}
            </div>
          )}
        </div>
      )}

      {!products.length ? (
        <div className="card empty">
          <Package size={28} />
          <h2>Nenhum produto ainda</h2>
          <p>Cadastre um produto com o primeiro lote. As próximas entradas vão em Entrada de lote.</p>
        </div>
      ) : (
        products.map((product) => {
          const productLots = lots.filter((l) => l.product_id === product.id)
          return (
            <section key={product.id} className={`card inv-product ${product.active ? '' : 'inactive'}`}>
              <div className="inv-head">
                <div>
                  <strong>
                    {product.brand} {product.name}
                  </strong>
                  <span className="inv-meta">
                    {kindLabel(product.kind)} · {product.unit}
                    {product.anvisa_registration && ` · Anvisa ${product.anvisa_registration}`}
                  </span>
                </div>
                <span className="spacer" />
                <button
                  className="btn ghost small"
                  onClick={() => run(() => api.inventory.updateProduct(product.id, { active: !product.active }))}
                >
                  {product.active ? 'Desativar' : 'Reativar'}
                </button>
              </div>
              {productLots.length ? (
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Validade</th>
                      <th>Inicial</th>
                      <th>Saldo</th>
                      <th>Situação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {productLots.map((lot) => {
                      const st = lotStatus(lot)
                      return (
                        <Fragment key={lot.id}>
                        <tr>
                          <td>{lot.number}</td>
                          <td>{fmtDate(lot.expires_on)}</td>
                          <td>
                            {lot.initial_quantity} {lot.unit}
                          </td>
                          <td>
                            <b>
                              {lot.balance} {lot.unit}
                            </b>
                          </td>
                          <td>
                            <span className={`lot-status ${st.cls}`}>{st.text}</span>
                          </td>
                          <td className="inv-actions">
                            <button
                              className="icon-btn"
                              aria-label={`Histórico do lote ${lot.number}`}
                              onClick={() => setOpenHistory(openHistory === lot.id ? null : lot.id)}
                            >
                              <History size={14} />
                            </button>
                            <button className="icon-btn" aria-label={`Ajustar saldo do lote ${lot.number}`} onClick={() => setAdjusting(lot)}>
                              <SlidersHorizontal size={14} />
                            </button>
                          </td>
                        </tr>
                        {openHistory === lot.id && <MovementsRow lotId={lot.id} />}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="inv-meta">Sem lotes.</p>
              )}
            </section>
          )
        })
      )}

      {modal === 'product' && <ProductModal onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'lot' && <LotModal products={activeProducts} onClose={() => setModal(null)} onSaved={done} />}
      {adjusting && (
        <AdjustModal
          lot={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null)
            load()
          }}
        />
      )}
    </div>
  )
}
