import { useEffect, useState } from 'react'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import LotFields, { KINDS } from '../components/LotFields'
import Modal from '../components/Modal'
import { parseAmount } from './regions'
import { UNIT_BY_TREATMENT, fmtDate } from './technique'

const KIND_BY_TREATMENT = { botox: 'toxina', preenchimento: 'preenchedor' } // os demais têm o mesmo nome
const NEW = 'novo'

/** Lote novo para o ponto, de um produto do estoque ou de um produto cadastrado aqui. A unidade vem do tratamento. */
export default function NewLotModal({ treatment, onClose, onSaved }) {
  const unit = UNIT_BY_TREATMENT[treatment]
  const kinds = KINDS.filter((k) => k.unit === unit)
  const [products, setProducts] = useState(null) // null = carregando
  const [choice, setChoice] = useState('') // id do produto ou NEW
  const [form, setForm] = useState({ brand: '', name: '', kind: KIND_BY_TREATMENT[treatment] ?? treatment, anvisa_registration: '' })
  const [lot, setLot] = useState({ number: '', expires_on: '', quantity: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const setLotField = (field) => (e) => setLot({ ...lot, [field]: e.target.value })

  useEffect(() => {
    let alive = true
    api.inventory
      .products()
      .then((all) => all.filter((p) => p.active && p.unit === unit))
      .catch((err) => {
        if (alive) setError(err)
        return []
      })
      .then((list) => {
        if (!alive) return
        setProducts(list)
        setChoice(list[0] ? String(list[0].id) : NEW)
      })
    return () => {
      alive = false
    }
  }, [unit])

  async function submit(e) {
    e.preventDefault()
    // O plano recusa lote vencido ao salvar; melhor saber agora, antes de o lote entrar no estoque.
    if (lot.expires_on < new Date().toLocaleDateString('sv-SE')) {
      return setError(new Error(`Validade ${fmtDate(lot.expires_on)} já passou. Lote vencido não pode ser usado no plano.`))
    }
    setBusy(true)
    setError(null)
    const body = { ...lot, quantity: parseAmount(lot.quantity) }
    try {
      onSaved(
        choice === NEW
          ? (await api.inventory.createProduct({ ...form, unit, lot: body })).lot
          : await api.inventory.createLot({ ...body, product_id: Number(choice) }),
      )
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title="Novo lote" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorList error={error} />
        <label className="field">
          <span>Produto</span>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!products}>
            {!products && <option value="">Carregando…</option>}
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.name}
              </option>
            ))}
            {products && <option value={NEW}>Novo produto</option>}
          </select>
        </label>
        {choice === NEW && (
          <>
            <div className="form-row">
              <label className="field">
                <span>Marca</span>
                <input className="input" value={form.brand} onChange={set('brand')} required />
              </label>
              <label className="field">
                <span>Nome</span>
                <input className="input" value={form.name} onChange={set('name')} required />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Tipo</span>
                <select className="input" value={form.kind} onChange={set('kind')}>
                  {kinds.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Registro Anvisa (opcional)</span>
                <input className="input" value={form.anvisa_registration} onChange={set('anvisa_registration')} />
              </label>
            </div>
          </>
        )}
        <LotFields lot={lot} set={setLotField} unit={unit} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !products}>
            Salvar lote
          </button>
        </div>
      </form>
    </Modal>
  )
}
