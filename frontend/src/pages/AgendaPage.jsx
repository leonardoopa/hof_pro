import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'

const DEFAULT_FROM = 7 // grade padrão 07h–20h; estende se houver agendamento fora dela
const DEFAULT_TO = 20
const ROW = 48
const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou' }

const iso = (d) => d.toLocaleDateString('sv-SE')
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)) // segunda-feira
const at = (day, time) => new Date(`${day}T${time}:00`)

function AppointmentForm({ initial, patients, onClose, onSaved }) {
  const navigate = useNavigate()
  const editing = Boolean(initial.id)
  const start = initial.starts_at ? new Date(initial.starts_at) : null
  const end = initial.ends_at ? new Date(initial.ends_at) : null
  const [mode, setMode] = useState(initial.patient_id || !editing ? 'patient' : 'lead')
  const [patientId, setPatientId] = useState(initial.patient_id ?? '')
  const [leadName, setLeadName] = useState(initial.lead_name ?? '')
  const [leadPhone, setLeadPhone] = useState(initial.lead_phone ?? '')
  const [day, setDay] = useState(iso(start))
  const [from, setFrom] = useState(hhmm(start))
  const [to, setTo] = useState(hhmm(end))
  const [kind, setKind] = useState(initial.kind ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
      onSaved()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    const body = {
      starts_at: at(day, from).toISOString(),
      ends_at: at(day, to).toISOString(),
      kind,
      notes,
    }
    if (mode === 'patient') {
      if (!patientId) return setError({ messages: ['Escolha um paciente.'] })
      body.patient_id = Number(patientId)
    } else {
      body.patient_id = null
      body.lead_name = leadName
      body.lead_phone = leadPhone
    }
    run(() => (editing ? api.appointments.update(initial.id, body) : api.appointments.create(body)))
  }

  return (
    <Modal title={editing ? 'Agendamento' : 'Novo agendamento'} onClose={onClose}>
      <form className="agenda-form" onSubmit={submit}>
        <ErrorList error={error} />
        {(!editing || !initial.patient_id) && (
          <div className="agenda-row">
            <button type="button" className={`btn small ${mode === 'patient' ? 'primary' : ''}`} onClick={() => setMode('patient')}>
              Paciente cadastrado
            </button>
            <button type="button" className={`btn small ${mode === 'lead' ? 'primary' : ''}`} onClick={() => setMode('lead')}>
              Novo paciente
            </button>
          </div>
        )}
        {mode === 'patient' ? (
          <label className="field">
            <span>Paciente</span>
            <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Selecione…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="agenda-row">
            <label className="field">
              <span>Nome</span>
              <input className="input" value={leadName} onChange={(e) => setLeadName(e.target.value)} maxLength={150} />
            </label>
            <label className="field">
              <span>Telefone</span>
              <input className="input" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} maxLength={30} />
            </label>
          </div>
        )}
        <div className="agenda-row">
          <label className="field"><span>Dia</span><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} required /></label>
          <label className="field"><span>Início</span><input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
          <label className="field"><span>Fim</span><input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} required /></label>
        </div>
        <label className="field">
          <span>Procedimento</span>
          <input className="input" value={kind} onChange={(e) => setKind(e.target.value)} maxLength={80} placeholder="Ex.: avaliação, retorno" />
        </label>
        <label className="field">
          <span>Observações</span>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {editing && (
          <div className="agenda-actions">
            {initial.patient_id && (
              <Link className="btn small" to={`/pacientes/${initial.patient_id}`}>
                <ExternalLink size={14} /> Abrir ficha
              </Link>
            )}
            {!initial.patient_id && (
              <button type="button" className="btn small" disabled={busy} onClick={() => run(async () => { const r = await api.appointments.convert(initial.id); navigate(`/pacientes/${r.patient_id}`) })}>
                Cadastrar como paciente
              </button>
            )}
            {['confirmado', 'realizado', 'faltou', 'cancelado'].filter((s) => s !== initial.status).map((s) => (
              <button type="button" key={s} className={`btn small ${s === 'cancelado' ? 'danger' : ''}`} disabled={busy} onClick={() => run(() => api.appointments.setStatus(initial.id, s))}>
                {STATUS[s]}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Fechar</button>
          <button type="submit" className="btn primary" disabled={busy}>Salvar</button>
        </div>
      </form>
    </Modal>
  )
}

export default function AgendaPage() {
  const [start, setStart] = useState(() => weekStart(new Date()))
  const [items, setItems] = useState(null)
  const [patients, setPatients] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [reload, setReload] = useState(0)
  const [showCanceled, setShowCanceled] = useState(false)

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start])

  useEffect(() => {
    let stale = false // navegação rápida entre semanas: ignora a resposta antiga
    api.appointments
      .list(iso(days[0]), iso(days[6]))
      .then((r) => { if (!stale) { setItems(r); setError(null) } })
      .catch((e) => { if (!stale) setError(e) })
    return () => { stale = true }
  }, [days, reload])
  useEffect(() => { api.patients.list().then(setPatients).catch(() => {}) }, [])

  const openNew = (day, hour) => {
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour)
    setEditing({ starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 3_600_000).toISOString() })
  }
  const saved = () => { setEditing(null); setReload((n) => n + 1) }
  const todayIso = iso(new Date())
  const visible = useMemo(
    () => (items ?? []).filter((a) => showCanceled || a.status !== 'cancelado'),
    [items, showCanceled],
  )
  const hours = useMemo(() => {
    let from = DEFAULT_FROM
    let to = DEFAULT_TO
    for (const a of visible) {
      from = Math.min(from, new Date(a.starts_at).getHours())
      to = Math.max(to, new Date(a.starts_at).getHours())
    }
    return Array.from({ length: to - from + 1 }, (_, i) => i + from)
  }, [visible])
  const lanes = useMemo(() => computeLanes(visible), [visible])
  const canceledCount = (items ?? []).filter((a) => a.status === 'cancelado').length
  const title = `${days[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${days[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`

  return (
    <div className="agenda">
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p>Marque consultas e novos pacientes. Clique em um horário para agendar; em horário ocupado, use a faixa livre à direita.</p>
        </div>
        <button className="btn primary" onClick={() => openNew(new Date(), new Date().getHours() < 20 ? Math.max(7, new Date().getHours() + 1) : 8)}>
          Novo agendamento
        </button>
      </div>
      <ErrorList error={error} />
      <div className="agenda-bar">
        <button className="btn small" onClick={() => setStart(addDays(start, -7))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
        <button className="btn small" onClick={() => setStart(weekStart(new Date()))}>Hoje</button>
        <button className="btn small" onClick={() => setStart(addDays(start, 7))} aria-label="Próxima semana"><ChevronRight size={16} /></button>
        <h2>{title}</h2>
        <label className="agenda-toggle">
          <input type="checkbox" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
          Mostrar cancelados{canceledCount > 0 ? ` (${canceledCount})` : ''}
        </label>
      </div>
      {items === null && !error && <p className="report-empty">Carregando…</p>}
      <div className="agenda-scroll">
        <div className="agenda-grid">
          <div className="agenda-head" />
          {days.map((d) => (
            <div key={iso(d)} className={`agenda-head ${iso(d) === todayIso ? 'today' : ''}`}>
              {d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}
            </div>
          ))}
          {hours.map((h) => (
            <Row key={h} hour={h} days={days} items={visible} lanes={lanes} onNew={openNew} onOpen={setEditing} />
          ))}
        </div>
      </div>
      {editing && <AppointmentForm initial={editing} patients={patients} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  )
}

// Divide o dia em faixas para agendamentos que se sobrepõem (inclusive cancelados exibidos),
// de modo que nenhum fique escondido atrás de outro.
function computeLanes(items) {
  const byDay = new Map()
  for (const a of items) {
    const k = iso(new Date(a.starts_at))
    byDay.set(k, [...(byDay.get(k) ?? []), a])
  }
  const lanes = new Map()
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || a.id - b.id)
    let cluster = []
    let clusterEnd = 0
    const flush = () => {
      const n = Math.max(1, ...cluster.map((c) => c.lane + 1))
      cluster.forEach((c) => lanes.set(c.id, { lane: c.lane, lanes: n }))
      cluster = []
    }
    for (const a of sorted) {
      const s = new Date(a.starts_at).getTime()
      const e = new Date(a.ends_at).getTime()
      if (cluster.length && s >= clusterEnd) flush()
      const used = new Set(cluster.filter((c) => c.end > s).map((c) => c.lane))
      let lane = 0
      while (used.has(lane)) lane += 1
      cluster.push({ id: a.id, lane, end: e })
      clusterEnd = Math.max(clusterEnd, e)
    }
    flush()
  }
  return lanes
}

function Row({ hour, days, items, lanes, onNew, onOpen }) {
  return (
    <>
      <div className="agenda-hour">{String(hour).padStart(2, '0')}:00</div>
      {days.map((d) => {
        const here = items.filter((a) => {
          const s = new Date(a.starts_at)
          return iso(s) === iso(d) && s.getHours() === hour
        })
        return (
          <div key={iso(d)} className="agenda-cell">
            <button type="button" className="agenda-slot" aria-label={`Agendar ${iso(d)} às ${hour}h`} onClick={() => onNew(d, hour)} />
            {here.map((a) => {
              const s = new Date(a.starts_at)
              const mins = (new Date(a.ends_at) - s) / 60_000
              const { lane, lanes: n } = lanes.get(a.id) ?? { lane: 0, lanes: 1 }
              const name = a.patient_name || a.lead_name
              const detail = `${hhmm(s)} · ${a.kind || STATUS[a.status]}${!a.patient_id ? ' · novo' : ''}`
              return (
                <button key={a.id} className={`agenda-appt ${a.status}`} title={`${name} — ${detail}`}
                  style={{
                    top: (s.getMinutes() / 60) * ROW,
                    height: Math.max(30, (mins / 60) * ROW - 2),
                    // a faixa de 14px à direita fica livre para clicar no horário e agendar outro
                    left: `calc(2px + (100% - 16px) * ${lane / n})`,
                    width: `calc((100% - 16px) * ${1 / n} - 2px)`,
                  }}
                  onClick={() => onOpen(a)}>
                  <span className="agenda-appt-name">{name}</span>
                  <small>{detail}</small>
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
