import { AlertTriangle, Package, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'
import { fmtDate } from '../planning/technique'

const KINDS = [
  { key: 'toxina', label: 'Toxina', unit: 'U' },
  { key: 'preenchedor', label: 'Preenchedor', unit: 'ml' },
  { key: 'bioestimulador', label: 'Bioestimulador', unit: 'ml' },
  { key: 'skinbooster', label: 'Skinbooster', unit: 'ml' },
  { key: 'outro', label: 'Outro', unit: 'ml' },
]
const kindLabel = (key) => KINDS.find((k) => k.key === key)?.label ?? key

function ProductModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ brand: '', name: '', kind: 'preenchedor', unit: 'ml', anvisa_registration: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.inventory.createProduct(form))
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
      onSaved(await api.inventory.createLot({ ...form, product_id: Number(form.product_id), quantity: Number(form.quantity) }))
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
        <div className="form-row">
          <label className="field">
            <span>Número do lote</span>
            <input className="input" value={form.number} onChange={set('number')} required />
          </label>
          <label className="field">
            <span>Validade</span>
            <input className="input" type="date" value={form.expires_on} onChange={set('expires_on')} required />
          </label>
        </div>
        <label className="field">
          <span>Quantidade ({unit})</span>
          <input className="input" type="number" min="0.01" step="0.01" value={form.quantity} onChange={set('quantity')} required />
        </label>
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
          <p>Cadastre um produto e depois registre a entrada dos lotes.</p>
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
                <button
                  className="icon-btn"
                  aria-label={`Excluir ${product.name}`}
                  onClick={() => window.confirm('Excluir o produto e seus lotes?') && run(() => api.inventory.removeProduct(product.id))}
                >
                  <Trash2 size={15} />
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
                        <tr key={lot.id}>
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
                              aria-label={`Excluir lote ${lot.number}`}
                              onClick={() => window.confirm('Excluir este lote?') && run(() => api.inventory.removeLot(lot.id))}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
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
    </div>
  )
}
