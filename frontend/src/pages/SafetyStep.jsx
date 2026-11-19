import { AlertOctagon, ClipboardCopy, Plus, ShieldAlert, Timer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import { formatAmount, parseAmount, pointLabel, regionLabel } from '../planning/regions'
import { lotLabel } from '../planning/technique'

const KINDS = [
  { key: 'oclusao_vascular', label: 'Suspeita de oclusão vascular' },
  { key: 'nodulo', label: 'Nódulo / granuloma' },
  { key: 'edema', label: 'Edema persistente' },
  { key: 'hematoma', label: 'Hematoma' },
  { key: 'ptose', label: 'Ptose' },
  { key: 'infeccao', label: 'Infecção' },
  { key: 'alergia', label: 'Reação alérgica' },
  { key: 'assimetria', label: 'Assimetria' },
  { key: 'outro', label: 'Outro' },
]
const SEVERITIES = [
  { key: 'leve', label: 'Leve' },
  { key: 'moderada', label: 'Moderada' },
  { key: 'grave', label: 'Grave' },
]
const OUTCOMES = [
  { key: 'acompanhamento', label: 'Em acompanhamento' },
  { key: 'resolvido', label: 'Resolvido' },
  { key: 'sequela', label: 'Resolvido com sequela' },
]
// Sinais de oclusão vascular citados nos guias da tela. As chaves são as mesmas do backend (schemas_safety.SignKey).
const SIGNS = [
  { key: 'palidez', label: 'Palidez / branqueamento' },
  { key: 'livedo', label: 'Livedo reticular (pele rendilhada)' },
  { key: 'dor_desproporcional', label: 'Dor desproporcional' },
  { key: 'enchimento_capilar_lento', label: 'Enchimento capilar lento' },
  { key: 'cianose', label: 'Cianose (arroxeado)' },
  { key: 'bolhas', label: 'Bolhas / pústulas' },
  { key: 'alteracao_visual', label: 'Alteração visual', urgent: true },
  { key: 'dor_ocular', label: 'Dor ocular', urgent: true },
  { key: 'alteracao_neurologica', label: 'Alteração neurológica', urgent: true },
]
// Passos sem dose: a regra do projeto é não mostrar dose até a validação por profissional.
const STEPS = [
  'Pare a injeção na hora.',
  'Confira os sinais abaixo e marque o que vê.',
  'Se o produto é ácido hialurônico: hialuronidase na área afetada, conforme o protocolo da clínica. Reavalie a perfusão e repita até ela voltar.',
  'Calor local e massagem da área.',
  'Qualquer alteração visual, dor ocular ou sinal neurológico: emergência. Encaminhe na hora para oftalmologia ou pronto-socorro.',
  'Registre a conduta e acompanhe o paciente nos dias seguintes.',
]

const label = (list, key) => list.find((i) => i.key === key)?.label ?? key
const nowLocal = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
const elapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  return `${h ? `${h}:` : ''}${m}:${String(s % 60).padStart(2, '0')}`
}

/** Aplicações do paciente, para ligar a intercorrência ao ponto e ao lote. */
function ApplicationSelect({ rows, value, onChange }) {
  return (
    <label className="field">
      <span>Aplicação relacionada (opcional)</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nenhuma / não sei</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {new Date(r.applied_at).toLocaleDateString('pt-BR')} · {regionLabel(r.region)}
            {pointLabel(r.region, r.point_key) ? ` (${pointLabel(r.region, r.point_key)})` : ''} · {r.product} · lote {r.lot_number}
          </option>
        ))}
      </select>
    </label>
  )
}

function EventModal({ patientId, occlusion, applications, lots, onClose, onSaved }) {
  const [startedAt] = useState(() => new Date())
  const [now, setNow] = useState(() => Date.now())
  const [form, setForm] = useState({
    kind: occlusion ? 'oclusao_vascular' : 'nodulo',
    severity: occlusion ? 'grave' : 'leve',
    onset_at: nowLocal(),
    application_id: '',
    description: '',
    conduct: '',
    hyaluronidase_lot_id: '',
    hyaluronidase_amount: '',
  })
  const [signs, setSigns] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  useEffect(() => {
    if (!occlusion) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [occlusion])

  const urgent = SIGNS.some((s) => s.urgent && signs.includes(s.key))
  const toggle = (key) => setSigns((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        kind: form.kind,
        severity: form.severity,
        onset_at: new Date(form.onset_at).toISOString(),
        signs,
        description: form.description,
        conduct: form.conduct,
        application_id: form.application_id ? Number(form.application_id) : null,
        protocol_started_at: occlusion ? startedAt.toISOString() : null,
      }
      if (form.hyaluronidase_lot_id) {
        body.hyaluronidase_lot_id = Number(form.hyaluronidase_lot_id)
        body.hyaluronidase_amount = parseAmount(form.hyaluronidase_amount) || null
      }
      onSaved(await api.safety.create(patientId, body))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title={occlusion ? 'Protocolo de oclusão vascular' : 'Registrar intercorrência'} onClose={onClose} className="wide">
      <form onSubmit={submit} className="safety-form">
        {occlusion && (
          <>
            <div className="protocol-timer" aria-live="off">
              <Timer size={18} /> Protocolo iniciado às {startedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              <b>{elapsed(now - startedAt.getTime())}</b>
            </div>
            <ol className="protocol-steps">
              {STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <fieldset className="signs">
              <legend>Sinais observados</legend>
              {SIGNS.map((s) => (
                <label key={s.key} className={`sign ${s.urgent ? 'urgent' : ''}`}>
                  <input type="checkbox" checked={signs.includes(s.key)} onChange={() => toggle(s.key)} /> {s.label}
                </label>
              ))}
            </fieldset>
            {urgent && (
              <p className="alert error" role="alert">
                <AlertOctagon size={16} /> Sinal visual ou neurológico: emergência. Encaminhe agora para oftalmologia ou pronto-socorro.
              </p>
            )}
            <p className="protocol-ref">
              Referências: Cohen JL et al., consenso de oclusão vascular (Aesthetic Surgery Journal, 2015); guia CMAC de oclusão por
              ácido hialurônico (JCAD, 2021); força-tarefa ASDS de eventos adversos com preenchedor. Não substitui o julgamento clínico.
            </p>
          </>
        )}

        <ErrorList error={error} />
        <div className="form-row">
          {!occlusion && (
            <label className="field">
              <span>Tipo</span>
              <select className="input" value={form.kind} onChange={set('kind')}>
                {KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Gravidade</span>
            <select className="input" value={form.severity} onChange={set('severity')}>
              {SEVERITIES.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Início</span>
            <input className="input" type="datetime-local" value={form.onset_at} onChange={set('onset_at')} required />
          </label>
        </div>
        <ApplicationSelect rows={applications} value={form.application_id} onChange={(v) => setForm({ ...form, application_id: v })} />
        <label className="field">
          <span>Descrição</span>
          <textarea className="input" value={form.description} onChange={set('description')} maxLength={5000} />
        </label>
        <label className="field">
          <span>Conduta</span>
          <textarea className="input" value={form.conduct} onChange={set('conduct')} maxLength={5000} />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Hialuronidase usada (lote)</span>
            <select className="input" value={form.hyaluronidase_lot_id} onChange={set('hyaluronidase_lot_id')}>
              <option value="">Não usada</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {lotLabel(l)}
                </option>
              ))}
            </select>
          </label>
          {form.hyaluronidase_lot_id && (
            <label className="field">
              <span>Quantidade usada</span>
              <input
                className="input"
                inputMode="decimal"
                value={form.hyaluronidase_amount}
                onChange={set('hyaluronidase_amount')}
                required
                aria-label="Quantidade de hialuronidase usada"
              />
            </label>
          )}
        </div>
        {form.hyaluronidase_lot_id && <p className="inv-meta">A quantidade sai do saldo do lote, como numa aplicação.</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Registrar intercorrência'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EventCard({ event, onChanged }) {
  const [anvisa, setAnvisa] = useState({ on: event.anvisa_notified_on ?? '', protocol: event.anvisa_protocol })
  const [error, setError] = useState(null)
  const [toast, toastNode] = useToast()

  async function patch(body) {
    setError(null)
    try {
      onChanged(await api.safety.update(event.id, body))
      return true
    } catch (err) {
      setError(err)
      return false
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(await api.safety.notivisa(event.id))
      toast('Resumo copiado. Cole no formulário do Notivisa.')
    } catch (err) {
      setError(err)
    }
  }

  const point = pointLabel(event.region, event.point_key)
  return (
    <article className={`card event-card ${event.severity}`}>
      <header>
        <strong>{event.kind_label}</strong>
        <span className={`chip sev-${event.severity}`}>{label(SEVERITIES, event.severity)}</span>
        <span className="inv-meta">{new Date(event.onset_at).toLocaleString('pt-BR')}</span>
      </header>
      {event.region && (
        <p>
          {regionLabel(event.region)}
          {point && ` · ${point}`}
        </p>
      )}
      {event.lot_label && <p className="inv-meta">{event.lot_label}</p>}
      {event.signs.length > 0 && <p className="inv-meta">Sinais: {event.signs.map((s) => label(SIGNS, s)).join(', ')}</p>}
      {event.description && <p>{event.description}</p>}
      {event.conduct && <p><b>Conduta:</b> {event.conduct}</p>}
      {event.hyaluronidase_label && (
        <p className="inv-meta">
          Hialuronidase: {event.hyaluronidase_label} · {formatAmount(event.hyaluronidase_amount)}
        </p>
      )}
      <ErrorList error={error} />
      <div className="event-actions">
        <label className="field">
          <span>Desfecho</span>
          <select className="input mini" value={event.outcome} onChange={(e) => patch({ outcome: e.target.value })}>
            {OUTCOMES.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Notificado à Anvisa em</span>
          <input className="input mini" type="date" value={anvisa.on} onChange={(e) => setAnvisa({ ...anvisa, on: e.target.value })} />
        </label>
        <label className="field">
          <span>Nº da notificação</span>
          <input
            className="input mini"
            value={anvisa.protocol}
            maxLength={60}
            onChange={(e) => setAnvisa({ ...anvisa, protocol: e.target.value })}
          />
        </label>
        <button
          className="btn small"
          onClick={async () => {
            if (await patch({ anvisa_notified_on: anvisa.on || null, anvisa_protocol: anvisa.protocol })) toast('Notificação registrada')
          }}
        >
          Salvar notificação
        </button>
        <button className="btn small" onClick={copySummary}>
          <ClipboardCopy size={14} /> Copiar resumo para o Notivisa
        </button>
      </div>
      {toastNode}
    </article>
  )
}

export default function SafetyStep() {
  const { patient } = useOutletContext()
  const [events, setEvents] = useState(null)
  const [applications, setApplications] = useState([])
  const [lots, setLots] = useState([])
  const [modal, setModal] = useState(null) // 'occlusion' | 'event'
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    Promise.all([
      api.safety.list(patient.id),
      api.inventory.traceability(patient.id).catch(() => ({ rows: [] })),
      api.inventory.lots({ available: true }).catch(() => []),
    ])
      .then(([list, trace, available]) => {
        setEvents(list)
        setApplications(trace.rows)
        setLots(available.filter((l) => l.unit === 'U' && !l.expired))
      })
      .catch(setError)
  }, [patient.id])

  useEffect(load, [load])

  if (patient.anonymized_at) {
    return <p className="empty-state">Dados ocultos. Use "Mostrar dados" para ver e registrar intercorrências.</p>
  }

  return (
    <div className="safety">
      <section className="card safety-head">
        <div>
          <h2>
            <ShieldAlert size={20} /> Intercorrências
          </h2>
          <p className="inv-meta">
            Registre o evento ligado ao ponto e ao lote aplicados. O resumo sai pronto para a notificação no Notivisa, feita por você.
          </p>
        </div>
        <div className="safety-actions">
          <button className="btn danger-solid" onClick={() => setModal('occlusion')}>
            <AlertOctagon size={17} /> Suspeita de oclusão vascular
          </button>
          <button className="btn" onClick={() => setModal('event')}>
            <Plus size={17} /> Registrar intercorrência
          </button>
        </div>
      </section>

      <ErrorList error={error} />
      {events && !events.length && <p className="inv-meta">Nenhuma intercorrência registrada.</p>}
      {events?.map((e) => (
        <EventCard key={e.id} event={e} onChanged={(updated) => setEvents((list) => list.map((x) => (x.id === updated.id ? updated : x)))} />
      ))}

      {modal && (
        <EventModal
          patientId={patient.id}
          occlusion={modal === 'occlusion'}
          applications={applications}
          lots={lots}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
    </div>
  )
}
