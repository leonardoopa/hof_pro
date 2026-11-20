import { Check, Plus, Search, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'
import { centsToInput, formatBRL, formatQty, lineTotalCents, parseBRL, parseQty } from './money'

export const STATUS_LABEL = { rascunho: 'Rascunho', aprovado: 'Aprovado', recusado: 'Recusado', cancelado: 'Cancelado' }
export const METHOD_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', outro: 'Outro' }

export const fmtDate = (value) => new Date(value).toLocaleDateString('pt-BR')
const fmtDateTime = (value) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
// Dia local em AAAA-MM-DD (toISOString daria o dia seguinte à noite no Brasil).
const localDay = () => new Date().toLocaleDateString('sv-SE')

export function StatusChip({ status }) {
  return <span className={`chip fin-status ${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

// ---- itens do orçamento ----
let rowSeq = 0
const blankRow = () => ({ key: ++rowSeq, id: null, description: '', quantity: '1', unit: '', price: '' })
const rowOf = (item) => ({
  key: ++rowSeq,
  id: item.id,
  description: item.description,
  quantity: formatQty(item.quantity),
  unit: item.unit,
  price: centsToInput(item.unit_price_cents),
})
const snapshot = (rows, discount, notes) =>
  JSON.stringify([rows.map((r) => [r.id, r.description, r.quantity, r.unit, r.price]), discount, notes])

const lineOf = (row) => {
  const qty = parseQty(row.quantity)
  const price = parseBRL(row.price)
  return qty > 0 && price !== null ? lineTotalCents(qty, price) : null
}

/** Valida as linhas e monta o corpo da API. `bad` marca os campos com problema (key -> campos). */
function buildItems(rows) {
  const errors = []
  const bad = {}
  const items = []
  rows.forEach((row, n) => {
    const marks = new Set()
    const description = row.description.trim()
    const quantity = parseQty(row.quantity)
    const price = parseBRL(row.price)
    if (!description) {
      marks.add('description')
      errors.push(`Item ${n + 1}: informe a descrição.`)
    }
    if (!(quantity > 0)) {
      marks.add('quantity')
      errors.push(`Item ${n + 1}: quantidade inválida (número maior que zero, com até 2 casas).`)
    }
    if (price === null) {
      marks.add('price')
      errors.push(`Item ${n + 1}: preço inválido (ex.: 1.234,56).`)
    }
    if (marks.size) bad[row.key] = marks
    else items.push({ ...(row.id ? { id: row.id } : {}), description, quantity, unit: row.unit.trim(), unit_price_cents: price })
  })
  return { items, errors, bad }
}

function ItemsEditor({ rows, setRows, bad }) {
  const change = (key, field) => (e) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: e.target.value } : r)))
  const cls = (row, field) => `input ${bad[row.key]?.has(field) ? 'invalid' : ''}`.trim()
  return (
    <div className="fin-items" role="group" aria-label="Itens do orçamento">
      <div className="fin-items-head" aria-hidden="true">
        <span>Descrição</span>
        <span>Qtd.</span>
        <span>Un.</span>
        <span>Preço unit.</span>
        <span className="num">Total</span>
        <span />
      </div>
      {rows.map((row, n) => {
        const zero = parseBRL(row.price) === 0
        const line = lineOf(row)
        return (
          <div key={row.key} className={`fin-item${zero ? ' zero' : ''}`}>
            <input className={cls(row, 'description')} value={row.description} onChange={change(row.key, 'description')} maxLength={200} placeholder="Descrição" aria-label={`Descrição do item ${n + 1}`} />
            <input className={cls(row, 'quantity')} value={row.quantity} onChange={change(row.key, 'quantity')} inputMode="decimal" autoComplete="off" placeholder="Qtd." aria-label={`Quantidade do item ${n + 1}`} />
            <input className="input" value={row.unit} onChange={change(row.key, 'unit')} maxLength={8} placeholder="Un." aria-label={`Unidade do item ${n + 1}`} />
            <input className={cls(row, 'price')} value={row.price} onChange={change(row.key, 'price')} inputMode="decimal" autoComplete="off" placeholder="0,00" aria-label={`Preço unitário do item ${n + 1} em reais`} />
            <output className="fin-money num">{line === null ? '—' : formatBRL(line)}</output>
            <button type="button" className="icon-btn" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))} disabled={rows.length === 1} aria-label={`Remover item ${n + 1}`} title="Remover item">
              <Trash2 size={15} />
            </button>
            {zero && (
              <span className="fin-zero-tag">
                <TriangleAlert size={13} /> Valor zero: confira o preço deste item
              </span>
            )}
          </div>
        )
      })}
      <button type="button" className="btn small fin-add" onClick={() => setRows((prev) => [...prev, blankRow()])} disabled={rows.length >= 100}>
        <Plus size={14} /> Adicionar item
      </button>
    </div>
  )
}

function ItemsView({ items }) {
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-view-items">
        <thead>
          <tr>
            <th>Descrição</th>
            <th className="num">Qtd.</th>
            <th className="num">Preço unit.</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{i.description}</td>
              <td className="num">
                {formatQty(i.quantity)} {i.unit}
              </td>
              <td className="num fin-money">{formatBRL(i.unit_price_cents)}</td>
              <td className="num fin-money">{formatBRL(i.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- paciente (orçamento manual) ----
function PatientPicker({ value, onPick }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stale = false
    const timer = setTimeout(
      () =>
        api.patients
          .list(query.trim())
          .then((r) => {
            if (!stale) {
              setRows(r)
              setError(null)
            }
          })
          .catch((e) => !stale && setError(e)),
      query ? 250 : 0,
    )
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="field">
      <span>Paciente</span>
      <label className="search fin-search">
        <Search size={16} />
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar paciente" autoFocus />
      </label>
      <ErrorList error={error} />
      <div className="fin-patients" role="group" aria-label="Pacientes">
        {rows === null && !error && <p className="fin-hint">Carregando…</p>}
        {rows?.length === 0 && <p className="fin-hint">Nenhum paciente encontrado.</p>}
        {rows?.map((p) => {
          const hidden = Boolean(p.anonymized_at)
          return (
            <button key={p.id} type="button" className="fin-patient" aria-pressed={value?.id === p.id} disabled={hidden} onClick={() => onPick(p)}>
              <strong className={hidden ? 'fin-hidden' : undefined}>{hidden ? 'Dados ocultos' : p.full_name}</strong>
              {!hidden && p.phone && <span>{p.phone}</span>}
              {value?.id === p.id && <Check size={15} aria-label="Selecionado" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- pagamentos ----
function ReverseModal({ payment, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  async function submit(e) {
    e.preventDefault()
    if (sending.current) return
    if (!reason.trim()) return setError({ messages: ['Informe o motivo do estorno.'] })
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await api.finance.reversePayment(payment.id, reason.trim())
      await onDone()
    } catch (err) {
      setError(err)
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Modal title="Estornar pagamento" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="fin-hint-block">
          Estorno de <strong>{formatBRL(payment.amount_cents)}</strong> ({METHOD_LABEL[payment.method] ?? payment.method}, {fmtDate(payment.paid_at)}). Será lançado um valor negativo e o pagamento original continua no histórico.{' '}
          <strong>Esta ação não pode ser desfeita.</strong>
        </p>
        <ErrorList error={error} />
        <label className="field">
          <span>Motivo do estorno</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} autoFocus />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Voltar
          </button>
          <button className="btn danger" disabled={busy}>
            {busy ? 'Estornando…' : 'Estornar pagamento'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PaymentsSection({ budget, reload, onReverse, notify }) {
  const approved = budget.status === 'aprovado'
  const balance = budget.balance_cents
  const [amount, setAmount] = useState(balance > 0 ? centsToInput(balance) : '')
  const [method, setMethod] = useState('pix')
  const [date, setDate] = useState(localDay)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  // Depois de um pagamento, o valor sugerido passa a ser o novo saldo.
  useEffect(() => setAmount(balance > 0 ? centsToInput(balance) : ''), [balance])

  async function submit(e) {
    e.preventDefault()
    if (sending.current) return // clique duplo não lança dois pagamentos
    const cents = parseBRL(amount)
    if (cents === null || cents <= 0) return setError({ messages: ['Informe um valor maior que zero (ex.: 150,00).'] })
    if (cents > balance) return setError({ messages: [`O valor passa do saldo do orçamento (${formatBRL(balance)}).`] })
    if (!date || date > localDay()) return setError({ messages: ['Informe a data do pagamento (não pode ser no futuro).'] })
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await api.finance.addPayment(budget.id, {
        amount_cents: cents,
        method,
        paid_at: date === localDay() ? null : `${date}T12:00:00`, // hoje = agora, no servidor
        notes: note.trim(),
      })
      setNote('')
      notify('Pagamento registrado.')
    } catch (err) {
      setError(err)
      sending.current = false
      setBusy(false)
      return
    }
    try {
      await reload()
    } catch {
      // O pagamento já gravou: o erro aqui é só da recarga, e não pode levar a tentar pagar de novo.
      setError({ messages: ['O pagamento foi registrado, mas não foi possível atualizar a tela. Feche e abra o orçamento para ver o saldo.'] })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <section className="fin-section" aria-label="Pagamentos">
      <h3 className="fin-h3">Pagamentos</h3>
      {budget.payments.length === 0 ? (
        <p className="fin-hint">{approved ? 'Nenhum pagamento registrado.' : 'Nenhum pagamento.'}</p>
      ) : (
        <ul className="fin-payments">
          {budget.payments.map((p) => {
            const isReversal = p.amount_cents < 0
            return (
              <li key={p.id} className={`${isReversal ? 'reversal ' : ''}${p.reversed ? 'reversed' : ''}`.trim()}>
                <div>
                  <strong className={`fin-money ${isReversal ? 'neg' : ''}`}>{formatBRL(p.amount_cents)}</strong>
                  <span className="fin-meta">
                    {METHOD_LABEL[p.method] ?? p.method} · {fmtDateTime(p.paid_at)}
                  </span>
                  {p.notes && <span className="fin-meta">{isReversal ? `Motivo do estorno: ${p.notes}` : p.notes}</span>}
                </div>
                <div className="fin-pay-side">
                  {isReversal && <span className="chip">Estorno</span>}
                  {p.reversed && <span className="chip fin-status cancelado">Estornado</span>}
                  {!isReversal && !p.reversed && (
                    <button type="button" className="btn small danger" onClick={() => onReverse(p)}>
                      Estornar
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {approved && balance > 0 && (
        <form className="fin-pay-form" onSubmit={submit}>
          <h4>Registrar pagamento</h4>
          <ErrorList error={error} />
          <div className="fin-pay-grid">
            <label className="field">
              <span>Forma de pagamento</span>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {Object.entries(METHOD_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Valor (R$)</span>
              <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,00" />
            </label>
            <label className="field">
              <span>Data</span>
              <input className="input" type="date" value={date} max={localDay()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Observação (opcional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Registrando…' : 'Registrar pagamento'}
          </button>
        </form>
      )}
      {approved && balance <= 0 && budget.total_cents > 0 && <p className="fin-hint">Orçamento quitado: não há saldo a receber.</p>}
      {!approved && budget.status === 'rascunho' && <p className="fin-hint">Os pagamentos ficam disponíveis depois que o orçamento for aprovado.</p>}
    </section>
  )
}

// ---- modal ----
/**
 * Abre um orçamento (budgetId) ou, sem id, o formulário de um novo orçamento manual. Rascunho edita as linhas;
 * depois de aprovado só recebe pagamentos (e estornos). `onChanged` avisa a lista para recarregar.
 */
export default function BudgetModal({ budgetId = null, initialWarnings = [], onClose, onChanged, notify }) {
  const [id, setId] = useState(budgetId)
  const [budget, setBudget] = useState(null)
  const [patient, setPatient] = useState(null)
  const [rows, setRows] = useState(() => (budgetId ? [] : [blankRow()]))
  const [discount, setDiscount] = useState('')
  const [notes, setNotes] = useState('')
  const [baseline, setBaseline] = useState(() => snapshot([blankRow()], '', ''))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [ask, setAsk] = useState(null)
  const [reversing, setReversing] = useState(null)
  const [loading, setLoading] = useState(Boolean(budgetId))
  const busyRef = useRef(false)

  const apply = useCallback((b) => {
    const next = b.items.map(rowOf)
    const disc = b.discount_cents ? centsToInput(b.discount_cents) : ''
    setBudget(b)
    setRows(next)
    setDiscount(disc)
    setNotes(b.notes)
    setBaseline(snapshot(next, disc, b.notes))
  }, [])

  useEffect(() => {
    if (!budgetId) return
    let stale = false
    api.finance
      .budget(budgetId)
      .then((b) => !stale && (apply(b), setError(null)))
      .catch((e) => !stale && setError(e))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [budgetId, apply])

  const isNew = !id
  const editable = isNew || budget?.status === 'rascunho'
  const dirty = editable && (Boolean(patient) || snapshot(rows, discount, notes) !== baseline)
  const { items, errors, bad } = buildItems(rows)

  // Prévia do total no rascunho; o servidor recalcula ao salvar.
  const subtotal = rows.reduce((sum, r) => sum + (lineOf(r) ?? 0), 0)
  const discountCents = discount.trim() === '' ? 0 : parseBRL(discount)
  const total = Math.max(subtotal - (discountCents ?? 0), 0)
  const hasZero = rows.some((r) => parseBRL(r.price) === 0)

  /** Uma ação por vez; erro da API vai para a lista de erros do modal. */
  async function run(action) {
    if (busyRef.current) return undefined
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      return await action()
    } catch (err) {
      setError(err)
      return undefined
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function checkForm() {
    setShowErrors(true)
    const problems = [...errors]
    if (discountCents === null) problems.push('Desconto inválido (ex.: 50,00).')
    else if (discountCents > subtotal) problems.push('O desconto não pode passar do subtotal do orçamento.')
    if (problems.length) {
      setError({ messages: problems })
      return false
    }
    return true
  }

  async function create() {
    if (!patient) return setError({ messages: ['Escolha o paciente do orçamento.'] })
    if (!checkForm()) return
    const b = await run(() =>
      api.finance.createBudget({ patient_id: patient.id, plan_id: null, items, discount_cents: discountCents, notes: notes.trim() }),
    )
    if (!b) return
    setId(b.id)
    apply(b)
    setShowErrors(false)
    onChanged()
    notify('Orçamento criado como rascunho.')
  }

  async function save() {
    if (!checkForm()) return
    const b = await run(() => api.finance.updateBudget(id, { items, discount_cents: discountCents, notes: notes.trim() }))
    if (!b) return
    apply(b)
    setShowErrors(false)
    onChanged()
    notify('Alterações salvas.')
  }

  const changeStatus = (status, done) => async () => {
    const b = await run(() => api.finance.setBudgetStatus(id, status))
    if (!b) return
    apply(b)
    onChanged()
    notify(done)
  }

  const reload = async () => {
    apply(await api.finance.budget(id))
    onChanged()
  }

  const requestClose = () => {
    if (!dirty) return onClose()
    setAsk({ title: 'Descartar alterações?', message: 'Há alterações não salvas neste orçamento. Se fechar agora, elas serão perdidas.', confirmLabel: 'Descartar e fechar', danger: true, onConfirm: onClose })
  }

  const title = isNew ? 'Novo orçamento' : `Orçamento nº ${id}`
  const canCancelApproved = budget?.status === 'aprovado' && budget.paid_cents === 0

  return (
    <>
      <Modal title={title} className="fin-modal" onClose={ask || reversing ? () => {} : requestClose}>
        {loading && <p className="fin-hint">Carregando…</p>}
        {!loading && !budget && !isNew && (
          <>
            <ErrorList error={error} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}

        {(isNew || budget) && (
          <>
            {budget && (
              <div className="fin-head">
                <div>
                  <strong className={budget.patient_hidden ? 'fin-hidden' : 'fin-patient-name'}>{budget.patient_name}</strong>
                  <span className="fin-meta">
                    Criado em {fmtDate(budget.created_at)}
                    {budget.approved_at && ` · Aprovado em ${fmtDate(budget.approved_at)}`}
                  </span>
                </div>
                <StatusChip status={budget.status} />
              </div>
            )}

            <ErrorList error={error} />
            {editable && hasZero && initialWarnings.length > 0 && (
              <div className="alert warn" role="status">
                <ul>
                  {initialWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <span>Preencha o preço nos itens destacados antes de aprovar, ou cadastre-o na aba Preços.</span>
              </div>
            )}

            {isNew && <PatientPicker value={patient} onPick={setPatient} />}

            {editable ? (
              <ItemsEditor rows={rows} setRows={setRows} bad={showErrors ? bad : {}} />
            ) : (
              <ItemsView items={budget.items} />
            )}

            <div className="fin-totals">
              <dl className="fin-sum">
                <div>
                  <dt>Subtotal</dt>
                  <dd className="fin-money">{formatBRL(editable ? subtotal : budget.subtotal_cents)}</dd>
                </div>
                <div>
                  <dt>Desconto</dt>
                  <dd className="fin-money">
                    {editable ? (
                      <label className="fin-discount">
                        <span>R$</span>
                        <input className={`input${showErrors && discountCents === null ? ' invalid' : ''}`} value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,00" aria-label="Desconto em reais" />
                      </label>
                    ) : (
                      formatBRL(-budget.discount_cents).replace('-', '− ')
                    )}
                  </dd>
                </div>
                <div className="strong">
                  <dt>Total</dt>
                  <dd className="fin-money">{formatBRL(editable ? total : budget.total_cents)}</dd>
                </div>
                {budget?.status === 'aprovado' && (
                  <div>
                    <dt>Pago</dt>
                    <dd className="fin-money">{formatBRL(budget.paid_cents)}</dd>
                  </div>
                )}
              </dl>
              {budget?.status === 'aprovado' && (
                <div className={`fin-balance ${budget.balance_cents > 0 ? 'open' : 'paid'}`}>
                  <span>{budget.balance_cents > 0 ? 'Saldo a receber' : 'Quitado'}</span>
                  <strong className="fin-money">{formatBRL(budget.balance_cents)}</strong>
                </div>
              )}
              {editable && (
                <div className="fin-balance draft">
                  <span>Total do orçamento</span>
                  <strong className="fin-money">{formatBRL(total)}</strong>
                </div>
              )}
            </div>

            {editable ? (
              <label className="field">
                <span>Observações (opcional)</span>
                <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />
              </label>
            ) : (
              budget.notes && <p className="fin-notes">{budget.notes}</p>
            )}

            {!isNew && (budget.status === 'rascunho' || budget.status === 'aprovado' || budget.payments.length > 0) && <PaymentsSection budget={budget} reload={reload} onReverse={setReversing} notify={notify} />}

            <div className="fin-actions">
              <div className="fin-actions-side">
                {!isNew && budget.status === 'rascunho' && (
                  <>
                    <button type="button" className="btn" disabled={busy} onClick={() => setAsk({ title: 'Recusar orçamento?', message: 'O orçamento será marcado como recusado e não poderá ser reaberto nem editado.', confirmLabel: 'Recusar orçamento', onConfirm: changeStatus('recusado', 'Orçamento recusado.') })}>
                      Recusar
                    </button>
                    <button type="button" className="btn danger" disabled={busy} onClick={() => setAsk({ title: 'Cancelar orçamento?', message: 'O orçamento será cancelado e não poderá ser reaberto nem editado. Ele continua guardado no histórico.', confirmLabel: 'Cancelar orçamento', danger: true, onConfirm: changeStatus('cancelado', 'Orçamento cancelado.') })}>
                      Cancelar orçamento
                    </button>
                  </>
                )}
                {budget?.status === 'aprovado' && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy || !canCancelApproved}
                    title={canCancelApproved ? undefined : 'Há pagamentos lançados: estorne-os antes de cancelar.'}
                    onClick={() => setAsk({ title: 'Cancelar orçamento aprovado?', message: 'O orçamento será cancelado e não poderá ser reaberto. Ele continua guardado no histórico.', confirmLabel: 'Cancelar orçamento', danger: true, onConfirm: changeStatus('cancelado', 'Orçamento cancelado.') })}
                  >
                    Cancelar orçamento
                  </button>
                )}
              </div>
              <div className="fin-actions-side">
                <button type="button" className="btn" onClick={requestClose}>
                  Fechar
                </button>
                {isNew && (
                  <button type="button" className="btn primary" disabled={busy} onClick={create}>
                    {busy ? 'Criando…' : 'Criar orçamento'}
                  </button>
                )}
                {!isNew && budget.status === 'rascunho' && (
                  <>
                    <button type="button" className="btn" disabled={busy || !dirty} onClick={save}>
                      {busy ? 'Salvando…' : 'Salvar alterações'}
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy || dirty}
                      title={dirty ? 'Salve as alterações antes de aprovar.' : undefined}
                      onClick={() =>
                        setAsk({
                          title: 'Aprovar orçamento?',
                          message: `Total de ${formatBRL(budget.total_cents)}. Depois de aprovado, os itens e o desconto não podem mais ser alterados e o orçamento passa a receber pagamentos.${hasZero ? ' Atenção: há itens com valor zero.' : ''}`,
                          confirmLabel: 'Aprovar orçamento',
                          onConfirm: changeStatus('aprovado', 'Orçamento aprovado.'),
                        })
                      }
                    >
                      <Check size={16} /> Aprovar
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>
      {ask && <ConfirmModal {...ask} onClose={() => setAsk(null)} />}
      {reversing && (
        <ReverseModal
          payment={reversing}
          onClose={() => setReversing(null)}
          onDone={async () => {
            await reload()
            setReversing(null)
            notify('Pagamento estornado.')
          }}
        />
      )}
    </>
  )
}
