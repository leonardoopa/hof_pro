import { ChevronLeft, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import ErrorList from '../components/ErrorList'
import { ageFrom } from './PatientsPage'

const STEPS = [
  { to: 'anamnese', label: 'Anamnese' },
  { to: 'planejamento', label: 'Planejamento' },
  { to: 'prontuario', label: 'Prontuário / Termos' },
  { to: 'resumo', label: 'Resumo e Orientações' },
]

export default function PatientWorkspace() {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setPatient(null)
    api.patients.get(patientId).then(setPatient).catch(setError)
  }, [patientId])

  async function remove() {
    if (!window.confirm(`Excluir ${patient.full_name} e todos os dados dele(a)? Isso não pode ser desfeito.`)) return
    try {
      await api.patients.remove(patient.id)
      navigate('/pacientes')
    } catch (err) {
      setError(err)
    }
  }

  if (error && !patient) return <ErrorList error={error} />
  if (!patient) return <div className="boot">Carregando…</div>

  const age = ageFrom(patient.birth_date)

  return (
    <>
      <div className="patient-head">
        <button className="icon-btn" onClick={() => navigate('/pacientes')} aria-label="Voltar para pacientes">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1>{patient.full_name}</h1>
          <span className="meta">{[age != null && `${age} anos`, patient.phone, patient.email].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="spacer" />
        <button className="btn ghost danger small" onClick={remove}>
          <Trash2 size={15} /> Excluir
        </button>
      </div>

      <ErrorList error={error} />

      <nav className="stepper" aria-label="Etapas do atendimento">
        {STEPS.map((step, i) => (
          <NavLink key={step.to} to={step.to} className="step">
            <span className="num">{i + 1}</span>
            {step.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ patient }} />
    </>
  )
}
