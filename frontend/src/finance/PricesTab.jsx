import { Pencil, Plus, Power, PowerOff, Tags } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'
import { GROUPS, REGIONS, TREATMENTS, regionLabel } from '../planning/regions'
import { centsToInput, formatBRL, parseBRL } from './money'

const treatmentOf = (key) => TREATMENTS.find((t) => t.key === key)
const treatmentLabel = (key) => treatmentOf(key)?.label ?? key
const unitOf = (key) => treatmentOf(key)?.unit ?? 'ml'
const suggestName = (treatment, region) => (region ? `${treatmentLabel(treatment)} — ${regionLabel(region)}` : treatmentLabel(treatment))

/** Cria (price = null) ou edita um preço. Regra: preço da região vence o genérico; só um ativo por tratamento + região. */
function PriceModal({ price, onClose, onSaved }) {
  const [treatment, setTreatment] = useState(price?.treatment ?? 'botox')
  const [region, setRegion] = useState(price?.region ?? '')
  const [name, setName] = useState(price?.name ?? suggestName('botox', ''))
  const [value, setValue] = useState(price ? centsToInput(price.unit_price_cents) : '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const nameTouched = useRef(Boolean(price)) // o nome acompanha tratamento e região até a pessoa escrever o próprio

  const pick = (nextTreatment, nextRegion) => {
    setTreatment(nextTreatment)
    setRegion(nextRegion)
    if (!nameTouched.current) setName(suggestName(nextTreatment, nextRegion))
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const cents = parseBRL(value)
    if (!name.trim()) return setError({ messages: ['Informe o nome do preço.'] })
    if (cents === null) return setError({ messages: ['Informe o preço em reais (ex.: 1.234,56).'] })
    setBusy(true)
    setError(null)
    const body = { name: name.trim(), treatment, region: region || null, unit_price_cents: cents }
    try {
      await (price ? api.finance.updatePriceItem(price.id, body) : api.finance.createPriceItem(body))
      onSaved(price ? 'Preço atualizado.' : 'Preço cadastrado.')
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title={price ? 'Editar preço' : 'Novo preço'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorList error={error} />
        <div className="form-row">
          <label className="field">
            <span>Tratamento</span>
            <select className="input" value={treatment} onChange={(e) => pick(e.target.value, region)}>
              {TREATMENTS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Região (opcional)</span>
            <select className="input" value={region} onChange={(e) => pick(treatment, e.target.value)}>
              <option value="">Qualquer região</option>
              {GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {REGIONS.filter((r) => r.group === group.key).map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Nome</span>
          <input
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => {
              nameTouched.current = true
              setName(e.target.value)
            }}
          />
        </label>
        <label className="field">
          <span>Preço por {unitOf(treatment)} (R$)</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,00" autoFocus />
        </label>
        <p className="fin-hint-block">
          O preço é por unidade do plano ({unitOf(treatment)}). Sem região, vale para qualquer região do tratamento; havendo preço da região, ele vence.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function PricesTab({ notify }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(undefined) // undefined = fechado, null = novo, objeto = editar
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    return api.finance
      .priceItems()
      .then((rows) => {
        setItems(rows)
        setError(null)
      })
      .catch(setError)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(item) {
    if (busyId) return
    setBusyId(item.id)
    try {
      await api.finance.updatePriceItem(item.id, { active: !item.active })
      notify(item.active ? 'Preço desativado.' : 'Preço reativado.')
      await load()
    } catch (err) {
      setError(err) // ex.: reativar quando já há outro ativo para o mesmo tratamento e região
    } finally {
      setBusyId(null)
    }
  }

  const sorted = items && [...items].sort((a, b) => Number(b.active) - Number(a.active))

  return (
    <section>
      <div className="fin-bar">
        <p className="fin-hint-block">Preços por unidade (U ou ml) usados ao gerar o orçamento a partir de um plano. O preço da região vence o do tratamento em geral.</p>
        <button className="btn primary" onClick={() => setEditing(null)}>
          <Plus size={16} /> Novo preço
        </button>
      </div>
      <ErrorList error={error} />

      {items === null && !error && <p className="fin-hint">Carregando…</p>}
      {items === null && error && (
        <button className="btn" onClick={load}>
          Tentar de novo
        </button>
      )}
      {items?.length === 0 && (
        <div className="empty-state">
          <Tags size={26} />
          <h2>Nenhum preço cadastrado</h2>
          <p>Cadastre o preço por unidade de cada tratamento para que o orçamento saia preenchido a partir do plano.</p>
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={16} /> Novo preço
          </button>
        </div>
      )}
      {sorted?.length > 0 && (
        <div className="card fin-card">
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tratamento</th>
                  <th>Região</th>
                  <th className="num">Preço</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} className={p.active ? undefined : 'inactive'}>
                    <td>{p.name}</td>
                    <td>{treatmentLabel(p.treatment)}</td>
                    <td>{p.region ? regionLabel(p.region) : <span className="fin-muted">Qualquer região</span>}</td>
                    <td className="num fin-money">
                      {formatBRL(p.unit_price_cents)} <span className="fin-muted">/ {unitOf(p.treatment)}</span>
                    </td>
                    <td>
                      <span className={`chip${p.active ? ' ok' : ''}`}>{p.active ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td>
                      <div className="fin-row-actions">
                        <button className="btn small" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>
                          <Pencil size={14} /> Editar
                        </button>
                        <button className="btn small" onClick={() => toggle(p)} disabled={busyId === p.id} aria-label={`${p.active ? 'Desativar' : 'Reativar'} ${p.name}`}>
                          {p.active ? <PowerOff size={14} /> : <Power size={14} />} {p.active ? 'Desativar' : 'Reativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing !== undefined && (
        <PriceModal
          price={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(message) => {
            setEditing(undefined)
            notify(message)
            load()
          }}
        />
      )}
    </section>
  )
}
