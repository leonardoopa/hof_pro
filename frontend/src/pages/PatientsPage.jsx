import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { initials } from '../components/AppLayout'
import ErrorList from '../components/ErrorList'
import Modal from '../components/Modal'

export function ageFrom(birthDate) {
  if (!birthDate) return null
  const born = new Date(birthDate)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age -= 1
  return age
}

function NewPatientModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: '', birth_date: '', phone: '', email: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onCreated(await api.patients.create({ ...form, birth_date: form.birth_date || null }))
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Modal title="Novo paciente" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorList error={error} />
        <label className="field">
          <span>Nome completo</span>
          <input className="input" value={form.full_name} onChange={set('full_name')} required minLength={2} autoFocus />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Nascimento</span>
            <input className="input" type="date" value={form.birth_date} onChange={set('birth_date')} />
          </label>
          <label className="field">
            <span>Telefone</span>
            <input className="input" type="tel" value={form.phone} onChange={set('phone')} />
          </label>
        </div>
        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" value={form.email} onChange={set('email')} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function PatientsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [patients, setPatients] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    (q) =>
      api.patients
        .list(q)
        .then((rows) => {
          setPatients(rows)
          setError(null)
        })
        .catch(setError),
    [],
  )

  useEffect(() => {
    const timer = setTimeout(() => load(query), 250)
    return () => clearTimeout(timer)
  }, [query, load])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pacientes</h1>
          <p>Prontuários, anamnese e planejamentos de cada paciente.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={17} /> Novo paciente
        </button>
      </div>

      <div className="toolbar">
        <label className="search">
          <Search size={17} />
          <input
            className="input"
            placeholder="Buscar por nome, telefone ou e-mail"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar paciente"
          />
        </label>
      </div>

      <ErrorList error={error} />

      {patients && patients.length === 0 && (
        <div className="card empty">
          <p>{query ? 'Nenhum paciente encontrado.' : 'Nenhum paciente cadastrado ainda.'}</p>
          {!query && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              Cadastrar primeiro paciente
            </button>
          )}
        </div>
      )}

      <div className="patient-list">
        {patients?.map((p) => {
          const age = ageFrom(p.birth_date)
          return (
            <Link key={p.id} to={`/pacientes/${p.id}`} className="patient-row">
              <div className="avatar">{initials(p.full_name)}</div>
              <div>
                <strong>{p.full_name}</strong>
                <span className="meta">{[age != null && `${age} anos`, p.phone].filter(Boolean).join(' · ') || 'Sem contato'}</span>
              </div>
              <div className="row-chips">
                <span className={`chip ${p.anamnesis_done ? 'ok' : 'warn'}`}>Anamnese {p.anamnesis_done ? 'concluída' : 'pendente'}</span>
                <span className="chip">{p.plans_count} {p.plans_count === 1 ? 'plano' : 'planos'}</span>
              </div>
            </Link>
          )
        })}
      </div>

      {creating && (
        <NewPatientModal
          onClose={() => setCreating(false)}
          onCreated={(patient) => navigate(`/pacientes/${patient.id}/anamnese`)}
        />
      )}
    </>
  )
}
