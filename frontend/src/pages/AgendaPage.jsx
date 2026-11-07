import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7) // 07h às 20h
const ROW = 48
const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou' }

const iso = (d) => d.toLocaleDateString('sv-SE')
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)) // segunda-feira
const at = (day, time) => new Date(`${day}T${time}:00`)

function AppointmentForm({ initial, patients, onClose, onSaved }) {
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
              <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.appointments.convert(initial.id))}>
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

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start])

  const load = useCallback(() => {
    api.appointments.list(iso(days[0]), iso(days[6])).then((r) => { setItems(r); setError(null) }).catch(setError)
  }, [days])

  useEffect(load, [load])
  useEffect(() => { api.patients.list().then(setPatients).catch(() => {}) }, [])

  const openNew = (day, hour) => {
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour)
    setEditing({ starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 3_600_000).toISOString() })
  }
  const saved = () => { setEditing(null); load() }
  const todayIso = iso(new Date())
  const title = `${days[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${days[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`

  return (
    <div className="agenda">
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p>Marque consultas e novos pacientes. Clique em um horário vazio para agendar.</p>
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
          {HOURS.map((h) => (
            <Row key={h} hour={h} days={days} items={items ?? []} onNew={openNew} onOpen={setEditing} />
          ))}
        </div>
      </div>
      {editing && <AppointmentForm initial={editing} patients={patients} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  )
}

function Row({ hour, days, items, onNew, onOpen }) {
  return (
    <>
      <div className="agenda-hour">{String(hour).padStart(2, '0')}:00</div>
      {days.map((d) => {
        const here = items.filter((a) => {
          const s = new Date(a.starts_at)
          return iso(s) === iso(d) && s.getHours() === hour
        })
        return (
          <div key={iso(d)} className="agenda-cell" role="button" tabIndex={0} aria-label={`Agendar ${iso(d)} ${hour}h`}
            onClick={() => onNew(d, hour)} onKeyDown={(e) => e.key === 'Enter' && onNew(d, hour)}>
            {here.map((a) => {
              const s = new Date(a.starts_at)
              const mins = (new Date(a.ends_at) - s) / 60_000
              return (
                <button key={a.id} className={`agenda-appt ${a.status}`}
                  style={{ top: (s.getMinutes() / 60) * ROW, height: Math.max(20, (mins / 60) * ROW - 2) }}
                  onClick={(e) => { e.stopPropagation(); onOpen(a) }}>
                  {a.patient_name || a.lead_name}
                  <small>{hhmm(s)} · {a.kind || STATUS[a.status]}{!a.patient_id ? ' · novo' : ''}</small>
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
