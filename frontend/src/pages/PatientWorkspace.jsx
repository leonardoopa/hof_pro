import { ChevronLeft, EyeOff, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import ErrorList from '../components/ErrorList'
import { ageFrom } from './PatientsPage'

const STEPS = [
  { to: 'anamnese', label: 'Anamnese' },
  { to: 'planejamento', label: 'Planejamento' },
  { to: 'evolucao', label: 'Evolução' },
  { to: 'prontuario', label: 'Prontuário / Termos' },
  { to: 'resumo', label: 'Resumo e Orientações' },
]

export default function PatientWorkspace() {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(null) // 'remove' | 'anonymize'

  useEffect(() => {
    setPatient(null)
    api.patients.get(patientId).then(setPatient).catch(setError)
  }, [patientId])

  async function anonymize() {
    try {
      setPatient(await api.patients.anonymize(patient.id))
    } catch (err) {
      setError(err)
    }
  }

  async function remove() {
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
        {!patient.anonymized_at && (
          <button className="btn ghost small" onClick={() => setConfirm('anonymize')}>
            <EyeOff size={15} /> Anonimizar
          </button>
        )}
        <button className="btn ghost danger small" onClick={() => setConfirm('remove')}>
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

      {confirm === 'remove' && (
        <ConfirmModal
          title="Excluir paciente"
          message={`Excluir ${patient.full_name} e todos os dados dele(a)? Isso não pode ser desfeito.`}
          confirmLabel="Excluir"
          danger
          onConfirm={remove}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'anonymize' && (
        <ConfirmModal
          title="Anonimizar paciente"
          message="Nome, contato, observações e fotos serão apagados; o registro clínico e a rastreabilidade são mantidos. Isso não pode ser desfeito."
          confirmLabel="Anonimizar"
          danger
          onConfirm={anonymize}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
