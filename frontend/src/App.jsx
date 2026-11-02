import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import AppLayout from './components/AppLayout'
import AnamnesisStep from './pages/AnamnesisStep'
import AuthPage from './pages/AuthPage'
import ComingSoon from './pages/ComingSoon'
import PatientsPage from './pages/PatientsPage'
import PatientWorkspace from './pages/PatientWorkspace'
import PlanningStep from './pages/PlanningStep'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">Carregando…</div>
  return user ? children : <Navigate to="/entrar" replace />
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">Carregando…</div>
  return user ? <Navigate to="/pacientes" replace /> : children
}

export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/cadastro" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />

      <Route element={<Protected><AppLayout /></Protected>}>
        <Route path="/pacientes" element={<PatientsPage />} />
        <Route path="/pacientes/:patientId" element={<PatientWorkspace />}>
          <Route index element={<Navigate to="anamnese" replace />} />
          <Route path="anamnese" element={<AnamnesisStep />} />
          <Route path="planejamento" element={<PlanningStep />} />
          <Route
            path="prontuario"
            element={<ComingSoon title="Prontuário e termos" text="Termos de consentimento e assinatura digital do paciente, depois do planejamento." />}
          />
          <Route
            path="resumo"
            element={<ComingSoon title="Resumo e orientações" text="Resumo do plano e orientações pós-procedimento para o paciente." />}
          />
        </Route>
        <Route
          path="/estoque"
          element={<ComingSoon title="Estoque" text="Controle de produtos com marca, lote e validade, com alerta de vencimento." />}
        />
        <Route
          path="/financeiro"
          element={<ComingSoon title="Financeiro" text="Orçamentos e recebimentos ligados ao plano de cada paciente." />}
        />
      </Route>

      <Route path="*" element={<Navigate to="/pacientes" replace />} />
    </Routes>
  )
}
