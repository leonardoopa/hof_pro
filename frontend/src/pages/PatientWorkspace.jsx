import { Archive, ArchiveRestore, ChevronLeft, Eye, EyeOff } from 'lucide-react'
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
  const [confirm, setConfirm] = useState(null) // 'archive' | 'anonymize'

  useEffect(() => {
    setPatient(null)
    api.patients.get(patientId).then(setPatient).catch(setError)
  }, [patientId])

  // Ocultar, mostrar e reativar devolvem o paciente atualizado e a tela continua aberta.
  async function change(action) {
    setError(null)
    try {
      setPatient(await action(patient.id))
    } catch (err) {
      setError(err)
    }
  }

  async function archive() {
    try {
      await api.patients.archive(patient.id)
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
        {patient.archived_at && <span className="chip warn">Arquivado</span>}
        <span className="spacer" />
        {patient.anonymized_at ? (
          <button className="btn ghost small" onClick={() => change(api.patients.reveal)}>
            <Eye size={15} /> Mostrar dados
          </button>
        ) : (
          <button className="btn ghost small" onClick={() => setConfirm('anonymize')}>
            <EyeOff size={15} /> Ocultar dados
          </button>
        )}
        {patient.archived_at ? (
          <button className="btn ghost small" onClick={() => change(api.patients.unarchive)}>
            <ArchiveRestore size={15} /> Reativar
          </button>
        ) : (
          <button className="btn ghost small" onClick={() => setConfirm('archive')}>
            <Archive size={15} /> Arquivar
          </button>
        )}
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

      {confirm === 'archive' && (
        <ConfirmModal
          title="Arquivar paciente"
          message={`${patient.full_name} sai da lista de pacientes. Nada é apagado: em "Ver arquivados" você abre a ficha e pode reativar.`}
          confirmLabel="Arquivar"
          onConfirm={archive}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'anonymize' && (
        <ConfirmModal
          title="Ocultar dados do paciente"
          message={'Nome, nascimento, contato, observações e fotos saem das telas e dos documentos, e o planejamento fica fechado. Nada é apagado: "Mostrar dados" traz tudo de volta. Anamnese, termos assinados e rastreabilidade continuam visíveis.'}
          confirmLabel="Ocultar dados"
          onConfirm={() => change(api.patients.anonymize)}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
